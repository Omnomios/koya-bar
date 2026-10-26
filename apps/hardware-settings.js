import * as UI from './theme-ui.js';
import { createFramework } from './framework-client.js';
import { scalarControl } from './scalar-control.js';
import { text, icon, pill } from './touch-ui.js';
import { haptic } from './haptics.js';
import { presets } from './motion.js';
import { KIT_METRICS } from './kit.js';
import { ofType, sensorLabels, coolingSummary, coolingDetail, lightingDetail, lightLevels, lightReading, celsius, heat, fanReading, rpm } from './hardware-model.js';
import { SPACE, TYPE, TEXT, SURFACE, HEALTH, FONT, FONT_STRONG } from './theme.js';

const glyph = name => '/rom/assets/status/' + name + '.png';
const TILE = 58, CHIP = 30, SLIDER = 40, CARD_HEADER = 28, PAD = SPACE.m;
const TITLES = { cooling: 'Cooling', lighting: 'Keyboard & lighting' };
const shortId = path => path.split('/').pop();
const tone = value => ({ hot: TEXT.accent, warm: HEALTH.warn, cool: TEXT.primary })[heat(value)];

// Cooling and Keyboard & lighting. Pages describe the hardware the Framework
// service reports and update in place as readings arrive; only a change of
// devices rebuilds them. Fan overrides last while Cooling stays open.
export function hardwareSettings(frame, bus, session = () => ({}), changed = () => {}) {
  let snapshot = { available: false, devices: [] }, pageKind = '', closed = false, building = false;
  const { win, kit } = frame;
  const topology = kind => (kind === 'cooling' ? [...ofType(snapshot, 'Temperature'), ...ofType(snapshot, 'Fan')] : ofType(snapshot, 'Lighting'))
    .map(device => device.path + (device.Writable ? '+' : '')).join('|');
  const device = path => snapshot.devices.find(item => item.path === path);
  const allowed = () => !closed && session().Active && session().ScreenState === 'unlocked';
  const report = error => frame.flash(String(error.message || error), TEXT.accent, 4000);
  const client = createFramework(bus, value => {
    snapshot = value;
    if (pageKind) frame.enqueue(async () => { await frame.current?.update?.(); await frame.refreshHint(); });
    changed();
  });
  const run = async fn => { if (!allowed()) return; try { await fn(); } catch (error) { report(error); } };

  // A page of sections under an optional hero. The hero stays outside the
  // scroll area so the badge's pulse is never clipped.
  const contentPage = async (kind, rebuild) => {
    pageKind = kind; await client.watch(true); pageKind = kind;
    const page = await frame.newPage(SPACE.m), sections = [], disposers = [];
    const shape = topology(kind);
    page.add = (id, height, dispose) => { sections.push({ id, height }); if (dispose) disposers.push(dispose); };
    page.finish = async hero => {
      const height = sections.reduce((sum, item) => sum + item.height, 0) + Math.max(0, sections.length - 1) * SPACE.s;
      const above = hero ? KIT_METRICS.badgeSlotSize + SPACE.m : 0;
      const room = Math.max(60, Math.min(frame.stageHeight - SPACE.xs - 20 - above, height));
      const area = await kit.scrollArea({ id: 'hardware-settings-content', height: room, gap: SPACE.s });
      await area.setContentHeight(height);
      if (hero) { await UI.attach(win, page.el, hero); await UI.setLayoutOrder(win, hero, 0); page.items.push(hero); }
      await UI.attach(win, page.el, area.id); await UI.setLayoutOrder(win, area.id, 1);
      for (const item of sections) { await UI.attach(win, area.content, item.id); page.items.push(item.id); }
      page.height = SPACE.xs + above + room;
    };
    // The set of devices changed: rebuild in place (never for readings).
    page.reshape = () => {
      if (building || !page.alive || shape === topology(kind)) return false;
      building = true;
      // Fans stay overridden across the rebuild: dispose skips the release.
      setTimeout(() => {
        if (!page.alive) { building = false; return; }
        frame.go(rebuild, { title: TITLES[kind], back: true, animate: false }).catch(report).finally(() => { building = false; });
      }, 0);
      return true;
    };
    page.dispose = async () => { disposers.forEach(fn => fn()); if (!building) { pageKind = ''; await client.watch(false); } };
    return page;
  };

  // A row of equal chips; `paint(value)` marks the chosen one.
  const chips = async (id, entries, width, choose) => {
    const line = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.xs }, item: { size: { x: width, y: CHIP } } });
    const each = (width - SPACE.xs * (entries.length - 1)) / entries.length;
    const built = [];
    for (const entry of entries) {
      const chip = { value: entry.value };
      chip.id = await pill(win, line, entry.title, each, () => run(async () => {
        if (chip.value === chosen) return;
        haptic(); kit.play(chip.id, presets.bump()); await choose(entry.value);
      }), { height: CHIP, onLabel: label => { chip.label = label; } });
      await UI.setElementId(win, chip.id, id + '-' + entry.value);
      built.push(chip);
    }
    let chosen;
    const paint = value => {
      chosen = value;
      return Promise.all(built.flatMap(chip => [
        UI.setBoxColour(win, chip.id, chip.value === value ? SURFACE.accent : SURFACE.control),
        UI.setTextColour(win, chip.label, chip.value === value ? TEXT.onAccent : allowed() ? TEXT.primary : TEXT.disabled),
        UI.setHitTarget(win, chip.id, allowed())]));
    };
    return { id: line, paint };
  };

  // An inset card: a glyph and a name over the card's own controls.
  // Resolves to { id, height, content, trailing }; `rows` are the heights of
  // the controls the caller attaches to `content`.
  const card = async (name, title, rows = []) => {
    const height = SPACE.s + CARD_HEADER + rows.reduce((sum, row) => sum + SPACE.s + row, 0) + PAD;
    const surface = await kit.surface('inset', { size: { x: 'auto', y: height }, layout: { type: 'column', gap: SPACE.s }, padding: { t: SPACE.s, r: PAD, b: PAD, l: PAD } });
    const header = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s, alignItems: 'center' }, item: { size: { x: 'auto', y: CARD_HEADER } } });
    await icon(win, header, glyph(name), 18, 18, CARD_HEADER);
    const heading = await text(win, header, title, TYPE.body, 'auto', CARD_HEADER, TEXT.primary, FONT_STRONG, 'left');
    const trailing = await text(win, header, '', TYPE.detail, 'auto', CARD_HEADER, TEXT.secondary, FONT, 'right');
    await Promise.all([UI.setGrow(win, heading, 1), UI.setGrow(win, trailing, 1), UI.attach(win, surface.content, header)]);
    return { id: surface.id, height, content: surface.content, trailing };
  };

  const cooling = async () => {
    const page = await contentPage('cooling', cooling);
    const width = frame.width, inner = width - PAD * 2;
    const hero = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: { x: width, y: KIT_METRICS.badgeSlotSize } } });
    const summary = coolingSummary(snapshot);
    const badge = await kit.badge({ glyph: glyph('fan'), health: summary.health });
    const title = await kit.titleBlock({ title: summary.title, subtitle: summary.subtitle, dot: summary.health });
    await Promise.all([UI.attach(win, hero, badge.id), UI.attach(win, hero, title.id), UI.setElementId(win, title.heading, 'cooling-summary')]);

    // Temperatures: a grid of tiles, up to four across.
    const sensors = ofType(snapshot, 'Temperature'), labels = sensorLabels(sensors), tiles = [];
    if (sensors.length) {
      const across = Math.min(4, sensors.length), each = (width - SPACE.s * (across - 1)) / across;
      for (let offset = 0; offset < sensors.length; offset += across) {
        const line = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: width, y: TILE } } });
        for (const sensor of sensors.slice(offset, offset + across)) {
          const tile = await kit.surface('inset', { size: { x: each, y: TILE }, layout: { type: 'column', justifyContent: 'center' }, padding: { t: 0, r: PAD, b: 0, l: PAD } });
          const value = await text(win, tile.content, '', TYPE.title, 'auto', 26, TEXT.primary, FONT_STRONG, 'left');
          await text(win, tile.content, labels.get(sensor.path), TYPE.caption, 'auto', 16, TEXT.secondary, FONT, 'left');
          await Promise.all([UI.attach(win, line, tile.id), UI.setElementId(win, value, 'cooling-' + shortId(sensor.path))]);
          tiles.push({ path: sensor.path, id: tile.id, value, shown: '' });
        }
        page.add(line, TILE);
      }
    }

    // Fans: Auto or Manual, and the speed while manual.
    const fans = [];
    for (const [index, fan] of ofType(snapshot, 'Fan').entries()) {
      const id = 'fan-' + shortId(fan.path), name = ofType(snapshot, 'Fan').length > 1 ? fan.Name || 'Fan ' + (index + 1) : 'Fan';
      const manual = fan.Modes?.includes('duty') ? 'duty' : fan.Modes?.[0];
      const control = fan.Writable && manual;
      const box = await card('fan', name, control ? [CHIP, SLIDER] : []);
      const entry = { path: fan.path, box, mode: '', remembered: manual === 'duty' ? 60 : 3000 };
      if (control) {
        entry.modes = await chips(id + '-mode', [{ value: 'auto', title: 'Auto' }, { value: 'manual', title: 'Manual' }], inner, async value => {
          if (value === 'auto') await client.automaticFan(fan.path);
          else await client.overrideFan(fan.path, manual, entry.remembered);
          kit.play(box.id, presets.bump());
        });
        await UI.attach(win, box.content, entry.modes.id);
        const isManual = () => device(fan.path)?.Mode === manual;
        entry.slider = await scalarControl(win, { id: id + '-target', width: inner, value: 0,
          maximum: manual === 'rpm' ? 10000 : 100, step: manual === 'rpm' ? 100 : 5,
          format: value => !isManual() ? 'Auto' : manual === 'rpm' ? value + ' rpm' : value + '%',
          available: () => allowed() && device(fan.path)?.Available && isManual(),
          commit: async value => { await client.overrideFan(fan.path, manual, value); entry.remembered = value; }, report });
        await UI.attach(win, box.content, entry.slider.id);
      }
      await UI.setElementId(win, box.trailing, id);
      page.add(box.id, box.height, () => entry.slider?.dispose());
      fans.push(entry);
    }
    if (!tiles.length && !fans.length) {
      const empty = await kit.emptyState({ glyph: glyph('fan'), message: 'No cooling hardware reported', width });
      page.add(empty.id, empty.height);
    }

    let spinning;
    page.update = async () => {
      if (page.reshape()) return;
      const now = coolingSummary(snapshot);
      if (now.spinning !== spinning) { spinning = now.spinning; badge.pulse(spinning); }
      await Promise.all([UI.setTextString(win, title.heading, now.title), UI.setTextString(win, title.caption, now.subtitle), title.setDot(now.health),
        ...tiles.map(tile => {
          const sensor = device(tile.path), shown = sensor?.Available ? celsius(sensor.Celsius) : '—';
          const work = [UI.setTextString(win, tile.value, shown), UI.setTextColour(win, tile.value, sensor?.Available ? tone(sensor.Celsius) : TEXT.secondary)];
          // Juice: a reading that crosses into warm or hot bumps its tile.
          if (tile.shown && sensor?.Available && heat(sensor.Celsius) !== tile.heat && heat(sensor.Celsius) !== 'cool') kit.play(tile.id, presets.bump());
          tile.shown = shown; tile.heat = sensor?.Available ? heat(sensor.Celsius) : '';
          return Promise.all(work);
        }),
        ...fans.map(entry => {
          const fan = device(entry.path), mode = fan?.Mode === 'auto' || !fan ? 'auto' : 'manual';
          // Juice: the speed control wakes when the fan goes manual.
          if (entry.slider && mode !== entry.mode) kit.play(entry.slider.id, presets.fade(mode === 'manual' ? 1 : 0.35));
          entry.mode = mode;
          if (fan && fan.Mode !== 'auto' && fan.Target) entry.remembered = fan.Target;
          return Promise.all([UI.setTextString(win, entry.box.trailing, fan?.Available ? (fan.RPM > 0 ? rpm(fan.RPM) + ' RPM' : 'Idle') : fanReading(fan)),
            ...(entry.modes ? [entry.modes.paint(mode), entry.slider.set(mode === 'manual' ? fan.Target : 0)] : [])]);
        })]);
      // The status line says what happens to a manual fan on leaving.
      page.hint = fans.some(entry => device(entry.path)?.Mode && device(entry.path).Mode !== 'auto') ? 'Fans return to Auto when you close Cooling' : '';
    };
    await page.update();
    await page.finish(hero);
    badge.pop();
    return page;
  };

  const lighting = async () => {
    const page = await contentPage('lighting', lighting);
    const width = frame.width, inner = width - PAD * 2, lights = [];
    for (const light of ofType(snapshot, 'Lighting')) {
      const id = 'lighting-' + shortId(light.path), keyboard = /keyboard/i.test(light.Name || light.path);
      // Firmware presets read better than a percentage when the light has them.
      const levels = light.Writable ? lightLevels(light.Levels) : [];
      const slider = light.Writable && !levels.length && light.PercentageSupported;
      const box = await card(keyboard ? 'keyboard' : 'power-light', light.Name || 'Light', levels.length ? [CHIP] : slider ? [SLIDER] : []);
      const entry = { path: light.path, box };
      if (levels.length) {
        entry.levels = await chips(id + '-level', levels, inner, async value => { await client.setLevel(light.path, value); kit.play(box.id, presets.bump()); });
        await UI.attach(win, box.content, entry.levels.id);
      } else if (slider) {
        entry.slider = await scalarControl(win, { id: id + '-brightness', width: inner, value: light.Brightness, minimum: light.Minimum,
          format: value => value > 0 ? value + '%' : 'Off',
          available: () => allowed() && device(light.path)?.Available, commit: value => client.setBrightness(light.path, value), report });
        await UI.attach(win, box.content, entry.slider.id);
      }
      await UI.setElementId(win, box.trailing, id);
      page.add(box.id, box.height, () => entry.slider?.dispose());
      lights.push(entry);
    }
    if (!lights.length) {
      const empty = await kit.emptyState({ glyph: glyph('keyboard'), message: 'No lighting reported', width });
      page.add(empty.id, empty.height);
    }
    page.update = async () => {
      if (page.reshape()) return;
      await Promise.all(lights.map(entry => {
        const light = device(entry.path);
        // The control already shows the value; the header only reports trouble.
        return Promise.all([UI.setTextString(win, entry.box.trailing, entry.levels || entry.slider ? light?.Available ? '' : 'Unavailable' : lightReading(light)),
          ...(entry.levels ? [entry.levels.paint(light?.Level)] : []), ...(entry.slider ? [entry.slider.set(light?.Brightness || 0)] : [])]);
      }));
    };
    await page.update();
    await page.finish();
    return page;
  };

  return {
    start: () => client.start(), cooling, lighting,
    get capabilities() { return { cooling: ofType(snapshot, 'Fan').length > 0 || ofType(snapshot, 'Temperature').length > 0, lighting: ofType(snapshot, 'Lighting').length > 0 }; },
    detail: kind => kind === 'cooling' ? coolingDetail(snapshot) : lightingDetail(snapshot),
    async onSession() { if (!allowed()) await client.watch(false); else if (pageKind) await client.watch(true); },
    async dispose() { closed = true; await client.dispose(); }
  };
}
