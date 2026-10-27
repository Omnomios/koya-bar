// Framework hardware stays in the standalone system service. This client is
// deliberately independent of Koya UI so its behaviour runs in Koya tests.
export const FRAMEWORK_NAME = 'org.framework_dbus', FRAMEWORK_PATH = '/org/framework_dbus';
const MANAGER = FRAMEWORK_NAME + '.Manager1', COMMON = FRAMEWORK_NAME + '.Device1';
const CHARGING = FRAMEWORK_NAME + '.Charging1';
export function frameworkDevices(objects) {
  return Object.entries(objects || {}).filter(([path, value]) => path.startsWith(FRAMEWORK_PATH + '/') && value?.[COMMON]).map(([path, interfaces]) => {
    const [type, values] = Object.entries(interfaces).find(([name]) => name !== COMMON && name.startsWith(FRAMEWORK_NAME + '.')) || [];
    return { path, type, ...interfaces[COMMON], ...values };
  });
}
export function createFramework(bus, changed = () => {}, { schedule = setTimeout, cancel = clearTimeout } = {}) {
  let devices = [], available = false, error = '', started = false, disposed = false, flight, dirty = false, watching = false, subscribed = false, retry, generation = 0;
  const leases = new Map(); let previous = '';
  const snapshot = () => ({ available, error, devices: devices.map(item => ({ ...item })) });
  const publish = () => { const value = snapshot(), key = JSON.stringify(value); if (!disposed && key !== previous) { previous = key; changed(value); } };
  const invoke = (path, iface, method, signature = '', ...args) => bus.call(FRAMEWORK_NAME, path, iface, method, signature, ...args);
  const clearLeases = () => { for (const timer of leases.values()) cancel(timer); leases.clear(); };
  const unavailable = reason => { available = false; error = String(reason?.message || reason || 'Hardware service unavailable'); devices = []; subscribed = false; clearLeases(); publish(); };
  const refresh = () => {
    dirty = true;
    if (disposed) return Promise.resolve();
    if (flight) return flight;
    flight = (async () => {
      try {
        while (dirty && !disposed) {
          dirty = false;
          const manager = await invoke(FRAMEWORK_PATH, 'org.freedesktop.DBus.Properties', 'GetAll', 's', MANAGER);
          const objects = await invoke(FRAMEWORK_PATH, 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects');
          if (disposed) return;
          available = manager.Available === true; error = manager.Error || '';
          devices = frameworkDevices(objects);
          if (watching && !subscribed) { await invoke(FRAMEWORK_PATH, MANAGER, 'Subscribe'); subscribed = true; }
          publish();
        }
      } catch (reason) { if (!disposed) unavailable(reason); }
    })().finally(() => { flight = undefined; });
    return flight;
  };
  const find = (path, suffix) => {
    const d = devices.find(item => item.path === path && item.type === FRAMEWORK_NAME + '.' + suffix + '1');
    if (!available || !d?.Available || !d.Writable) throw new Error(d?.Error || 'Hardware control unavailable');
    return d;
  };
  const set = async (path, type, member, signature, ...args) => {
    await refresh(); find(path, type);
    await invoke(path, FRAMEWORK_NAME + '.' + type + '1', member, signature, ...args); await refresh();
  };
  const renew = path => {
    cancel(leases.get(path));
    leases.set(path, schedule(async () => {
      if (disposed || !leases.has(path)) return;
      try { await invoke(path, FRAMEWORK_NAME + '.Fan1', 'Renew'); if (leases.has(path)) renew(path); }
      catch (reason) { cancel(leases.get(path)); leases.delete(path); error = String(reason); publish(); await refresh(); }
    }, 5000));
  };
  const releaseFans = async () => {
    const paths = [...leases.keys()]; clearLeases();
    await Promise.all(paths.map(path => invoke(path, FRAMEWORK_NAME + '.Fan1', 'SetAutomatic').catch(reason => { error = String(reason); publish(); })));
  };
  const signal = event => {
    if (event.member === 'NameOwnerChanged' && event.args?.[0] === FRAMEWORK_NAME) {
      clearLeases(); subscribed = false;
      if (!event.args[2]) unavailable('Hardware service stopped'); else refresh();
    } else if (event.path?.startsWith(FRAMEWORK_PATH) && ['PropertiesChanged', 'InterfacesAdded', 'InterfacesRemoved'].includes(event.member)) refresh();
    else if (event.interface === 'org.freedesktop.DBus.Local' && event.member === 'Disconnected') unavailable('System bus disconnected');
  };
  return {
    snapshot, refresh,
    async start() {
      if (started || disposed) return; started = true;
      try {
        await bus.connect(); bus.onSignal(signal);
        await bus.addMatch("type='signal',sender='org.framework_dbus'");
        await bus.addMatch("type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.framework_dbus'");
        // Activates the service if installed. Missing service is a normal case.
        await invoke(FRAMEWORK_PATH, MANAGER, 'Refresh'); await refresh();
      } catch (reason) { unavailable(reason); }
      const poll = () => {
        if (disposed) return;
        retry = schedule(async () => {
          if (!available) {
            try { await invoke(FRAMEWORK_PATH, MANAGER, 'Refresh'); } catch (_) {}
            await refresh();
          }
          poll();
        }, 30000);
      };
      poll();
    },
    async watch(value) {
      if (watching !== !!value) generation++;
      watching = !!value;
      if (watching) { await refresh(); }
      else {
        await releaseFans();
        if (subscribed) { subscribed = false; await invoke(FRAMEWORK_PATH, MANAGER, 'Unsubscribe').catch(() => {}); }
      }
    },
    async setLimit(path, percent) {
      if (!Number.isInteger(percent) || percent < 25 || percent > 100) throw new Error('Charge limit must be 25–100%');
      await set(path, 'Charging', 'SetLimit', 'u', percent);
      if (find(path, 'Charging').Limit !== percent) throw new Error('Could not confirm charge limit');
    },
    setBrightness: (path, value) => set(path, 'Lighting', 'SetBrightness', 'u', value),
    setLevel: (path, value) => set(path, 'Lighting', 'SetLevel', 's', value),
    async overrideFan(path, mode, target) {
      if (!watching) throw new Error('Open Cooling settings to control a fan');
      if (!['duty', 'rpm'].includes(mode) || !Number.isInteger(target) || target < 0 || target > (mode === 'duty' ? 100 : 65533)) throw new Error('Invalid fan target');
      const requestGeneration = generation;
      await set(path, 'Fan', 'Override', 'su', mode, target);
      if (!watching || disposed || generation !== requestGeneration) {
        await invoke(path, FRAMEWORK_NAME + '.Fan1', 'SetAutomatic').catch(() => {});
        throw new Error('Cooling control closed before the change completed');
      }
      cancel(leases.get(path)); renew(path);
    },
    async automaticFan(path) {
      cancel(leases.get(path)); leases.delete(path);
      await set(path, 'Fan', 'SetAutomatic', '');
    },
    releaseFans,
    async dispose() { disposed = true; watching = false; generation++; cancel(retry); bus.offSignal(signal); await releaseFans(); if (subscribed) await invoke(FRAMEWORK_PATH, MANAGER, 'Unsubscribe').catch(() => {}); }
  };
}
export function frameworkChargeProvider(client, { limit = () => 80 } = {}) {
  let owned = false;
  const charging = () => client.snapshot().devices.find(item => item.type === CHARGING);
  return {
    id: 'framework',
    supports(device, devices) {
      const current = charging();
      if (devices.length !== 1 || !/^BAT[0-9]+$/.test(device.name)) return false;
      // Once discovered, retain ownership through a service outage so a write
      // cannot silently target the independent generic UPower controller.
      if (current) owned = true;
      return owned;
    },
    async read() {
      await client.refresh(); const value = charging();
      if (!value?.Available || value.Conflict) throw new Error(value?.Conflict ? 'Another charge controller is active' : value?.Error || 'Framework charge control unavailable');
      return { enabled: value.Limit < 100, start: null, end: value.Limit, adjustable: value.Writable, minimum: value.Minimum, maximum: value.Maximum };
    },
    async setEnabled(_device, enabled) { const current = charging(); if (!current) throw new Error('Framework service unavailable'); await client.setLimit(current.path, enabled ? limit() : 100); },
    async setLimit(_device, value) { const current = charging(); if (!current) throw new Error('Framework service unavailable'); await client.setLimit(current.path, value); }
  };
}
