import { createChargeControls, upowerChargeBackend } from './charge-control.js';

// UPower handles desktop and laptop batteries; no phone device access.
const NAME = 'org.freedesktop.UPower', PATH = '/org/freedesktop/UPower';
const PROPERTIES = 'org.freedesktop.DBus.Properties', DEVICE = NAME + '.Device';
const states = { 1: 'charging', 2: 'discharging', 3: 'empty', 4: 'full', 5: 'pending-charge', 6: 'pending-discharge' };
const reading = (value, name) => typeof value[name] === 'number' && Number.isFinite(value[name]) ? value[name] : -1;
export function createBatteryStatus(bus, changed, { chargeBackends = [] } = {}) {
  const chargeControls = createChargeControls([...chargeBackends, upowerChargeBackend(bus)]);
  let device, flight, dirty = false, disposed = false, previous = '';
  const batteries = new Map(), changing = new Set();
  const publish = value => {
    const key = JSON.stringify(value);
    if (!disposed && key !== previous) { previous = key; changed(value); }
  };
  const unavailable = () => {
    batteries.clear();
    publish({ BatteryPresent: false, BatteryPercent: -1, BatteryState: 'unknown', ExternalPower: false,
      BatteryTimeToEmpty: -1, BatteryTimeToFull: -1, BatteryRate: -1, BatteryEnergy: -1, BatteryEnergyFull: -1, BatteryDevices: '[]' });
  };
  const refresh = () => {
    dirty = true;
    if (disposed) return Promise.resolve();
    if (flight) return flight;
    flight = (async () => {
      try {
        while (dirty && !disposed) {
          dirty = false;
          device = await bus.call(NAME, PATH, NAME, 'GetDisplayDevice');
          const [value, power, paths] = await Promise.all([
            bus.call(NAME, device, PROPERTIES, 'GetAll', 's', DEVICE),
            bus.call(NAME, PATH, PROPERTIES, 'GetAll', 's', NAME),
            bus.call(NAME, PATH, NAME, 'EnumerateDevices').catch(() => [])
          ]);
          // The display device aggregates charge/time; health and cycles belong
          // to physical batteries and must be read from those devices.
          const devices = await Promise.all((Array.isArray(paths) ? paths : []).map(async path => {
            try {
              const item = await bus.call(NAME, path, PROPERTIES, 'GetAll', 's', DEVICE);
              if (![2, 3].includes(item.Type) || !item.PowerSupply || !item.IsPresent) return;
              return { path, name: item.NativePath || item.Model || 'Battery', health: reading(item, 'Capacity'),
                cycles: reading(item, 'ChargeCycles'), full: reading(item, 'EnergyFull'), design: reading(item, 'EnergyFullDesign'),
                thresholdSupported: !!item.ChargeThresholdSupported, thresholdEnabled: !!item.ChargeThresholdEnabled,
                start: reading(item, 'ChargeStartThreshold'), end: reading(item, 'ChargeEndThreshold') };
            } catch (_) { return; }
          }));
          if (disposed) break;
          batteries.clear();
          const described = await chargeControls.describe(devices.filter(Boolean));
          if (disposed) break;
          for (const item of described) batteries.set(item.path, item);
          publish({ BatteryPresent: !!value.IsPresent, BatteryPercent: reading(value, 'Percentage'),
            BatteryState: states[value.State] || 'unknown', ExternalPower: power.OnBattery === false,
            BatteryTimeToEmpty: reading(value, 'TimeToEmpty'), BatteryTimeToFull: reading(value, 'TimeToFull'),
            BatteryRate: typeof value.EnergyRate === 'number' && Number.isFinite(value.EnergyRate) ? Math.abs(value.EnergyRate) : -1,
            BatteryEnergy: reading(value, 'Energy'), BatteryEnergyFull: reading(value, 'EnergyFull'),
            BatteryDevices: JSON.stringify(described) });
        }
      } catch (_) { unavailable(); }
    })().finally(() => { flight = undefined; });
    return flight;
  };
  const signal = event => {
    if (event.interface === PROPERTIES && event.args?.[0] === DEVICE || event.path === device || event.path === PATH
      || event.member === 'NameOwnerChanged' && [NAME, 'org.framework_dbus'].includes(event.args?.[0])) refresh();
    if (event.path?.startsWith('/org/framework_dbus')) refresh();
    if (event.interface === 'org.freedesktop.DBus.Local' && event.member === 'Disconnected') unavailable();
  };
  return {
    start: async () => {
      try {
        await bus.connect(); bus.onSignal(signal);
        await bus.addMatch("type='signal',sender='org.freedesktop.UPower',interface='org.freedesktop.DBus.Properties'");
        await bus.addMatch("type='signal',sender='org.freedesktop.UPower',interface='org.freedesktop.UPower'");
        await bus.addMatch("type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.freedesktop.UPower'");
        await bus.addMatch("type='signal',sender='org.framework_dbus'");
        await bus.addMatch("type='signal',sender='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.framework_dbus'");
        await refresh();
      } catch (_) { unavailable(); }
    },
    refresh,
    async setChargeLimit(path, percent) {
      if (disposed || changing.has(path)) throw new Error('Charge control change is unavailable');
      changing.add(path);
      try {
        await refresh();
        if (!batteries.get(path)?.adjustable) throw new Error('Adjustable charge control is unavailable');
        await chargeControls.setLimit(path, percent); await refresh();
        if (batteries.get(path)?.end !== percent) throw new Error('Could not confirm charge limit');
      } finally { changing.delete(path); }
    },
    setChargeControl: async (path, enabled) => {
      if (typeof path !== 'string' || typeof enabled !== 'boolean') throw new Error('Invalid charge control arguments');
      if (disposed || changing.has(path)) throw new Error('Charge control change is unavailable');
      changing.add(path);
      try {
        // Re-enumerate before every write: never accept an arbitrary D-Bus path,
        // a peripheral battery or a device removed since the dropdown opened.
        await refresh();
        const battery = batteries.get(path);
        if (disposed || !battery?.thresholdSupported) throw new Error('Charge control is not supported by this battery');
        if (battery.thresholdEnabled === enabled) return;
        await chargeControls.setEnabled(path, enabled);
        await refresh();
        if (disposed || batteries.get(path)?.thresholdEnabled !== enabled) throw new Error('Could not confirm the charge control change');
      } finally { changing.delete(path); }
    },
    dispose: () => { disposed = true; batteries.clear(); chargeControls.dispose(); bus.offSignal(signal); }
  };
}
