import * as Login from 'Module/login';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import * as Process from 'Module/process';

// The greeter's state and the login wallpaper's settings read, against the
// real module. tests/run.sh prepares one home per case under
// KOYA_LOGIN_HOME_ROOT and runs this once per case; KOYA_TEST_CASE names it.
const assert = (value, message) => { if (!value) throw new Error(message); };
export default function main() {
  setTimeout(() => {
    try {
      const user = Process.getEnv('KOYA_TEST_USER', ''), kind = Process.getEnv('KOYA_TEST_CASE', '');
      if (kind === 'state') {
        assert(Login.lastUser() === '', 'No account is remembered before a sign-in');
        assert(Login.rememberUser(user) === true, 'A real account is remembered');
        assert(Login.lastUser() === user, 'The remembered account reads back');
        for (const name of ['../escape', '.hidden', 'no-such-account-koya', 'a/b', ''])
          assert(Login.rememberUser(name) === false, 'Unusable names are refused: ' + JSON.stringify(name));
        assert(Login.lastUser() === user, 'Refused names leave the remembered account');
      } else {
        const text = Login.userPreferences(user);
        if (kind === 'valid') assert(JSON.parse(text).Wallpaper === 'nocturne', 'Settings are read for the account');
        else assert(text === null, kind + ': unsafe or missing settings are not read');
        assert(Login.userPreferences('../' + user) === null, 'Path-like names are refused');
      }
      Log.info('KOYA_GREETER_STATE_TEST_PASS');
    } catch (error) { Log.error('KOYA_GREETER_STATE_TEST_FAIL: ' + error); }
    finally { setTimeout(() => Engine.quit(), 50); }
  }, 0);
}
