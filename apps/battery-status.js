// UPower handles desktop and laptop batteries; no phone device access.
const NAME = 'org.freedesktop.UPower', PATH = '/org/freedesktop/UPower';
export function createBatteryStatus(bus, changed) {
  let device, reading = false, dirty = false;
  const unavailable = () => changed({ BatteryPresent: false, BatteryPercent: -1, BatteryState: 'unknown', ExternalPower: false });
  const refresh = async () => {
    dirty = true;
    if (reading) return;
    reading = true;
    try {
      while (dirty) {
        dirty = false;
        device = await bus.call(NAME, PATH, NAME, 'GetDisplayDevice');
        const value = await bus.call(NAME, device, 'org.freedesktop.DBus.Properties', 'GetAll', 's', NAME + '.Device');
        const power = await bus.call(NAME, PATH, 'org.freedesktop.DBus.Properties', 'GetAll', 's', NAME);
        changed({ BatteryPresent: !!value.IsPresent, BatteryPercent: Number(value.Percentage),
          BatteryState: ({ 1: 'charging', 2: 'discharging', 4: 'full' })[value.State] || 'unknown', ExternalPower: power.OnBattery === false });
      }
    } catch (_) { unavailable(); }
    finally { reading = false; }
  };
  const signal = event => {
    if (event.path === device || event.path === PATH || event.member === 'NameOwnerChanged' && event.args?.[0] === NAME) refresh();
    if (event.interface === 'org.freedesktop.DBus.Local' && event.member === 'Disconnected') unavailable();
  };
  return { start: async () => {
    try {
      await bus.connect(); bus.onSignal(signal);
      await bus.addMatch("type='signal',sender='org.freedesktop.UPower',interface='org.freedesktop.DBus.Properties'");
      await bus.addMatch("type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.freedesktop.UPower'");
      await refresh();
    } catch (_) { unavailable(); }
  }, dispose: () => bus.offSignal(signal) };
}
