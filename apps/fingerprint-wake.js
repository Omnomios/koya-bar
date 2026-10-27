// Current Hyprland uses a Lua dispatcher; older releases accept `dpms on`.
export async function wakeHyprland(spawn) {
  const dispatch = args => new Promise((resolve, reject) => {
    const child = spawn({ cmd: 'hyprctl', args: ['dispatch', ...args] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('exit', code => code === 0 && /^ok\b/i.test(output.trim())
      ? resolve() : reject(new Error(`hyprctl DPMS wake failed (exit ${code}): ${output.trim()}`)));
  });
  try { await dispatch(['hl.dsp.dpms({ action = "on" })']); }
  catch (_) { await dispatch(['dpms', 'on']); }
}
