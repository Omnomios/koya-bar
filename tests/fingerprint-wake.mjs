import assert from 'node:assert/strict';
import { createLockController, sensorMessage } from '../apps/lock-model.js';
import { wakeHyprland } from '../apps/fingerprint-wake.js';
import { createFingerprintAuth } from '../apps/fingerprint-auth.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const attempt = (wakeDisplay, unlock = async () => true) => {
  let report, finish;
  const controller = createLockController({
    fingerprint: {
      verify: progress => { report = progress; return new Promise(resolve => { finish = resolve; }); },
      cancel: async () => {}
    },
    lockState: async () => 'locked', unlock, wakeDisplay
  });
  return { controller, report: (...args) => report(...args), finish: value => finish(value) };
};

let wakes = 0;
let run = attempt(() => { wakes++; });
let scanning = run.controller.scan(); await tick();
assert.equal(wakes, 0, 'starting an idle scan must leave DPMS off');
run.report('Touch the sensor', 'info');
run.report('Verification timed out', 'error');
assert.equal(wakes, 0, 'initial prompts and timeouts must leave DPMS off');
run.finish({ ok: false, reason: 'retry', timedOut: true });
assert.equal(await scanning, false); assert.equal(wakes, 0);

run = attempt(() => { wakes++; }); scanning = run.controller.scan(); await tick();
run.report('Failed to match fingerprint', 'error');
run.report('Touch the sensor again', 'info');
await tick(); assert.equal(wakes, 1, 'feedback from one scan wakes once');
run.finish({ ok: false, reason: 'retry' }); await scanning;
assert.equal(wakes, 1, 'the final failure must not duplicate a feedback wake');

for (const [message, type] of [
  ['Your finger was not centered, try swiping your finger again', 'info'],
  ['Reader reported a hardware failure', 'error']
]) {
  run = attempt(() => { wakes++; }); scanning = run.controller.scan(); await tick();
  run.report(message, type); await tick();
  assert.equal(wakes, message.startsWith('Your') ? 2 : 3);
  run.finish({ ok: false, reason: 'retry' }); await scanning;
}

run = attempt(() => { wakes++; }); scanning = run.controller.scan(); await tick();
run.finish({ ok: false, reason: 'attempts' });
assert.equal(await scanning, false); assert.equal(wakes, 4, 'a final failed outcome wakes without a message');

run = attempt(() => { wakes++; }); scanning = run.controller.scan(); await tick();
run.finish({ ok: false, reason: 'configuration' });
assert.equal(await scanning, false); assert.equal(wakes, 4, 'configuration failure without a scan leaves DPMS off');

const order = [];
run = attempt(() => { order.push('wake'); }, async () => { order.push('unlock'); return true; });
scanning = run.controller.scan(); await tick();
run.report('Touch the sensor', 'info'); assert.deepEqual(order, []);
run.finish({ ok: true }); assert.equal(await scanning, true);
assert.deepEqual(order, ['wake', 'unlock'], 'successful fingerprint wakes before unlock handoff');

const successOrder = [];
run = attempt(() => { successOrder.push('wake'); }, async () => { successOrder.push('unlock'); return true; });
scanning = run.controller.scan(); await tick();
run.report('Failed to match fingerprint', 'error');
await tick();
assert.deepEqual(successOrder, ['wake']);
// DPMS can go off again while PAM continues listening after the mismatch.
run.finish({ ok: true });
assert.equal(await scanning, true);
assert.deepEqual(successOrder, ['wake', 'wake', 'unlock'], 'success wakes again after earlier feedback');

let wakeAttempts = 0;
run = attempt(() => { if (++wakeAttempts === 1) throw new Error('first wake failed'); }, async () => {
  assert.equal(wakeAttempts, 2, 'success retries after a failed feedback wake');
  return true;
});
scanning = run.controller.scan(); await tick();
run.report('Failed to match fingerprint', 'error'); await tick();
run.finish({ ok: true });
assert.equal(await scanning, true);

assert.deepEqual(sensorMessage('Verification timed out, try again'),
  { reaction: null, text: 'Touch the sensor' }, 'timeout takes precedence over reaction words');
let mixedTimeoutWakes = 0;
run = attempt(() => { mixedTimeoutWakes++; });
scanning = run.controller.scan(); await tick();
run.report('Verification timed out, try again', 'error');
run.finish({ ok: false, reason: 'retry', timedOut: true });
assert.equal(await scanning, false);
assert.equal(mixedTimeoutWakes, 0, 'timeout with reaction words stays quiet');

let queuedWakes = 0;
run = attempt(() => { queuedWakes++; });
scanning = run.controller.scan(); await tick();
run.report('Failed to match fingerprint', 'error');
const cancelledBeforeWake = run.controller.cancelFingerprint();
run.finish({ ok: false, cancelled: true });
await cancelledBeforeWake; await scanning;
assert.equal(queuedWakes, 0, 'cancellation in the feedback turn suppresses the queued wake');

run = attempt(() => { throw new Error('hyprctl failed'); }, async () => { order.push('unlock after wake error'); return true; });
scanning = run.controller.scan(); await tick(); run.finish({ ok: true });
assert.equal(await scanning, true, 'wake errors must not suppress authentication success');
assert.equal(order.at(-1), 'unlock after wake error');

run = attempt(() => { wakes++; }, async () => assert.fail('cancelled fingerprint unlocked'));
scanning = run.controller.scan(); await tick();
const cancelling = run.controller.cancelFingerprint();
run.report('Failed to match fingerprint', 'error');
run.finish({ ok: true }); await cancelling;
assert.equal(await scanning, false); assert.equal(wakes, 4, 'cancelled feedback must not wake');

const commands = [];
const spawn = ({ cmd, args }) => {
  commands.push([cmd, ...args]);
  const reply = commands.length === 1 ? ['Invalid dispatcher', 0] : ['ok\n', 0];
  return {
    stdout: { on: (_, callback) => queueMicrotask(() => callback(reply[0])) },
    on: (_, callback) => setTimeout(() => callback(reply[1]), 0)
  };
};
await wakeHyprland(spawn);
assert.deepEqual(commands, [
  ['hyprctl', 'dispatch', 'hl.dsp.dpms({ action = "on" })'],
  ['hyprctl', 'dispatch', 'dpms', 'on']
]);
await assert.rejects(wakeHyprland(() => ({
  stdout: { on: (_, callback) => queueMicrotask(() => callback('error\n')) },
  on: (_, callback) => setTimeout(() => callback(0), 0)
})), /hyprctl DPMS wake failed/, 'a zero exit with an error reply is not success');

let options, finish;
const auth = createFingerprintAuth({ begin: value => {
  options = value;
  return { result: new Promise(resolve => { finish = resolve; }), cancel: async () => {} };
} }, { user: 'fixture', configured: () => true });
const messages = [];
const checking = auth.verify((message, type) => messages.push([message, type]));
options.onMessage({ type: 'info', message: 'Touch the sensor' });
options.onMessage({ type: 'error', message: 'Failed to match fingerprint' });
assert.deepEqual(messages, [['Touch the sensor', 'info'], ['Failed to match fingerprint', 'error']]);
finish({ ok: false, phase: 'timeout', pamCode: 26 });
assert.equal((await checking).timedOut, true, 'PAM timeout remains distinguishable from a failed scan');
const pamTimedOut = auth.verify();
options.onMessage({ type: 'info', message: 'Verification timed out' });
finish({ ok: false, phase: 'authentication', pamCode: 9 });
assert.equal((await pamTimedOut).timedOut, true, 'pam_fprintd timeout message marks its authentication-phase failure');
const pamErrorTimedOut = auth.verify();
options.onMessage({ type: 'error', message: 'Verification timed out' });
finish({ ok: false, phase: 'authentication', pamCode: 9 });
assert.equal((await pamErrorTimedOut).timedOut, true, 'PAM error timeout also marks its authentication-phase failure');
let timeoutWakes = 0;
const timeoutController = createLockController({
  fingerprint: auth, lockState: async () => 'locked',
  wakeDisplay: () => { timeoutWakes++; }
});
const idleScan = timeoutController.scan();
await tick();
options.onMessage({ type: 'error', message: 'Verification timed out' });
finish({ ok: false, phase: 'authentication', pamCode: 9 });
assert.equal(await idleScan, false);
assert.equal(timeoutWakes, 0, 'PAM error timeout never wakes after the final authentication failure');

console.log('Fingerprint wake policy: passed');
