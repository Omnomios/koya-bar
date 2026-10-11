import * as Compositor from 'Koya/Compositor';
import * as UI from 'Helix/UserInterface';
import * as Assets from 'Koya/Assets';
import * as Event from 'Helix/Event';
import * as Engine from 'Helix/Engine';
import * as Desktop from 'Module/desktop';
import * as Process from 'Module/process';
import * as Hypr from 'Module/hypr';
import * as Log from 'Helix/Log';
import { LauncherModel } from './launcher-model.js';
import { clips } from './motion.js';
import { icon, label, row, children } from './touch-ui.js';
import { surfaceCursor, controlCursor } from './cursor.js';
import { FONT, CREAM, ORANGE, CLEAR, TONAL, MUTED, POPOVER, SPACE, RADIUS, TYPE } from './theme.js';

const PAD = SPACE.m, FIELD = 40;
// One line per result: trim to roughly what fits at caption size.
const clip = (value, limit) => value.length > limit ? value.slice(0, Math.max(0, limit - 1)).trimEnd() + '…' : value;

export default function main() {
  setTimeout(() => build().catch(error => { Log.error('Launcher: ' + error); Engine.quit(); }), 0);
}
async function build() {
  const displays = await Compositor.listDisplays();
  if (!displays.length) throw new Error('No display available');
  let display = displays[0];
  try {
    Hypr.connect();
    const monitors = await Hypr.monitors();
    display = displays.find(item => item.display === monitors.find(monitor => monitor.focused)?.name) || display;
  } catch (_) {}
  // A compact spotlight-style picker: search field, results, key hints.
  const width = Math.min(560, Number(display.logical_width || display.width) - 40);
  const ROW = 44, inner = width - PAD * 2, FOOTER = 24;
  const capacity = Math.max(1, Math.min(9, Math.floor((Number(display.logical_height || display.height) - 160) / ROW)));
  const height = PAD * 2 + FIELD + SPACE.s * 2 + capacity * ROW + FOOTER;
  const win = await Compositor.createWindow({ role: 'overlay', anchor: 'center', size: { x: width, y: height },
    exclusiveZone: -1, display: display.display, namespace: 'koya-launcher', msaaSamples: 1,
    keyboardInteractivity: 'exclusive', acceptPointerEvents: true, transparent: true });
  const [root, field, queryLabel, caret, list, footer] = await Promise.all([
    UI.createElement(win, { id: 'launcher-root', renderable: { type: 'box', colour: POPOVER, cornerRadius: RADIUS.surface, cornerResolution: 16 },
      layout: { type: 'column', gap: SPACE.s, padding: { l: PAD, r: PAD, t: PAD, b: PAD } },
      item: { size: { x: width, y: height } }, contentAlign: 'fill', onHover: surfaceCursor(win) }),
    UI.createElement(win, { renderable: { type: 'box', colour: TONAL, cornerRadius: RADIUS.control, cornerResolution: 16 },
      layout: { type: 'none' }, item: { size: { x: inner, y: FIELD } }, contentAlign: 'fill', clipToBounds: true,
      onHover: controlCursor(win, 'text') }),
    UI.createElement(win, { id: 'launcher-query', renderable: { type: 'text', string: 'Type to search applications…',
      font: FONT, size: TYPE.heading, colour: MUTED, metricsBasis: 'line', justify: 'left', vAlign: 'center' },
      item: { size: { x: inner - 24, y: FIELD }, position: { x: 12, y: 0 } }, contentAlign: { x: 'start', y: 'center' }, clipToBounds: true }),
    UI.createElement(win, { renderable: { type: 'box', colour: ORANGE },
      item: { size: { x: 2, y: 20 }, position: { x: 12, y: (FIELD - 20) / 2 } }, contentAlign: 'fill' }),
    UI.createElement(win, { id: 'launcher-list', layout: { type: 'column', gap: 2 }, item: { size: { x: inner, y: capacity * ROW } } }),
    label(win, null, 'Loading applications…', TYPE.caption, inner, FOOTER, MUTED),
    Compositor.setClearColor(win, 0, 0, 0, 0)
  ]);
  const [blink] = await Promise.all([
    clips(win, caret, { blink: [{ time: 0, opacity: 1 }, { time: 0.5, opacity: 1 },
      { time: 0.51, opacity: 0 }, { time: 1, opacity: 0 }, { time: 1.01, opacity: 1, looping: true }] }),
    UI.attach(win, root, field), UI.attach(win, root, list), UI.attach(win, root, footer),
    UI.attach(win, field, queryLabel), UI.attach(win, field, caret), UI.attachRoot(win, root)
  ]);
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
        UI.setTextColour(win, queryLabel, model.query || preedit ? CREAM : MUTED)
      ]);
      const position = await UI.getTextCaretPosition(win, queryLabel, model.query || preedit ? model.cursor + Array.from(preedit).length : 0);
      const scroll = Math.max(0, Number(position.x || 0) - inner + 40);
      const [nextBoard] = await Promise.all([
        UI.createElement(win, { layout: { type: 'column', gap: 2 }, item: { size: { x: inner, y: capacity * ROW } } }),
        UI.setPosition(win, queryLabel, { x: -scroll, y: 0 }),
        UI.setLayoutPosition(win, caret, { x: 12 + Number(position.x || 0) - scroll, y: (FIELD - 20) / 2 }),
        ...(board ? [UI.destroyElement(win, board)] : [])
      ]);
      board = nextBoard;
      await UI.attach(win, list, board);
      const first = Math.floor(model.selected / capacity) * capacity;
      await children(win, board, model.results.slice(first, first + capacity).map(async (app, offset) => {
        const index = first + offset;
        // Results sit directly on the surface; only the selection is filled.
        const target = await row(win, null, inner, ROW - 2, () => { model.selected = index; launch(); },
          { colour: index === model.selected ? TONAL : CLEAR, gap: 10, radius: RADIUS.control });
        const [glyph, detail] = await children(win, target, [
          icon(win, null, app.icon || '/rom/assets/launcher/application.png', 24, 28, ROW - 2),
          UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: inner - 62, y: ROW - 2 } } })
        ]);
        if (!app.icon) loadIcon(app).then(texture => {
          if (texture && token === revision) return UI.setTexture(win, glyph, texture);
        }).catch(error => Log.error('Launcher icon: ' + error));
        await Promise.all([
          UI.setElementId(win, target, 'launcher-app-' + app.id),
          children(win, detail, [
            // Name and description share one line, so more results fit.
            label(win, null, app.name, TYPE.body, Math.round((inner - 62) * 0.45), ROW - 2, index === model.selected ? ORANGE : CREAM),
            label(win, null, clip(app.genericName || app.comment || app.executable, Math.floor(((inner - 62) * 0.55 - SPACE.s) / 6.5)), TYPE.caption, Math.round((inner - 62) * 0.55) - SPACE.s, ROW - 2, MUTED)
          ])
        ]);
        return target;
      }));
      if (ready && !model.results.length) await label(win, board, 'No matching applications', TYPE.body, inner, ROW, MUTED);
      const count = model.results.length;
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
