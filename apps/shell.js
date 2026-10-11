import * as Compositor from 'Koya/Compositor';
import * as Desktop from 'Module/desktop';
import * as Process from 'Module/process';
import { session as Bus, system as System } from 'Module/dbus';
import * as Log from 'Helix/Log';
import * as Hypr from 'Module/hypr';
import { createNetworkStatus } from './network-status.js';
import { createShellService } from './shell-service.js';
import { createBatteryStatus } from './battery-status.js';
import wallpaper from './wallpaper.js';
import topBar from './top-bar.js';
import { connect } from './session.js';
import { startSshAgent } from './ssh-agent.js';

const NAME = 'org.koya.Shell1', PATH = '/org/koya/Shell1';
const methods = {
  GetState: ['', 'a{sv}'], Ready: ['s', ''], GetApplications: ['', 'aa{sv}'], ResolveIcon: ['s', 's'],
  OpenSettings: ['', ''], OpenWifi: ['', ''], SetSetting: ['ss', 'a{sv}']
};
export async function startShell() {
  await Bus.connect();
  const owner = await Bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName', 'su', NAME, 4);
  if (owner !== '1') throw new Error('Another Koya shell is running');
  let displays = await Compositor.listDisplays();
  if (!displays.length) throw new Error('No display available');
  const root = Process.getEnv('KOYA_DESKTOP_ROOT', '.');
  const emit = member => Bus.emitSignal(PATH, NAME, member, '');
  Desktop.start(root, () => emit('ApplicationsChanged'));
  const applications = { list: () => Desktop.applications(), resolveIcon: value => Desktop.resolveIcon(value) };
  const children = new Set(), running = new Map();
  // Built-in apps are exclusive-keyboard overlays: never stack two copies.
  const openBuiltin = component => {
    if (running.has(component)) return;
    const args = ['-m', root, '-n', root + '/build/native/modules', '-i', 'apps/' + component + '.js'];
    const sharedAssets = Process.getEnv('KOYA_ASSET_DIR', '');
    if (sharedAssets) args.unshift('-m', sharedAssets);
    const child = Process.spawn({ cmd: Process.getEnv('KOYA_BIN', 'koya'), args });
    children.add(child); running.set(component, child);
    child.stderr.on('data', data => Log.error(component + ': ' + data));
    child.on('exit', () => { children.delete(child); if (running.get(component) === child) running.delete(component); });
  };
  const service = createShellService({ applications, stored: Desktop.loadPreferences(),
    persist: text => Desktop.savePreferences(text), openBuiltin,
    changed: state => Bus.emitSignal(PATH, NAME, 'StateChanged', 'a{sv}', state) });
  Bus.exportObject(PATH, NAME, invocation => {
    const specification = methods[invocation.member];
    if (!specification) { invocation.error('org.freedesktop.DBus.Error.UnknownMethod', invocation.member); return; }
    if (invocation.signature !== specification[0]) { invocation.error('org.freedesktop.DBus.Error.InvalidArgs', 'Unexpected arguments'); return; }
    service.request(invocation.member, invocation.args).then(value => {
      if (specification[1]) invocation.reply(specification[1], value); else invocation.reply('');
    }).catch(error => invocation.error(NAME + '.Error', String(error.message || error)));
  });
  const network = createNetworkStatus(System, values => service.update(values));
  const battery = createBatteryStatus(System, values => service.update(values));
  await Promise.all([network.start(), battery.start()]);
  const bars = new Map();
  let sharedNotifications;
  let sharedVolume;
  const syncDisplays = async () => {
    displays = await Compositor.listDisplays();
    for (const display of displays) {
      if (bars.has(display.display)) continue;
      const [background, top] = await Promise.all([wallpaper({ display }),
        topBar({ display, notifications: sharedNotifications, volume: sharedVolume })]);
      sharedNotifications ||= top.notifications;
      sharedVolume ||= top.volume;
      bars.set(display.display, { background, top });
    }
    for (const [name, windows] of bars) {
      if (displays.some(display => display.display === name)) continue;
      await windows.top.dispose();
      await windows.background.dispose();
      bars.delete(name);
    }
    if (displays.length) {
      if (!displays.some(display => display.display === sharedNotifications?.display.display)) await sharedNotifications.setDisplay(displays[0]);
      if (!displays.some(display => display.display === sharedVolume?.display.display)) await sharedVolume.setDisplay(displays[0]);
    }
  };
  await syncDisplays();
  // Service state remains connected when the first output is unplugged.
  connect('notifications', sharedNotifications.onState, sharedNotifications.onApplications,
    () => sharedNotifications.start().catch(error => Log.error('Notifications: ' + error)));
  connect('volume', sharedVolume.onState);
  // Observe output changes; Hyprland retains workspace and window control.
  let sync = Promise.resolve();
  for (const name of ['monitoraddedv2', 'monitorremoved']) Hypr.on(name, () => {
    sync = sync.then(syncDisplays).catch(error => Log.error('Displays: ' + error));
  });
  Hypr.connect();
  const sshAgent = startSshAgent();
  globalThis.koyaShell = { service, bars, sshAgent };
}
