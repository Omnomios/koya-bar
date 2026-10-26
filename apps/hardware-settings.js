import * as UI from './theme-ui.js';
import { createFramework, FRAMEWORK_NAME } from './framework-client.js';
import { scalarControl } from './scalar-control.js';
import { button } from './touch-ui.js';
import { SPACE, TYPE, TEXT, SURFACE, LIST_ROW_HEIGHT } from './theme.js';

export function hardwareSettings(frame, bus, session = () => ({}), changed = () => {}) {
  let snapshot = { available: false, devices: [] }, pageKind = '', closed = false, switchingMode = false;
  const byType = type => snapshot.devices.filter(d => d.type === FRAMEWORK_NAME + '.' + type + '1');
  const topology = kind => snapshot.devices.filter(d => kind === 'cooling' ? ['Fan', 'Temperature'].some(type => d.type === FRAMEWORK_NAME + '.' + type + '1') : d.type === FRAMEWORK_NAME + '.Lighting1').map(d => [d.path, d.type.endsWith('Fan1') ? d.Mode : '']).map(value => JSON.stringify(value)).join('|');
  const allowed = () => !closed && session().Active && session().ScreenState === 'unlocked';
  const report = error => frame.flash(String(error.message || error), TEXT.accent, 4000);
  const client = createFramework(bus, value => {
    snapshot = value;
    if (pageKind) frame.enqueue(async () => { await frame.current?.update?.(); await frame.refreshHint(); });
    changed();
  });
  const run = async fn => { if (!allowed()) return; try { await fn(); } catch (error) { report(error); } };
  const contentPage = async () => {
    const page = await frame.newPage(); page.items = [];
    const rows = [], controls = [];
    page.add = async item => { rows.push(item); controls.push(item); return item; };
    page.finish = async () => {
      const height = rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * SPACE.s;
      const area = await frame.kit.scrollArea({ id: 'hardware-settings-content', height: Math.max(60, Math.min(frame.stageHeight, height)), gap: SPACE.s });
      await area.setContentHeight(height); await UI.attach(frame.win, page.el, area.id);
      for (const row of rows) await UI.attach(frame.win, area.content, row.id);
      page.items.push(area.id); page.height = Math.max(60, Math.min(frame.stageHeight, height));
    };
    page.dispose = async () => { pageKind = ''; controls.forEach(item => item.dispose?.()); if (!switchingMode) await client.watch(false); };
    return page;
  };
  const reading = async (page, id, title, value) => {
    const row = await frame.navigate(null, title, value, LIST_ROW_HEIGHT, undefined, { trailing: 0 });
    await UI.setHitTarget(frame.win, row.target, false); await UI.setElementId(frame.win, row.target, id);
    await page.add({ id: row.target, height: LIST_ROW_HEIGHT }); return row;
  };
  const buttons = async (page, id, entries, selected, choose) => {
    const row = await UI.createElement(frame.win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: frame.width, y: 36 } } });
    const width = (frame.width - SPACE.s * (entries.length - 1)) / entries.length;
    const values = await Promise.all(entries.map(async entry => {
      const value = typeof entry === 'string' ? entry : entry.value, title = typeof entry === 'string' ? entry : entry.title;
      const target = await button(frame.win, null, title, width, 36, () => run(() => choose(value)),
        { colour: selected === value ? SURFACE.accent : SURFACE.control, labelColour: selected === value ? TEXT.onAccent : TEXT.primary });
      await UI.setElementId(frame.win, target, id + '-' + value); return { target, value };
    }));
    for (const value of values) await UI.attach(frame.win, row, value.target);
    await page.add({ id: row, height: 36 });
    return next => Promise.all(values.flatMap(item => [UI.setBoxColour(frame.win, item.target, next === item.value ? SURFACE.accent : SURFACE.control), UI.setHitTarget(frame.win, item.target, allowed())]));
  };
  const cooling = async () => {
    pageKind = 'cooling'; await client.watch(true); pageKind = 'cooling';
    const page = await contentPage(), readings = [], fans = [];
    const shape = topology('cooling'); let rebuilding = false;
    for (const d of byType('Temperature')) {
      const row = await reading(page, 'cooling-' + d.path.split('/').pop(), d.Name, d.Available ? d.Celsius.toFixed(1) + ' °C' : 'Unavailable');
      readings.push({ path: d.path, row });
    }
    for (const d of byType('Fan')) {
      const id = 'fan-' + d.path.split('/').pop();
      const row = await reading(page, id, d.Name, d.Available ? d.RPM + ' RPM' : 'Unavailable');
      let mode = d.Mode === 'rpm' || d.Mode === 'duty' ? d.Mode : 'auto', slider, updateButtons;
      const choose = async value => {
        if (switchingMode) return;
        switchingMode = true;
        try {
          if (value === 'auto') await client.automaticFan(d.path);
          else await client.overrideFan(d.path, value, value === 'duty' ? 60 : 3000);
          if (page.alive === false) return;
          // Rebuild only after an explicit mode change, never on telemetry updates.
          await frame.go(cooling, { title: 'Cooling', back: true, animate: false });
        } finally { switchingMode = false; }
      };
      if (d.Writable) {
        updateButtons = await buttons(page, id + '-mode', [{ title: 'Automatic', value: 'auto' }, ...d.Modes.map(value => ({ title: value === 'rpm' ? 'RPM' : 'Duty', value }))], mode, choose);
        if (mode !== 'auto') {
          slider = await scalarControl(frame.win, { id: id + '-target', title: mode === 'rpm' ? 'Target RPM' : 'Fan duty', width: frame.width,
            value: d.Target, maximum: mode === 'rpm' ? 10000 : 100, step: mode === 'rpm' ? 100 : 1,
            format: value => mode === 'rpm' ? String(value) : value + '%', available: () => { const item = client.snapshot().devices.find(item => item.path === d.path); return allowed() && item?.Available && item.Mode === mode; },
            commit: value => client.overrideFan(d.path, mode, value), report });
          await page.add(slider);
        }
      }
      fans.push({ path: d.path, row, mode, slider, updateButtons });
    }
    if (!readings.length && !fans.length) await reading(page, 'cooling-unavailable', 'Cooling', 'Unavailable');
    page.update = async () => {
      if (!switchingMode && !rebuilding && shape !== topology('cooling') && page.alive) {
        rebuilding = true; setTimeout(() => { if (page.alive) frame.go(cooling, { title: 'Cooling', back: true, animate: false }).catch(report); }, 0);
      }
      for (const { path, row } of readings) {
        const d = snapshot.devices.find(item => item.path === path);
        await UI.setTextString(frame.win, row.valueLabel, d?.Available ? d.Celsius.toFixed(1) + ' °C' : 'Unavailable');
      }
      for (const fan of fans) {
        const d = snapshot.devices.find(item => item.path === fan.path);
        await UI.setTextString(frame.win, fan.row.valueLabel, d?.Available ? d.RPM + ' RPM' + (d.Mode !== 'auto' ? ' · ' + d.Mode : '') : 'Unavailable');
        await fan.updateButtons?.(d?.Mode || 'auto'); await fan.slider?.set(d?.Target || 0);
      }
    };
    await page.finish(); return page;
  };
  const lighting = async () => {
    pageKind = 'lighting'; await client.watch(true); pageKind = 'lighting';
    const page = await contentPage(), rows = [];
    for (const d of byType('Lighting')) {
      const id = 'lighting-' + d.path.split('/').pop();
      const row = await reading(page, id, d.Name, d.Available ? d.Brightness + '%' : 'Unavailable');
      let slider, updateButtons;
      if (d.Writable && d.PercentageSupported) {
        slider = await scalarControl(frame.win, { id: id + '-brightness', width: frame.width, value: d.Brightness,
          minimum: d.Minimum, available: () => allowed() && snapshot.devices.find(item => item.path === d.path)?.Available,
          commit: value => client.setBrightness(d.path, value), report });
        await page.add(slider);
      }
      if (d.Writable && d.Levels?.length) {
        // Keep labels readable on narrow settings panels.
        for (let offset = 0; offset < d.Levels.length; offset += 3) {
          const entries = d.Levels.slice(offset, offset + 3).map(value => ({ value, title: ({ high: 'High', medium: 'Medium', low: 'Low', 'ultra-low': 'Very low', auto: 'Automatic' })[value] || value }));
          const update = await buttons(page, id + '-level', entries, d.Level, value => client.setLevel(d.path, value));
          const before = updateButtons; updateButtons = async value => { await before?.(value); await update(value); };
        }
      }
      rows.push({ path: d.path, row, slider, updateButtons });
    }
    if (!rows.length) await reading(page, 'lighting-unavailable', 'Keyboard & lighting', 'Unavailable');
    page.update = async () => {
      for (const item of rows) {
        const d = snapshot.devices.find(value => value.path === item.path);
        await UI.setTextString(frame.win, item.row.valueLabel, d?.Available ? d.Brightness + '%' + (d.Level === 'auto' ? ' · Automatic' : '') : 'Unavailable');
        await item.slider?.set(d?.Brightness || 0); await item.updateButtons?.(d?.Level);
      }
    };
    await page.finish(); return page;
  };
  return {
    start: () => client.start(), cooling, lighting,
    get capabilities() { return { cooling: byType('Fan').length > 0 || byType('Temperature').length > 0, lighting: byType('Lighting').length > 0 }; },
    async onSession() { if (!allowed()) await client.watch(false); else if (pageKind) await client.watch(true); },
    async dispose() { closed = true; await client.dispose(); }
  };
}
