import assert from 'node:assert/strict';
import { createShellService } from '../apps/shell-service.js';
import { defaults, readSettings, settingValue } from '../apps/settings-model.js';
import { clockDefaults, clockPresentation, clockRefreshDelay } from '../apps/clock-model.js';
import { Notifications, plain } from '../apps/notifications-model.js';
import { networkStatus, createNetworkStatus } from '../apps/network-status.js';
import { topBarStatus } from '../apps/status-model.js';
import { wallpaperFrame, WALLPAPERS } from '../apps/wallpapers.js';
import { validPassword, connectionSettings, networks } from '../apps/wifi-model.js';
import { filterApplications, LauncherModel } from '../apps/launcher-model.js';
import { createLockController } from '../apps/lock-model.js';
import { networkSummary } from '../apps/network-model.js';
import { notificationHeight, notificationGeometry, notificationPages, MAX_VISIBLE } from '../apps/notifications-layout.js';
import { pressFeedback, volumeInput } from '../apps/input-model.js';
import { popupContains } from '../apps/popup-layout.js';
import { BAR_HEIGHT } from '../apps/theme.js';
import { createCursorState } from '../apps/cursor-model.js';

const mouseHover = phase => ({ source: 'mouse', phase });
const cursor = createCursorState();
cursor.hover('surface', 'default', 0, mouseHover('enter'));
cursor.hover('card', 'pointer', 10, mouseHover('enter'));
cursor.hover('field', 'text', 10, mouseHover('enter'));
cursor.hover('surface', 'default', 0, mouseHover('move'));
cursor.hover('card', 'pointer', 10, mouseHover('move'));
assert.equal(cursor.shape, 'text', 'Ancestor hover must not override its nested control');
cursor.hover('field', 'text', 10, mouseHover('leave'));
assert.equal(cursor.shape, 'pointer', 'Leaving a child must restore its parent cursor');
cursor.drag('ew-resize', { source: 'mouse', phase: 'start', interactionId: 'drag' });
cursor.hover('card', 'pointer', 10, mouseHover('leave'));
cursor.hover('surface', 'default', 0, mouseHover('leave'));
assert.equal(cursor.shape, 'ew-resize', 'Captured dragging must keep the cursor outside the slider');
cursor.drag('ew-resize', { source: 'touch', phase: 'start', interactionId: 'finger' });
cursor.drag('ew-resize', { source: 'mouse', phase: 'cancel', interactionId: 'drag' });
assert.equal(cursor.shape, 'default');
assert.equal(cursor.active, false, 'Touch must not retain a mouse cursor override');
cursor.hover('field', 'text', 10, mouseHover('enter')); cursor.clear();
assert.equal(cursor.shape, 'default'); assert.equal(cursor.active, false);

const feedback = [];
const pressed = pressFeedback({ start: event => feedback.push('start:' + event.interactionId),
  end: event => feedback.push('end:' + event.interactionId), cancel: event => feedback.push('cancel:' + event.interactionId) });
pressed({ phase: 'start', interactionId: 'finger-a' });
pressed({ phase: 'start', interactionId: 'finger-b' });
pressed({ phase: 'change', interactionId: 'finger-a', inside: false });
pressed({ phase: 'end', interactionId: 'finger-a', inside: false });
assert.deepEqual(feedback, ['start:finger-a']);
pressed({ phase: 'cancel', interactionId: 'finger-b', reason: 'focus-lost' });
assert.deepEqual(feedback, ['start:finger-a', 'cancel:finger-b']);
pressed({ phase: 'start', interactionId: 'mouse:primary' });
pressed({ phase: 'end', interactionId: 'mouse:primary', inside: false });
assert.equal(feedback.at(-1), 'end:mouse:primary');
pressed({ phase: 'cancel', interactionId: 'mouse:primary' });
assert.equal(feedback.length, 4);

const levels = []; let audioAvailable = true;
const slider = volumeInput({ setPercent: percent => levels.push(percent), available: () => audioAvailable });
const sliderEvent = (phase, interactionId, x) => ({ phase, interactionId, local: { x, y: 32 } });
slider.onActivate(sliderEvent('', 'tap', 82)); assert.equal(levels.at(-1), 50);
slider.onDrag(sliderEvent('start', 'drag-a', 6));
slider.onDrag(sliderEvent('change', 'drag-a', -50)); assert.equal(levels.at(-1), 0);
slider.onDrag(sliderEvent('start', 'drag-b', 82));
slider.onDrag(sliderEvent('cancel', 'drag-b', 82));
slider.onActivate(sliderEvent('', 'tap-b', 82)); assert.equal(levels.at(-1), 0);
slider.onDrag(sliderEvent('end', 'drag-a', 250)); assert.equal(levels.at(-1), 100);
slider.onDrag(sliderEvent('start', 'drag-c', 82));
const beforeCancel = levels.length;
slider.onDrag(sliderEvent('cancel', 'drag-c', 250));
slider.onDrag(sliderEvent('change', 'drag-c', 6));
slider.onDrag(sliderEvent('end', 'drag-c', 6));
assert.equal(levels.length, beforeCancel, 'Cancellation must not set or commit a volume');
audioAvailable = false;
slider.onActivate(sliderEvent('', 'tap', 82)); slider.onDrag(sliderEvent('start', 'unavailable', 6));
assert.equal(levels.length, beforeCancel);
audioAvailable = true; slider.dispose();
slider.onActivate(sliderEvent('', 'delayed-tap', 82)); slider.onDrag(sliderEvent('start', 'delayed-drag', 6));
assert.equal(levels.length, beforeCancel, 'Destroyed slider must ignore queued input');
assert.equal(popupContains({ x: 140, y: 60 }, { x: 100, y: 42 }, { x: 280, y: 64 }), true);
assert.equal(popupContains({ x: 99, y: 60 }, { x: 100, y: 42 }, { x: 280, y: 64 }), false);
import { speakerStatus, clampVolume, channelVolumes, volumePopupPosition } from '../apps/audio-model.js';

assert.equal(clampVolume(150), 100); assert.equal(clampVolume(-1), 0);
for (const [percent, icon] of [[0, 'volume-zero'], [25, 'volume-low'], [50, 'volume-medium'], [100, 'volume']])
  assert.equal(speakerStatus({ available: true, percent }).icon, icon);
assert.equal(speakerStatus({ available: true, percent: 50, muted: true }).icon, 'volume-muted');
assert.equal(speakerStatus({ available: false }).icon, 'volume-unavailable');
assert.deepEqual(channelVolumes([65536, 32768], 40), ['40.000%', '20.000%']);
assert.deepEqual(channelVolumes([0, 0], 50, [1, 0.5]), ['50.000%', '25.000%']);
assert.deepEqual(volumePopupPosition({ x: 1920, y: 1080 }, { x: 1700, y: 0, width: 36, height: 36 }), { x: 1578, y: 42 });
assert.equal(volumePopupPosition({ x: 1920, y: 1080 }, { x: 1900, y: 0, width: 36, height: 36 }).x, 1632);
assert.equal(volumePopupPosition({ x: 1920, y: 1080 }, { x: 0, y: 0, width: 36, height: 36 }).x, 8);
for (const size of [{ x: 1920, y: 1080 }, { x: 2560, y: 1440 }, { x: 390, y: 844 }]) {
  const geometry = notificationGeometry(size);
  assert.equal(geometry.width, 300);
  assert.equal(geometry.x, size.x - 300 - 10);
  assert.equal(geometry.y, BAR_HEIGHT + 10);
  assert.ok(geometry.y + geometry.height <= size.y - 10);
}
assert.equal(notificationGeometry({ x: 280, y: 600 }).width, 260);
const compactNotification = { body: 'A very long notification body '.repeat(20), actions: [], active: true };
assert.ok(notificationHeight(compactNotification, 300, false) <= 100);
const history = Array.from({ length: 12 }, (_, id) => ({ ...compactNotification, id }));
const notificationGroups = notificationPages(history, 284, 550);
assert.deepEqual(notificationGroups.map(group => group.length), [MAX_VISIBLE, MAX_VISIBLE, 2]);
assert.deepEqual(notificationGroups.flat().map(item => item.id), history.map(item => item.id));
assert.ok(notificationPages(history, 284, 200).every(group => group.length <= 2));
assert.deepEqual(notificationPages([{ ...compactNotification, transient: true }], 284, 550), [[]]);
const withActions = { ...compactNotification, actions: Array.from({ length: 8 }, (_, index) => ({ key: String(index), label: 'Action' })) };
assert.equal(notificationHeight(withActions, 300, false), notificationHeight(compactNotification, 300, false));
assert.ok(notificationHeight(withActions, 300) > notificationHeight(compactNotification, 300));
for (const group of notificationPages(Array.from({ length: 6 }, () => withActions), 284, 500))
  assert.ok(group.reduce((sum, item) => sum + notificationHeight(item, 284), 0) + (group.length - 1) * 10 <= 500);
assert.deepEqual(notificationPages([], 284, 550), [[]]);

let unlocks = 0, authentication = 0, time = 1000, secure = 'locked';
const locker = createLockController({ authenticate: async password => { authentication++; return { ok: password === 'fixture' }; },
  unlock: async () => { unlocks++; return true; }, lockState: async () => secure, now: () => time });
assert.equal(await locker.submit('wrong'), false); assert.equal(unlocks, 0);
assert.equal(await locker.submit('fixture'), false); assert.equal(authentication, 1);
time += 1000; assert.equal(await locker.submit('fixture'), true); assert.equal(unlocks, 1);
assert.equal(await locker.submit('fixture'), false); assert.equal(unlocks, 1);
const refused = createLockController({ authenticate: async () => { throw new Error('PAM unavailable'); },
  unlock: async () => { unlocks++; return true; }, lockState: async () => secure });
assert.equal(await refused.submit('fixture'), false); assert.equal(unlocks, 1);
secure = 'locking';
const unconfirmed = createLockController({ authenticate: async () => { throw new Error('must not authenticate'); },
  unlock: async () => { unlocks++; return true; }, lockState: async () => secure });
assert.equal(await unconfirmed.submit('fixture'), false); assert.equal(unlocks, 1);
secure = 'locked'; let resolveAuthentication;
const simultaneous = createLockController({ authenticate: () => new Promise(resolve => { resolveAuthentication = resolve; }),
  unlock: async () => { unlocks++; return true; }, lockState: async () => secure });
const checking = simultaneous.submit('fixture'); await Promise.resolve(); await Promise.resolve();
assert.equal(await simultaneous.submit('fixture'), false);
secure = 'finished'; resolveAuthentication({ ok: true });
assert.equal(await checking, false); assert.equal(unlocks, 1);

const launcherApps = [
  { id: 'firefox.desktop', name: 'Firefox', genericName: 'Web Browser', keywords: 'Internet;Tabs', executable: 'firefox' },
  { id: 'terminal.desktop', name: 'Terminal', genericName: 'Command line', executable: 'alacritty' },
  { id: 'settings.desktop', name: 'Koya Settings', comment: 'Desktop wallpaper', keywords: 'Preferences' },
  { id: 'editor.desktop', name: 'Éditeur', comment: 'Text editor' }
];
assert.equal(filterApplications(launcherApps, 'web tabs')[0].id, 'firefox.desktop');
assert.equal(filterApplications(launcherApps, 'ffx')[0].id, 'firefox.desktop');
assert.equal(filterApplications(launcherApps, 'alacritty')[0].id, 'terminal.desktop');
assert.equal(filterApplications(launcherApps, 'editeur')[0].id, 'editor.desktop');
assert.equal(filterApplications(launcherApps, 'preferences')[0].id, 'settings.desktop');
assert.equal(filterApplications(launcherApps, 'no such app').length, 0);
const picker = new LauncherModel(launcherApps);
picker.move(999); assert.equal(picker.selected, 3);
picker.move(-999); assert.equal(picker.selected, 0);
picker.filter('browser'); assert.equal(picker.current.id, 'firefox.desktop');
picker.refresh(launcherApps.slice(1)); assert.equal(picker.current, undefined);
picker.filter(''); assert.equal(picker.results.length, 3);
picker.move(1); const selected = picker.current.id;
picker.refresh([...launcherApps].reverse()); assert.equal(picker.current.id, selected);
picker.filter('ab🐟d'); picker.moveCursor(-1); picker.insert('c');
assert.equal(picker.query, 'ab🐟cd');
picker.erase(); assert.equal(picker.query, 'ab🐟d');
picker.moveCursor(-1); picker.erase(true); assert.equal(picker.query, 'abd');
picker.moveCursor(-256); picker.erase(); assert.equal(picker.query, 'abd');

const saved = [], opened = [];
const applications = { list: async () => [{ id: 'example.desktop', name: 'Example' }], resolveIcon: async value => value };
const service = createShellService({ applications, stored: { Wallpaper: 'tidal-blue', VolumeStepPercent: -1, Bad: true },
  persist: async value => saved.push(JSON.parse(value)), openBuiltin: async component => opened.push(component) });
assert.equal(service.snapshot().Wallpaper, 'tidal-blue');
assert.equal(service.snapshot().VolumeStepPercent, undefined);
assert.equal(service.snapshot().Bad, undefined);
assert.equal((await service.request('GetApplications')).length, 1);
await service.request('OpenSettings'); await service.request('OpenWifi');
assert.deepEqual(opened, ['settings', 'wifi']);
for (const method of ['ShowDesktopView', 'SwitchDesktop', 'FocusWindow', 'CloseWindow', 'LaunchApplication'])
  await assert.rejects(service.request(method));
await service.request('SetSetting', ['Wallpaper', 'violet-dusk']);
assert.equal(saved[0].Wallpaper, 'violet-dusk');
assert.equal(service.snapshot().Wallpaper, 'violet-dusk');
await assert.rejects(service.request('SetSetting', ['Wallpaper', '../invalid']));
assert.equal(saved.length, 1);
await Promise.all([service.request('SetSetting', ['Wallpaper', 'earthy-green']), service.request('SetSetting', ['Wallpaper', 'tidal-blue'])]);
assert.equal(saved[1].Wallpaper, 'earthy-green');
assert.equal(saved[2].Wallpaper, 'tidal-blue');
await assert.rejects(service.request('SetSetting', ['VolumeStepPercent', '10']));
const failing = createShellService({ applications, persist: async () => { throw new Error('disk full'); }, openBuiltin: () => {} });
await assert.rejects(failing.request('SetSetting', ['Wallpaper', 'tidal-blue']));
assert.equal(failing.snapshot().Wallpaper, WALLPAPERS[0].id);
assert.throws(() => settingValue('VolumeStepPercent', '5.5'));
assert.throws(() => settingValue('VolumeStepPercent', ''));
assert.deepEqual(readSettings({ VolumeIndicatorEnabled: false, VolumeMaxPercent: 75 }), defaults);
assert.deepEqual(readSettings({ ClockTimeFormat: 'wrong', ClockShowDate: 'no', ClockShowSeconds: 1 }), defaults);
assert.equal(settingValue('ClockShowDate', 'false'), false);
assert.equal(settingValue('ClockShowSeconds', true), true);
assert.throws(() => settingValue('ClockTimeFormat', 'locale'));
assert.throws(() => settingValue('ClockShowDate', '0'));
await service.request('SetSetting', ['ClockTimeFormat', '12h']);
await service.request('SetSetting', ['ClockShowDate', 'false']);
await service.request('SetSetting', ['ClockShowSeconds', 'true']);
assert.deepEqual(readSettings(saved.at(-1)), { Wallpaper: 'tidal-blue', ClockTimeFormat: '12h', ClockShowDate: false, ClockShowSeconds: true });
assert.equal(service.snapshot().ClockShowSeconds, true);

const timezone = process.env.TZ;
try {
  process.env.TZ = 'Australia/Sydney';
  const beforeMidnight = new Date('2026-10-07T12:59:59Z'), afterMidnight = new Date('2026-10-07T13:00:00Z');
  assert.deepEqual(clockPresentation(beforeMidnight), { time: '23:59', date: '2026-10-07', showDate: true, timeWidth: 44 });
  assert.equal(clockPresentation(afterMidnight).date, '2026-10-08', 'Date follows the local calendar rather than UTC');
  assert.equal(clockPresentation(afterMidnight, { ClockTimeFormat: '12h' }).time, '12:00 AM');
  assert.equal(clockPresentation(new Date(2026, 9, 8, 12, 5, 9), { ClockTimeFormat: '12h', ClockShowSeconds: true }).time, '12:05:09 PM');
  assert.equal(clockPresentation(new Date(2026, 0, 2, 1, 3, 4)).date, '2026-01-02');
  assert.equal(clockPresentation(afterMidnight, { ClockShowDate: false }).showDate, false);
  assert.equal(clockPresentation(beforeMidnight, { ClockShowSeconds: true }).time, '23:59:59');
  assert.equal(clockRefreshDelay(61250, clockDefaults), 58750);
  assert.equal(clockRefreshDelay(61250, { ClockShowSeconds: true }), 750);
  assert.equal(clockRefreshDelay(60000, clockDefaults), 60000);
} finally {
  if (timezone === undefined) delete process.env.TZ; else process.env.TZ = timezone;
}

const signals = [], timers = new Map(); let serial = 0;
const notifications = new Notifications({ signal: (...args) => signals.push(args),
  schedule: callback => { const id = ++serial; timers.set(id, callback); return id; }, cancel: id => timers.delete(id) });
const note = ['Example', 0, '', '<b>Hello</b>', 'Body &amp; text', ['default', 'Open'], {}, 0];
const id = notifications.notify(':1.1', note);
assert.equal(notifications.unread, 1);
assert.equal(notifications.items[0].summary, 'Hello');
assert.equal(notifications.items[0].body, 'Body & text');
assert.equal(notifications.notify(':1.1', ['Example', id, '', 'Replaced', '', [], {}, 0]), id);
assert.notEqual(notifications.notify(':1.2', ['Other', id, '', '', '', [], {}, 0]), id);
const actionable = notifications.notify(':1.1', note);
assert.equal(notifications.invoke(actionable, 'default'), true);
assert.equal(signals.at(-2)[1], 'ActionInvoked');
assert.equal(signals.at(-1)[1], 'NotificationClosed');
const timed = notifications.notify(':1.3', ['Timer', 0, '', '', '', [], {}, 100]);
const expiry = notifications.records.get(timed).timer; timers.get(expiry)();
assert.equal(notifications.records.get(timed).active, false);
assert.equal(notifications.records.get(timed).actions.length, 0);
notifications.read(); assert.equal(notifications.unread, 0);
notifications.clear(); assert.equal(notifications.records.size, 0);
assert.equal(plain('a&#x1f41f;b'), 'a🐟b');

const nm = 'org.freedesktop.NetworkManager';
const network = networkStatus({ '/org/freedesktop/NetworkManager': { [nm]: { NetworkingEnabled: true, WirelessEnabled: true,
  WirelessHardwareEnabled: true, State: 70, Connectivity: 4, PrimaryConnectionType: '802-3-ethernet' } } }, {}, true);
assert.equal(network.NetworkType, 'ethernet');
assert.equal(topBarStatus(network).wired, true);
assert.equal(topBarStatus({ BatteryPresent: true, BatteryPercent: 10, BatteryState: 'discharging' }).batteryLow, true);
assert.equal(topBarStatus({ BatteryPresent: true, BatteryPercent: -1 }).batteryText, '—');
assert.equal(topBarStatus({ NetworkState: 'connected', NetworkConnectivity: 'portal' }).warning, true);
const connectionObjects = {
  '/org/freedesktop/NetworkManager': { [nm]: { NetworkingEnabled: true, WirelessEnabled: true, WirelessHardwareEnabled: true,
    State: 70, Connectivity: 4, PrimaryConnectionType: '802-11-wireless', PrimaryConnection: '/active' } },
  '/active': { [nm + '.Connection.Active']: { Id: 'Saved profile', Devices: ['/device'], Ip4Config: '/ip4', Ip6Config: '/ip6' } },
  '/device': { [nm + '.Device']: { State: 100, Interface: 'wlan0' }, [nm + '.Device.Wireless']: { ActiveAccessPoint: '/ap' } },
  '/ap': { [nm + '.AccessPoint']: { Ssid: [75, 111, 121, 97], Strength: 0x150, RsnFlags: 0x100 } },
  '/ip4': { [nm + '.IP4Config']: { AddressData: [{ address: '192.0.2.4', prefix: 24 }] } },
  '/ip6': { [nm + '.IP6Config']: { AddressData: [{ address: '2001:db8::4', prefix: 64 }] } }
};
const wifiConnection = networkStatus(connectionObjects, {}, true);
const wifiSummary = networkSummary(wifiConnection);
assert.equal(wifiSummary.title, 'Wi-Fi');
assert.equal(wifiSummary.status, 'Connected · Internet available');
assert.deepEqual(wifiSummary.rows, [['Network', 'Koya'], ['Interface', 'wlan0'], ['IPv4', '192.0.2.4'],
  ['IPv6', '2001:db8::4'], ['Signal', '80%'], ['Security', 'WPA / WPA2']]);
assert.equal(networkSummary({ ...wifiConnection, NetworkConnectivity: 'portal' }).status, 'Connected · Sign-in required');
assert.equal(networkSummary({ ...wifiConnection, NetworkConnectivity: 'limited' }).status, 'Connected · Limited connectivity');
assert.equal(networkSummary({ ...wifiConnection, NetworkState: 'offline' }).rows.length, 0);
assert.equal(networkSummary({ NetworkAvailable: false }).status, 'NetworkManager unavailable');
assert.ok(networkSummary({ ...wifiConnection, NetworkType: 'ethernet' }).rows.some(([name, value]) => name === 'Wi-Fi' && value === 'Koya'));
assert.ok(!networkSummary({ ...wifiConnection, WifiStrength: -1 }).rows.some(([name]) => name === 'Signal'));
const networkListeners = new Set(), networkUpdates = [];
const mockNetworkBus = {
  connect: async () => {}, addMatch: () => {},
  onSignal: listener => networkListeners.add(listener), offSignal: listener => networkListeners.delete(listener),
  call: async (service, path, iface, method, signature, name) => {
    if (method === 'GetNameOwner') { if (name === nm) return ':1.42'; throw new Error('No modem service'); }
    if (method === 'GetManagedObjects') return structuredClone(connectionObjects);
    throw new Error('Unexpected network call');
  }
};
const trackedNetwork = createNetworkStatus(mockNetworkBus, state => networkUpdates.push(state));
await trackedNetwork.start();
const networkSignal = (path, iface, changes) => {
  for (const listener of networkListeners) listener({ path, sender: ':1.42', interface: 'org.freedesktop.DBus.Properties', member: 'PropertiesChanged', args: [iface, changes, []] });
};
networkSignal('/ip4', nm + '.IP4Config', { AddressData: [{ address: '192.0.2.9' }] });
assert.equal(networkUpdates.at(-1).NetworkIPv4, '192.0.2.9');
networkSignal('/org/freedesktop/NetworkManager', nm, { Connectivity: 2 });
assert.equal(networkSummary(networkUpdates.at(-1)).status, 'Connected · Sign-in required');
networkSignal('/ap', nm + '.AccessPoint', { Strength: 20 });
assert.ok(networkSummary(networkUpdates.at(-1)).rows.some(([name, value]) => name === 'Signal' && value === '20%'));
networkSignal('/org/freedesktop/NetworkManager', nm, { PrimaryConnection: '/' });
assert.equal(networkUpdates.at(-1).NetworkIPv4, '');
assert.equal(networkUpdates.at(-1).NetworkInterface, '');
trackedNetwork.dispose(); assert.equal(networkListeners.size, 0);
assert.equal(validPassword('wpa-psk', 'short'), false);
assert.equal(validPassword('wpa-psk', 'long-enough'), true);
const profile = connectionSettings({ name: 'Example', ssid: [69, 120], security: 'wpa-psk', password: true }, 'long-enough', 'tester');
assert.equal(profile['802-11-wireless-security'].psk, 'long-enough');
assert.equal(networks([], [], '/').length, 0);
for (const size of [{ x: 1920, y: 1080 }, { x: 390, y: 844 }]) {
  const frame = wallpaperFrame(WALLPAPERS[0], size);
  const crop = { x: frame.aabb.max.x - frame.aabb.min.x, y: frame.aabb.max.y - frame.aabb.min.y };
  assert.ok(Math.abs(crop.x / crop.y - size.x / size.y) < 1e-6);
  assert.ok(frame.aabb.min.x >= 0 && frame.aabb.min.y >= 0);
  assert.ok(frame.aabb.max.x <= WALLPAPERS[0].size.x + 1e-6 && frame.aabb.max.y <= WALLPAPERS[0].size.y + 1e-6);
}
console.log('Desktop models: passed');
