// Both generations of power-profiles-daemon (and compatible providers).
const PROPERTIES = 'org.freedesktop.DBus.Properties';
const providers = [
  { name: 'org.freedesktop.UPower.PowerProfiles', path: '/org/freedesktop/UPower/PowerProfiles' },
  { name: 'net.hadess.PowerProfiles', path: '/net/hadess/PowerProfiles' }
];
export const PROFILE_LABELS = { 'power-saver': 'Power saver', balanced: 'Balanced', performance: 'Performance' };

export function createPowerProfiles(bus, changed) {
  let provider, profiles = [], disposed = false, dirty = false, flight, busy = false, previous = '';
  const publish = value => {
    const key = JSON.stringify(value);
    if (!disposed && key !== previous) { previous = key; changed(value); }
  };
  const refresh = () => {
    dirty = true;
    if (flight) return flight;
    flight = (async () => {
      while (dirty && !disposed) {
        dirty = false;
        let found;
        for (const candidate of providers) {
          try {
            const value = await bus.call(candidate.name, candidate.path, PROPERTIES, 'GetAll', 's', candidate.name);
            const available = Array.isArray(value.Profiles) ? value.Profiles.map(item => item.Profile) : [];
            profiles = Object.keys(PROFILE_LABELS).filter(profile => available.includes(profile));
            if (!profiles.length) continue;
            provider = candidate; found = true;
            publish({ PowerProfiles: JSON.stringify(profiles), PowerProfile: value.ActiveProfile || '',
              PowerProfileDegraded: value.PerformanceDegraded || '' });
            break;
          } catch (_) { /* An absent optional service is normal. */ }
        }
        if (!found) {
          provider = undefined; profiles = [];
          publish({ PowerProfiles: '[]', PowerProfile: '', PowerProfileDegraded: '' });
        }
      }
    })().finally(() => { flight = undefined; });
    return flight;
  };
  const signal = event => {
    if (event.interface === PROPERTIES && providers.some(item => item.path === event.path)
      || event.member === 'NameOwnerChanged' && providers.some(item => item.name === event.args?.[0])
      || event.interface === 'org.freedesktop.DBus.Local' && event.member === 'Disconnected') refresh();
  };
  return {
    start: async () => {
      try {
        await bus.connect(); bus.onSignal(signal);
        await Promise.all(providers.flatMap(item => [
          bus.addMatch("type='signal',sender='" + item.name + "',interface='" + PROPERTIES + "'"),
          bus.addMatch("type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='" + item.name + "'")
        ]));
        await refresh();
      } catch (_) {
        provider = undefined; profiles = [];
        publish({ PowerProfiles: '[]', PowerProfile: '', PowerProfileDegraded: '' });
      }
    },
    setProfile: async profile => {
      if (disposed || busy) throw new Error('Power mode change is unavailable');
      busy = true;
      try {
        await refresh();
        if (!provider || !profiles.includes(profile)) throw new Error('Power mode is not supported');
        const target = provider;
        await bus.callComplex(target.name, target.path, PROPERTIES, 'Set', 'ssv', target.name, 'ActiveProfile', profile);
        await refresh();
      } finally { busy = false; }
    },
    dispose: () => { disposed = true; bus.offSignal(signal); }
  };
}
