// The native backend owns logind's inhibitor FD. State is published only after
// acquisition succeeds; switching off cancels a pending acquisition as well.
export function caffeineButton(state = {}) {
  return { label: state.CaffeinePending ? 'Starting…' : state.CaffeineError ? 'Retry Caffeine' : state.CaffeineActive ? 'Caffeine on' : 'Caffeine',
    active: !!state.CaffeineActive, error: !!state.CaffeineError,
    enabled: !!(state.CaffeineActive || state.CaffeinePending || state.Active && state.ScreenState === 'unlocked') };
}

export function createCaffeine({ acquire, release, bus, changed = () => {} }) {
  let active = false, pending = false, error = '', generation = 0, flight, disposed = false;
  const snapshot = () => ({ CaffeineActive: active, CaffeinePending: pending, CaffeineError: error });
  const publish = () => changed(snapshot());
  const disable = () => {
    ++generation; release(); active = pending = false; error = ''; publish();
    return snapshot();
  };
  const signal = event => {
    if ((active || pending) && (event.member === 'NameOwnerChanged' && event.args?.[0] === 'org.freedesktop.login1'
      || event.interface === 'org.freedesktop.DBus.Local' && event.member === 'Disconnected')) disable();
  };
  return {
    snapshot,
    async start() {
      await bus.connect();
      if (disposed) return;
      bus.onSignal(signal);
      await bus.addMatch("type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.freedesktop.login1'");
    },
    setEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Caffeine expects a boolean');
      if (!enabled) return disable();
      if (disposed) throw new Error('Caffeine is unavailable');
      if (active) return snapshot();
      if (pending) return flight;
      const request = ++generation;
      pending = true; error = ''; publish();
      flight = (async () => {
        try {
          await acquire();
          if (request !== generation) throw new Error('Caffeine request cancelled');
          active = true; pending = false; publish();
          return snapshot();
        } catch (reason) {
          if (request === generation) {
            active = pending = false; error = String(reason?.message || reason); publish();
          }
          throw reason;
        }
      })();
      return flight;
    },
    onState(state) { if (!state.Active && (active || pending)) disable(); },
    dispose() { disposed = true; bus.offSignal(signal); disable(); }
  };
}
