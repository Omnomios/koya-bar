import assert from './assert.js';
import * as Log from 'Helix/Log';
import { createChargeControls, upowerChargeBackend } from '../apps/charge-control.js';
import { createBatteryStatus } from '../apps/battery-status.js';
import { powerView } from '../apps/power-model.js';
export async function test() {
  let installed = true, firmware = { enabled: false, end: 80 }, failRead = false, failWrite = false, ignoreWrite = false;
  let nativeWrites = 0, upowerWrites = 0, kernelEnabled = true;
  const device = { path: '/battery/BAT1', name: 'BAT1', thresholdSupported: true };
  const bus = { async call(name, path, iface, method, signature, ...args) {
    if (method === 'EnableChargeThreshold') { upowerWrites++; kernelEnabled = args[0]; return; }
    return { IsPresent: true, PowerSupply: true, ChargeThresholdSupported: true,
      ChargeThresholdEnabled: kernelEnabled, ChargeStartThreshold: 75, ChargeEndThreshold: 80 };
  } };
  const framework = { id: 'framework', supports: (_device, devices) => installed && devices.length === 1,
    read: async () => {
      if (failRead) throw new Error('EC unavailable');
      if (firmware.conflict) throw new Error('Another charge controller is active');
      return { ...firmware, start: null };
    },
    setEnabled: async (_device, enabled) => {
      if (failWrite) throw new Error('Permission denied');
      nativeWrites++; if (!ignoreWrite) firmware.enabled = enabled;
    } };
  const manager = createChargeControls([framework, upowerChargeBackend(bus)]);
  let devices = await manager.describe([device]);
  assert.equal(devices[0].chargeBackend, 'framework'); assert.equal(devices[0].thresholdEnabled, false);
  assert.equal(powerView({ BatteryDevices: JSON.stringify(devices) }).chargeControls[0].range, '80%', 'Firmware ceiling is not a fabricated restart range');
  await manager.setEnabled(device.path, true); assert.equal(nativeWrites, 1); assert.equal(upowerWrites, 0);
  failWrite = true; await assert.rejects(manager.setEnabled(device.path, false), /denied/); assert.equal(upowerWrites, 0); failWrite = false;
  ignoreWrite = true; await assert.rejects(manager.setEnabled(device.path, false), /confirm/); ignoreWrite = false;
  failRead = true; devices = await manager.describe([device]);
  assert.equal(devices[0].thresholdSupported, false); assert.equal(devices[0].chargeBackend, 'framework');
  await assert.rejects(manager.setEnabled(device.path, false), /unavailable/); assert.equal(upowerWrites, 0);
  failRead = false; firmware.conflict = true;
  assert.equal((await manager.describe([device]))[0].thresholdSupported, false);
  delete firmware.conflict;
  installed = false; devices = await manager.describe([device]); assert.equal(devices[0].chargeBackend, 'upower');
  assert.equal(powerView({ BatteryDevices: JSON.stringify(devices) }).chargeControls[0].range, '75–80%');
  await manager.setEnabled(device.path, false); assert.equal(upowerWrites, 1);
  await assert.rejects(manager.setEnabled('/unrelated/device', true), /unavailable/);
  await assert.rejects(manager.setEnabled(device.path, 'true'), /Invalid/);
  await manager.describe([]); await assert.rejects(manager.setEnabled(device.path, true), /unavailable/);
  installed = true;
  const multiple = await manager.describe([device, { ...device, path: '/battery/BAT2', name: 'BAT2' }]);
  assert(multiple.every(item => item.chargeBackend === 'upower'), 'A single firmware ceiling must not be mapped onto ambiguous batteries');
  firmware.end = 150;
  assert.equal((await manager.describe([device]))[0].thresholdSupported, false);
  manager.dispose();

  // The existing battery service and popup receive the same generic state.
  let status, enabled = false, writes = 0;
  const fake = { ...bus, connect: async () => {}, onSignal: () => {}, offSignal: () => {}, addMatch: async () => {},
    async call(name, path, iface, method) {
      if (method === 'GetDisplayDevice') return '/display';
      if (method === 'EnumerateDevices') return [device.path];
      if (path === '/display') return { IsPresent: true, Percentage: 75, State: 2 };
      if (path === '/org/freedesktop/UPower') return { OnBattery: true };
      return { Type: 2, PowerSupply: true, IsPresent: true, NativePath: 'BAT1', ChargeThresholdSupported: false };
    } };
  const battery = createBatteryStatus(fake, value => { status = value; }, { chargeBackends: [{
    id: 'fixture', supports: () => true, read: async () => ({ enabled, start: null, end: 85 }),
    setEnabled: async (_device, value) => { writes++; enabled = value; }
  }] });
  await battery.start(); assert.equal(status.BatteryPercent, 75);
  assert.equal(powerView(status).chargeControls[0].enabled, false);
  await battery.setChargeControl(device.path, true);
  assert.equal(powerView(status).chargeControls[0].enabled, true); assert.equal(writes, 1);
  battery.dispose(); await assert.rejects(battery.setChargeControl(device.path, false), /unavailable/);
  Log.info('Charge backend selection, firmware ownership and verified writes: passed');
}
