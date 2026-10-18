import assert from 'node:assert/strict';
import { createAuthentication } from '../apps/authentication-model.js';

let event, stops = 0, clock = 1000;
const answers = [], canceled = [], windows = [], disposed = [], sshReplies = [];
const backend = {
  start: callback => { event = callback; return true; }, stop: () => { stops++; },
  ask: async (...args) => args,
  respond: (id, answer) => answers.push([id, answer]),
  cancel: id => { canceled.push(id); event({ member: 'AuthenticationEnd', args: [id] }); }
};
const auth = createAuthentication({ backend, now: () => clock, show: async (text, respond, request) => {
  const window = { text, respond, request, retries: 0 }; windows.push(window);
  return { dispose: async () => disposed.push(window),
    update: async value => { window.status = value.status; window.error = value.error; if (value.retry) window.retries++; } };
} });
await assert.rejects(auth.ask('Password?', 'entry', ':1.2'), /active unlocked/);
auth.setAvailable(true);
const begin = (id, mode = 'entry', question = 'Password:', action = 'org.koya.Askpass.' + mode) => {
  event({ member: 'AuthenticationBegin', args: [id, action, 'Authorize this action', 'alice', 'sudo -A true'] });
  event({ member: 'AuthenticationPrompt', args: [id, question, false] });
};
begin(1, 'entry', 'Password:', 'org.freedesktop.policykit.exec'); await auth.settled();
assert.equal(windows[0].request.options.source, 'polkit');
auth.ssh({ type: 'prompt', id: 7, text: 'SSH passphrase' }, line => sshReplies.push(line));
await auth.settled(); assert.equal(windows.length, 1, 'SSH and polkit never stack password dialogs');

// A polkit answer holds its dialog while PAM checks it. A refusal comes back
// to the same dialog; the SSH prompt waits until the request ends.
await windows[0].respond('fixture password'); await auth.settled();
assert.deepEqual(answers, [[1, 'fixture password']]);
await windows[0].respond('double submit'); assert.equal(answers.length, 1, 'A held dialog answers once per prompt');
event({ member: 'AuthenticationMessage', args: [1, 'Incorrect password', true] }); await auth.settled();
assert.equal(windows[0].status, 'Incorrect password'); assert.equal(windows[0].error, true);
event({ member: 'AuthenticationPrompt', args: [1, 'Password:', false] }); await auth.settled();
assert.equal(windows.length, 1, 'A retry reuses the dialog'); assert.equal(windows[0].retries, 1);
await windows[0].respond('second try'); await auth.settled();
assert.deepEqual(answers.at(-1), [1, 'second try']);
event({ member: 'AuthenticationEnd', args: [1] }); await auth.settled();
assert(disposed.includes(windows[0]));
assert.equal(windows[1].text, 'SSH passphrase'); assert.equal(windows[1].request.options.source, 'ssh');
await windows[1].respond('fixture key'); await auth.settled();
assert.deepEqual(sshReplies, ['R 7 fixture%20key\n']);

// sudo asks afresh after a refusal: the same question soon after an answer.
const sudo = '[sudo] password for alice: ';
begin(2, 'entry', sudo); await auth.settled();
assert.equal(windows[2].request.options.retry, false); assert.equal(windows[2].request.options.requester, 'sudo -A true');
await windows[2].respond('wrong'); event({ member: 'AuthenticationEnd', args: [2] }); await auth.settled();
clock += 2500; begin(3, 'entry', sudo); await auth.settled();
assert.equal(windows[3].request.options.retry, true); assert.equal(windows[3].request.options.status, 'Incorrect password');
await windows[3].respond('right'); event({ member: 'AuthenticationEnd', args: [3] }); await auth.settled();
clock += 60000; begin(4, 'entry', sudo); await auth.settled();
assert.equal(windows[4].request.options.retry, false, 'A later sudo prompt is a new request');

// Losing the session cancels the open request and closes its dialog.
auth.setAvailable(false); await auth.settled();
assert(canceled.includes(4)); assert(disposed.includes(windows[4])); assert.equal(stops, 1);
await windows[4].respond('late'); assert.equal(answers.at(-1)[1], 'right');
await assert.rejects(auth.ask('Password?', 'entry', ':1.2'), /active unlocked/);
auth.ssh({ type: 'prompt', id: 8, text: 'Blocked' }, line => sshReplies.push(line));
assert.equal(sshReplies.at(-1), 'C 8\n');
auth.setAvailable(true); begin(5, 'confirm'); await auth.settled();
assert.equal(windows.at(-1).request.options.mode, 'confirm');
await windows.at(-1).respond(''); await auth.settled();
assert.deepEqual(answers.at(-1), [5, '']);
await assert.rejects(auth.ask('Password?', 'unknown', ':1.2'), /Invalid authentication/);
console.log('Authentication queue, retries, cancellation and session gating: passed');
