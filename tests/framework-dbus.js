// Run only against the simulated daemon on a private session bus.
import { session as Bus } from 'Module/dbus';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import { createFramework } from '../apps/framework-client.js';
import assert from './assert.js';
export default function main() {
  setTimeout(async () => {
    const client = createFramework(Bus);
    try {
      await client.start();
      const state = client.snapshot(); assert(state.available); assert.equal(state.devices.length, 7);
      const charge = state.devices.find(d => d.type.endsWith('Charging1'));
      const light = state.devices.find(d => d.path.endsWith('keyboard'));
      const fan = state.devices.find(d => d.type.endsWith('Fan1'));
      assert.equal(charge.Limit, 100);
      await client.setLimit(charge.path, 83); assert.equal(client.snapshot().devices.find(d => d.path === charge.path).Limit, 83);
      await client.setBrightness(light.path, 70); assert.equal(client.snapshot().devices.find(d => d.path === light.path).Brightness, 70);
      await client.watch(true); await client.overrideFan(fan.path, 'duty', 60);
      assert.equal(client.snapshot().devices.find(d => d.path === fan.path).Mode, 'duty');
      await client.watch(false); await client.refresh(); assert.equal(client.snapshot().devices.find(d => d.path === fan.path).Mode, 'auto');
      Log.info('KOYA_FRAMEWORK_DBUS_PASS');
    } catch (error) { Log.error('KOYA_FRAMEWORK_DBUS_FAIL: ' + error.stack); }
    finally { await client.dispose(); Engine.quit(); }
  }, 0);
}
