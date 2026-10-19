// Run in a private session bus; never contacts package managers or changes host
// preferences. Exercises native UI pages and writes Vulkan captures to /tmp.
// dbus-run-session -- koya -m /usr/share/koya/assets -m . -n build/native/modules -i tests/updates-preview.js
import { session as Bus } from 'Module/dbus';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import * as Process from 'Module/process';
import * as Screenshot from 'Koya/Screenshot';
import * as Image from 'Koya/Image';
import * as Compositor from 'Koya/Compositor';
import { createShellService, shellStatePayload } from '../apps/shell-service.js';
import updates from '../apps/updates.js';
import settings from '../apps/settings.js';
import topBar from '../apps/top-bar.js';

const NAME = 'org.koya.Shell1', PATH = '/org/koya/Shell1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = '/tmp/koya-updates-preview';
const capture = async (win, name) => {
  await delay(700);
  if (!await Screenshot.capture(win, { id: name, source: 'vulkan', mipmaps: false })) throw new Error('Capture failed: ' + name);
  const png = await Image.encode(win, { src: '/ram/screenshot/' + name, format: 'png' });
  const bytes = png instanceof ArrayBuffer ? png : png.buffer instanceof ArrayBuffer
    ? png.buffer.slice(png.byteOffset || 0, (png.byteOffset || 0) + png.byteLength) : Uint8Array.from(png).buffer;
  if (!Process.writeFile(output + '/' + name + '.png', bytes)) throw new Error('Capture write failed');
};
const ready = async frame => {
  for (let i = 0; i < 100 && !frame.current; i++) await delay(50);
  if (!frame.current) throw new Error('Page did not load');
  await frame.settled;
};

export default function main() {
  setTimeout(async () => {
    const timeout = setTimeout(() => { Log.error('KOYA_UPDATES_PREVIEW_FAIL: timeout'); Engine.quit(); }, 25000);
    try {
      Process.mkdir(output);
      await Bus.connect();
      if (await Bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName', 'su', NAME, 4) !== '1')
        throw new Error('Use a private dbus-run-session');
      const packages = [
        { name: 'firefox', current: '143.0.4-1', next: '144.0-1', source: 'Repository' },
        { name: 'linux', current: '6.18-1', next: '6.19-1', source: 'Repository' },
        { name: 'mesa', current: '1:25.2.4-1', next: '1:25.2.5-1', source: 'Repository' },
        { name: 'google-chrome', current: '154.0.8037.92-1', next: '155.0.8059.84-1', source: 'AUR' },
        { name: 'visual-studio-code-bin', current: '1.139.1-1', next: '1.142.0-1', source: 'AUR' }
      ];
      let detail = { available: true, checking: false, installing: false, authenticating: false, checkedAt: Date.now(), packages,
        error: '', message: '', log: ':: Synchronizing package databases…\n core is up to date\n extra is up to date\n:: Starting full system upgrade…\n(1/3) upgrading linux\n(2/3) upgrading google-chrome\n(3/3) upgrading visual-studio-code-bin\n:: Running post-transaction hooks…\nUpgrade complete\n' };
      const service = createShellService({ stored: {}, persist: async () => {}, updates: { snapshot: () => detail },
        changed: state => Bus.emitSignal(PATH, NAME, 'StateChanged', 'a{sv}', shellStatePayload(state)) });
      service.update({ Active: true, ScreenState: 'unlocked', UpdatesAvailable: true, UpdatesCount: 5, UpdatesCheckedAt: detail.checkedAt, UpdatesRevision: 1 });
      Bus.exportObject(PATH, NAME, invocation => service.request(invocation.member, invocation.args).then(value => {
        if (invocation.member === 'GetState' || invocation.member === 'SetSetting') invocation.reply('a{sv}', shellStatePayload(value));
        else if (invocation.member === 'GetUpdates') invocation.reply('s', value);
        else invocation.reply('');
      }).catch(error => invocation.error(NAME + '.Error', String(error))));
      const frame = await updates(); await ready(frame);
      await capture(frame.win, 'overview');
      // An installation part-way: linux done, google-chrome building.
      detail = { ...detail, installing: true, message: 'Installing updates…',
        progress: { phase: 'build', current: 'google-chrome', done: ['linux'], packages, rest: '' } };
      service.update({ UpdatesInstalling: true, UpdatesRevision: 2 }); await capture(frame.win, 'installing');
      detail = { ...detail, installing: false, packages: [], checkedAt: Date.now(), message: 'Updates installed',
        progress: { ...detail.progress, phase: 'done', current: '', done: packages.map(item => item.name) } };
      service.update({ UpdatesInstalling: false, UpdatesCount: 0, UpdatesRevision: 3 }); await capture(frame.win, 'finished');
      await globalThis.koyaUpdates.go('log'); await capture(frame.win, 'log');
      await globalThis.koyaUpdates.go('overview');
      detail = { ...detail, progress: null, log: '' };
      service.update({ UpdatesRevision: 4 }); await capture(frame.win, 'current');
      detail = { ...detail, packages, error: 'Install pacman-contrib to check repository updates.\nAUR check failed: network unavailable.' };
      service.update({ UpdatesError: detail.error, UpdatesCount: 5, UpdatesRevision: 5 }); await capture(frame.win, 'failure');
      const preferences = await settings(); await ready(preferences);
      await capture(preferences.win, 'settings-home');
      await globalThis.koyaSettings.go('updates', 0); await capture(preferences.win, 'settings-updates');
      await globalThis.koyaSettings.go('updateInterval', 0); await capture(preferences.win, 'settings-interval');
      const display = (await Compositor.listDisplays({ backend: 'wayland' }))[0];
      const noop = async () => {};
      const notifications = { display, close: noop, open: noop, resize: noop, subscribe: callback => { callback(0); return () => {}; } };
      const volume = { close: noop, toggle: noop, resize: noop, subscribe: callback => { callback({ available: false }); return () => {}; } };
      service.update({ UpdatesError: '', UpdatesCount: 5, UpdatesChecking: false });
      const top = await topBar({ display, notifications, volume, initialState: service.snapshot() });
      await capture(top.window, 'bar-count');
      service.update({ UpdatesCount: 0 }); await capture(top.window, 'bar-zero');
      service.update({ UpdatesError: 'Network unavailable' }); await capture(top.window, 'bar-failure');
      service.update({ UpdatesError: '', UpdatesChecking: true }); await capture(top.window, 'bar-busy');
      await top.dispose();
      Process.writeFileText(output + '/result.txt', 'PASS\n');
      Log.info('KOYA_UPDATES_PREVIEW_PASS');
    } catch (error) {
      Process.writeFileText(output + '/result.txt', 'FAIL: ' + error + '\n' + (error.stack || ''));
      Log.error('KOYA_UPDATES_PREVIEW_FAIL: ' + error + '\n' + (error.stack || ''));
    }
    finally { clearTimeout(timeout); setTimeout(() => Engine.quit(), 150); }
  }, 0);
}
