import { system } from 'Module/dbus';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import { createFingerprintService } from '../apps/fingerprint-model.js';
import assert from './assert.js';
export default function main() {
  setTimeout(async () => {
    const service = createFingerprintService(system);
    try {
      await service.refresh();
      assert.equal(service.state.available, true, service.state.message);
      assert.equal(service.state.name, 'Fixture reader');
      await service.enroll('left-thumb');
      for (let i = 0; i < 100 && service.state.busy; i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(service.state.busy, false, 'Enrollment signal must reach Koya and release the reader');
      assert.deepEqual(service.state.fingers, ['left-thumb']);
      await service.remove('left-thumb'); assert.deepEqual(service.state.fingers, []);
      await service.enroll('right-thumb'); await service.cancel();
      await new Promise(resolve => setTimeout(resolve, 150));
      await service.refresh(); assert.deepEqual(service.state.fingers, []);
      Log.info('KOYA_FINGERPRINT_DBUS_PASS');
    } catch (error) { Log.error('KOYA_FINGERPRINT_DBUS_FAIL: ' + error); }
    finally { await service.dispose(); Engine.quit(); }
  }, 0);
}
