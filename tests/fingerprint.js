import assert from './assert.js';
import * as Log from 'Helix/Log';
import { createFingerprintService } from '../apps/fingerprint-model.js';
import { createLockController } from '../apps/lock-model.js';
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
  await service.refresh(); assert.equal(service.state.available, true);
  await assert.rejects(service.enroll('invalid'), /Invalid/);
  await service.enroll('right-index-finger');
  assert.equal(service.state.enrolling, true);
  signal('enroll-completed', true, ':1.99'); assert.equal(service.state.enrolling, true);
  signal('enroll-stage-passed'); assert.equal(service.state.completed, 1);
  signal('enroll-retry-scan'); assert.equal(service.state.completed, 1);
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
  Log.info('Fingerprint enrollment, ownership, cancellation and lock fallback: passed');
}
