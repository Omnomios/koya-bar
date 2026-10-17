import * as Desktop from 'Module/desktop';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';

// Desktop.changePassword driving a fake passwd (KOYA_PASSWD) on a terminal.
const assert = (value, message) => { if (!value) throw new Error(message); };
export default function main() {
  setTimeout(async () => {
    try {
      let result = await Desktop.changePassword('old-secret', 'a-good-password');
      assert(result.ok === true, 'An accepted change reports success: ' + JSON.stringify(result));
      result = await Desktop.changePassword('wrong', 'a-good-password');
      assert(!result.ok && result.field === 'current' && result.message === 'The current password is incorrect', 'A wrong current password: ' + JSON.stringify(result));
      result = await Desktop.changePassword('old-secret', 'short');
      assert(!result.ok && result.field === 'next' && result.message === 'The password is shorter than 8 characters', 'A refused new password, in passwd\'s words: ' + JSON.stringify(result));
      let rejected = false;
      try { Desktop.changePassword('', 'x'); } catch (_) { rejected = true; }
      assert(rejected, 'Empty passwords are refused before passwd runs');
      Log.info('KOYA_PASSWORD_TEST_PASS');
    } catch (error) { Log.error('KOYA_PASSWORD_TEST_FAIL: ' + error); }
    finally { setTimeout(() => Engine.quit(), 50); }
  }, 0);
}
