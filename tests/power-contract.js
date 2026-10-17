import { session as Bus } from 'Module/dbus';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import { createBatteryStatus } from '../apps/battery-status.js';
import { createPowerProfiles } from '../apps/power-profiles.js';
import { powerView } from '../apps/power-model.js';
import { createShellService, shellStatePayload } from '../apps/shell-service.js';

const UPOWER = 'org.freedesktop.UPower', ROOT = '/org/freedesktop/UPower';
const NAME = 'org.freedesktop.UPower.PowerProfiles', PATH = '/org/freedesktop/UPower/PowerProfiles';
const PROPERTIES = 'org.freedesktop.DBus.Properties';
const assert = (value, message) => { if (!value) throw new Error(message); };
const double = value => ({ _t: 'd', _v: value });

// Run on an isolated session bus; no host power setting is touched.
export default function main() {
  setTimeout(async () => {
    let battery, profiles, service, active = 'balanced', writes = 0, denied = false, state = {}, chargeEnabled = true, chargeWrites = 0;
    const update = value => { state = { ...state, ...value }; service?.update(value); };
    const timer = setTimeout(() => { Log.error('KOYA_POWER_TEST_FAIL: timeout'); Engine.quit(); }, 10000);
    try {
      await Bus.connect();
      for (const name of [UPOWER, NAME, 'org.koya.Shell1'])
        assert(await Bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName', 'su', name, 4) === '1', 'Fixture name unavailable');
      Bus.exportObject(ROOT, UPOWER, invocation => {
        if (invocation.member === 'GetDisplayDevice') invocation.reply('o', '/display');
        else if (invocation.member === 'EnumerateDevices') invocation.reply('ao', ['/battery/BAT0']);
        else invocation.error('org.freedesktop.DBus.Error.UnknownMethod', invocation.member);
      });
      Bus.exportObject(ROOT, PROPERTIES, invocation => invocation.reply('a{sv}', { OnBattery: false }));
      Bus.exportObject('/display', PROPERTIES, invocation => invocation.reply('a{sv}', {
        IsPresent: true, Percentage: double(80), State: 1, EnergyRate: double(12.4), Energy: double(40), EnergyFull: double(50), TimeToFull: 3600
      }));
      Bus.exportObject('/battery/BAT0', PROPERTIES, invocation => invocation.reply('a{sv}', {
        Type: 2, PowerSupply: true, IsPresent: true, NativePath: 'BAT0', Capacity: double(95.8), ChargeCycles: 91,
        EnergyFull: double(46.95), EnergyFullDesign: double(49), ChargeThresholdSupported: true, ChargeThresholdEnabled: chargeEnabled,
        ChargeStartThreshold: 75, ChargeEndThreshold: 80
      }));
      Bus.exportObject('/battery/BAT0', UPOWER + '.Device', invocation => {
        assert(invocation.member === 'EnableChargeThreshold' && invocation.signature === 'b'
          && typeof invocation.args[0] === 'boolean', 'Incorrect charge control arguments');
        if (denied) { invocation.error('org.freedesktop.DBus.Error.AccessDenied', 'Fixture denied'); return; }
        chargeWrites++; chargeEnabled = invocation.args[0];
        Bus.emitSignal('/battery/BAT0', PROPERTIES, 'PropertiesChanged', 'sa{sv}as', UPOWER + '.Device', { ChargeThresholdEnabled: chargeEnabled }, []);
        invocation.reply('');
      });
      Bus.exportObject(PATH, PROPERTIES, invocation => {
        if (invocation.member === 'GetAll') invocation.reply('a{sv}', {
          Profiles: { _t: 'aa{sv}', _v: [{ Profile: 'power-saver' }, { Profile: 'balanced' }] }, ActiveProfile: active, PerformanceDegraded: ''
        });
        else if (invocation.member === 'Set') {
          assert(invocation.signature === 'ssv' && invocation.args[0] === NAME && invocation.args[1] === 'ActiveProfile', 'Incorrect Set arguments');
          if (denied) { invocation.error('org.freedesktop.DBus.Error.AccessDenied', 'Fixture denied'); return; }
          writes++; active = invocation.args[2];
          invocation.reply('');
          Bus.emitSignal(PATH, PROPERTIES, 'PropertiesChanged', 'sa{sv}as', NAME, { ActiveProfile: active }, []);
        } else invocation.error('org.freedesktop.DBus.Error.UnknownMethod', invocation.member);
      });
      battery = createBatteryStatus(Bus, update); profiles = createPowerProfiles(Bus, update);
      await Promise.all([battery.start(), profiles.start()]);
      service = createShellService({ setChargeControl: battery.setChargeControl, setPowerProfile: profiles.setProfile });
      service.update(state);
      Bus.exportObject('/org/koya/Shell1', 'org.koya.Shell1', invocation => {
        service.request(invocation.member, invocation.args).then(value => invocation.reply('a{sv}', shellStatePayload(value)))
          .catch(error => invocation.error('org.koya.Shell1.Error', String(error)));
      });
      const snapshot = await Bus.call('org.koya.Shell1', '/org/koya/Shell1', 'org.koya.Shell1', 'GetState');
      assert(snapshot.BatteryRate === 12.4, 'Shell state lost fractional battery readings');
      assert(powerView(state).details.some(row => row.key === 'Health' && row.value === '95.8%'), 'Physical battery details failed: ' + JSON.stringify(state));
      assert(powerView(state).profiles.join(',') === 'power-saver,balanced', 'Nested profile list decoding failed');
      for (const enabled of [false, true]) {
        const value = await Bus.call('org.koya.Shell1', '/org/koya/Shell1', 'org.koya.Shell1', 'SetChargeControl', 'sb', '/battery/BAT0', enabled);
        assert(powerView(value).chargeControls[0].enabled === enabled, 'Charge state did not round trip through the shell');
      }
      assert(chargeWrites === 2 && chargeEnabled, 'Charge control did not use the device boolean method');
      await profiles.setProfile('power-saver');
      assert(writes === 1 && active === 'power-saver' && state.PowerProfile === 'power-saver', 'Profile Set did not round trip');
      denied = true;
      let rejected = false;
      try { await profiles.setProfile('balanced'); } catch (_) { rejected = true; }
      assert(rejected && state.PowerProfile === 'power-saver', 'Denied change reported success');
      rejected = false;
      try { await Bus.call('org.koya.Shell1', '/org/koya/Shell1', 'org.koya.Shell1', 'SetChargeControl', 'sb', '/battery/BAT0', false); }
      catch (_) { rejected = true; }
      assert(rejected && chargeWrites === 2 && powerView(state).chargeControls[0].enabled, 'Denied charge control reported success');
      denied = false; service.update({ ScreenState: 'locked' }); rejected = false;
      try { await Bus.call('org.koya.Shell1', '/org/koya/Shell1', 'org.koya.Shell1', 'SetChargeControl', 'sb', '/battery/BAT0', false); }
      catch (_) { rejected = true; }
      assert(rejected && chargeWrites === 2, 'Charge control must not be changed while locked');
      Log.info('KOYA_POWER_TEST_PASS');
    } catch (error) { Log.error('KOYA_POWER_TEST_FAIL: ' + error); }
    finally {
      clearTimeout(timer); battery?.dispose(); profiles?.dispose(); setTimeout(() => Engine.quit(), 100);
    }
  }, 0);
}
