import { createPromptQueue, promptReply } from './ssh-agent-model.js';

// sudo calls askpass afresh after a refusal, with the same question. A repeat
// this soon after an answer is that retry.
const RETRY_WINDOW = 20000;
const ASKPASS = 'org.koya.Askpass.';

// One queue owns all password surfaces. Native polkit owns its challenges;
// askpass and SSH receive only the answer belonging to their own request.
// Polkit requests hold their surface while PAM checks an answer, so a refusal
// is shown on the same dialog.
export function createAuthentication({ backend, show, onError = () => {}, now = () => Date.now() }) {
  let allowed = false, started = false, answered;
  const requests = new Map(), conversations = new Map();
  const queue = createPromptQueue({ show, encode: (id, answer) => ({ id, answer }), onError,
    hold: entry => entry.id.startsWith('polkit:'),
    reply: ({ id, answer }) => {
      const request = requests.get(id);
      if (!request) return;
      if (!request.hold || answer === null) requests.delete(id);
      request.reply(allowed ? answer : null);
    }
  });
  const dismiss = id => { requests.delete(id); return queue.receive({ type: 'dismiss', id }); };
  const prompt = (id, text, options, reply, hold = false) => {
    if (!allowed) { reply(null); return; }
    requests.set(id, { reply, hold });
    queue.receive({ type: 'prompt', id, text, options, status: options.status, error: options.error });
  };
  const event = ({ member, args = [] }) => {
    const [id, first, second, third, fourth] = args, key = 'polkit:' + id;
    if (member === 'AuthenticationBegin') conversations.set(id, { action: first, message: second, user: third, requester: fourth || '', status: '', error: false });
    else if (member === 'AuthenticationPrompt') {
      const context = conversations.get(id);
      if (!context) return;
      const askpass = context.action.startsWith(ASKPASS);
      const mode = askpass ? context.action.slice(ASKPASS.length) : 'entry';
      const retry = askpass && mode === 'entry' && answered?.question === first && now() - answered.at < RETRY_WINDOW;
      const options = { source: askpass ? 'askpass' : 'polkit', action: context.action, message: context.message, user: context.user, requester: context.requester,
        question: first, mode, echo: !!second, retry, status: retry ? 'Incorrect password' : context.status, error: retry || context.error,
        confirm: mode === 'entry' ? 'Authenticate' : mode === 'confirm' ? 'Allow' : 'Close' };
      prompt(key, [context.message, context.user && 'As ' + context.user, first].filter(Boolean).join('\n'), options, answer => {
        if (answer === null) { backend.cancel(id); return; }
        if (askpass && mode === 'entry') answered = { question: first, at: now() };
        backend.respond(id, answer);
      }, true);
    } else if (member === 'AuthenticationMessage') {
      const context = conversations.get(id);
      if (context) {
        context.status = first; context.error = !!second;
        queue.receive({ type: 'update', id: key, status: first, error: !!second });
      }
    } else if (member === 'AuthenticationEnd') { conversations.delete(id); dismiss(key); }
  };
  return {
    setAvailable(value) {
      allowed = value;
      if (!value) {
        for (const [id, request] of [...requests]) {
          requests.delete(id);
          try { request.reply(null); } catch (error) { onError(error); }
        }
        queue.clear(); conversations.clear(); answered = undefined;
        backend.stop(); started = false;
      } else if (!started) {
        try { const registered = backend.start(event); started = true; return registered; }
        catch (error) { allowed = false; onError(error); }
      }
    },
    async ask(question, mode, sender) {
      if (!allowed || !started) return Promise.reject(new Error('Authentication requires an active unlocked session'));
      if (typeof question !== 'string' || !question || question.length > 2048 || question.includes('\0') || !['entry', 'confirm', 'none'].includes(mode))
        return Promise.reject(new Error('Invalid authentication request'));
      return backend.ask(question, mode, sender);
    },
    ssh(event, reply) {
      const key = 'ssh:' + event.id;
      if (event.type === 'prompt') prompt(key, event.text, { source: 'ssh', question: event.text, mode: 'entry' },
        answer => reply(promptReply(event.id, answer)));
      else if (event.type === 'dismiss') dismiss(key);
    },
    clearSsh() {
      for (const id of [...requests.keys()]) if (id.startsWith('ssh:')) dismiss(id);
    },
    settled: () => queue.settled()
  };
}
