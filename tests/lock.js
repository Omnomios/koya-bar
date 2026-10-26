import assert from './assert.js';
import * as Log from 'Helix/Log';
import { createLockController } from '../apps/lock-model.js';

export async function test() {
let unlocks = 0, authentication = 0, time = 1000, secure = 'locked';
const locker = createLockController({ authenticate: async password => { authentication++; return { ok: password === 'fixture' }; },
  unlock: async () => { unlocks++; return true; }, lockState: async () => secure, now: () => time });
assert.equal(await locker.submit('wrong'), false); assert.equal(unlocks, 0);
assert.equal(await locker.submit('fixture'), false); assert.equal(authentication, 1);
time += 1000; assert.equal(await locker.submit('fixture'), true); assert.equal(unlocks, 1);
assert.equal(await locker.submit('fixture'), false); assert.equal(unlocks, 1);
const refused = createLockController({ authenticate: async () => { throw new Error('PAM unavailable'); },
  unlock: async () => { unlocks++; return true; }, lockState: async () => secure });
assert.equal(await refused.submit('fixture'), false); assert.equal(unlocks, 1);
secure = 'locking';
const unconfirmed = createLockController({ authenticate: async () => { throw new Error('must not authenticate'); },
  unlock: async () => { unlocks++; return true; }, lockState: async () => secure });
assert.equal(await unconfirmed.submit('fixture'), false); assert.equal(unlocks, 1);
secure = 'locked'; let resolveAuthentication;
const simultaneous = createLockController({ authenticate: () => new Promise(resolve => { resolveAuthentication = resolve; }),
  unlock: async () => { unlocks++; return true; }, lockState: async () => secure });
const checking = simultaneous.submit('fixture'); await Promise.resolve(); await Promise.resolve();
assert.equal(await simultaneous.submit('fixture'), false);
secure = 'finished'; resolveAuthentication({ ok: true });
assert.equal(await checking, false); assert.equal(unlocks, 1);
Log.info('Lock authentication and compositor handoff: passed');

}
