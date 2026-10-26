import * as Fingerprint from 'Module/fingerprint';
import * as Process from 'Module/process';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import assert from './assert.js';
export default function main() {
  setTimeout(async () => {
    try {
      const mode = Process.getEnv('KOYA_FINGERPRINT_FIXTURE', 'denied');
      const checking = Fingerprint.verify();
      assert.throws(() => Fingerprint.verify(), /already running/);
      if (mode === 'cancel') Fingerprint.cancel();
      const result = await checking;
      assert.equal(result.ok, mode === 'success');
      assert.equal(result.cancelled, mode === 'cancel');
      if (mode !== 'cancel') assert.equal((await Fingerprint.verify()).ok, mode === 'success');
      Log.info('KOYA_FINGERPRINT_NATIVE_PASS');
    } catch (error) { Log.error('KOYA_FINGERPRINT_NATIVE_FAIL: ' + error); }
    finally { Engine.quit(); }
  }, 0);
}
