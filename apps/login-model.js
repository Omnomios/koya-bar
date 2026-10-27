// greetd owns the PAM conversation and session lifecycle. Each reply advances
// one conversation; passwords are supplied only in response to its prompts.
export function createLoginController({ request, onState = () => {}, onStarted }) {
  // `error`: the last attempt failed (message says why); `refused`: PAM
  // rejected the answer, so the same account can simply try again. `notice`: text PAM
  // sent alongside its prompts (info or error messages), for display.
  const state = { phase: 'username', username: '', prompt: '', secret: true, message: 'Enter your user name.', busy: false, error: false, refused: false, notice: '' };
  let session, authenticating = false;
  const notify = () => onState({ ...state });
  const send = value => request(JSON.stringify(value));
  const cancel = async () => {
    if (authenticating) {
      try { await send({ type: 'cancel_session' }); }
      finally { authenticating = false; }
    }
  };
  const advance = async reply => {
    for (;;) {
      if (reply?.type === 'error') {
        const error = new Error(reply.error_type === 'auth_error' ? 'Authentication failed. Try again.' : reply.description || 'Login failed.');
        error.refused = reply.error_type === 'auth_error'; throw error;
      }
      if (reply?.type === 'success') {
        state.phase = 'starting'; state.message = 'Starting ' + session.name + '…'; await notify();
        // greetd connects the session's output to its VT. Keep compositor and
        // desktop logs in the journal during the graphical handoff.
        const cmd = ['/usr/bin/systemd-cat', '--identifier=koya-session', '--', ...session.cmd];
        const result = await send({ type: 'start_session', cmd, env: session.env });
        if (result?.type !== 'success') throw new Error(result?.description || 'Could not start the session.');
        authenticating = false; state.phase = 'started';
        // greetd waits for the greeter to exit. Release raw output before quit.
        await onStarted();
        return true;
      }
      if (reply?.type !== 'auth_message' || typeof reply.auth_message !== 'string') throw new Error('Unexpected reply from greetd.');
      const type = reply.auth_message_type;
      if (type === 'secret' || type === 'visible') {
        state.phase = 'prompt'; state.prompt = reply.auth_message; state.secret = type === 'secret'; state.message = reply.auth_message;
        return false;
      }
      if (type !== 'info' && type !== 'error') throw new Error('Unknown authentication prompt.');
      state.message = reply.auth_message; state.notice = reply.auth_message; await notify();
      reply = await send({ type: 'post_auth_message_response', response: null });
    }
  };
  const run = async operation => {
    if (state.busy || state.phase === 'started') return false;
    state.busy = true; state.error = state.refused = false; await notify();
    try { return await operation(); }
    catch (error) {
      if (state.phase === 'started') throw error;
      try { await cancel(); } catch (_) { /* A disconnected transport has no reusable conversation. */ }
      state.phase = 'username'; state.prompt = ''; state.notice = ''; state.error = true; state.refused = !!error.refused; state.message = error.message || 'Login connection failed. Try again.';
      return false;
    } finally { state.busy = false; await notify(); }
  };
  return {
    get state() { return { ...state }; },
    begin(username, selected) {
      if (state.phase !== 'username') return Promise.resolve(false);
      return run(async () => {
        username = username.trim();
        if (!username || username.length > 256 || /[\x00-\x1f\x7f]/.test(username)) throw new Error('Enter a valid user name.');
        if (!selected?.cmd?.length) throw new Error('Choose an installed Wayland session.');
        session = selected; state.username = username; state.phase = 'authenticating'; state.notice = ''; state.message = 'Signing in…'; authenticating = true;
        await notify();
        return advance(await send({ type: 'create_session', username }));
      });
    },
    respond(answer) {
      if (state.phase !== 'prompt') return Promise.resolve(false);
      return run(async () => {
        const response = send({ type: 'post_auth_message_response', response: answer }); answer = '';
        state.message = 'Checking…'; await notify();
        return advance(await response);
      });
    },
    // The session can change until it starts: greetd only needs its command
    // once authentication succeeds.
    chooseSession(selected) {
      if (state.phase === 'starting' || state.phase === 'started' || !selected?.cmd?.length) return false;
      session = selected; return true;
    },
    cancel() {
      return run(async () => {
        await cancel(); state.phase = 'username'; state.prompt = ''; state.notice = ''; state.message = 'Enter your user name.';
        return false;
      });
    }
  };
}
