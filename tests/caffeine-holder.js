import * as Sleep from 'Module/sleep';
import * as Log from 'Helix/Log';
import * as Engine from 'Helix/Engine';
import { system as Bus } from 'Module/dbus';

export default function () {
  setTimeout(async () => {
    try {
      await Bus.connect(); await Sleep.acquire();
      const count = await Bus.call('org.freedesktop.login1', '/org/freedesktop/login1', 'org.koya.Test.Caffeine', 'Count');
      if (Number(count) !== 1) throw new Error('Koya did not hold the inhibitor');
      Log.info('KOYA_CAFFEINE_TEST_PASS: held until runtime shutdown');
    } catch (error) { Log.error('KOYA_CAFFEINE_TEST_FAIL: ' + error); }
    finally { setTimeout(() => Engine.quit(), 100); }
  }, 0);
}
