import assert from './assert.js';
import * as Log from 'Helix/Log';
import { promptEvents, promptReply, createPromptQueue } from '../apps/ssh-agent-model.js';

export async function test() {
const events = [], read = promptEvents(event => events.push(event));
read('REA'); read('DY\nP 1 Enter%20pass'); read('phrase%20%E9%AD%9A\nD 1\n');
assert.deepEqual(events, [{ type: 'ready' }, { type: 'prompt', id: 1, text: 'Enter passphrase 魚' }, { type: 'dismiss', id: 1 }]);
assert.equal(promptReply(9, 'x 魚%'), 'R 9 x%20%E9%AD%9A%25\n');
assert.equal(promptReply(9, null), 'C 9\n');
assert.equal(promptReply(9, ''), 'R 9 \n');
for (const text of ['P 0 bad\n', 'P 1 %ZZ\n', 'unexpected\n', 'P 1 %00\n']) assert.throws(() => promptEvents(() => {})(text));
for (const secret of ['x\ny', 'x\0y', 'x'.repeat(513)]) assert.throws(() => promptReply(1, secret));
const shown = [], disposed = [], replies = [], errors = [];
let finishBuild;
const queue = createPromptQueue({
  show: async (text, respond) => {
    shown.push({ text, respond });
    if (text === 'slow') await new Promise(resolve => { finishBuild = resolve; });
    return { dispose: async () => disposed.push(text) };
  }, reply: line => replies.push(line), onError: () => errors.push('failure')
});
queue.receive({ type: 'prompt', id: 1, text: 'slow' });
await Promise.resolve(); await Promise.resolve();
queue.receive({ type: 'prompt', id: 2, text: 'second' });
queue.receive({ type: 'dismiss', id: 1 });
finishBuild(); await queue.settled();
assert.deepEqual(disposed, ['slow']); assert.deepEqual(shown.map(prompt => prompt.text), ['slow', 'second']);
// An obsolete window must never answer a different queued request.
shown[0].respond('obsolete'); assert.deepEqual(replies, []);
await shown[1].respond('fixture password');
assert.deepEqual(replies, ['R 2 fixture%20password\n']); assert.deepEqual(disposed, ['slow', 'second']);
queue.receive({ type: 'dismiss', id: 2 });
queue.receive({ type: 'prompt', id: 3, text: 'retry' }); await queue.settled();
await shown[2].respond(null); assert.equal(replies.at(-1), 'C 3\n');
queue.receive({ type: 'prompt', id: 4, text: 'exit' }); await queue.settled();
await queue.clear(); assert.equal(disposed.at(-1), 'exit'); assert.equal(replies.length, 2);
assert.deepEqual(errors, []);
const failures = [];
const broken = createPromptQueue({ show: async () => { throw new Error('No display'); }, reply: line => failures.push(line) });
await broken.receive({ type: 'prompt', id: 5, text: 'unavailable' }); assert.deepEqual(failures, ['C 5\n']);
Log.info('SSH prompt protocol and queue: passed');

}
