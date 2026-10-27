// A single Hyprland snapshot covers every lock surface. Keep a window visible
// if monitor state is missing or unreadable, so failed IPC cannot blank the lock.
export function readHyprlandMonitors(spawn) {
  return new Promise((resolve, reject) => {
    let child, output = '';
    try {
      child = spawn({ cmd: 'hyprctl', args: ['-j', 'monitors', 'all'] });
      child.stdout.on('data', chunk => { output += String(chunk); });
      child.on('exit', code => {
        if (code !== 0) { reject(new Error(`hyprctl monitor query failed (exit ${code})`)); return; }
        try {
          const monitors = JSON.parse(output);
          if (!Array.isArray(monitors)) throw new Error('Expected monitor array');
          resolve(monitors);
        } catch (error) { reject(error); }
      });
    } catch (error) { reject(error); }
  });
}

export function createLockDisplayPower({ readMonitors, setRendering }) {
  const screens = new Map();
  let pending = Promise.resolve();
  const serial = work => {
    const next = pending.then(work);
    pending = next.catch(() => {});
    return next;
  };
  const apply = async (screen, enabled) => {
    if (screen.enabled === enabled) return;
    await setRendering(screen.win, enabled);
    screen.enabled = enabled;
  };
  return {
    add(name, win) { screens.set(name, { win, enabled: true }); },
    remove(name) { screens.delete(name); },
    refresh() { return serial(async () => {
      let monitors;
      try { monitors = await readMonitors(); }
      catch (error) {
        await Promise.all([...screens.values()].map(screen => apply(screen, true)));
        throw error;
      }
      const byName = new Map(monitors.filter(item => typeof item?.name === 'string').map(item => [item.name, item]));
      await Promise.all([...screens].map(([name, screen]) => {
        const monitor = byName.get(name);
        // Disabled outputs are not DPMS-off outputs. Missing/invalid status
        // is treated as visible until Hyprland supplies a usable state.
        const enabled = monitor?.disabled === true || monitor?.dpmsStatus !== false;
        return apply(screen, enabled);
      }));
    }); },
    resume() { return serial(() => Promise.all([...screens.values()].map(screen => apply(screen, true)))); },
    get allOff() { return screens.size > 0 && [...screens.values()].every(screen => !screen.enabled); }
  };
}
