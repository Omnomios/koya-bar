import assert from './assert.js';
import * as Log from 'Helix/Log';
import { createFingerprintAuth, fingerprintOutcome } from '../apps/fingerprint-auth.js';
import { createLockController } from '../apps/lock-model.js';
const wait = () => new Promise(resolve => setTimeout(resolve, 0));
export async function test() {
  let options, finish, release, begin = 0, cancelled = 0;
  const pam = { begin(value) {
    options = value; begin++;
    return { result: new Promise(resolve => { finish = resolve; }), cancel: () => {
      cancelled++; return new Promise(resolve => { release = () => { finish({ ok: false, phase: 'cancelled', pamCode: 26 }); resolve(); }; });
    } };
  } };
  const auth = createFingerprintAuth(pam, { user: 'fixture', configured: () => true });
  assert(auth.available());
  const messages = [], checking = auth.verify(message => messages.push(message));
  assert.equal(options.service, 'koya-fingerprint'); assert.equal(options.timeoutMs, 35000);
  assert(!Object.hasOwn(options, 'password'), 'No password fallback in the fingerprint transaction');
  options.onMessage({ type: 'info', message: 'Place your finger' }); options.onMessage({ type: 'error', message: 'Failed to match fingerprint' });
  options.onMessage({ type: 'prompt', message: 'Password' });
  assert.deepEqual(messages, ['Place your finger', 'Failed to match fingerprint']);
  assert.throws(() => auth.verify(), /already running/);
  finish({ ok: true, phase: 'authentication', pamCode: 0 }); assert((await checking).ok);
  const failed = auth.verify(); finish({ ok: false, phase: 'account', pamCode: 13 }); assert.equal((await failed).reason, 'account');
  const pending = auth.verify(message => messages.push(message));
  let settled = false; const stopping = auth.cancel().then(() => { settled = true; });
  await wait(); assert(!settled); options.onMessage({ type: 'info', message: 'late' }); assert(!messages.includes('late'));
  release(); await stopping; assert((await pending).cancelled);
  assert.equal(cancelled, 1);
  for (const [input, reason] of [
    [{ ok: false, phase: 'authentication', pamCode: 11 }, 'attempts'],
    [{ ok: false, phase: 'authentication', pamCode: 7 }, 'retry'],
    [{ ok: false, phase: 'authentication', pamCode: 9 }, 'retry'],
    [{ ok: false, phase: 'timeout', pamCode: 26 }, 'retry'],
    [{ ok: false, phase: 'authentication', pamCode: 19 }, 'configuration'],
    [{ ok: true }, 'configuration']]) assert.equal(fingerprintOutcome(input).reason, reason);
  assert(!fingerprintOutcome({ ok: true, phase: 'account', pamCode: 0 }).ok, 'Only the documented completed success is accepted');
  const disabled = createFingerprintAuth(pam, { user: 'fixture', configured: () => false });
  const before = begin; assert(!disabled.available()); assert.equal((await disabled.verify()).reason, 'configuration'); assert.equal(begin, before);
  assert(!createFingerprintAuth({}, { user: 'fixture', configured: () => true }).available());
  // An authentication success already queued in JS must lose to cancellation.
  const race = auth.verify(); finish({ ok: true, phase: 'authentication', pamCode: 0 });
  const cancelling = auth.cancel(); release(); await cancelling; assert(!(await race).ok);
  let passwordChecks = 0, unlocked = 0;
  const controller = createLockController({ fingerprint: auth, authenticate: async () => { passwordChecks++; return { ok: true }; },
    lockState: async () => 'locked', unlock: async () => { unlocked++; return true; } });
  const scan = controller.scan(); await wait(); const password = controller.submit('fixture-password');
  await wait(); assert.equal(passwordChecks, 0); release();
  assert.equal(await scan, false); assert.equal(await password, true); assert.equal(unlocked, 1);
  Log.info('PAM fingerprint adapter, cancellation barrier, messages, result mapping and password handoff: passed');
}
