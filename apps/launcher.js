import * as Compositor from 'Koya/Compositor';
import * as UI from './theme-ui.js';
import * as Assets from 'Koya/Assets';
import * as Event from 'Helix/Event';
import * as Engine from 'Helix/Engine';
import * as Desktop from 'Module/desktop';
import * as Process from 'Module/process';
import * as Hypr from 'Module/hypr';
import * as Log from 'Helix/Log';
import { LauncherModel } from './launcher-model.js';
import { clips, presets } from './motion.js';
import { createKit } from './kit.js';
import { shadow } from './shadow.js';
import { icon, label, row, children } from './touch-ui.js';
import { surfaceCursor, controlCursor } from './cursor.js';
import { popupContains } from './popup-layout.js';
import { connect } from './session.js';
import { FONT, CLEAR, SPACE, RADIUS, TYPE, TEXT, AUTO, ELEVATION, SURFACE, configureTheme } from './theme.js';

const PANEL_PADDING = SPACE.m, SEARCH_FIELD_HEIGHT = 40;
// One line per result: trim to roughly what fits at caption size.
const clip = (value, limit) => value.length > limit ? value.slice(0, Math.max(0, limit - 1)).trimEnd() + '…' : value;

export default function main() {
  setTimeout(() => build().catch(error => { Log.error('Launcher: ' + error); Engine.quit(); }), 0);
}
async function build() {
  await configureTheme(Desktop.loadPreferences());
  connect('launcher');
  const displays = await Compositor.listDisplays({ backend: 'wayland' });
  if (!displays.length) throw new Error('No display available');
  let display = displays[0];
  try {
    Hypr.connect();
    const monitors = await Hypr.monitors();
    display = displays.find(item => item.display === monitors.find(monitor => monitor.focused)?.name) || display;
  } catch (_) {}
  // A compact spotlight-style picker: search field, results, key hints.
  const width = Math.min(560, Number(display.logical_width || display.width) - 40);
  const RESULT_ROW_HEIGHT = 44, inner = width - PANEL_PADDING * 2, FOOTER_HEIGHT = 24;
  const capacity = Math.max(1, Math.min(9, Math.floor((Number(display.logical_height || display.height) - 160) / RESULT_ROW_HEIGHT)));
  const height = PANEL_PADDING * 2 + SEARCH_FIELD_HEIGHT + SPACE.s * 2 + capacity * RESULT_ROW_HEIGHT + FOOTER_HEIGHT;
  // The overlay covers the output so a click outside the picker closes it.
  const screen = { x: Number(display.logical_width || display.width), y: Number(display.logical_height || display.height) };
  const place = { x: Math.round((screen.x - width) / 2), y: Math.round((screen.y - height) / 2) };
  const win = await Compositor.createWindow({ role: 'overlay', anchor: 'top-left', size: screen,
    exclusiveZone: -1, display: display.display, namespace: 'koya-launcher', msaaSamples: 1,
    keyboardInteractivity: 'exclusive', acceptPointerEvents: true, transparent: true });
  const kit = createKit(win);
  const [backdrop, field, queryLabel, caret, results, footer] = await Promise.all([
    UI.createElement(win, { layout: { type: 'none' }, item: { size: AUTO }, onHover: surfaceCursor(win),
      onActivate: event => { if (!launching && !popupContains(event.local, place, { x: width, y: height })) Engine.quit(); } }),
    UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.field, cornerRadius: RADIUS.control, cornerResolution: 16 },
      layout: { type: 'none' }, item: { size: { x: 'auto', y: SEARCH_FIELD_HEIGHT } }, contentAlign: 'fill', clipToBounds: true,
      onHover: controlCursor(win, 'text') }),
    // Inset in the field by margins; scrolled by a visual offset as it grows.
    UI.createElement(win, { id: 'launcher-query', renderable: { type: 'text', string: 'Type to search applications…',
      font: FONT, size: TYPE.heading, colour: TEXT.secondary, metricsBasis: 'line', justify: 'left', vAlign: 'center' },
      item: { size: AUTO, margin: { t: 0, r: 12, b: 0, l: 12 } }, contentAlign: { x: 'start', y: 'center' }, clipToBounds: true }),
    // The caret follows the measured caret position (a runtime value).
    UI.createElement(win, { renderable: { type: 'box', colour: TEXT.caret },
      item: { size: { x: 2, y: 20 }, position: { x: 12, y: (SEARCH_FIELD_HEIGHT - 20) / 2 } }, contentAlign: 'fill' }),
    // Every result, in a native scroll viewport `capacity` rows tall.
    kit.scrollArea({ height: capacity * RESULT_ROW_HEIGHT, id: 'launcher-list' }),
    label(win, null, 'Loading applications…', TYPE.caption, 'auto', FOOTER_HEIGHT, TEXT.secondary),
    Compositor.setClearColor(win, 0, 0, 0, 0)
  ]);
  const panel = await kit.surface('panel', { id: 'launcher-root', layout: { type: 'column', gap: SPACE.s }, padding: { t: PANEL_PADDING, r: PANEL_PADDING, b: PANEL_PADDING, l: PANEL_PADDING } });
  const root = panel.content;
  const [blink] = await Promise.all([
    clips(win, caret, { blink: [{ time: 0, opacity: 1 }, { time: 0.5, opacity: 1 },
      { time: 0.51, opacity: 0 }, { time: 1, opacity: 0 }, { time: 1.01, opacity: 1, looping: true }] }),
    UI.attach(win, root, field), UI.attach(win, root, results.id), UI.attach(win, root, footer),
    UI.attach(win, field, queryLabel), UI.attach(win, field, caret), UI.attach(win, backdrop, panel.id),
    UI.setLayoutAABB(win, panel.id, { min: place, max: { x: place.x + width, y: place.y + height } })
  ]);
  const shade = await shadow(win, backdrop, { x: width, y: height }, place, ELEVATION.panel.shadow);
  await UI.attachRoot(win, backdrop);
  kit.play(panel.id, presets.dropIn());
  if (shade) kit.play(shade, presets.dropIn());
  await blink.play('blink');
  const model = new LauncherModel();
  let ready = false, launching = false, preedit = '', message = '', board, queue = Promise.resolve(), revision = 0;
  const iconJobs = new Map();
  const cache = Process.getEnv('XDG_CACHE_HOME', Process.getEnv('HOME', '') + '/.cache');
  const loadIcon = app => {
    if (!iconJobs.has(app.id)) iconJobs.set(app.id, Desktop.resolveIcon(app.iconName || '').then(async texture => {
      await Assets.mount(cache + '/koya/icons', '/rom'); app.icon = texture; return texture;
    }));
    return iconJobs.get(app.id);
  };
  const render = () => {
    const token = ++revision;
    queue = queue.then(async () => {
      if (token !== revision) return;
      const characters = Array.from(model.query);
      characters.splice(model.cursor, 0, ...Array.from(preedit));
      await Promise.all([
        UI.setTextString(win, queryLabel, characters.join('') || 'Type to search applications…'),
        UI.setTextColour(win, queryLabel, model.query || preedit ? TEXT.primary : TEXT.secondary)
      ]);
      const position = await UI.getTextCaretPosition(win, queryLabel, model.query || preedit ? model.cursor + Array.from(preedit).length : 0);
      const scroll = Math.max(0, Number(position.x || 0) - inner + 40);
      const [nextBoard] = await Promise.all([
        UI.createElement(win, { layout: { type: 'column', gap: 2 }, item: { size: { x: 'auto', y: Math.max(1, model.results.length) * RESULT_ROW_HEIGHT } } }),
        UI.setPosition(win, queryLabel, { x: -scroll, y: 0 }),
        UI.setLayoutPosition(win, caret, { x: 12 + Number(position.x || 0) - scroll, y: (SEARCH_FIELD_HEIGHT - 20) / 2 }),
        ...(board ? [UI.destroyElement(win, board)] : [])
      ]);
      board = nextBoard;
      await UI.attach(win, results.content, board);
      await children(win, board, model.results.map(async (app, index) => {
        // Results sit directly on the surface; only the selection is filled.
        const target = await row(win, null, inner, RESULT_ROW_HEIGHT - 2, () => { model.selected = index; launch(); },
          { colour: index === model.selected ? SURFACE.selected : CLEAR, hover: index === model.selected ? SURFACE.selected : undefined, gap: 10, radius: RADIUS.control });
        const [glyph, detail] = await children(win, target, [
          icon(win, null, app.icon || '/rom/assets/launcher/application.png', 24, 28, RESULT_ROW_HEIGHT - 2),
          UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: inner - 62, y: RESULT_ROW_HEIGHT - 2 } } })
        ]);
        if (!app.icon) loadIcon(app).then(texture => {
          if (texture && token === revision) return UI.setTexture(win, glyph, texture);
        }).catch(error => Log.error('Launcher icon: ' + error));
        await Promise.all([
          UI.setElementId(win, target, 'launcher-app-' + app.id),
          children(win, detail, [
            // Name and description share one line, so more results fit.
            label(win, null, app.name, TYPE.body, Math.round((inner - 62) * 0.45), RESULT_ROW_HEIGHT - 2, index === model.selected ? TEXT.accent : TEXT.primary),
            label(win, null, clip(app.genericName || app.comment || app.executable, Math.floor(((inner - 62) * 0.55 - SPACE.s) / 6.5)), TYPE.caption, Math.round((inner - 62) * 0.55) - SPACE.s, RESULT_ROW_HEIGHT - 2, TEXT.secondary)
          ])
        ]);
        return target;
      }));
      if (ready && !model.results.length) await label(win, board, 'No matching applications', TYPE.body, inner, RESULT_ROW_HEIGHT, TEXT.secondary);
      const count = model.results.length;
      // The scroll range follows the results; keep the selection in view.
      await results.setContentHeight(Math.max(1, count) * RESULT_ROW_HEIGHT);
      await results.reveal(model.selected * RESULT_ROW_HEIGHT, (model.selected + 1) * RESULT_ROW_HEIGHT);
      await UI.setTextString(win, footer, message || (!ready ? 'Loading applications…' : launching ? 'Opening ' + model.current?.name + '…'
        : (count ? (model.selected + 1) + ' / ' + count + '   ·   ↑↓ select   Enter open   Esc close' : 'Esc close')));
    }).catch(error => Log.error('Launcher layout: ' + error));
    return queue;
  };
  const launch = async () => {
    if (!ready || launching || !model.current) return;
    launching = true; message = ''; render();
    try { await Desktop.launch(model.current.id); Engine.quit(); }
    catch (error) { launching = false; message = 'Could not open ' + model.current.name; Log.error('Launch: ' + error); render(); }
  };
  const filter = query => { if (launching) return; model.filter(query); message = ''; render(); };
  Event.on('textInput', event => {
    if (event.id !== win || launching) return;
    const value = String(event.text || '');
    if (value === '\u0015') { preedit = ''; filter(''); return; }
    if (value === '\u0001') { model.moveCursor(-256); render(); return; }
    if (value === '\u0005') { model.moveCursor(256); render(); return; }
    if (value === '\u0017') {
      const characters = Array.from(model.query), prefix = characters.slice(0, model.cursor).join('').replace(/\s*\S+\s*$/, '');
      model.filter(prefix + characters.slice(model.cursor).join(''), Array.from(prefix).length); render(); return;
    }
    const printable = value.replace(/[\x00-\x1f\x7f]/g, '');
    if (printable) { model.insert(printable); message = ''; render(); }
  });
  Event.on('textInputMethod', event => {
    if (event.id !== win || launching) return;
    for (let i = 0; i < Math.min(256, Number(event.deleteBefore || 0)); i++) model.erase();
    for (let i = 0; i < Math.min(256, Number(event.deleteAfter || 0)); i++) model.erase(true);
    preedit = String(event.preedit || '').replace(/[\x00-\x1f\x7f]/g, '');
    model.insert(String(event.text || '').replace(/[\x00-\x1f\x7f]/g, '')); message = ''; render();
  });
  const key = event => {
    if (event.id !== win) return;
    const code = Number(event.key);
    if ([1, 65307].includes(code)) { Engine.quit(); return; }
    if (launching) return;
    if ([28, 96, 65293].includes(code)) { launch(); return; }
    if ([14, 65288].includes(code)) { preedit = ''; model.erase(); render(); return; }
    if ([111, 65535].includes(code)) { preedit = ''; model.erase(true); render(); return; }
    if ([105, 65361].includes(code)) { model.moveCursor(-1); render(); return; }
    if ([106, 65363].includes(code)) { model.moveCursor(1); render(); return; }
    if ([103, 65362].includes(code)) model.move(-1);
    else if ([108, 65364, 15, 65289].includes(code)) model.move(1);
    else if ([104, 65365].includes(code)) model.move(-capacity);
    else if ([109, 65366].includes(code)) model.move(capacity);
    else if ([102, 65360].includes(code)) model.moveCursor(-256);
    else if ([107, 65367].includes(code)) model.moveCursor(256);
    else return;
    render();
  };
  Event.on('keyDown', key); Event.on('keyRepeat', key);
  // Let the desktop input method compose text; no phone keyboard service.
  try { await Compositor.setTextInput(win, { enabled: true, newFocus: true, inputId: queryLabel, cursorElement: queryLabel, contentPurpose: 0 }); }
  catch (_) {}
  const refresh = async () => {
    const apps = await Desktop.applications();
    await Assets.mount(cache + '/koya/icons', '/rom');
    model.refresh(apps); ready = true; await render();
  };
  Desktop.start(Process.getEnv('KOYA_DESKTOP_ROOT', '.'), () => refresh().catch(error => Log.error('Applications: ' + error)));
  await render(); await refresh();
  globalThis.koyaLauncher = { window: win, model, filter, launch, render };
}
