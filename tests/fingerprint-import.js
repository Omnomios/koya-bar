// Load the real application graphs without opening a window or authenticating.
import account from '../apps/account.js';
import lock from '../apps/lock.js';
import greeter from '../apps/greeter.js';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
export default function main() {
  if ([account, lock, greeter].every(app => typeof app === 'function')) Log.info('KOYA_FINGERPRINT_IMPORT_PASS');
  else Log.error('KOYA_FINGERPRINT_IMPORT_FAIL');
  Engine.quit();
}
