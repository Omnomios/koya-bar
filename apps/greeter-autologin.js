import * as Process from 'Module/process';

// Automatic login at the Koya greeter, through its installed helper:
// `status` reads who signs in automatically; enable/disable run through
// pkexec (administrator approval). Absent without the greeter installed.
const HELPER = Process.getEnv('KOYA_GREETER_HELPER', '/usr/local/libexec/koya-greeter-autologin');
const run = (cmd, args) => new Promise(resolve => {
  let stdout = '', child;
  try {
    child = Process.spawn({ cmd, args });
    child.stdout.on('data', chunk => { stdout = (stdout + String(chunk)).slice(-4096); });
    child.on('exit', code => resolve({ code: Number(code), stdout }));
  } catch (_) { resolve({ code: -1, stdout: '' }); }
});

export const greeterAutologin = {
  available: () => Process.exists(HELPER),
  // The account that signs in automatically ('' for none).
  user: async () => (await run(HELPER, ['status'])).stdout.trim(),
  // Resolves to 'changed', 'dismissed' (the prompt was closed) or 'denied'.
  set: async enabled => {
    const { code } = await run('/usr/bin/pkexec', [HELPER, enabled ? 'enable' : 'disable']);
    return code === 0 ? 'changed' : code === 126 ? 'dismissed' : 'denied';
  }
};
