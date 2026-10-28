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
import { text, icon, label, row, children } from './touch-ui.js';
import { surfaceCursor, controlCursor } from './cursor.js';
import { popupContains } from './popup-layout.js';
import { connect } from './session.js';
import { FONT, FONT_STRONG, CLEAR, SPACE, RADIUS, TYPE, TEXT, AUTO, ELEVATION, SURFACE, BORDER, HEALTH, MOTION, configureTheme } from './theme.js';

// A solid search block with a tab on its top edge. Results hang beneath it on
// a translucent sheet that appears once there is something to show and eases
// to the height of the matches.
const BLOCK_PADDING = 10, SEARCH_FIELD_HEIGHT = 44, SHEET_PADDING = SPACE.m, SHEET_GAP = SPACE.s;
const RESULT_ROW_HEIGHT = 44, FOOTER_HEIGHT = 24;
// The tab tucks under the block by a corner radius so it reads as part of it.
const TAB_HEIGHT = 30, TAB_OVERLAP = RADIUS.surface, TAB_PADDING = 10, TAB_MAX = 240, DOT = 8;
// One line per result: trim to roughly what fits at caption size.
const clip = (value, limit) => value.length > limit ? value.slice(0, Math.max(0, limit - 1)).trimEnd() + '…' : value;
// A status dot settling: pops from small to full, fully opaque.
const settleFrames = () => presets.pop(0, 0.4).map(frame => ({ ...frame, opacity: 1 }));

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
  const screen = { x: Number(display.logical_width || display.width), y: Number(display.logical_height || display.height) };
  const width = Math.min(600, screen.x - 40), inner = width - SHEET_PADDING * 2, blockHeight = SEARCH_FIELD_HEIGHT + BLOCK_PADDING * 2;
  // Sit in the upper third, like a spotlight, leaving room for results below.
  const blockPlace = { x: Math.round((screen.x - width) / 2), y: Math.max(16 + TAB_HEIGHT, Math.round(screen.y * 0.2)) };
  const tabPlace = { x: blockPlace.x + BLOCK_PADDING, y: blockPlace.y - TAB_HEIGHT + TAB_OVERLAP };
  const sheetPlace = { x: blockPlace.x, y: blockPlace.y + blockHeight + SHEET_GAP };
  const chrome = SHEET_PADDING * 2 + SPACE.s + FOOTER_HEIGHT;
  const capacity = Math.max(1, Math.min(9, Math.floor((screen.y - sheetPlace.y - 32 - chrome) / RESULT_ROW_HEIGHT)));
  // The overlay covers the output so a click outside the picker closes it.
  const win = await Compositor.createWindow({ role: 'overlay', anchor: 'top-left', size: screen,
    exclusiveZone: -1, display: display.display, namespace: 'koya-launcher', msaaSamples: 1,
    keyboardInteractivity: 'exclusive', acceptPointerEvents: true, transparent: true });
  const kit = createKit(win), play = kit.play;
  let ready = false, launching = false, closing = false, browsing = false, sheetOpen = false, sheetHeight = 0, tabWidth = TAB_MAX;
  let preedit = '', message = '', board, boardShape, rows = [], queue = Promise.resolve(), revision = 0, shownSelected = -1, wasEmpty = false;
  const inside = point => popupContains(point, blockPlace, { x: width, y: blockHeight }) || popupContains(point, tabPlace, { x: tabWidth, y: TAB_HEIGHT })
    || (sheetOpen && popupContains(point, sheetPlace, { x: width, y: sheetHeight }));
  const backdrop = await UI.createElement(win, { layout: { type: 'none' }, item: { size: AUTO }, onHover: surfaceCursor(win),
    onActivate: event => { if (!launching && event.local && !inside(event.local)) close(); } });

  // ---- The tab: how many applications there are, and whether they loaded --
  // Created before the block, so it draws beneath the block's top edge.
  const tab = await UI.createElement(win, { id: 'launcher-tab', renderable: { type: 'box', colour: ELEVATION.block.surface, cornerRadius: RADIUS.surface,
    cornerResolution: 16, origin: { x: 0.5, y: 0 } }, layout: { type: 'row', alignItems: 'center', gap: 6, padding: { l: TAB_PADDING, r: TAB_PADDING, t: 0, b: TAB_OVERLAP } },
    item: { size: { x: TAB_MAX, y: TAB_HEIGHT } }, contentAlign: 'fill' });
  const tabDot = await UI.createElement(win, { renderable: { type: 'box', colour: HEALTH.off, cornerRadius: DOT / 2, cornerResolution: 16, origin: { x: 0.5, y: 0.5 } },
    item: { size: { x: DOT, y: DOT } }, contentAlign: 'fill' });
  await UI.attach(win, tab, tabDot);
  const tabLabel = await text(win, tab, 'Loading…', TYPE.caption, TAB_MAX - TAB_PADDING * 2 - DOT - 6, TAB_HEIGHT - TAB_OVERLAP, TEXT.secondary, FONT_STRONG, 'left');
  const placeTab = () => UI.setLayoutAABB(win, tab, { min: tabPlace, max: { x: tabPlace.x + tabWidth, y: tabPlace.y + TAB_HEIGHT } });
  let tabHealth = 'off';
  const setTab = async (value, health) => {
    await Promise.all([UI.setTextString(win, tabLabel, value), UI.setBoxColour(win, tabDot, HEALTH[health])]);
    // The tab hugs its label.
    const measured = await UI.measureText(win, tabLabel).catch(() => undefined);
    if (measured?.size?.x) {
      const labelWidth = Math.min(TAB_MAX - TAB_PADDING * 2 - DOT - 6, Math.ceil(measured.size.x) + 2);
      tabWidth = TAB_PADDING * 2 + DOT + 6 + labelWidth;
      await Promise.all([UI.setLayoutSize(win, tabLabel, { x: labelWidth, y: TAB_HEIGHT - TAB_OVERLAP }), placeTab()]);
    }
    if (health !== tabHealth) { tabHealth = health; play(tabDot, settleFrames()); play(tab, presets.bump()); }
  };

  // ---- The sheet: results and key hints ------------------------------------
  const sheet = await kit.surface('sheet', { layout: { type: 'column', gap: SPACE.s },
    padding: { t: SHEET_PADDING, r: SHEET_PADDING, b: SHEET_PADDING, l: SHEET_PADDING } });
  // Every result, in a native scroll viewport whose height follows the matches.
  const [results, resultsContent, footer] = await Promise.all([
    UI.createElement(win, { id: 'launcher-list', scroll: { axis: 'y' }, layout: { type: 'column' }, item: { size: { x: inner, y: 1 } } }),
    UI.createElement(win, { layout: { type: 'column' }, item: { size: { x: inner, y: 1 } } }),
    label(win, null, 'Loading applications…', TYPE.caption, 'auto', FOOTER_HEIGHT, TEXT.secondary)
  ]);
  await Promise.all([UI.setClipToBounds(win, sheet.id, true), UI.attach(win, results, resultsContent),
    UI.attach(win, sheet.content, results), UI.attach(win, sheet.content, footer)]);

  // ---- The block: the search field ------------------------------------------
  const block = await kit.surface('block', { id: 'launcher-root', layout: { type: 'row', alignItems: 'center' },
    padding: { t: BLOCK_PADDING, r: BLOCK_PADDING, b: BLOCK_PADDING, l: BLOCK_PADDING } });
  const fieldWidth = width - BLOCK_PADDING * 2;
  const [field, queryLabel, caret, focusRing] = await Promise.all([
    UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.field, cornerRadius: RADIUS.control, cornerResolution: 16 },
      layout: { type: 'none' }, item: { size: { x: fieldWidth, y: SEARCH_FIELD_HEIGHT } }, contentAlign: 'fill', clipToBounds: true,
      onHover: controlCursor(win, 'text') }),
    // Inset in the field by margins; scrolled by a visual offset as it grows.
    UI.createElement(win, { id: 'launcher-query', renderable: { type: 'text', string: 'Type to search applications…',
      font: FONT, size: TYPE.heading, colour: TEXT.secondary, metricsBasis: 'line', justify: 'left', vAlign: 'center' },
      item: { size: AUTO, margin: { t: 0, r: 12, b: 0, l: 12 } }, contentAlign: { x: 'start', y: 'center' }, clipToBounds: true }),
    // The caret follows the measured caret position (a runtime value).
    UI.createElement(win, { renderable: { type: 'box', colour: TEXT.caret },
      item: { size: { x: 2, y: 20 }, position: { x: 12, y: (SEARCH_FIELD_HEIGHT - 20) / 2 } }, contentAlign: 'fill' }),
    // The field always has focus here, so it always wears the focus ring.
    UI.createElement(win, { renderable: { type: 'box', colour: BORDER.focus, inset: 2, cornerRadius: RADIUS.control, cornerResolution: 16 },
      item: { size: AUTO }, contentAlign: 'fill' }),
    Compositor.setClearColor(win, 0, 0, 0, 0)
  ]);
  const [blink] = await Promise.all([
    clips(win, caret, { blink: [{ time: 0, opacity: 1 }, { time: 0.5, opacity: 1 },
      { time: 0.51, opacity: 0 }, { time: 1, opacity: 0 }, { time: 1.01, opacity: 1, looping: true }] }),
    UI.attach(win, block.content, field), UI.attach(win, field, queryLabel), UI.attach(win, field, caret), UI.attach(win, field, focusRing),
    UI.setHitTarget(win, focusRing, false),
    UI.attach(win, backdrop, tab), UI.attach(win, backdrop, sheet.id), UI.attach(win, backdrop, block.id), placeTab(),
    UI.setLayoutAABB(win, block.id, { min: blockPlace, max: { x: blockPlace.x + width, y: blockPlace.y + blockHeight } })
  ]);

  // The sheet's height eases toward the matches, frame by frame, so it visibly
  // grows and shrinks as the query narrows rather than snapping.
  let visibleRows = 1, sheetTarget = 0, tweenGeneration = 0;
  const applySheet = height => Promise.all([
    UI.setLayoutAABB(win, sheet.id, { min: sheetPlace, max: { x: sheetPlace.x + width, y: sheetPlace.y + Math.max(1, height) } }),
    UI.setLayoutSize(win, results, { x: inner, y: Math.max(1, Math.min(visibleRows * RESULT_ROW_HEIGHT, height - chrome)) })
  ]);
  const resizeSheet = target => {
    if (target === sheetTarget) return;
    sheetTarget = target;
    const generation = ++tweenGeneration, from = sheetHeight, start = Date.now(), duration = MOTION.slow * 1000;
    const step = async () => {
      if (generation !== tweenGeneration) return;
      const t = Math.min(1, (Date.now() - start) / duration);
      sheetHeight = Math.round(from + (target - from) * (1 - (1 - t) ** 3));
      await applySheet(sheetHeight).catch(() => {});
      if (t < 1) setTimeout(step, 16); else revealSelected().catch(() => {});
    };
    step();
  };
  const showSheet = open => {
    if (open && !sheetOpen) play(sheet.id, [{ time: 0, opacity: 0, position: { x: 0, y: -MOTION.drop } },
      { time: MOTION.base, opacity: 1, position: { x: 0, y: 0 }, ease: MOTION.enter }]);
    if (!open && sheetOpen) play(sheet.id, [{ time: MOTION.base, opacity: 0, position: { x: 0, y: -MOTION.drop / 2 }, ease: MOTION.exit }]);
    sheetOpen = open;
    resizeSheet(open ? chrome + visibleRows * RESULT_ROW_HEIGHT : 0);
  };
  // Scroll the least needed for the selection to be visible.
  const revealSelected = async () => {
    const top = model.selected * RESULT_ROW_HEIGHT, bottom = top + RESULT_ROW_HEIGHT, height = visibleRows * RESULT_ROW_HEIGHT;
    const offset = Number((await UI.getScrollOffset(win, results))?.y || 0);
    if (top < offset) return UI.scrollTo(win, results, { x: 0, y: top });
    if (bottom > offset + height) return UI.scrollTo(win, results, { x: 0, y: bottom - height });
    return true;
  };

  const blockShade = await shadow(win, backdrop, { x: width, y: blockHeight }, blockPlace, ELEVATION.block.shadow);
  await Promise.all([applySheet(0), UI.attachRoot(win, backdrop)]);
  play(sheet.id, [{ time: 0, opacity: 0 }]);
  play(block.id, presets.dropIn()); play(tab, presets.dropIn());
  if (blockShade) play(blockShade, presets.dropIn());
  play(tabDot, presets.breathe());
  await blink.play('blink');
  const model = new LauncherModel();
  const iconJobs = new Map();
  const cache = Process.getEnv('XDG_CACHE_HOME', Process.getEnv('HOME', '') + '/.cache');
  const loadIcon = app => {
    const key = app.id + ':' + (app.iconName || '');
    if (!iconJobs.has(key)) iconJobs.set(key, Desktop.resolveIcon(app.iconName || '').then(async texture => {
      await Assets.mount(cache + '/koya/icons', '/rom'); app.icon = texture; return texture;
    }));
    return iconJobs.get(key);
  };
  // Results show once there is a query, a message, or the list was asked for
  // (↓, Tab or Enter on an empty field), like a spotlight.
  const wanted = () => !!(model.query || preedit || browsing || message);
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
      const scroll = Math.max(0, Number(position.x || 0) - fieldWidth + 40);
      await Promise.all([
        UI.setPosition(win, queryLabel, { x: -scroll, y: 0 }),
        UI.setLayoutPosition(win, caret, { x: 12 + Number(position.x || 0) - scroll, y: (SEARCH_FIELD_HEIGHT - 20) / 2 })
      ]);
      const shape = JSON.stringify([ready, model.results.map(app => app.id)]);
      const rebuilt = shape !== boardShape;
      if (rebuilt) {
        if (board) await UI.destroyElement(win, board);
        board = await UI.createElement(win, { layout: { type: 'column', gap: 2 }, item: { size: { x: 'auto', y: Math.max(1, model.results.length) * RESULT_ROW_HEIGHT } } });
        const owner = board; rows = [];
        await UI.attach(win, resultsContent, board);
        await children(win, board, model.results.map(async (app, index) => {
          // Results sit directly on the sheet; only the selection is filled.
          const target = await row(win, null, inner, RESULT_ROW_HEIGHT - 2, () => { model.selected = index; launch(); },
            { colour: index === model.selected ? SURFACE.selected : CLEAR, gap: 10, radius: RADIUS.control });
          const [glyph, detail] = await children(win, target, [
            icon(win, null, app.icon || '/rom/assets/launcher/application.png', 24, 28, RESULT_ROW_HEIGHT - 2),
            UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: inner - 62, y: RESULT_ROW_HEIGHT - 2 } } })
          ]);
          if (!app.icon) loadIcon(app).then(texture => {
            if (texture && board === owner) return UI.setTexture(win, glyph, texture);
          }).catch(error => Log.error('Launcher icon: ' + error));
          rows[index] = { target, glyph, iconName: app.iconName };
          await Promise.all([
            UI.setElementId(win, target, 'launcher-app-' + app.id),
            children(win, detail, [
              // Name and description share one line, so more results fit.
              label(win, null, app.name, TYPE.body, Math.round((inner - 62) * 0.45), RESULT_ROW_HEIGHT - 2, index === model.selected ? TEXT.accent : TEXT.primary)
                .then(name => { rows[index].name = name; return name; }),
              label(win, null, clip(app.genericName || app.comment || app.executable, Math.floor(((inner - 62) * 0.55 - SPACE.s) / 6.5)), TYPE.caption, Math.round((inner - 62) * 0.55) - SPACE.s, RESULT_ROW_HEIGHT - 2, TEXT.secondary)
                .then(description => { rows[index].description = description; return description; })
            ])
          ]);
          return target;
        }));
        if (ready && !model.results.length) await label(win, board, 'No matching applications', TYPE.body, inner, RESULT_ROW_HEIGHT, TEXT.secondary);
        boardShape = shape;
        // Rows rise in quickly, top first; only those in view are animated.
        rows.slice(0, capacity).forEach((item, index) => play(item.target, presets.rise(index, 0)));
      }
      await Promise.all(rows.flatMap((item, index) => {
        const app = model.results[index];
        if (item.iconName !== app.iconName) {
          item.iconName = app.iconName; const owner = board;
          loadIcon(app).then(texture => { if (texture && board === owner) return UI.setTexture(win, item.glyph, texture); })
            .catch(error => Log.error('Launcher icon: ' + error));
        }
        return [UI.setBoxColour(win, item.target, index === model.selected ? SURFACE.selected : CLEAR),
          UI.setTextColour(win, item.name, index === model.selected ? TEXT.accent : TEXT.primary), UI.setTextString(win, item.name, app.name),
          UI.setTextString(win, item.description, clip(app.genericName || app.comment || app.executable, Math.floor(((inner - 62) * 0.55 - SPACE.s) / 6.5)))];
      }));
      // A moved selection nudges, so keyboard travel has some weight.
      if (!rebuilt && model.selected !== shownSelected && rows[model.selected]) play(rows[model.selected].target, presets.bump());
      shownSelected = model.selected;
      const count = model.results.length;
      // Running out of matches shakes the block, once, like a refusal.
      if (ready && model.query && !count && !wasEmpty) play(block.id, presets.shake());
      wasEmpty = ready && !count;
      visibleRows = Math.min(capacity, Math.max(1, count));
      await UI.setLayoutSize(win, resultsContent, { x: inner, y: Math.max(1, count) * RESULT_ROW_HEIGHT });
      showSheet(wanted());
      await revealSelected();
      await UI.setTextString(win, footer, message || (!ready ? 'Loading applications…' : launching ? 'Opening ' + model.current?.name + '…'
        : (count ? (model.selected + 1) + ' / ' + count + '   ·   ↑↓ select   Enter open   Esc close' : 'Esc close')));
    }).catch(error => Log.error('Launcher layout: ' + error));
    return queue;
  };
  // Everything folds away together before the process ends.
  const close = () => {
    if (closing) return;
    closing = true;
    const out = [{ time: MOTION.fast, opacity: 0, scale: { x: 0.98, y: 0.98 }, ease: MOTION.exit }];
    [block.id, tab, ...(blockShade ? [blockShade] : []), ...(sheetOpen ? [sheet.id] : [])].forEach(id => play(id, out));
    setTimeout(() => Engine.quit(), MOTION.fast * 1000 + 30);
  };
  const launch = async () => {
    if (!ready || launching || closing || !model.current) return;
    launching = true; message = ''; render();
    if (rows[model.selected]) play(rows[model.selected].target, presets.bump());
    play(block.id, presets.bump());
    try { await Desktop.launch(model.current.id); close(); }
    catch (error) {
      launching = false; message = 'Could not open ' + model.current.name; Log.error('Launch: ' + error);
      play(block.id, presets.shake()); render();
    }
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
    if ([1, 65307].includes(code)) { close(); return; }
    if (launching) return;
    const listing = sheetOpen || wanted();
    // With the sheet folded away, Enter and the list keys open the full list.
    if (!listing && [28, 96, 65293, 108, 65364, 15, 65289, 109, 65366].includes(code)) { browsing = true; render(); return; }
    if ([28, 96, 65293].includes(code)) { launch(); return; }
    if ([14, 65288].includes(code)) { preedit = ''; model.erase(); render(); return; }
    if ([111, 65535].includes(code)) { preedit = ''; model.erase(true); render(); return; }
    if ([105, 65361].includes(code)) { model.moveCursor(-1); render(); return; }
    if ([106, 65363].includes(code)) { model.moveCursor(1); render(); return; }
    // ↑ past the first result of an unfiltered list folds the sheet again.
    if ([103, 65362].includes(code) && browsing && !model.query && model.selected === 0) { browsing = false; render(); return; }
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
    model.refresh(apps); ready = true;
    await setTab(apps.length + (apps.length === 1 ? ' application' : ' applications'), 'good');
    await render();
  };
  Desktop.start(Process.getEnv('KOYA_DESKTOP_ROOT', '.'), () => refresh().catch(error => Log.error('Applications: ' + error)));
  await render(); await refresh();
  globalThis.koyaLauncher = { window: win, model, filter, launch, render };
}
