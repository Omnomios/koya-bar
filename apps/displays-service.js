import { monitorConfig, layoutKey, monitorRules, validateLayout, matchesLayout } from './displays-model.js';

export async function queryDisplayMonitors(send) {
  let request = 'j/monitors all';
  let reply = await send(request);
  let canDisable = true;
  if (String(reply).trim() === 'too many args') {
    request = 'j/monitors';
    reply = await send(request);
    canDisable = false;
  }
  let monitors;
  try { monitors = JSON.parse(reply); }
  catch (_) { throw new Error('Hyprland ' + request + ' returned invalid JSON: ' + String(reply).trim()); }
  if (!Array.isArray(monitors)) throw new Error('Hyprland ' + request + ' returned invalid monitor data');
  return { monitors, canDisable };
}

// The shell owns the preview, including its timer, independently of the app.
export function createDisplays({ query, send, load, save, changed = () => {}, report = () => {},
  allowed = () => true,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = timer => clearTimeout(timer) }) {
  let stored = load(), pending, sequence = 0, queue = Promise.resolve(), restoring = false, ownReloads = 0;
  if (stored?.version !== 1 || !stored.layouts || typeof stored.layouts !== 'object') stored = { version: 1, layouts: {} };
  let managed = Object.keys(stored.layouts).length > 0, appliedKey;
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const command = async code => {
    const result = await send(code);
    if (String(result).trim() !== 'ok') throw new Error(String(result).trim() || 'Hyprland rejected the display settings');
  };
  const configsFor = monitors => {
    const saved = stored.layouts[layoutKey(monitors)];
    return monitors.map(m => monitorConfig(m, Array.isArray(saved) ? saved.find(c => c.name === m.name) : undefined, monitors));
  };
  // Older mock queries return an array and model the full-monitor capability.
  const queryState = async () => {
    const result = await query();
    return Array.isArray(result) ? { monitors: result, canDisable: true } : result;
  };
  const read = async () => {
    const { monitors, canDisable } = await queryState();
    return { monitors, canDisable, configs: configsFor(monitors), pending: pending ? { token: pending.token, deadline: pending.deadline } : null };
  };
  const applyRules = configs => command('eval ' + monitorRules(configs));
  const reloadConfiguration = async () => {
    ownReloads++;
    try { await command('reload'); } catch (error) { ownReloads--; throw error; }
  };
  const ensureDisplay = async monitors => {
    if (monitors.length && !monitors.some(m => !m.disabled)) {
      const fallback = monitors.find(m => /^eDP-|^LVDS-|^DSI-/.test(m.name)) || monitors[0];
      await applyRules([{ ...monitorConfig(fallback), enabled: true, mirror: '', mode: 'preferred', x: 0, y: 0, scale: 1, transform: 0 }]);
    }
  };
  const rollback = async () => {
    if (!pending) return;
    const previous = pending; cancel(previous.timer); restoring = true;
    try {
      // Reload restores fields that monitor JSON cannot report, such as VRR
      // policy and an ICC profile. Then restore the actual previous geometry.
      await reloadConfiguration();
      const { monitors } = await queryState();
      const baseline = previous.baseline.filter(c => monitors.some(m => m.name === c.name));
      for (const config of baseline) if (config.mirror && !baseline.some(c => c.name === config.mirror && c.enabled && !c.mirror)) config.mirror = '';
      if (baseline.some(c => c.enabled && !c.mirror)) await applyRules(baseline);
      else {
        const fallback = monitors.find(m => !m.disabled) || monitors[0];
        if (fallback) await applyRules([{ ...monitorConfig(fallback), enabled: true, mirror: '', mode: 'preferred', x: 0, y: 0, scale: 1, transform: 0 }]);
      }
      pending = undefined; changed();
    } catch (error) {
      // Retain the transaction for a retry if the compositor was unavailable.
      previous.timer = schedule(() => serial(rollback).catch(report), 2000); throw error;
    } finally { restoring = false; }
  };
  const restore = () => serial(async () => {
    if (restoring || pending) return;
    let { monitors } = await queryState(), key = layoutKey(monitors), saved = stored.layouts[key];
    // hl.monitor rules outlive a connection. Remove our previous combination's
    // rules before undocking, including a rule that disabled the laptop panel.
    if (managed && appliedKey !== key && (appliedKey !== undefined || !saved)) {
      await reloadConfiguration();
      ({ monitors } = await queryState()); key = layoutKey(monitors); saved = stored.layouts[key];
      await ensureDisplay(monitors);
    }
    appliedKey = key;
    if (Array.isArray(saved)) { validateLayout(saved, monitors); await applyRules(saved); }
  });
  return {
    read: () => serial(read), restore,
    cancelPreview: () => serial(rollback),
    apply: configs => serial(async () => {
      if (!allowed()) throw new Error('Display changes require an active unlocked session');
      if (pending) throw new Error('Keep or revert the current preview first');
      const { monitors, canDisable } = await queryState(); validateLayout(configs, monitors);
      if (!canDisable && configs.some(config => !config.enabled)) throw new Error('Off is unavailable: this compositor cannot track disabled displays');
      const before = await send('configerrors');
      if (!allowed()) throw new Error('Display changes require an active unlocked session');
      const transaction = pending = { token: String(++sequence), deadline: now() + 20000,
        baseline: configsFor(monitors), configs: JSON.parse(JSON.stringify(configs)), key: layoutKey(monitors) };
      managed = true; appliedKey = transaction.key;
      transaction.timer = schedule(() => serial(rollback).catch(report), 20000);
      try {
        await applyRules(configs);
        let applied = false;
        for (let i = 0; i < 12; i++) {
          await delay(150);
          const { monitors: current } = await queryState();
          if (layoutKey(current) !== transaction.key) throw new Error('Connected displays changed during the preview');
          if (matchesLayout(configs, current)) { applied = true; break; }
        }
        if (!applied) throw new Error('The display did not accept that mode, scale or layout');
        const errors = await send('configerrors');
        if (String(errors).trim() !== String(before).trim() && String(errors).trim()) throw new Error(String(errors).trim());
        changed(); return read();
      } catch (error) {
        try { await rollback(); } catch (restoreError) { report(restoreError); }
        throw error;
      }
    }),
    confirm: token => serial(async () => {
      if (!allowed()) { await rollback(); throw new Error('Display changes require an active unlocked session'); }
      if (!pending || token !== pending.token) throw new Error('This display preview has ended');
      if (now() >= pending.deadline) { await rollback(); throw new Error('The display preview expired'); }
      if (layoutKey((await queryState()).monitors) !== pending.key) { await rollback(); throw new Error('Connected displays changed'); }
      if (!allowed() || now() >= pending.deadline) { await rollback(); throw new Error('The display preview ended'); }
      const next = { version: 1, layouts: { ...stored.layouts, [pending.key]: pending.configs } };
      try { await save(JSON.stringify(next)); }
      catch (error) { await rollback(); throw error; }
      stored = next; cancel(pending.timer); pending = undefined; changed(); return read();
    }),
    revert: token => serial(async () => {
      if (pending && token !== undefined && token !== pending.token) throw new Error('This display preview has ended');
      await rollback(); return read();
    }),
    configReloaded: () => {
      // Event delivery can follow the reload reply and the rollback itself.
      if (ownReloads) { ownReloads--; return Promise.resolve(); }
      return serial(async () => { if (pending) await rollback(); }).then(restore);
    },
    topologyChanged: () => serial(async () => {
      if (pending) {
        if (layoutKey((await queryState()).monitors) === pending.key) return false;
        await rollback();
      }
      return true;
    }).then(restoreSaved => restoreSaved ? restore() : undefined)
  };
}
