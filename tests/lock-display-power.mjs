import assert from 'node:assert/strict';
import { createLockDisplayPower, readHyprlandMonitors } from '../apps/lock-display-power.js';

const calls = [], monitors = [
  { name: 'eDP-1', dpmsStatus: false, disabled: false },
  { name: 'DP-1', dpmsStatus: true, disabled: false },
  { name: 'HDMI-A-1', dpmsStatus: false, disabled: true }
];
let queries = 0;
const power = createLockDisplayPower({
  readMonitors: async () => { queries++; return monitors; },
  setRendering: async (win, enabled) => { calls.push([win, enabled]); }
});
power.add('eDP-1', 1);
power.add('DP-1', 2);
power.add('HDMI-A-1', 3);
await power.refresh();
assert.equal(queries, 1, 'one monitor query for every screen');
assert.deepEqual(calls, [[1, false]], 'only connected DPMS-off outputs stop rendering');
await power.refresh();
assert.equal(queries, 2);
assert.deepEqual(calls, [[1, false]], 'unchanged state does not repeat compositor calls');
monitors[1].dpmsStatus = false;
await power.refresh();
assert.deepEqual(calls.at(-1), [2, false]);
await power.resume();
assert.deepEqual(calls.slice(-2), [[1, true], [2, true]], 'wake resumes all paused lock windows before feedback or unlock');
monitors[0].dpmsStatus = true;
monitors[1].dpmsStatus = true;
await power.refresh();
assert.deepEqual(calls.slice(-2), [[1, true], [2, true]]);
monitors.push({ name: 'DP-2', dpmsStatus: false, disabled: false });
power.add('DP-2', 4);
await power.refresh();
assert.deepEqual(calls.at(-1), [4, false], 'new screens inherit their own DPMS state');
monitors[3].dpmsStatus = true;
await power.refresh();
assert.deepEqual(calls.at(-1), [4, true]);
monitors.splice(3, 1);
power.remove('DP-2');
monitors[0].dpmsStatus = false;
await power.refresh();
assert.deepEqual(calls.at(-1), [1, false]);
delete monitors[0].dpmsStatus;
await power.refresh();
assert.deepEqual(calls.at(-1), [1, true], 'unknown DPMS state keeps lock visible');

const spawn = ({ cmd, args }) => {
  assert.deepEqual([cmd, ...args], ['hyprctl', '-j', 'monitors', 'all']);
  return { stdout: { on: (_, fn) => queueMicrotask(() => fn(JSON.stringify(monitors))) },
    on: (_, fn) => setTimeout(() => fn(0), 0) };
};
assert.deepEqual(await readHyprlandMonitors(spawn), monitors);
let failQuery = true;
const resilient = createLockDisplayPower({
  readMonitors: async () => {
    if (failQuery) throw new Error('hyprctl unavailable');
    return [{ name: 'eDP-1', dpmsStatus: false, disabled: false }];
  },
  setRendering: async (win, enabled) => calls.push([win, enabled])
});
resilient.add('eDP-1', 9);
await assert.rejects(resilient.refresh(), /hyprctl unavailable/);
assert.equal(resilient.allOff, false, 'query failure keeps a new lock screen visible');
failQuery = false;
await resilient.refresh();
assert.deepEqual(calls.at(-1), [9, false], 'a later successful query still applies');
assert.equal(resilient.allOff, true);
failQuery = true;
await assert.rejects(resilient.refresh(), /hyprctl unavailable/);
assert.deepEqual(calls.at(-1), [9, true], 'query failure restores a previously paused lock window');
assert.equal(resilient.allOff, false);
failQuery = false;
await resilient.refresh();
assert.deepEqual(calls.at(-1), [9, false], 'a later successful query reapplies DPMS state');
await resilient.resume();
assert.deepEqual(calls.at(-1), [9, true]);
assert.equal(resilient.allOff, false);
let releaseQuery;
const orderedCalls = [];
const ordered = createLockDisplayPower({
  readMonitors: () => new Promise(resolve => { releaseQuery = resolve; }),
  setRendering: async (win, enabled) => orderedCalls.push(enabled)
});
ordered.add('eDP-1', 10);
const staleRefresh = ordered.refresh();
await Promise.resolve();
const wake = ordered.resume();
releaseQuery([{ name: 'eDP-1', dpmsStatus: false, disabled: false }]);
await Promise.all([staleRefresh, wake]);
assert.deepEqual(orderedCalls, [false, true], 'wake wins over an in-flight stale DPMS snapshot');
await assert.rejects(readHyprlandMonitors(() => ({
  stdout: { on: (_, fn) => queueMicrotask(() => fn('Invalid dispatcher')) },
  on: (_, fn) => setTimeout(() => fn(0), 0)
})), /JSON/, 'exit zero with invalid output is not a valid monitor snapshot');
console.log('Lock display power: passed');
