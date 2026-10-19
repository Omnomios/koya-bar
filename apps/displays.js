import * as UI from './theme-ui.js';
import * as Log from 'Helix/Log';
import * as Desktop from 'Module/desktop';
import { session as Bus } from 'Module/dbus';
import { appFrame, glyph } from './app-frame.js';
import { connect, call } from './session.js';
import { text, label, icon, row, pill, toggle, children } from './touch-ui.js';
import { textInput } from './text-input.js';
import { presets } from './motion.js';
import { shadow } from './shadow.js';
import { controlCursor, dragCursor, resetCursor } from './cursor.js';
import { COLOUR_MODES, VRR_MODES, ADVANCED_NUMBERS, parseMode, layoutKey, layoutView,
  snapPosition, arrangeDisplays, validateLayout, logicalSize, validScales, nearestScale } from './displays-model.js';
import { AUTO, CLEAR, GUTTER, SPACE, TYPE, RADIUS, TEXT, SURFACE, BORDER, HIGHLIGHT, ELEVATION, FONT, FONT_STRONG, configureTheme } from './theme.js';

// One page for the whole setup: the arrangement (drag to place, click to
// select), then the selected display's header with how it is used, and a
// form of its common settings. Choices sit inline as segments, or open a
// dropdown over the page when there are too many; colour, HDR and the rest
// are a page away under Advanced. Nothing changes until Apply, which previews
// the setup and asks to keep it.
const CANVAS = 176, HEADER = 44, LINE = 44, FIELD = 32, ACTION = 32, LABEL_WIDTH = 132, MENU_ROW = 34, MENU_ROWS = 8;
const ROTATIONS = [[0, 'Normal'], [1, '90°'], [2, '180°'], [3, '270°']];
const COLOUR_NAMES = { auto: 'Automatic', srgb: 'sRGB', wide: 'Wide gamut', edid: 'Display colour space', hdr: 'HDR', hdredid: 'HDR · display colour space',
  dcip3: 'DCI-P3', dp3: 'Display P3', adobe: 'Adobe RGB' };
const TRANSFERS = [['default', 'Default'], ['auto', 'Automatic'], ['srgb', 'sRGB'], ['gamma22', 'Gamma 2.2'], ['gamma22force', 'Force Gamma 2.2']];
const VRR_SHORT = { '-1': 'Default', 0: 'Off', 1: 'On', 2: 'Fullscreen', 3: 'Games' };
const SUPPORT = [[0, 'Auto'], [1, 'On'], [-1, 'Off']];
const NUMBER_LABELS = { sdrbrightness: 'SDR brightness', sdrsaturation: 'SDR saturation', sdr_min_luminance: 'SDR black', sdr_max_luminance: 'SDR white',
  min_luminance: 'Black level', max_luminance: 'Peak', max_avg_luminance: 'Average' };
const INTEGERS = ['sdr_max_luminance', 'max_luminance', 'max_avg_luminance'];
const percent = scale => Number((scale * 100).toFixed(2)) + '%';
const hertz = (refresh, exact) => (exact ? refresh.toFixed(2) : Math.round(refresh)) + ' Hz';
const clone = value => JSON.parse(JSON.stringify(value));
const requestShell = (method, value) => call(method, value === undefined ? '' : 's', ...(value === undefined ? [] : [value])).then(JSON.parse);
const watchShell = ({ state, changed }) => {
  const signal = event => { if (event.interface === 'org.koya.Shell1' && event.member === 'DisplaysChanged') changed(); };
  const disconnect = connect('displays', state, () => {}, async () => { Bus.onSignal(signal); await changed(); });
  return () => { disconnect(); Bus.offSignal(signal); };
};

export async function displayApp({ request = requestShell, watch = watchShell } = {}) {
  await configureTheme(Desktop.loadPreferences());
  let latest, draft = [], selected, state, operation = false, disconnect, poll, countdown, route, dirty = false, menu;
  let refreshQueue = Promise.resolve();
  const advancedScroll = new Map();
  const pickers = new Map();
  const frame = await appFrame({ title: 'Displays', namespace: 'koya-displays', maxSize: { x: 640, y: 760 },
    hint: () => latest ? latest.pending ? '' : dirty ? 'Not applied' : '' : 'Reading displays…',
    onBack: () => go(route?.parent || null, -1),
    onClose: async () => {
      disconnect?.(); clearInterval(poll);
      if (operation || latest?.pending) await request('RevertDisplays', latest?.pending?.token || '');
    } });
  const { win, kit } = frame;
  const enabled = () => state?.Active && state.ScreenState === 'unlocked';
  const locked = () => operation || !!latest?.pending || !enabled();
  const current = () => draft.find(c => c.name === selected) || draft[0];
  const monitor = config => latest.monitors.find(m => m.name === config.name);
  const error = value => { Log.error('Displays: ' + value); frame.flash(String(value.message || value), TEXT.accent, 6000); };
  const titleFor = config => monitor(config)?.description || config.name;
  const numberOf = config => draft.indexOf(config) + 1;
  const markDirty = () => { dirty = JSON.stringify(draft) !== JSON.stringify(latest.configs); frame.refreshHint(); };
  const builder = () => route?.kind === 'edit' ? edit : route?.kind === 'advanced' ? advanced : latest?.pending ? confirmation : overview;
  const go = (next = null, direction = 0) => {
    route = next;
    return frame.go(async () => { await closeMenu(); return builder()(); }, { title: next?.title || 'Displays', back: !!next, direction });
  };
  // Retain the form for value changes. Only a different form shape needs
  // replacement (for example, changing a display from Extend to Mirror).
  const redraw = () => frame.enqueue(async () => {
    await closeMenu();
    if (await frame.current?.refreshControls?.()) return;
    await frame.show(builder(), { title: route?.title || 'Displays', back: !!route, animate: false });
  });
  const set = values => {
    if (locked()) return;
    const next = { ...current(), ...values };
    if (Object.hasOwn(values, 'mode')) next.scale = nearestScale(next, monitor(next));
    const adjusted = Object.hasOwn(values, 'mode') && next.scale !== current().scale;
    Object.assign(current(), next); markDirty();
    redraw().then(() => { if (adjusted) frame.flash('Scale adjusted to ' + percent(next.scale) + ' for this resolution', TEXT.accent, 4000); });
  };
  const change = (key, value) => { if (locked()) return; current()[key] = value; markDirty(); go(route?.parent || null, -1); };
  const editValue = (title, key, options = {}) => go({ kind: 'edit', title, key, ...options, parent: route }, 1);

  // ---- Controls ------------------------------------------------------------
  // Segments in a track; the chosen one is filled. [value, caption, disabled].
  const segmented = async (options, chosen, onChoose, width, id, binding) => {
    const selected = () => binding ? binding.read() : chosen;
    const track = await UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.control, cornerRadius: RADIUS.control, cornerResolution: 16 },
      layout: { type: 'row', gap: 2, padding: { t: 2, r: 2, b: 2, l: 2 } }, item: { size: { x: width, y: FIELD } }, contentAlign: 'fill' });
    const each = (width - 4 - 2 * (options.length - 1)) / options.length;
    const paints = [];
    const ids = await children(win, track, options.map(async ([value, caption, disabled]) => {
      const on = value === selected();
      let target, label, hovered = false;
      const pointer = controlCursor(win, () => value === selected() || disabled ? 'default' : 'pointer');
      const colour = () => value === selected() ? SURFACE.accent : hovered && !disabled ? HIGHLIGHT.hover : CLEAR;
      target = await pill(win, null, caption, each, () => { if (value !== selected() && !disabled) onChoose(value); }, { height: FIELD - 4, size: TYPE.caption + 1,
        colour: on ? SURFACE.accent : CLEAR, hover: on || disabled ? CLEAR : HIGHLIGHT.hover, cursor: on || disabled ? 'default' : 'pointer',
        labelColour: on ? TEXT.onAccent : disabled ? TEXT.disabled : TEXT.primary, onLabel: value => { label = value; },
        ...(binding ? { element: { onHover: event => {
          pointer(event); if (event.source === 'touch') return;
          hovered = event.phase !== 'leave'; UI.setBoxColour(win, target, colour()).catch(error);
        } } } : {}) });
      paints.push(() => Promise.all([UI.setBoxColour(win, target, colour()),
        UI.setTextColour(win, label, value === selected() ? TEXT.onAccent : disabled ? TEXT.disabled : TEXT.primary)]));
      return target;
    }));
    binding?.updates.push(() => Promise.all(paints.map(paint => paint())));
    if (id) await Promise.all([UI.setElementId(win, track, 'displays-' + id), ...ids.map((item, index) => UI.setElementId(win, item, 'displays-' + id + '-' + index))]);
    return track;
  };
  // A field showing the choice; it opens a dropdown of the options.
  const picker = async (options, chosen, onChoose, width, id, fallback = '', binding) => {
    const selected = () => binding ? binding.read() : chosen;
    const caption = options.find(([value]) => value === chosen)?.[1] || fallback;
    const open = () => openMenu(target, options, selected(), onChoose);
    const target = await row(win, null, width, FIELD, open,
      { colour: SURFACE.control, hover: SURFACE.controlHover, gap: SPACE.s, right: SPACE.s, radius: RADIUS.control });
    const [words] = await children(win, target, [text(win, null, caption, TYPE.detail, width - 12 - SPACE.s * 2 - 16, FIELD, TEXT.primary, FONT, 'left'),
      icon(win, null, glyph('expand'), 14, 16, FIELD)]);
    binding?.updates.push(() => UI.setTextString(win, words, options.find(([value]) => value === selected())?.[1] || fallback));
    if (id) { pickers.set(id, open); await UI.setElementId(win, target, 'displays-' + id); }
    return target;
  };
  // A field showing a typed value; it opens the editor.
  const valueField = async (caption, width, handler, id) => {
    const target = await row(win, null, width, FIELD, handler, { colour: SURFACE.control, hover: SURFACE.controlHover, gap: SPACE.s, right: SPACE.s, radius: RADIUS.control });
    await children(win, target, [text(win, null, caption, TYPE.detail, width - 12 - SPACE.s * 2 - 16, FIELD, TEXT.primary, FONT, 'left'),
      icon(win, null, glyph('next'), 12, 16, FIELD)]);
    if (id) await UI.setElementId(win, target, 'displays-' + id);
    return target;
  };
  const closeMenu = async () => {
    const open = menu; menu = undefined;
    if (open) await Promise.all([open.catcher, open.shade, open.panel].filter(Boolean).map(id => UI.destroyElement(win, id))).catch(() => {});
  };
  // The dropdown floats over the page beneath its field (above it when the
  // panel has no room below); a click anywhere else closes it.
  const openMenu = async (anchor, options, chosen, onChoose) => {
    if (locked()) return;
    await closeMenu();
    const [base, at] = await Promise.all([UI.getElementFrame(win, frame.root), UI.getElementFrame(win, anchor)]);
    const width = Math.max(at.max.x - at.min.x, 180), height = Math.min(options.length, MENU_ROWS) * MENU_ROW + SPACE.xs * 2;
    const below = base.max.y - at.max.y - SPACE.s >= height + 4;
    const position = { x: Math.round(at.min.x - base.min.x),
      y: Math.round(below ? at.max.y - base.min.y + 4 : Math.max(SPACE.s, at.min.y - base.min.y - 4 - height)) };
    const origin = { x: 0.5, y: below ? 0 : 1 };
    const [catcher, panel, area] = await Promise.all([
      UI.createElement(win, { layout: { type: 'none' }, item: { size: AUTO }, onActivate: () => { closeMenu(); } }),
      // Opaque, unlike the translucent popover surface: it sits over the page, not the desktop.
      UI.createElement(win, { id: 'displays-menu', renderable: { type: 'box', colour: SURFACE.background, cornerRadius: RADIUS.surface, cornerResolution: 16,
          // It grows out of the edge nearest its field.
          origin },
        layout: { type: 'none' }, item: { size: { x: width, y: height } }, contentAlign: 'fill' }),
      kit.scrollArea({ width: width - SPACE.xs * 2, height: height - SPACE.xs * 2 })
    ]);
    const inner = width - SPACE.xs * 2;
    for (const [value, caption, disabled] of options) {
      const on = value === chosen;
      const item = await row(win, area.content, inner, MENU_ROW, () => { if (disabled) return; closeMenu(); if (!on) onChoose(value); },
        { colour: CLEAR, gap: SPACE.s, right: SPACE.s, radius: RADIUS.control, cursor: disabled ? 'default' : 'pointer' });
      await children(win, item, [text(win, null, caption, TYPE.detail, inner - 12 - SPACE.s * 2 - 10, MENU_ROW, disabled ? TEXT.disabled : TEXT.primary, on ? FONT_STRONG : FONT, 'left'),
        UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 8, y: 8 } }, resolution: 16, colour: on ? SURFACE.accent : CLEAR },
          item: { size: { x: 10, y: MENU_ROW } }, contentAlign: { x: 'center', y: 'center' } })]);
    }
    await area.setContentHeight(options.length * MENU_ROW);
    const [edge, content] = await Promise.all([
      UI.createElement(win, { renderable: { type: 'box', colour: BORDER.surface, inset: 1, cornerRadius: RADIUS.surface, cornerResolution: 16 }, item: { size: AUTO }, contentAlign: 'fill' }),
      UI.createElement(win, { layout: { type: 'column', padding: { t: SPACE.xs, r: SPACE.xs, b: SPACE.xs, l: SPACE.xs } }, item: { size: AUTO } })
    ]);
    await Promise.all([UI.attach(win, panel, edge), UI.setHitTarget(win, edge, false), UI.attach(win, panel, content)]);
    await UI.attach(win, content, area.id);
    await UI.attach(win, frame.root, catcher);
    const shade = await shadow(win, frame.root, { x: width, y: height }, position, ELEVATION.popover.shadow, RADIUS.surface, origin);
    await Promise.all([UI.attach(win, frame.root, panel), UI.setLayoutPosition(win, panel, position)]);
    const index = options.findIndex(([value]) => value === chosen);
    if (index >= 0) await area.reveal(index * MENU_ROW, (index + 1) * MENU_ROW);
    menu = { catcher, shade, panel };
    frame.play(panel, presets.dropIn());
    if (shade) frame.play(shade, presets.dropIn());
  };
  // A labelled line of a form card. Siblings lay out in creation order, so the
  // control is built (by `build(width)`) after its label.
  const formLine = async (card, inner, caption, build, width) => {
    const line = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center', padding: { l: SPACE.m, r: SPACE.m, t: 0, b: 0 } },
      item: { size: { x: inner, y: LINE } } });
    await text(win, line, caption, TYPE.body, LABEL_WIDTH, LINE, TEXT.primary, FONT, 'left');
    await UI.attach(win, line, await build(width));
    await UI.attach(win, card, line);
    return line;
  };
  const formCard = async (count, width) => {
    const height = count * LINE + SPACE.xs * 2;
    const card = await kit.surface('inset', { size: { x: width, y: height }, padding: { t: SPACE.xs, r: SPACE.xs, b: SPACE.xs, l: SPACE.xs } });
    return { ...card, height, inner: width - SPACE.xs * 2, control: width - SPACE.xs * 2 - SPACE.m * 2 - LABEL_WIDTH };
  };

  // ---- Pages ---------------------------------------------------------------
  async function edit() {
    const page = await frame.newPage(SPACE.m), options = route, inputs = [];
    const key = options.key;
    let raw = String(current()[key] ?? options.fallback ?? ''), validation;
    await label(win, page.el, options.detail || (key === 'icc' ? 'Absolute path to an ICC colour profile. Leave empty to use no profile.' : ''), TYPE.body, frame.width, 48, TEXT.secondary);
    const input = await textInput(win, { id: 'displays-value', width: frame.width, value: raw, maxLength: key === 'icc' ? 4096 : 24,
      onInput: value => { raw = value; }, onSubmit: () => saveValue() });
    inputs.push(input); await UI.attach(win, page.el, input.master.id);
    validation = await label(win, page.el, '', TYPE.caption, frame.width, 24, TEXT.accent);
    const saveValue = async () => {
      const value = key === 'icc' ? raw.trim() : Number(raw.trim());
      if (key !== 'icc' && (!raw.trim() || !Number.isFinite(value) || value < options.min || value > options.max || options.integer && !Number.isInteger(value))) {
        await UI.setTextString(win, validation, 'Enter ' + (options.integer ? 'a whole number' : 'a number') + ' between ' + options.min + ' and ' + options.max);
        frame.shake(input.master.id); return;
      }
      change(key, value);
    };
    await pill(win, page.el, 'Done', frame.width, saveValue, { height: ACTION, size: TYPE.detail, colour: SURFACE.accent, labelColour: TEXT.onAccent });
    page.height = 48 + 44 + 24 + ACTION + SPACE.m * 3 + SPACE.xs + GUTTER;
    page.dispose = () => Promise.all(inputs.map(input => input.destroy()));
    page.reveal = () => input.focus();
    return page;
  }

  async function overview() {
    const page = await frame.newPage(SPACE.m), width = frame.width;
    if (!latest || !draft.length) {
      const empty = await kit.emptyState({ glyph: glyph('koya-displays'), message: latest ? 'No displays connected' : 'Reading displays…', width });
      await UI.attach(win, page.el, empty.id);
      page.height = empty.height + SPACE.xs + GUTTER; return page;
    }
    const c = current(); selected = c.name;
    const updates = [], tiles = new Map();
    let cardUpdates = [], settingsCard;
    const bind = read => ({ read, updates: cardUpdates });
    const shapeOf = () => JSON.stringify([route?.kind, current().name, draft.map(config => [config.name, config.enabled, !!config.mirror])]);
    const shape = shapeOf();
    const cardShapeOf = () => JSON.stringify(c.enabled && !c.mirror ? [parseMode(c.mode)?.width, parseMode(c.mode)?.height, validScales(c, monitor(c))] : null);
    let cardShape = cardShapeOf();
    const arranged = draft.filter(config => config.enabled && !config.mirror), aside = draft.filter(config => !config.enabled || config.mirror);
    page.dispose = () => resetCursor(win);

    // The arrangement. Tiles keep a hairline apart, so neighbours read as two.
    const canvas = await UI.createElement(win, { id: 'displays-layout', renderable: { type: 'box', colour: SURFACE.fieldInset, cornerRadius: RADIUS.surface, cornerResolution: 16 },
      layout: { type: 'none' }, item: { size: { x: width, y: CANVAS } }, contentAlign: 'fill', clipToBounds: true });
    await Promise.all([UI.attach(win, page.el, canvas), UI.setLayoutOrder(win, canvas, 0)]);
    let view = layoutView(draft, latest.monitors, width, CANVAS - (aside.length ? 28 : 0), 24);
    for (const rect of view.rectangles) {
      const config = draft.find(item => item.name === rect.name), chosen = rect.name === selected;
      let owner, origin, pointer;
      const cursor = dragCursor(win, 'move');
      const tile = await UI.createElement(win, { id: 'displays-monitor-' + rect.name,
        renderable: { type: 'box', colour: chosen ? SURFACE.accent : SURFACE.control, cornerRadius: RADIUS.control, cornerResolution: 16 },
        layout: { type: 'column', justifyContent: 'center', alignItems: 'center' }, item: { size: { x: rect.w - 2, y: rect.h - 2 } },
        contentAlign: 'fill', clipToBounds: true, onHover: controlCursor(win, arranged.length > 1 ? 'move' : 'pointer'),
        onActivate: () => { if (!locked() && !chosen) { selected = rect.name; redraw(); } },
        onDrag: event => {
          if (locked() || !page.alive || arranged.length < 2) return;
          if (event.phase === 'start' && owner === undefined) { owner = event.interactionId; origin = { x: config.x, y: config.y }; pointer = { ...event.canvas }; }
          if (owner !== event.interactionId) return;
          cursor(event);
          if (event.phase === 'change' || event.phase === 'end') {
            Object.assign(config, snapPosition(config, { x: origin.x + (event.canvas.x - pointer.x) / view.scale,
              y: origin.y + (event.canvas.y - pointer.y) / view.scale }, draft, latest.monitors, 12 / view.scale));
            UI.setLayoutPosition(win, tile, { x: view.ox + config.x * view.scale + 1, y: view.oy + config.y * view.scale + 1 }).catch(error);
          }
          if (event.phase === 'end' || event.phase === 'cancel') {
            owner = undefined; if (event.phase === 'cancel') Object.assign(config, origin);
            selected = rect.name; markDirty(); redraw();
          }
        } });
      const colour = chosen ? TEXT.onAccent : TEXT.primary, small = rect.h < 64;
      const ids = await children(win, tile, [text(win, null, String(numberOf(config)), small ? 18 : 26, rect.w - 2, small ? 24 : 34, colour, FONT_STRONG),
        text(win, null, rect.name, TYPE.caption, rect.w - 2, 18, colour)]);
      await Promise.all([UI.attach(win, canvas, tile), UI.setLayoutPosition(win, tile, { x: rect.left + 1, y: rect.top + 1 }),
        UI.setEnabled(win, ids[1], !small), ...ids.map(id => UI.setHitTarget(win, id, false))]);
      tiles.set(rect.name, { tile, ids });
    }
    // Displays outside the arrangement (off, or showing another) wait along
    // the bottom; clicking one selects it.
    if (aside.length) {
      const strip = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.xs }, item: { size: { x: width - SPACE.s * 2, y: 24 } } });
      for (const config of aside) {
        const chosen = config.name === selected, caption = numberOf(config) + ' · ' + config.name + (config.enabled ? ' · Mirror' : ' · Off');
        const chip = await pill(win, strip, caption, caption.length * 6.5 + 20, () => { if (!locked() && !chosen) { selected = config.name; redraw(); } },
          { height: 24, size: TYPE.caption, colour: chosen ? SURFACE.accent : SURFACE.control, labelColour: chosen ? TEXT.onAccent : TEXT.secondary });
        await UI.setElementId(win, chip, 'displays-aside-' + config.name);
      }
      await Promise.all([UI.attach(win, canvas, strip), UI.setLayoutPosition(win, strip, { x: SPACE.s, y: CANVAS - 24 - SPACE.s })]);
    }
    if (arranged.length > 1) {
      const align = await pill(win, canvas, 'Arrange', 76, () => { if (!locked()) {
        arrangeDisplays(draft, latest.monitors).forEach(config => Object.assign(draft.find(item => item.name === config.name), config)); markDirty(); redraw();
      } },
        { height: 24, size: TYPE.caption, colour: SURFACE.control, labelColour: TEXT.accent });
      await Promise.all([UI.setLayoutPosition(win, align, { x: width - 76 - SPACE.s, y: SPACE.s }), UI.setElementId(win, align, 'displays-arrange')]);
    }

    // The selected display, and how it is used.
    const targets = arranged.filter(config => config.name !== c.name);
    const mode = !c.enabled ? 'off' : c.mirror ? 'mirror' : 'extend';
    const subtitle = () => {
      if (!c.enabled) return c.name + ' · Off';
      if (c.mirror) { const target = draft.find(o => o.name === c.mirror); return c.name + ' · Showing ' + numberOf(target) + ' ' + titleFor(target); }
      const size = logicalSize(c, monitor(c)); return c.name + ' · ' + size.width + ' × ' + size.height;
    };
    const header = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: { x: width, y: HEADER } } });
    const modeWidth = 228, words = await UI.createElement(win, { layout: { type: 'column', justifyContent: 'center' }, item: { size: { x: width - modeWidth - SPACE.m, y: HEADER } } });
    const [, detail] = await children(win, words, [text(win, null, numberOf(c) + '  ' + titleFor(c), TYPE.heading, width - modeWidth - SPACE.m, 24, TEXT.primary, FONT_STRONG, 'left'),
      text(win, null, subtitle(), TYPE.caption, width - modeWidth - SPACE.m, 18, TEXT.secondary, FONT, 'left')]);
    updates.push(() => UI.setTextString(win, detail, subtitle()));
    const right = Math.max(0, ...arranged.filter(o => o.name !== c.name).map(o => o.x + logicalSize(o, monitor(o)).width));
    const modes = await segmented([['extend', 'Extend'], ['mirror', 'Mirror', !targets.length], ['off', 'Off', mode !== 'off' && arranged.length === 1 && !c.mirror]], mode, value => {
      if (value === 'extend') set({ enabled: true, mirror: '', ...(mode === 'extend' ? {} : { x: right, y: 0 }) });
      else if (value === 'mirror') set({ enabled: true, mirror: targets[0].name });
      else set({ enabled: false, mirror: '' });
    }, modeWidth, 'mode');
    await Promise.all([UI.attach(win, header, words), UI.attach(win, header, modes)]);
    await Promise.all([UI.attach(win, page.el, header), UI.setLayoutOrder(win, header, 1)]);
    page.items = [header];

    // Its settings.
    let cardHeight = 0;
    const buildSettings = async () => {
      if (mode === 'mirror' && targets.length > 1) {
        const card = await formCard(1, width);
        await formLine(card.content, card.inner, 'Showing', width => picker(targets.map(o => [o.name, numberOf(o) + ' · ' + titleFor(o)]), c.mirror, value => set({ mirror: value }), width, 'mirror', '', bind(() => c.mirror)), card.control);
        await Promise.all([UI.attach(win, page.el, card.id), UI.setLayoutOrder(win, card.id, 2)]);
        settingsCard = card; cardHeight = card.height; page.items.push(card.id);
      } else if (mode === 'extend') {
        const card = await formCard(5, width), modes = (monitor(c).availableModes || []).map(parseMode).filter(Boolean);
        const active = parseMode(c.mode) || modes[0];
        const resolutions = [...new Set(modes.map(m => m.width + 'x' + m.height))].map(key => modes.find(m => m.width + 'x' + m.height === key));
        await formLine(card.content, card.inner, 'Resolution', width => picker(resolutions.map(m => [m.width + 'x' + m.height, m.width + ' × ' + m.height]),
          active && active.width + 'x' + active.height, value => {
            const same = modes.filter(m => m.width + 'x' + m.height === value);
            const next = same.find(m => Math.abs(m.refresh - (parseMode(c.mode)?.refresh || 60)) < 0.1) || same.reduce((a, b) => b.refresh > a.refresh ? b : a);
            set({ mode: value + '@' + next.refresh });
          }, width, 'resolution', 'Preferred'), card.control);
        const rates = modes.filter(m => active && m.width === active.width && m.height === active.height);
        const exact = new Set(rates.map(m => Math.round(m.refresh))).size !== rates.length;
        const rateOptions = rates.map(m => [m.width + 'x' + m.height + '@' + m.refresh, hertz(m.refresh, exact)]);
        const chosenRate = active && rateOptions.find(([value]) => Math.abs(parseMode(value).refresh - active.refresh) < 0.1)?.[0];
        const rateBinding = bind(() => rateOptions.find(([value]) => Math.abs(parseMode(value).refresh - (parseMode(c.mode)?.refresh || active?.refresh)) < 0.1)?.[0]);
        await formLine(card.content, card.inner, 'Refresh rate', width => rateOptions.length <= 4
          ? segmented(rateOptions, chosenRate, value => set({ mode: value }), width, 'refresh', rateBinding)
          : picker(rateOptions, chosenRate, value => set({ mode: value }), width, 'refresh', '', rateBinding), card.control);
        const scales = validScales(c, monitor(c)), scaleOptions = scales.map(value => [value, percent(value)]);
        const chosenScale = scales.find(value => Math.abs(value - c.scale) < 0.00001);
        const scaleBinding = bind(() => scales.find(value => Math.abs(value - c.scale) < 0.00001));
        await formLine(card.content, card.inner, 'Scale', width => scales.length <= 5
          ? segmented(scaleOptions, chosenScale, value => set({ scale: value }), width, 'scale', scaleBinding)
          : picker(scaleOptions, chosenScale, value => set({ scale: value }), width, 'scale', percent(c.scale), scaleBinding), card.control);
        await formLine(card.content, card.inner, 'Rotation', width => segmented(ROTATIONS, c.transform % 4,
          value => set({ transform: value + (c.transform >= 4 ? 4 : 0) }), width, 'rotation', bind(() => c.transform % 4)), card.control);
        const more = await frame.navigate(null, 'Advanced', 'Colour, HDR and variable refresh', LINE, () => go({ kind: 'advanced', title: titleFor(c) }, 1),
          { width: card.inner, colour: CLEAR, radius: RADIUS.control });
        await Promise.all([UI.attach(win, card.content, more.target), UI.setElementId(win, more.target, 'displays-advanced')]);
        await Promise.all([UI.attach(win, page.el, card.id), UI.setLayoutOrder(win, card.id, 2)]);
        settingsCard = card; cardHeight = card.height; page.items.push(card.id);
      }
    };
    await buildSettings();

    // Apply previews the draft; Reset drops it.
    const footer = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: width, y: ACTION } } });
    let resetLabel, applyLabel;
    const [spacer, reset, apply_] = await Promise.all([
      UI.createElement(win, { item: { size: AUTO, flexGrow: 1 } }),
      pill(win, null, 'Reset', 96, () => { if (!locked() && dirty) {
        latest.configs.forEach(saved => { const config = draft.find(item => item.name === saved.name); Object.keys(config).forEach(key => { delete config[key]; }); Object.assign(config, clone(saved)); });
        dirty = false; frame.refreshHint(); redraw();
      } },
        { height: ACTION, size: TYPE.detail, colour: SURFACE.control, labelColour: dirty ? TEXT.primary : TEXT.disabled,
          cursor: () => dirty ? 'pointer' : 'default', onLabel: id => { resetLabel = id; } }),
      pill(win, null, 'Apply', 96, apply, { height: ACTION, size: TYPE.detail, colour: dirty ? SURFACE.accent : SURFACE.control,
        labelColour: dirty ? TEXT.onAccent : TEXT.disabled, cursor: () => dirty ? 'pointer' : 'default', onLabel: id => { applyLabel = id; } })
    ]);
    await Promise.all([UI.attach(win, footer, spacer), UI.attach(win, footer, reset), UI.attach(win, footer, apply_),
      UI.setElementId(win, reset, 'displays-reset'), UI.setElementId(win, apply_, 'displays-apply')]);
    await Promise.all([UI.attach(win, page.el, footer), UI.setLayoutOrder(win, footer, 3)]);
    page.height = CANVAS + HEADER + (cardHeight ? cardHeight + SPACE.m : 0) + ACTION + SPACE.m * 2 + SPACE.xs + GUTTER;
    page.refreshControls = async () => {
      if (current() !== c || shapeOf() !== shape) return false;
      const nextCardShape = cardShapeOf();
      if (nextCardShape !== cardShape) {
        if (settingsCard) { await UI.destroyElement(win, settingsCard.id); page.items = page.items.filter(id => id !== settingsCard.id); }
        cardUpdates = []; await buildSettings(); cardShape = nextCardShape;
      }
      view = layoutView(draft, latest.monitors, width, CANVAS - (aside.length ? 28 : 0), 24);
      await Promise.all([...updates.concat(cardUpdates).map(update => update()),
        UI.setBoxColour(win, apply_, dirty ? SURFACE.accent : SURFACE.control),
        UI.setTextColour(win, applyLabel, dirty ? TEXT.onAccent : TEXT.disabled), UI.setTextColour(win, resetLabel, dirty ? TEXT.primary : TEXT.disabled),
        ...view.rectangles.flatMap(rect => {
          const { tile, ids } = tiles.get(rect.name), small = rect.h < 64;
          return [UI.setLayoutPosition(win, tile, { x: rect.left + 1, y: rect.top + 1 }), UI.setLayoutSize(win, tile, { x: rect.w - 2, y: rect.h - 2 }),
            UI.setTextSize(win, ids[0], small ? 18 : 26), UI.setLayoutSize(win, ids[0], { x: rect.w - 2, y: small ? 24 : 34 }),
            UI.setLayoutSize(win, ids[1], { x: rect.w - 2, y: 18 }), UI.setEnabled(win, ids[1], !small)];
        })]);
      return true;
    };
    return page;
  }

  // Colour, HDR and the rarer controls, grouped in cards.
  async function advanced() {
    const page = await frame.newPage(), c = current();
    const updates = [], bind = read => ({ read, updates });
    const height = Math.max(80, frame.stageHeight - SPACE.xs - GUTTER);
    const area = await kit.scrollArea({ width: frame.width, height, gap: SPACE.s, id: 'displays-advanced-scroll' });
    await UI.attach(win, page.el, area.id);
    let total = 0;
    const group = async (caption, lines) => {
      const heading = await frame.section(area.content, caption);
      const card = await formCard(lines.length, frame.width);
      for (const [title, build] of lines) await formLine(card.content, card.inner, title, build, card.control);
      await UI.attach(win, area.content, card.id);
      page.items.push(heading.line, card.id);
      total += 32 + card.height + SPACE.s * 2;
    };
    // Typed values, two to a line: each a caption over its field.
    const grid = async (caption, cells) => {
      const heading = await frame.section(area.content, caption);
      const cell = 18 + SPACE.xs + FIELD, lines = Math.ceil(cells.length / 2), inner = frame.width - SPACE.m * 2, cellWidth = (inner - SPACE.m) / 2;
      const height = lines * cell + (lines - 1) * SPACE.m + SPACE.m * 2;
      const card = await kit.surface('inset', { size: { x: frame.width, y: height }, layout: { type: 'column', gap: SPACE.m },
        padding: { t: SPACE.m, r: SPACE.m, b: SPACE.m, l: SPACE.m } });
      for (let index = 0; index < cells.length; index += 2) {
        const line = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m }, item: { size: { x: inner, y: cell } } });
        for (const [title, build] of cells.slice(index, index + 2)) {
          const box = await UI.createElement(win, { layout: { type: 'column', gap: SPACE.xs }, item: { size: { x: cellWidth, y: cell } } });
          await text(win, box, title, TYPE.caption, cellWidth, 18, TEXT.secondary, FONT, 'left');
          await UI.attach(win, box, await build(cellWidth));
          await UI.attach(win, line, box);
        }
        await UI.attach(win, card.content, line);
      }
      await UI.attach(win, area.content, card.id);
      page.items.push(heading.line, card.id);
      total += 32 + height + SPACE.s * 2;
    };
    const number = key => {
      const [min, max, title, fallback] = ADVANCED_NUMBERS[key], luminance = key.includes('luminance');
      const value = c[key] === undefined ? 'Default' : c[key] === -1 ? 'Display default' : c[key] + (luminance ? ' cd/m²' : '×');
      return [NUMBER_LABELS[key], width => valueField(value, width, () => editValue(title, key, { min, max, fallback, integer: INTEGERS.includes(key),
        detail: luminance ? 'Luminance in cd/m². Overrides accept −1 to use the display default.' : '1 is unchanged.' }), key)];
    };
    await group('Refresh', [
      ['Variable refresh', width => segmented(VRR_MODES.map(([value]) => [value, VRR_SHORT[value]]), c.vrr ?? -1, value => set({ vrr: value }), width, 'vrr', bind(() => c.vrr ?? -1))]
    ]);
    await group('Colour', [
      ['Colour depth', width => segmented([[8, '8-bit'], [10, '10-bit']], c.bitdepth, value => set({ bitdepth: value }), width, 'bitdepth', bind(() => c.bitdepth))],
      ['Colour space', width => picker(COLOUR_MODES.map(value => [value, COLOUR_NAMES[value]]), c.cm, value => set({ cm: value }), width, 'cm', 'Compositor default', bind(() => c.cm))],
      ['SDR transfer', width => picker(TRANSFERS, c.sdr_eotf, value => set({ sdr_eotf: value }), width, 'sdr_eotf', 'Compositor default', bind(() => c.sdr_eotf))],
      ['ICC profile', width => valueField(c.icc === '' ? 'None' : c.icc || 'Compositor default', width, () => editValue('ICC colour profile', 'icc'), 'icc')]
    ]);
    await group('HDR', [
      ['HDR support', width => segmented(SUPPORT, c.supports_hdr, value => set({ supports_hdr: value }), width, 'supports_hdr', bind(() => c.supports_hdr))],
      ['Wide gamut', width => segmented(SUPPORT, c.supports_wide_color, value => set({ supports_wide_color: value }), width, 'supports_wide_color', bind(() => c.supports_wide_color))]
    ]);
    await grid('Levels', Object.keys(ADVANCED_NUMBERS).map(number));
    const half = width => (width - SPACE.s) / 2;
    await group('Placement', [
      ['Mirror image', async () => {
        const slot = await UI.createElement(win, { layout: { type: 'row' }, item: { size: { x: 56, y: LINE } } });
        const flip = await toggle(win, slot, c.transform >= 4, () => set({ transform: (c.transform + 4) % 8 }));
        await UI.setElementId(win, flip.id, 'displays-flip');
        updates.push(() => flip.set(c.transform >= 4));
        return slot;
      }],
      ...(c.enabled && !c.mirror ? [['Position', async width => {
        const pair = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: width, y: FIELD } } });
        await children(win, pair, ['x', 'y'].map(key => valueField(key.toUpperCase() + '  ' + c[key], half(width), () => editValue('Position ' + key.toUpperCase(), key, {
          min: -100000, max: 100000, integer: true, detail: 'Logical pixels, after scaling and rotation.' }), 'position-' + key)));
        return pair;
      }]] : [])
    ]);
    await area.setContentHeight(total);
    await area.scrollTo(advancedScroll.get(c.name) || 0);
    page.refreshControls = async () => {
      if (route?.kind !== 'advanced' || current() !== c) return false;
      await Promise.all(updates.map(update => update())); return true;
    };
    page.dispose = async () => advancedScroll.set(c.name, Number((await UI.getScrollOffset(win, area.id))?.y || 0));
    page.height = frame.stageHeight;
    return page;
  }

  // The preview: keep it, or it reverts when the bar runs out.
  async function confirmation() {
    const page = await frame.newPage(SPACE.m), width = frame.width;
    await text(win, page.el, 'Keep this display setup?', TYPE.title, width, 32, TEXT.primary, FONT_STRONG, 'left');
    countdown = await text(win, page.el, '', TYPE.body, width, 20, TEXT.secondary, FONT, 'left');
    const track = await UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.track, cornerRadius: 2, cornerResolution: 8 },
      layout: { type: 'none' }, item: { size: { x: width, y: 4 } }, contentAlign: 'fill' });
    const fill = await UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.accent, cornerRadius: 2, cornerResolution: 8, origin: { x: 0, y: 0.5 } },
      item: { size: AUTO }, contentAlign: 'fill' });
    await Promise.all([UI.attach(win, track, fill), UI.attach(win, page.el, track), UI.setElementId(win, countdown, 'displays-countdown')]);
    const footer = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: width, y: ACTION } } });
    await UI.attach(win, page.el, footer);
    const ids = await children(win, footer, [
      UI.createElement(win, { item: { size: AUTO, flexGrow: 1 } }),
      pill(win, null, 'Revert', 112, () => finish(false), { height: ACTION, size: TYPE.detail }),
      pill(win, null, 'Keep', 112, () => finish(true), { height: ACTION, size: TYPE.detail, colour: SURFACE.accent, labelColour: TEXT.onAccent })]);
    await Promise.all([UI.setElementId(win, ids[1], 'displays-revert'), UI.setElementId(win, ids[2], 'displays-keep')]);
    page.bar = fill;
    page.dispose = () => { countdown = undefined; };
    page.height = 32 + 20 + 4 + ACTION + SPACE.m * 3 + SPACE.xs + GUTTER;
    page.items = [footer];
    tick(); return page;
  }
  let span;
  const tick = () => {
    if (!countdown || !latest?.pending) return;
    const left = Math.max(0, latest.pending.deadline - Date.now());
    span = Math.max(span || 0, left);
    UI.setTextString(win, countdown, 'Reverting in ' + Math.ceil(left / 1000) + ' s').catch(() => {});
    const page = frame.current;
    if (page?.bar && !page.draining) page.draining = frame.play(page.bar, [{ time: 0, scale: { x: left / span, y: 1 } }, { time: left / 1000, scale: { x: 0, y: 1 } }]);
  };
  const refresh = () => {
    refreshQueue = refreshQueue.then(async () => {
      if (frame.closing || operation) return;
      const value = await request('GetDisplays');
      const topology = latest && layoutKey(value.monitors) !== layoutKey(latest.monitors);
      const ended = latest?.pending && !value.pending;
      const changed = !latest || topology || ended || !!value.pending !== !!latest.pending;
      latest = value;
      if (!value.pending) span = 0;
      if (!dirty || topology || ended) { draft = clone(value.configs); dirty = false; }
      if (!draft.some(c => c.name === selected)) selected = draft[0]?.name;
      if (changed) { route = null; await go(); if (topology) frame.flash('Connected displays changed', TEXT.accent, 5000); }
      tick();
    }).catch(error); return refreshQueue;
  };
  const apply = async () => {
    if (locked() || !dirty) return;
    try {
      validateLayout(draft, latest.monitors); operation = true;
      await frame.setStatus('Applying…');
      latest = await request('ApplyDisplays', JSON.stringify(draft)); route = null; await go();
    } catch (failure) { error(failure); }
    finally { operation = false; await refresh(); }
  };
  const finish = async keep => {
    if (operation || !latest?.pending || !enabled()) return;
    operation = true;
    try {
      await frame.setStatus(keep ? 'Saving…' : 'Restoring…');
      latest = await request(keep ? 'ConfirmDisplays' : 'RevertDisplays', latest.pending.token);
      draft = clone(latest.configs); dirty = false; route = null; await go();
      frame.flash(keep ? 'Display setup saved' : 'Previous setup restored', TEXT.accent);
    } catch (failure) { error(failure); }
    finally { operation = false; await refresh(); }
  };
  // For preview harnesses: select a display, open a page or a dropdown.
  globalThis.koyaDisplays = { select: name => { selected = name; route = null; return redraw(); },
    go: kind => go(kind ? { kind, title: titleFor(current()) } : null, kind ? 1 : -1), menu: id => frame.enqueue(() => pickers.get(id)?.()) };
  await go();
  disconnect = watch({ state: async value => { state = value; await frame.setDim(!enabled()); }, changed: refresh });
  poll = setInterval(() => { if (latest?.pending) refresh(); }, 1000);
  return frame;
}
export default () => displayApp();
