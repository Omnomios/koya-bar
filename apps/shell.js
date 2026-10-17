import * as Compositor from 'Koya/Compositor';
import * as Desktop from 'Module/desktop';
import * as Process from 'Module/process';
import { session as Bus, system as System } from 'Module/dbus';
import * as Log from 'Helix/Log';
import * as Hypr from 'Module/hypr';
import { createNetworkStatus } from './network-status.js';
import { createShellService, shellStatePayload } from './shell-service.js';
import { createBatteryStatus } from './battery-status.js';
import { createPowerProfiles } from './power-profiles.js';
import wallpaper from './wallpaper.js';
import topBar from './top-bar.js';
import { connect } from './session.js';
import { startSshAgent } from './ssh-agent.js';
import { configureTheme } from './theme.js';
import { configureWallpaper } from './wallpaper-surface.js';
import { createNotifications } from './notifications.js';
import { createVolume } from './volume.js';

const NAME = 'org.koya.Shell1', PATH = '/org/koya/Shell1';
const methods = {
  GetState: ['', 'a{sv}'], Ready: ['s', ''], GetApplications: ['', 'aa{sv}'], ResolveIcon: ['s', 's'],
  OpenSettings: ['', ''], OpenWifi: ['', ''], SetSetting: ['ss', 'a{sv}'], SetPowerProfile: ['s', 'a{sv}'], SetChargeControl: ['sb', 'a{sv}']
};
export async function startShell() {
  await Bus.connect();
  const owner = await Bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName', 'su', NAME, 4);
  if (owner !== '1') throw new Error('Another Koya shell is running');
  let displays = await Compositor.listDisplays({ backend: 'wayland' });
  if (!displays.length) throw new Error('No display available');
  const stored = Desktop.loadPreferences();
  await configureTheme(stored);
  const root = Process.getEnv('KOYA_DESKTOP_ROOT', '.');
  const emit = member => Bus.emitSignal(PATH, NAME, member, '');
  Desktop.start(root, () => emit('ApplicationsChanged'));
  // Load saved artwork alongside window construction. An imported image's
  // catalogue/mount is required by backgrounds, but never by the top bars.
  const wallpaperReady = configureWallpaper(stored);
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
  const profiles = createPowerProfiles(System, values => service.update(values));
  const battery = createBatteryStatus(System, values => service.update(values));
  const service = createShellService({ applications, stored, setPowerProfile: profiles.setProfile,
    setChargeControl: battery.setChargeControl,
    persist: text => Desktop.savePreferences(text), openBuiltin,
    changed: state => Bus.emitSignal(PATH, NAME, 'StateChanged', 'a{sv}', shellStatePayload(state)) });
  Bus.exportObject(PATH, NAME, invocation => {
    const specification = methods[invocation.member];
    if (!specification) { invocation.error('org.freedesktop.DBus.Error.UnknownMethod', invocation.member); return; }
    if (invocation.signature !== specification[0]) { invocation.error('org.freedesktop.DBus.Error.InvalidArgs', 'Unexpected arguments'); return; }
    service.request(invocation.member, invocation.args).then(value => {
      if (specification[1]) invocation.reply(specification[1], specification[1] === 'a{sv}' ? shellStatePayload(value) : value);
      else invocation.reply('');
    }).catch(error => invocation.error(NAME + '.Error', String(error.message || error)));
  });
  const network = createNetworkStatus(System, values => service.update(values));
  // Status services can be slow or absent; first paint must not wait for them.
  Promise.all([network.start(), battery.start(), profiles.start()])
    .catch(error => Log.error('Desktop status: ' + error));
  const bars = new Map();
  const sharedNotifications = createNotifications(displays[0]);
  const sharedVolume = createVolume(displays[0]);
  const syncDisplays = async outputs => {
    displays = outputs || await Compositor.listDisplays({ backend: 'wayland' });
    await Promise.all(displays.filter(display => !bars.has(display.display)).map(async display => {
      const [background, top] = await Promise.all([wallpaperReady.then(() => wallpaper({ display })),
        topBar({ display, notifications: sharedNotifications, volume: sharedVolume, initialState: service.snapshot() })]);
      bars.set(display.display, { background, top });
    }));
    await Promise.all([...bars].filter(([name]) => !displays.some(display => display.display === name)).map(async ([name, windows]) => {
      await Promise.all([windows.top.dispose(), windows.background.dispose()]);
      bars.delete(name);
    }));
    if (displays.length) {
      await Promise.all([
        ...(!displays.some(display => display.display === sharedNotifications.display.display) ? [sharedNotifications.setDisplay(displays[0])] : []),
        ...(!displays.some(display => display.display === sharedVolume.display.display) ? [sharedVolume.setDisplay(displays[0])] : [])
      ]);
    }
  };
  await syncDisplays(displays);
  // Service state remains connected when the first output is unplugged.
  connect('notifications', sharedNotifications.onState, sharedNotifications.onApplications,
    () => sharedNotifications.start().catch(error => Log.error('Notifications: ' + error)));
  connect('volume', sharedVolume.onState);
  // Observe output changes; Hyprland retains workspace and window control.
  let sync = Promise.resolve();
  for (const name of ['monitoraddedv2', 'monitorremoved']) Hypr.on(name, () => {
    sync = sync.then(() => syncDisplays()).catch(error => Log.error('Displays: ' + error));
  });
  Hypr.connect();
  const sshAgent = startSshAgent();
  globalThis.koyaShell = { service, bars, sshAgent };
}
