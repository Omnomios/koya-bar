import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real cursor controller with an asynchronous compositor boundary;
// no graphical session or live desktop cursor is touched by this test.
const calls = [], destroyed = [], errors = [];
let pointerReady = true;
const context = vm.createContext({});
const platform = {
  'Koya/Compositor': {
    setCursor: async (win, shape) => { calls.push([win, shape]); return pointerReady; },
    destroyWindow: async win => { destroyed.push(win); }
  },
  'Helix/Log': { error: message => errors.push(message) }
};
const source = new vm.SourceTextModule(readFileSync(new URL('../apps/cursor.js', import.meta.url), 'utf8'), { context });
await source.link(name => {
  if (name === './cursor-model.js') return new vm.SourceTextModule(readFileSync(new URL('../apps/cursor-model.js', import.meta.url), 'utf8'), { context });
  const exports = platform[name];
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
});
await source.evaluate();
const { surfaceCursor, controlCursor, dragCursor, resetCursor, destroySurface } = source.namespace;
const event = phase => ({ source: 'mouse', phase });
const root = surfaceCursor(1), button = controlCursor(1), field = controlCursor(1, 'text'), drag = dragCursor(1);
await Promise.all([root(event('enter')), button(event('enter'))]);
assert.deepEqual(calls, [[1, 'pointer']], 'Batch root/child events into the final cursor');
await root(event('move')); assert.equal(calls.length, 1, 'Avoid redundant cursor requests');
await field(event('enter')); await root(event('move')); await button(event('move'));
assert.deepEqual(calls.at(-1), [1, 'text']);
await field(event('leave')); assert.deepEqual(calls.at(-1), [1, 'pointer']);
await button(event('leave')); assert.deepEqual(calls.at(-1), [1, 'default']);
await root(event('leave'));
const beforeReenter = calls.length;
await root(event('enter')); assert.equal(calls.length, beforeReenter + 1, 'Entering again must explicitly replace another client cursor');

pointerReady = false;
await button(event('enter')); const beforeRetry = calls.length;
pointerReady = true;
await button(event('move')); assert.equal(calls.length, beforeRetry + 1, 'Retry a cursor request that arrived before pointer readiness');
await button(event('move')); assert.equal(calls.length, beforeRetry + 1);
await drag({ ...event('start'), interactionId: 'drag-a' });
await Promise.all([button(event('leave')), root(event('leave'))]);
assert.deepEqual(calls.at(-1), [1, 'ew-resize']);
await root(event('enter'));
await drag({ ...event('cancel'), interactionId: 'drag-a' });
assert.deepEqual(calls.at(-1), [1, 'default']);
const beforeTouch = calls.length;
await drag({ source: 'touch', phase: 'start', interactionId: 'finger' });
await button({ source: 'touch', phase: 'enter' });
assert.equal(calls.length, beforeTouch);

await field(event('enter')); await resetCursor(1);
assert.deepEqual(calls.at(-1), [1, 'default'], 'Hiding a surface must restore the default cursor');
await button(event('enter')); await destroySurface(1);
assert.deepEqual(calls.at(-1), [1, 'default']); assert.deepEqual(destroyed, [1]);
const beforeLate = calls.length;
await button(event('enter')); await root(event('move'));
assert.equal(calls.length, beforeLate, 'Destroyed surfaces must ignore queued hover');
const otherRoot = surfaceCursor(2); await otherRoot(event('enter'));
assert.deepEqual(calls.at(-1), [2, 'default'], 'Each window manages its own cursor state');
assert.deepEqual(errors, []);
console.log('Surface cursor lifecycle: passed');
