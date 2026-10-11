import * as Desktop from 'Module/desktop';
import * as Process from 'Module/process';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import * as UI from 'Helix/UserInterface';
import * as Input from 'Helix/Input';
import { session as Bus } from 'Module/dbus';
import { Notifications } from '../apps/notifications-model.js';
import { startNotifications, emitNotification } from '../apps/notifications-service.js';
import { createNetworkStatus } from '../apps/network-status.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
export default function main() {
  const timer = setTimeout(() => { Log.error('KOYA_DESKTOP_TEST_FAIL: timed out'); Engine.quit(); }, 10000);
  setTimeout(async () => {
    try {
      assert(typeof UI.setOnActivate === 'function' && typeof UI.setOnPress === 'function' && typeof UI.setOnDrag === 'function'
        && typeof Input.setHandlers === 'function', 'Koya 0.6.0 input API is required');
      const root = Process.getEnv('KOYA_DESKTOP_ROOT');
      assert(Desktop.userName().length > 0, 'Current account could not be resolved');
      Desktop.start(root, () => {});
      const apps = await Desktop.applications();
      assert(apps.some(app => app.id === 'example.desktop' && app.name === 'Example'), 'Desktop entry discovery failed');
      const app = apps.find(app => app.id === 'example.desktop');
      const icon = await Desktop.resolveIcon(app.iconName);
      assert(icon.startsWith('/rom/'), 'Desktop icon was not resolved');
      assert(apps.some(item => item.id === 'terminal.desktop'), 'Terminal application was omitted');
      assert(!apps.some(item => item.id === 'hidden.desktop'), 'Hidden application was included');
      assert(apps.some(item => item.id === 'koya-settings.desktop'), 'Settings desktop entry is missing');
      assert(app.genericName === 'Example utility' && app.keywords.includes('fixture'), 'Search metadata is missing');
      await Desktop.launch('example.desktop');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert(Process.exists(Process.getEnv('XDG_RUNTIME_DIR') + '/launched'), 'Desktop entry was not launched');
      let rejected = false;
      try { await Desktop.launch('unknown.desktop'); } catch (_) { rejected = true; }
      assert(rejected, 'Unknown desktop entry was accepted');
      Desktop.savePreferences(JSON.stringify({ Wallpaper: 'tidal-blue' }));
      const saved = Desktop.loadPreferences();
      assert(saved.Wallpaper === 'tidal-blue', 'Preferences did not round trip');
      Process.writeFileText(Process.getEnv('XDG_CONFIG_HOME') + '/koya-bar/settings.json', '{invalid');
      assert(Object.keys(Desktop.loadPreferences()).length === 0, 'Corrupt settings recovery failed');
      await Bus.connect();
      const model = new Notifications({ signal: (...args) => emitNotification(Bus, ...args) });
      await startNotifications(Bus, model);
      const id = await Bus.callComplex('org.freedesktop.Notifications', '/org/freedesktop/Notifications',
        'org.freedesktop.Notifications', 'Notify', 'susssasa{sv}i', 'Fixture', 0, '', 'Hello', 'Desktop body', [], {}, 0);
      assert(model.records.get(Number(id))?.summary === 'Hello', 'Native notification request failed');
      await Bus.call('org.freedesktop.Notifications', '/org/freedesktop/Notifications',
        'org.freedesktop.Notifications', 'CloseNotification', 'u', Number(id));
      assert(model.records.size === 0, 'Native notification close failed');
      const nm = 'org.freedesktop.NetworkManager';
      const addresses = address => ({ _t: 'aa{sv}', _v: [{ address, prefix: { _t: 'u', _v: 24 } }] });
      const objects = {
        '/org/freedesktop/NetworkManager': { [nm]: { NetworkingEnabled: true, WirelessEnabled: true, WirelessHardwareEnabled: true,
          State: { _t: 'u', _v: 70 }, Connectivity: { _t: 'u', _v: 4 }, PrimaryConnectionType: '802-3-ethernet', PrimaryConnection: { _t: 'o', _v: '/active' } } },
        '/active': { [nm + '.Connection.Active']: { Id: 'Wired fixture', Devices: { _t: 'ao', _v: ['/device'] }, Ip4Config: { _t: 'o', _v: '/ip4' } } },
        '/device': { [nm + '.Device']: { Interface: 'eth0', State: { _t: 'u', _v: 100 } } },
        '/ip4': { [nm + '.IP4Config']: { AddressData: addresses('192.0.2.4') } }
      };
      Bus.exportObject('/org/freedesktop', 'org.freedesktop.DBus.ObjectManager', invocation => invocation.reply('a{oa{sa{sv}}}', objects));
      assert(await Bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName', 'su', nm, 4) === '1', 'Fixture network name unavailable');
      let connection;
      const network = createNetworkStatus(Bus, state => { connection = state; });
      await network.start();
      assert(connection.NetworkName === 'Wired fixture' && connection.NetworkInterface === 'eth0' && connection.NetworkIPv4 === '192.0.2.4', 'Native connection summary failed: ' + JSON.stringify(connection));
      Bus.emitSignal('/ip4', 'org.freedesktop.DBus.Properties', 'PropertiesChanged', 'sa{sv}as', nm + '.IP4Config', { AddressData: addresses('192.0.2.9') }, []);
      const deadline = Date.now() + 2000;
      while (connection.NetworkIPv4 !== '192.0.2.9' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      assert(connection.NetworkIPv4 === '192.0.2.9', 'Native network update was not received');
      network.dispose();
      clearTimeout(timer); Log.info('KOYA_DESKTOP_TEST_PASS'); Engine.quit();
    } catch (error) { clearTimeout(timer); Log.error('KOYA_DESKTOP_TEST_FAIL: ' + error); Engine.quit(); }
  }, 0);
}
