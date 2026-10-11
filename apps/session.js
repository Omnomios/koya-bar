import { session as Bus } from 'Module/dbus';
import * as Log from 'Helix/Log';
import * as Engine from 'Helix/Engine';
import { configureWallpaper } from './wallpaper-surface.js';

const NAME = 'org.koya.Shell1', PATH = '/org/koya/Shell1';
export const call = (method, signature = '', ...args) => Bus.call(NAME, PATH, NAME, method, signature, ...args);

export function connect(component, onState = () => {}, onApplications = () => {}, onConnected = () => {}) {
  let disposed = false, refreshing = false, dirty = false;
  const report = error => Log.error(component + ': ' + error);
  const refresh = async () => {
    dirty = true;
    if (refreshing || disposed) return;
    refreshing = true;
    try {
      while (dirty && !disposed) {
        dirty = false;
        const state = await call('GetState');
        if (!disposed) { await configureWallpaper(state); await onState(state); }
      }
    } finally { refreshing = false; }
  };
  const signal = event => {
    if (disposed) return;
    if (event.interface === NAME && event.member === 'StateChanged') refresh().catch(report);
    if (event.interface === NAME && event.member === 'ApplicationsChanged') Promise.resolve(onApplications()).catch(report);
    if (event.interface === 'org.freedesktop.DBus' && event.member === 'NameOwnerChanged' && event.args?.[0] === NAME) {
      if (!event.args[2]) Engine.quit(); else refresh().catch(report);
    }
  };
  setTimeout(async () => {
    try {
      await Bus.connect();
      if (disposed) return;
      Bus.onSignal(signal);
      await Bus.addMatch("type='signal',sender='org.koya.Shell1',interface='org.koya.Shell1'");
      await Bus.addMatch("type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.koya.Shell1'");
      if (disposed) return;
      await onConnected(); await refresh(); await call('Ready', 's', component);
    } catch (error) { report(error); }
  }, 0);
  return () => { disposed = true; Bus.offSignal(signal); };
}
