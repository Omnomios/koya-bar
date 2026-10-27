import * as PAM from 'Module/pam';
import * as Process from 'Module/process';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import assert from './assert.js';
import { createFingerprintAuth, fingerprintOutcome } from '../apps/fingerprint-auth.js';
import { createLockController } from '../apps/lock-model.js';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export default function main() {
  setTimeout(async () => {
    const mode = Process.getEnv('KOYA_PAM_FIXTURE', 'denied');
    try {
      assert.equal(typeof PAM.begin, 'function', 'Install the cancellable hx-pam plugin');
      const user = 'koya-fixture', auth = createFingerprintAuth(PAM, { user, configured: () => true });
      const messages = [];
      if (mode === 'timeout') {
        const result = await PAM.begin({ service: 'koya-fingerprint', user, timeoutMs: 25 }).result;
        assert.equal(result.phase, 'timeout'); assert.equal(fingerprintOutcome(result).reason, 'retry');
      } else if (mode === 'cancel') {
        let passwords = 0, unlocks = 0;
        const controller = createLockController({ fingerprint: auth, lockState: async () => 'locked', unlock: async () => { unlocks++; return true; },
          onStatus: message => messages.push(message), authenticate: async password => {
            passwords++; return PAM.authenticate({ service: 'koya-password-fixture', user, password });
          } });
        const scan = controller.scan();
        for (let i = 0; i < 200 && !messages.includes('Waiting for finger'); i++) await delay(5);
        assert(messages.includes('Waiting for finger'), 'Live PAM message must arrive before cancellation');
        const password = controller.submit('fixture-password');
        assert.equal(await scan, false); assert.equal(await password, true); assert.equal(passwords, 1); assert.equal(unlocks, 1);
      } else if (mode === 'race') {
        const verifying = auth.verify(); const until = Date.now() + 150;
        while (Date.now() < until) {} // Queue helper success without delivering it to JS.
        await auth.cancel(); assert.equal((await verifying).ok, false);
      } else {
        const result = await auth.verify(message => messages.push(message));
        assert.equal(result.ok, ['success', 'retry'].includes(mode));
        const expected = { denied: 'retry', attempts: 'attempts', account: 'account', prompt: 'configuration', unavailable: 'retry' }[mode];
        if (expected) assert.equal(result.reason, expected);
        if (mode === 'retry') assert.deepEqual(messages, ['Failed to match fingerprint', 'Touch the sensor again']);
        if (mode === 'success' || mode === 'denied') assert.equal((await auth.verify()).ok, result.ok, 'A new transaction works after completion');
      }
      Log.info('KOYA_FINGERPRINT_PAM_PASS: ' + mode);
    } catch (error) { Log.error('KOYA_FINGERPRINT_PAM_FAIL: ' + mode + ': ' + error.stack); }
    finally { Engine.quit(); }
  }, 0);
}
