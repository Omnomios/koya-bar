// The backend's private stdout pipe contains prompts, never passphrases.
export function promptEvents(receive) {
  let buffer = '';
  return chunk => {
    buffer += chunk;
    if (buffer.length > 65536) throw new Error('SSH prompt stream exceeded its limit');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (line === 'READY') { receive({ type: 'ready' }); continue; }
      const match = /^(P|D) ([1-9][0-9]*)(?: (.*))?$/.exec(line);
      if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error('Invalid SSH prompt event');
      const id = Number(match[2]);
      if (match[1] === 'D') receive({ type: 'dismiss', id });
      else {
        const text = decodeURIComponent(match[3] || '');
        if (text.includes('\0') || text.length > 8192) throw new Error('Invalid SSH prompt');
        receive({ type: 'prompt', id, text });
      }
    }
  };
}
export function promptReply(id, answer) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid SSH prompt id');
  if (answer == null) return `C ${id}\n`;
  if (typeof answer !== 'string' || answer.length > 512 || /[\x00-\x1f\x7f]/.test(answer)) throw new Error('Invalid SSH passphrase');
  return `R ${id} ${encodeURIComponent(answer)}\n`;
}

// Serialize surface lifetimes. A canceled request can arrive while its window
// is still being built; finish building and dispose it before showing the next.
// A `hold` entry keeps its surface after an answer, until it is dismissed or
// asked again: the same surface then shows the retry.
export function createPromptQueue({ show, reply, encode = promptReply, onError = () => {}, hold = () => false }) {
  const pending = new Map();
  let active, work = Promise.resolve();
  const answer = (entry, secret) => {
    const id = entry.id;
    if (pending.get(id) !== entry || entry.waiting) return;
    if (secret != null && hold(entry)) {
      entry.waiting = true;
      try { reply(encode(id, secret)); } catch (_) { entry.waiting = false; onError(); }
      secret = undefined;
      return;
    }
    pending.delete(id);
    try { reply(encode(id, secret)); } catch (_) {
      try { reply(encode(id, null)); } catch (_) {}
      onError();
    }
    secret = undefined;
    return schedule();
  };
  const sync = async () => {
    while (true) {
      if (active && pending.get(active.id) !== active) {
        try { await active.surface?.dispose(); } catch (_) { onError(); }
        active = undefined;
      }
      if (active) {
        if (active.dirty) { active.dirty = false; await active.surface?.update?.(active); active.retry = false; }
        return;
      }
      if (!pending.size) return;
      active = pending.values().next().value;
      const entry = active;
      try { entry.surface = await show(entry.text, secret => answer(entry, secret), entry); }
      catch (_) { active = undefined; answer(entry, null); onError(); }
    }
  };
  const schedule = () => (work = work.then(sync).catch(() => { onError(); }));
  return {
    receive: event => {
      if (event.type === 'prompt') {
        const entry = pending.get(event.id);
        if (!entry) pending.set(event.id, { ...event });
        else if (entry.waiting) { Object.assign(entry, event, { waiting: false, retry: true }); entry.dirty = true; }
      } else if (event.type === 'update') {
        const entry = pending.get(event.id);
        if (entry) { Object.assign(entry, event); entry.dirty = true; }
      } else if (event.type === 'dismiss') pending.delete(event.id);
      return schedule();
    },
    clear: () => { pending.clear(); return schedule(); },
    settled: () => work
  };
}
