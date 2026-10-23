import * as Desktop from 'Module/desktop';
import { system as Bus } from 'Module/dbus';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import { createCaffeine, caffeineButton } from '../apps/caffeine.js';
import { createShellService } from '../apps/shell-service.js';
import topBar from '../apps/top-bar.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const control = (method, signature = '', ...args) => Bus.call('org.freedesktop.login1',
  '/org/freedesktop/login1', 'org.koya.Test.Caffeine', method, signature, ...args);
async function waitFor(check, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (_) {}
    await sleep(20);
  }
  throw new Error(message);
}
async function denied(operation) {
  try { await operation(); } catch (_) { return; }
  throw new Error('Operation should have failed');
}

export default function () {
  setTimeout(async () => {
    let caffeine;
    const timer = setTimeout(() => { Log.error('KOYA_CAFFEINE_TEST_FAIL: timeout'); Engine.quit(); }, 20000);
    try {
      assert(typeof topBar === 'function', 'Top bar module did not load in Koya');
      await Bus.connect();
      await waitFor(async () => Number(await control('Count')) === 0, 'Private logind did not start');
      const service = createShellService({ setCaffeine: value => caffeine.setEnabled(value),
        changed: state => caffeine?.onState(state) });
      caffeine = createCaffeine({ bus: Bus, acquire: () => Desktop.acquireSleepInhibitor(),
        release: () => Desktop.releaseSleepInhibitor(), changed: values => service.update(values) });
      await caffeine.start();
      const set = enabled => service.request('SetCaffeine', [enabled]);
      const count = expected => waitFor(async () => Number(await control('Count')) === expected, 'Expected ' + expected + ' inhibitor FDs');
      assert(!service.snapshot().CaffeineActive, 'Caffeine must start off');
      await set(true); await count(1);
      assert(service.snapshot().CaffeineActive && caffeineButton(service.snapshot()).label === 'Caffeine on', 'Acquisition was not reflected in the button');
      const seen = JSON.parse(await control('Seen'));
      assert(JSON.stringify(seen[0]) === JSON.stringify(['sleep:idle', 'Koya Bar', 'Caffeine keeps the computer awake', 'block']), 'Wrong freedesktop inhibition arguments');
      await set(true); await count(1);
      assert(JSON.parse(await control('Seen')).length === 1, 'Repeated enable acquired another inhibitor');
      await set(false); await count(0);
      assert(!service.snapshot().CaffeineActive, 'Off did not reset state');
      await control('Reject', 'b', true); await denied(() => set(true)); await count(0);
      assert(!service.snapshot().CaffeineActive && !service.snapshot().CaffeinePending && service.snapshot().CaffeineError, 'Denied inhibition reported success or stayed pending');
      assert(caffeineButton(service.snapshot()).label === 'Retry Caffeine', 'Failure is not visible on the button');
      await control('Reject', 'b', false); await set(true); await set(false); await count(0);
      await denied(() => set('true'));
      service.update({ ScreenState: 'locked' }); await denied(() => set(true));
      service.update({ ScreenState: 'unlocked' });

      await control('Hold', 'b', true);
      const enabling = set(true).then(() => false, () => true);
      await waitFor(async () => Number(await control('Pending')) === 1, 'Enable did not reach logind');
      assert(service.snapshot().CaffeinePending && !service.snapshot().CaffeineActive, 'Pending acquisition reported active');
      await set(false); await control('Hold', 'b', false);
      assert(await enabling, 'Cancelled acquisition reported success'); await count(0);

      await set(true); service.update({ Active: false }); await count(0);
      assert(!service.snapshot().CaffeineActive, 'Inactive session kept an inhibitor');
      await denied(() => set(true)); service.update({ Active: true });
      await set(true); caffeine.dispose(); await count(0);
      Log.info('KOYA_CAFFEINE_TEST_PASS');
    } catch (error) { Log.error('KOYA_CAFFEINE_TEST_FAIL: ' + error + '\n' + (error.stack || '')); }
    finally { clearTimeout(timer); caffeine?.dispose(); setTimeout(() => Engine.quit(), 100); }
  }, 0);
}
