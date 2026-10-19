// Exercise the real process plugin without invoking a package manager or sudo.
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import { runUpdateCommand } from '../apps/updates-process.js';
const assert = (value, message) => { if (!value) throw new Error(message); };

export default function main() {
  setTimeout(async () => {
    const timer = setTimeout(() => { Log.error('KOYA_UPDATES_NATIVE_FAIL: timeout'); Engine.quit(); }, 5000);
    try {
      let streamed = '';
      const result = await runUpdateCommand('/usr/bin/sh', ['-c', 'printf "first\\n"; printf "detail\\n" >&2; sleep 0.3; printf "last\\n"; exit 2'],
        { onOutput: text => { streamed += text; } });
      assert(result.code === 2, 'Exit code was lost');
      assert(result.stdout === 'first\nlast\n', 'Standard output was lost');
      assert(result.stderr === 'detail\n', 'Standard error was lost');
      assert(streamed.includes('first\n') && streamed.includes('last\n') && streamed.includes('detail\n'), 'Streaming output was lost');
      const locale = await runUpdateCommand('/usr/bin/printenv', ['LC_ALL']);
      assert(locale.stdout.trim() === 'C', 'Update command output must use a stable locale');
      const stdin = await runUpdateCommand('/usr/bin/sh', ['-c', 'read value; exit $?']);
      assert(stdin.code === 1, 'Commands must receive EOF instead of waiting for terminal input');
      const missing = await runUpdateCommand('/koya-test-command-does-not-exist', []);
      assert(missing.code === 127 && missing.stderr, 'Missing commands must preserve failure status');
      let timedOut = false;
      try { await runUpdateCommand('/usr/bin/sleep', ['2'], { timeout: 25 }); }
      catch (error) { timedOut = /timed out/.test(String(error)); }
      assert(timedOut, 'A stalled check did not time out');
      Log.info('KOYA_UPDATES_NATIVE_PASS');
    } catch (error) { Log.error('KOYA_UPDATES_NATIVE_FAIL: ' + error); }
    finally { clearTimeout(timer); setTimeout(() => Engine.quit(), 150); }
  }, 0);
}
