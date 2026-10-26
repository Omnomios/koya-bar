import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import { test as test0 } from './login.js';
import { test as test1 } from './lock.js';
import { test as test2 } from './accounts.js';
import { test as test3 } from './ssh-agent-model.js';
import { test as test4 } from './authentication.js';
import { test as test5 } from './authentication-view.js';
import { test as test6 } from './updates.js';
import { test as test7 } from './audio.js';
import { test as test8 } from './session-actions.js';
import { test as test9 } from './displays.js';
import { test as fingerprintTest } from './fingerprint.js';
import { test as sessionStateTest } from './session-state.js';
export default function main() {
  setTimeout(async () => {
    try {
      await test0();
      await test1();
      await test2();
      await test3();
      await test4();
      await test5();
      await test6();
      await test7();
      await test8();
      await test9();
      await fingerprintTest();
      await sessionStateTest();
      Log.info('KOYA_MODEL_TEST_PASS');
    } catch (error) { Log.error('KOYA_MODEL_TEST_FAIL: ' + error.stack); }
    finally { Engine.quit(); }
  }, 0);
}
