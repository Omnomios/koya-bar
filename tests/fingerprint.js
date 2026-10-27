import assert from './assert.js';
import * as Log from 'Helix/Log';
import { createFingerprintService, suggestedFinger, enrollPrompt } from '../apps/fingerprint-model.js';
import { createLockController, sensorMessage, SENSOR_PROMPT } from '../apps/lock-model.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
export async function test() {
  const calls = []; let listener, enrolled = [], claimError, claimWait;
  const bus = {
    connect: async () => {}, addMatch: async () => {},
    onSignal: fn => { listener = fn; }, offSignal: fn => { assert.equal(fn, listener); listener = undefined; },
    async call(name, path, iface, method, signature, ...args) {
      calls.push([method, ...args]);
      if (method === 'GetDefaultDevice') return '/reader';
      if (method === 'GetNameOwner') return ':1.42';
      if (method === 'GetAll') return { name: 'Fixture', 'num-enroll-stages': 3 };
      if (method === 'ListEnrolledFingers') return [...enrolled];
      if (method === 'Claim') { if (claimError) throw new Error(claimError); if (claimWait) await claimWait; }
      if (method === 'DeleteEnrolledFinger') enrolled = enrolled.filter(f => f !== args[0]);
    }
  };
  const service = createFingerprintService(bus);
  const signal = (result, done = false, sender = ':1.42') => listener({ path: '/reader', interface: 'net.reactivated.Fprint.Device', member: 'EnrollStatus', sender, args: [result, done] });
  await service.refresh(); assert.equal(service.state.available, true, 'A reader without enrolled fingers still supports enrollment');
  for (const reason of ['NoSuchDevice', 'ServiceUnknown']) {
    let detached = false;
    const missing = createFingerprintService({ ...bus, onSignal: () => {}, offSignal: () => { detached = true; },
      async call() { throw new Error(reason); } });
    await missing.refresh(); assert.equal(missing.state.available, false);
    await missing.dispose(); assert(detached, 'The capability probe releases its signal listener');
  }
  await assert.rejects(service.enroll('invalid'), /Invalid/);
  await service.enroll('right-index-finger');
  assert.equal(service.state.enrolling, true);
  signal('enroll-completed', true, ':1.99'); assert.equal(service.state.enrolling, true);
  signal('enroll-stage-passed'); assert.equal(service.state.completed, 1);
  signal('enroll-retry-scan'); assert.equal(service.state.completed, 1);
  assert.equal(service.state.events, 2, 'Each enrollment report counts, retries included');
  enrolled = ['right-index-finger']; signal('enroll-completed', true); await tick();
  assert.equal(service.state.busy, false); assert.deepEqual(service.state.fingers, enrolled);
  assert.deepEqual(calls.slice(-3).map(c => c[0]), ['EnrollStop', 'Release', 'ListEnrolledFingers']);
  await service.remove('right-index-finger'); assert.deepEqual(service.state.fingers, []);
  await service.enroll('left-thumb'); await service.cancel();
  signal('enroll-completed', true); await tick(); assert.equal(service.state.enrolling, false);
  claimError = 'PermissionDenied'; await service.enroll('left-thumb');
  assert.equal(service.state.busy, false); assert.match(service.state.message, /denied/); claimError = undefined;
  let releaseClaim; claimWait = new Promise(resolve => { releaseClaim = resolve; });
  const before = calls.filter(c => c[0] === 'EnrollStart').length;
  const preparing = service.enroll('left-thumb'); await tick(); const cancelling = service.cancel();
  releaseClaim(); await preparing; await cancelling; claimWait = undefined;
  assert.equal(calls.filter(c => c[0] === 'EnrollStart').length, before);
  assert.equal(calls.at(-1)[0], 'Release');
  await service.enroll('left-thumb');
  listener({ interface: 'org.freedesktop.DBus', member: 'NameOwnerChanged', args: ['net.reactivated.Fprint', ':1.42', ''] });
  assert.equal(service.state.available, false); assert.equal(service.state.busy, false);
  await service.dispose(); assert.equal(listener, undefined);
  assert(calls.filter(c => c[0] === 'Claim' || c[0] === 'ListEnrolledFingers').every(c => c[1] === ''), 'Only the caller account is managed');

  let finish, scans = 0, cancelled = 0, unlocks = 0, passwords = 0;
  let secure = 'locked';
  const lock = createLockController({
    fingerprint: { verify: () => { scans++; return new Promise(resolve => { finish = resolve; }); }, cancel: () => { cancelled++; } },
    authenticate: async () => { passwords++; return { ok: true }; }, lockState: async () => secure,
    unlock: async () => { unlocks++; return true; }
  });
  const scanning = lock.scan(); await tick();
  assert.equal(await lock.scan(), false); assert.equal(scans, 1);
  const cancellingScan = lock.cancelFingerprint();
  assert.equal(await lock.scan(), false, 'A cancelled transaction must finish before another starts');
  finish({ ok: true }); await cancellingScan; assert.equal(await scanning, false); assert.equal(unlocks, 0);
  const retry = lock.scan(); await tick(); const password = lock.submit('fixture');
  await tick(); assert.equal(passwords, 0, 'Release sensor before starting password PAM');
  finish({ ok: true }); assert.equal(await retry, false); assert.equal(await password, true);
  assert.equal(unlocks, 1); assert.equal(cancelled, 2); assert.equal(passwords, 1);
  const check = async (result, state) => {
    const attempt = createLockController({ fingerprint: { verify: async () => { secure = state; return result; }, cancel: () => {} },
      lockState: async () => secure, unlock: async () => { unlocks++; return true; } });
    secure = 'locked'; return attempt.scan();
  };
  assert.equal(await check({ ok: false }, 'locked'), false);
  assert.equal(await check({ ok: true }, 'finished'), false);
  assert.equal(unlocks, 1);
  assert.equal(await check({ ok: true }, 'locked'), true); assert.equal(unlocks, 2);
  // Completed transactions restart without a button; cancelling the wait
  // prevents a stale timer from starting another authentication process.
  let attempts = 0, releases = 0;
  const pauses = [], statuses = [];
  const continuous = createLockController({
    fingerprint: { verify: async progress => {
      progress('Fixture sensor prompt');
      return ++attempts < 3 ? { ok: false, reason: 'attempts' } : { ok: true };
    }, cancel: () => {} }, lockState: async () => 'locked',
    unlock: async () => { releases++; return true; }, onStatus: text => statuses.push(text)
  });
  assert.equal(await continuous.scanWhile({ enabled: () => true, pause: async ms => pauses.push(ms) }), true);
  assert.deepEqual(pauses, [2000, 4000]); assert.equal(releases, 1);
  assert(statuses.includes('Fixture sensor prompt'));
  let wake, scansAfterCancel = 0;
  const pendingRetry = createLockController({ fingerprint: {
    verify: async () => { scansAfterCancel++; return { ok: false, reason: 'attempts' }; }, cancel: () => {}
  }, lockState: async () => 'locked', unlock: async () => assert.fail('Cancelled scan unlocked') });
  const watching = pendingRetry.scanWhile({ enabled: () => true, pause: () => new Promise(resolve => { wake = resolve; }) });
  await tick(); await pendingRetry.cancelFingerprint(); wake();
  assert.equal(await watching, false); assert.equal(scansAfterCancel, 1);
  const accountDenied = createLockController({ fingerprint: { verify: async () => ({ ok: false, reason: 'account' }), cancel: () => {} },
    lockState: async () => 'locked', unlock: async () => assert.fail('Account denial unlocked') });
  assert.equal(await accountDenied.scanWhile({ enabled: () => true, pause: async () => assert.fail('Account denial must not loop') }), false);
  // Enrollment offers index fingers first, right before left, then thumbs.
  assert.equal(suggestedFinger([]), 'right-index-finger');
  assert.equal(suggestedFinger(['right-index-finger']), 'left-index-finger');
  assert.equal(suggestedFinger(['right-index-finger', 'left-index-finger']), 'right-thumb');
  assert.equal(suggestedFinger(['right-index-finger'], 'right'), 'right-thumb');
  assert.equal(suggestedFinger(['right-thumb', 'right-index-finger', 'right-middle-finger', 'right-ring-finger', 'right-little-finger'], 'right'), '');
  assert.equal(enrollPrompt('Preparing the fingerprint reader…'), 'Getting ready…');
  assert.equal(enrollPrompt('Touch the sensor with your right thumb'), 'Touch the sensor');
  assert.equal(enrollPrompt('Lift your finger, then touch again'), 'Lift, then touch again');
  assert.equal(enrollPrompt('Centre your finger on the sensor'), 'Centre your finger on the sensor');
  // pam_fprintd's sentences become a badge reaction and a few words.
  assert.deepEqual(sensorMessage('Place your finger on the fingerprint reader'), { reaction: null, text: SENSOR_PROMPT });
  assert.deepEqual(sensorMessage('Swipe your right index finger across Fixture Reader'), { reaction: null, text: SENSOR_PROMPT });
  assert.deepEqual(sensorMessage('Failed to match fingerprint'), { reaction: 'mismatch', text: 'Not recognised' });
  assert.deepEqual(sensorMessage('Place your finger on the reader again'), { reaction: 'adjust', text: 'Try again' });
  assert.deepEqual(sensorMessage('Your finger was not centered, try swiping your finger again'), { reaction: 'adjust', text: 'Centre your finger' });
  assert.deepEqual(sensorMessage('Verification timed out'), { reaction: null, text: SENSOR_PROMPT });
  assert.deepEqual(sensorMessage('Posez votre doigt'), { reaction: null, text: 'Posez votre doigt' });
  // A mismatch reports an error, then the prompt; too many attempts rest the
  // sensor until a stated time; a timed-out scan restarts without a word.
  let clock = 0; const phases = [], lines = [], outcomes = [{ ok: false, reason: 'retry' }, { ok: false, reason: 'attempts' }, { ok: true }];
  const narrated = createLockController({
    fingerprint: { verify: async progress => { progress('Failed to match fingerprint'); return outcomes.shift(); }, cancel: () => {} },
    lockState: async () => 'locked', unlock: async () => true, now: () => clock,
    onStatus: (text, tone = 'info') => lines.push([text, tone]), onSensor: (phase, detail) => phases.push(detail ? [phase, detail] : [phase])
  });
  assert.equal(await narrated.scanWhile({ enabled: () => true, pause: async ms => { clock += ms; } }), true);
  assert.deepEqual(phases, [['listening'], ['mismatch'], ['listening'], ['mismatch'], ['mismatch'], ['resting', { resumeAt: 4000 }],
    ['listening'], ['mismatch'], ['matched']]);
  assert.deepEqual(lines.slice(0, 3), [[SENSOR_PROMPT, 'info'], ['Not recognised', 'error'], [SENSOR_PROMPT, 'info']]);
  assert(lines.some(([text, tone]) => text === 'Too many attempts' && tone === 'error'));
  assert(!lines.some(([text]) => /restart|resumes/i.test(text)), 'Retries are not narrated');
  const refusedLines = [];
  const refusing = createLockController({ authenticate: async () => ({ ok: false }), lockState: async () => 'locked',
    unlock: async () => true, onStatus: (text, tone) => refusedLines.push([text, tone]) });
  assert.equal(await refusing.submit('wrong'), false);
  assert.deepEqual(refusedLines.at(-1), ['Incorrect password', 'error']);
  Log.info('Fingerprint enrollment, ownership, cancellation and lock fallback: passed');
}
