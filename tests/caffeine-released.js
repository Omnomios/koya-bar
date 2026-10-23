import { system as Bus } from 'Module/dbus';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';

export default function () {
  setTimeout(async () => {
    try {
      await Bus.connect();
      const deadline = Date.now() + 3000;
      let count;
      do {
        count = Number(await Bus.call('org.freedesktop.login1', '/org/freedesktop/login1', 'org.koya.Test.Caffeine', 'Count'));
        if (count === 0) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      if (count !== 0) throw new Error('Runtime shutdown leaked an inhibitor FD');
      Log.info('KOYA_CAFFEINE_TEST_PASS: released after runtime shutdown');
    } catch (error) { Log.error('KOYA_CAFFEINE_TEST_FAIL: ' + error); }
    finally { setTimeout(() => Engine.quit(), 100); }
  }, 0);
}
