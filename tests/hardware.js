import assert from './assert.js';
import { FRAMEWORK_NAME as NAME } from '../apps/framework-client.js';
import { sensorLabels, coolingSummary, coolingDetail, lightingDetail, lightLevels, lightReading, fanReading } from '../apps/hardware-model.js';
import { powerView } from '../apps/power-model.js';
const temperature = (path, Name, Celsius) => ({ path, type: NAME + '.Temperature1', Name, Available: true, Celsius });
export function test() {
  const sensors = [temperature('/t/0', 'local_f75303@4d', 37.9), temperature('/t/1', 'cpu_f75303@4d', 37.9),
    temperature('/t/2', 'ddr_f75303@4d', 32.9), temperature('/t/3', 'cpu@4c', 40.9), temperature('/t/4', 'acpitz_thing@1', 30)];
  assert.equal([...sensorLabels(sensors).values()].join(','), 'Board,CPU,Memory,CPU 2,Acpitz thing');
  const fan = { path: '/f/0', type: NAME + '.Fan1', Name: 'Fan 1', Available: true, Writable: true, RPM: 0, Mode: 'auto', Target: 0, Modes: ['duty', 'rpm'] };
  let summary = coolingSummary({ devices: [...sensors, fan] });
  assert.equal(summary.title, 'Cool · 41°'); assert.equal(summary.subtitle, 'Fan idle'); assert.equal(summary.health, 'good'); assert.equal(summary.spinning, false);
  assert.equal(coolingDetail({ devices: [...sensors, fan] }), '41° · Fan idle');
  summary = coolingSummary({ devices: [temperature('/t/0', 'cpu', 88), { ...fan, RPM: 4200 }] });
  assert.equal(summary.title, 'Running hot · 88°'); assert.equal(summary.subtitle, 'Fan 4,200 RPM'); assert.equal(summary.health, 'warn');
  assert.equal(coolingSummary({ devices: [{ ...fan, Mode: 'duty', Target: 60 }] }).subtitle, 'Fan manual');
  assert.equal(fanReading({ ...fan, Mode: 'duty', Target: 60 }), 'Manual · 60%');
  assert.equal(coolingSummary({ devices: [] }).title, 'Cooling');
  assert.equal(lightLevels(['high', 'medium', 'low', 'ultra-low', 'auto']).map(item => item.title).join(','), 'Dim,Low,Medium,High,Auto');
  const keyboard = { path: '/l/keyboard', type: NAME + '.Lighting1', Name: 'Keyboard backlight', Available: true, Brightness: 56, Levels: [] };
  assert.equal(lightingDetail({ devices: [keyboard] }), 'Keyboard 56%');
  assert.equal(lightingDetail({ devices: [{ ...keyboard, Brightness: 0 }] }), 'Keyboard off');
  assert.equal(lightReading({ Available: true, Level: 'ultra-low', Levels: ['ultra-low'], Brightness: 8 }), 'Dim');
  // A ceiling another tool owns is explained, not silently dropped.
  const blocked = powerView({ BatteryDevices: JSON.stringify([{ path: '/b', name: 'BAT1', thresholdSupported: false, chargeIssue: 'conflict' }]) });
  assert(blocked.details.some(row => row.key === 'Charge limit' && row.value === 'Set by another tool'));
  assert.equal(blocked.chargeControls.length, 0);
}
