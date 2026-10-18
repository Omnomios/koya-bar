import { system as Bus } from 'Module/dbus';
import * as Desktop from 'Module/desktop';

const NAME = 'org.freedesktop.login1', ROOT = '/org/freedesktop/login1', SESSION = NAME + '.Session';
export const currentSession = async () => {
  await Bus.connect();
  return Bus.call(NAME, ROOT, NAME + '.Manager', 'GetSessionByPID', 'u', Desktop.processId());
};
export const setLockedHint = async locked => Bus.call(NAME, await currentSession(), SESSION, 'SetLockedHint', 'b', locked);

export async function watchSession(changed) {
  let path, stopped = false, sleeping = false, flight, dirty = false, generation = 0;
  const unavailable = () => { generation++; changed({ Active: false, ScreenState: 'unknown' }); };
  const refresh = () => {
    dirty = true;
    if (flight) return flight;
    flight = (async () => {
      try {
        while (dirty && !stopped) {
          dirty = false;
          const version = generation;
          path ||= await currentSession();
          const value = await Bus.call(NAME, path, 'org.freedesktop.DBus.Properties', 'GetAll', 's', SESSION);
          if (!dirty && !stopped && version === generation) changed({ Active: value.Active === true && !sleeping, ScreenState: value.LockedHint === false ? 'unlocked' : 'locked' });
        }
      } catch (_) { if (!stopped) unavailable(); }
    })().finally(() => { flight = undefined; });
    return flight;
  };
  const signal = event => {
    if (event.interface === NAME + '.Manager' && event.member === 'PrepareForSleep') {
      sleeping = !!event.args[0]; if (sleeping) unavailable(); refresh();
    } else if (event.path === path && event.member === 'PropertiesChanged') refresh();
    else if (event.member === 'NameOwnerChanged' && event.args?.[0] === NAME) { path = undefined; unavailable(); refresh(); }
    else if (event.interface === 'org.freedesktop.DBus.Local' && event.member === 'Disconnected') unavailable();
  };
  unavailable();
  await Bus.connect(); Bus.onSignal(signal);
  await Promise.all([
    Bus.addMatch("type='signal',sender='org.freedesktop.login1',interface='org.freedesktop.DBus.Properties'"),
    Bus.addMatch("type='signal',sender='org.freedesktop.login1',interface='org.freedesktop.login1.Manager',member='PrepareForSleep'"),
    Bus.addMatch("type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.freedesktop.login1'")
  ]);
  await refresh();
  return () => { stopped = true; Bus.offSignal(signal); };
}
