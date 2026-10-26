import assert from './assert.js';
import * as Log from 'Helix/Log';
import { createFramework, frameworkDevices, frameworkChargeProvider, FRAMEWORK_NAME as NAME, FRAMEWORK_PATH as ROOT } from '../apps/framework-client.js';
import { scalarInput } from '../apps/scalar-input.js';
import { createChargeControls } from '../apps/charge-control.js';
import { createShellService } from '../apps/shell-service.js';
const common = NAME + '.Device1', charging = NAME + '.Charging1', fan = NAME + '.Fan1', lighting = NAME + '.Lighting1';
export async function test() {
  const paths = { charge: ROOT + '/charging', fan: ROOT + '/fans/0', light: ROOT + '/lighting/keyboard' };
  let listeners = [], running = true, deny = false, limit = 100, mode = 'auto', owner = true, watched = false, reads = 0;
  const timers = new Map(), operations = [], changes = [];
  const bus = {
    connect: async () => {}, addMatch: async () => {}, onSignal: fn => listeners.push(fn), offSignal: fn => { listeners = listeners.filter(value => value !== fn); },
    async call(name, path, iface, method, signature, ...args) {
      operations.push({ path, iface, method, signature, args });
      if (!running) throw new Error('Service unavailable');
      if (method === 'GetAll') return { Available: true };
      if (method === 'GetManagedObjects') { reads++; return {
        [paths.charge]: { [common]: { Name: 'Charge limit', Available: true, Writable: true }, [charging]: { Limit: limit, Minimum: 25, Maximum: 100, Conflict: false } },
        [paths.fan]: { [common]: { Name: 'Fan', Available: true, Writable: true }, [fan]: { RPM: 3000, Mode: mode, Target: mode === 'duty' ? 60 : 0, Modes: ['duty', 'rpm'] } },
        [paths.light]: { [common]: { Name: 'Keyboard', Available: true, Writable: true }, [lighting]: { Brightness: 50, Minimum: 0, PercentageSupported: true } }
      }; }
      if (method === 'Subscribe') { watched = true; return; }
      if (method === 'Unsubscribe') { watched = false; return; }
      if (deny) throw new Error('NotAuthorized');
      if (method === 'SetLimit') limit = args[0];
      if (method === 'Override') { mode = args[0]; owner = true; }
      if (method === 'Renew' && !owner) throw new Error('NotOwner');
      if (method === 'SetAutomatic') mode = 'auto';
    }
  };
  const client = createFramework(bus, value => changes.push(value), { schedule: (fn, ms) => { const id = {}; timers.set(id, { fn, ms }); return id; }, cancel: id => timers.delete(id) });
  await client.start(); assert.equal(client.snapshot().devices.length, 3);
  const before = changes.length; await client.refresh(); assert.equal(changes.length, before, 'Identical reads must not recursively refresh battery status');
  await client.setLimit(paths.charge, 80); assert.equal(limit, 80);
  await assert.rejects(client.setLimit(paths.charge, 24), /25/);
  await assert.rejects(client.setLimit('/unknown', 80), /unavailable/);
  deny = true; await assert.rejects(client.setLimit(paths.charge, 90), /NotAuthorized/); deny = false;
  await assert.rejects(client.overrideFan(paths.fan, 'duty', 60), /Open Cooling/);
  await client.watch(true); assert(watched);
  await client.overrideFan(paths.fan, 'duty', 60); assert.equal(mode, 'duty');
  const renewal = [...timers.values()].find(value => value.ms === 5000); assert(renewal); await renewal.fn();
  assert(operations.some(value => value.method === 'Renew'));
  await client.watch(false); assert.equal(mode, 'auto'); assert(!watched);
  const provider = frameworkChargeProvider(client);
  const battery = { path: '/battery/BAT1', name: 'BAT1' };
  assert(provider.supports(battery, [battery]));
  const controls = createChargeControls([provider]);
  assert.equal((await controls.describe([battery]))[0].adjustable, true);
  await controls.setLimit(battery.path, 85); assert.equal(limit, 85);
  running = false; await client.refresh(); assert.equal(client.snapshot().available, false);
  assert(provider.supports(battery, [battery]), 'Provider retains ownership across a service outage');
  let fallback = false;
  const conflict = createChargeControls([provider, { id: 'upower', supports: () => true, read: async () => { fallback = true; return { enabled: true, start: 75, end: 80 }; } }]);
  assert.equal((await conflict.describe([battery]))[0].thresholdSupported, false); assert(!fallback);
  running = true;
  listeners.forEach(fn => fn({ member: 'NameOwnerChanged', args: [NAME, '', ':1.9'] })); await client.refresh(); assert(client.snapshot().available);
  await client.dispose(); assert.equal(listeners.length, 0); assert.equal(timers.size, 0);
  assert.deepEqual(frameworkDevices({ '/unrelated': { [common]: {} } }), []);
  const preview = [], commits = [];
  const input = scalarInput({ minimum: 25, maximum: 100, width: 112, preview: n => preview.push(n), commit: n => commits.push(n) });
  input.onDrag({ phase: 'start', interactionId: 1, local: { x: 6 } });
  input.onDrag({ phase: 'change', interactionId: 1, local: { x: 56 } }); assert.equal(commits.length, 0);
  input.onDrag({ phase: 'end', interactionId: 2, local: { x: 106 } }); assert.equal(commits.length, 0);
  input.onDrag({ phase: 'end', interactionId: 1, local: { x: 106 } }); assert.deepEqual(commits, [100]);
  input.onDrag({ phase: 'start', interactionId: 3, local: { x: 6 } });
  input.onDrag({ phase: 'cancel', interactionId: 3, local: { x: 6 } }); assert.equal(commits.length, 1);
  input.dispose(); input.onActivate({ local: { x: 50 } }); assert.equal(commits.length, 1);
  const applied = [], stored = [];
  const shell = createShellService({ stored: {}, applications: {}, persist: async value => stored.push(JSON.parse(value)), setChargeLimit: async (...args) => applied.push(args) });
  await shell.request('SetChargeLimit', [battery.path, 83]); assert.equal(shell.snapshot().FrameworkChargeLimit, 83);
  await shell.request('SetChargeLimit', [battery.path, 100]); assert.equal(shell.snapshot().FrameworkChargeLimit, 83);
  shell.update({ Active: false }); await assert.rejects(shell.request('SetChargeLimit', [battery.path, 80]), /unavailable/);
  assert.equal(applied.length, 2); assert.equal(stored.length, 1); assert(reads > 0);
  let finishOverride, releaseCount = 0;
  const delayed = createFramework({ ...bus, async call(name, path, iface, member, signature, ...args) {
    if (member === 'Override') await new Promise(resolve => { finishOverride = resolve; });
    if (member === 'SetAutomatic') releaseCount++;
    return bus.call(name, path, iface, member, signature, ...args);
  } }, () => {}, { schedule: () => 1, cancel: () => {} });
  await delayed.start(); await delayed.watch(true);
  const pending = delayed.overrideFan(paths.fan, 'duty', 60);
  for (let i = 0; i < 20 && !finishOverride; i++) await Promise.resolve();
  assert(finishOverride); await delayed.watch(false); finishOverride();
  await assert.rejects(pending, /closed/); assert.equal(releaseCount, 1);
  await delayed.dispose();
  const firstCount = commits.length;
  const separate = scalarInput({ width: 100, preview: () => {}, commit: value => commits.push(value) });
  separate.onDrag({ phase: 'start', interactionId: 8, local: { x: 20 } });
  separate.onDrag({ phase: 'end', interactionId: 8, local: { x: 40 } });
  separate.onActivate({ interactionId: 8, local: { x: 40 } }); assert.equal(commits.length, firstCount + 1);
  separate.onActivate({ interactionId: 9, local: { x: 80 } }); assert.equal(commits.length, firstCount + 2);
  Log.info('Framework D-Bus client, capability discovery, charge ownership, fan lifecycle and release-only controls: passed');
}
