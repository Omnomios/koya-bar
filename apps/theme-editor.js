import * as UI from './theme-ui.js';
import { button, pill, text } from './touch-ui.js';
import { textInput } from './text-input.js';
import { colourPicker } from './colour-picker.js';
import { presets } from './motion.js';
import { themeDraft, themeGroups, colourName, colourHex } from './theme-editor-model.js';
import { TEXT, SURFACE, BORDER, SPACE, GUTTER, TYPE, RADIUS, LIST_ROW_HEIGHT, FONT, FONT_STRONG, AUTO } from './theme.js';

// A draft is private to Settings. Only Save writes the Skin preference and
// broadcasts a repaint, so experimenting cannot make the editor unreadable.
//
// Every page shows the draft on a small desktop (a bar over a card) and ends
// in a footer: the draft's state on the left, the page's actions on the right.
const PREVIEW_HEIGHT = 94, FOOTER_HEIGHT = 36, ACTION_WIDTH = 96, HEADER = 28;
const PALETTE = ['background', 'foreground', 'accent', 'good', 'warn', 'off'];
const SWATCH_HEIGHT = 40, SWATCH_LABEL = 18, CHIP = { x: 10, y: 24 }, CHIPS = 6;
const shortHex = value => colourHex(value).slice(0, value[3] === 1 ? 7 : 9);
// Validation messages name roles by path; the footer names them as people do.
const textRole = { primary: 'Text', secondary: 'Secondary text', onAccent: 'Accent text', disabled: 'Disabled text' };
const problem = message => {
  const contrast = /contrast: text\.(\w+) on surface\.(\w+)/.exec(message);
  if (contrast) return 'Low contrast · ' + (textRole[contrast[1]] || colourName(contrast[1])) + ' on ' + colourName(contrast[2]).toLowerCase();
  return /skin name/i.test(message) ? 'Name needed' : message;
};

export function themeEditor(frame, { value, save, exit }) {
  const draft = themeDraft(value), win = frame.win;
  let busy = false;
  const overview = { kind: 'overview' };
  const navigate = (route, direction = 1) => frame.go(() => build(route), {
    title: route.kind === 'overview' ? 'Theme' : route.kind === 'group' ? themeGroups[route.group] : colourName(route.path.split('.')[1]),
    back: true, direction
  });
  const back = () => {
    const route = frame.current?.themeRoute;
    if (!route || route.kind === 'overview') return exit();
    return navigate(route.kind === 'colour' && route.group ? { kind: 'group', group: route.group } : overview, -1);
  };
  const update = () => frame.current?.themeRoute && frame.current.update();
  let saved;
  const persist = async () => {
    if (busy || draft.error || !draft.dirty) return;
    const value = draft.value;
    busy = true; saved?.begin(); await update();
    try { if (await save(value)) { draft.receive(value); frame.current?.applied?.(); } }
    finally { busy = false; saved?.end(); await update(); }
  };

  // Painted from the draft, not the theme bindings, so it shows unsaved
  // colours. Layout places everything; each part states its size.
  async function preview(width) {
    const paints = [];
    const paint = (id, role, kind = 'box') => {
      const [group, key] = role.split('.');
      const apply = () => kind === 'text' ? UI.setTextColour(win, id, draft.preview[group][key])
        : kind === 'circle' ? UI.setCircleColour(win, id, draft.preview[group][key]) : UI.setBoxColour(win, id, draft.preview[group][key]);
      paints.push(apply);
      return id;
    };
    const el = async (role, options, radius = RADIUS.control) => paint(await UI.createElement(win, {
      renderable: { type: 'box', colour: [0, 0, 0, 0], cornerRadius: radius, cornerResolution: 16, ...(options.inset ? { inset: options.inset } : {}) },
      contentAlign: 'fill', ...options.element, item: { size: options.size, ...(options.item || {}) }
    }), role);
    const words = async (role, value, w, h, justify = 'left', font = FONT) => paint(await text(win, null, value, TYPE.caption, w, h, [0, 0, 0, 0], font, justify), role, 'text');
    // A surface with its hairline edge: a 'none' container both fill.
    const framed = async (fillRole, edgeRole, size, layout, radius) => {
      const outer = await el(fillRole, { size, element: { layout: { type: 'none' } } }, radius);
      const [edge, content] = await Promise.all([el(edgeRole, { size: AUTO, inset: 1 }, radius),
        UI.createElement(win, { layout, item: { size: AUTO } })]);
      await Promise.all([UI.attach(win, outer, edge), UI.attach(win, outer, content)]);
      return { id: outer, content };
    };
    const inner = width - SPACE.s * 2, cardHeight = PREVIEW_HEIGHT - SPACE.s * 3 - 22;
    const screen = await framed('surface.background', 'border.preview', { x: width, y: PREVIEW_HEIGHT },
      { type: 'column', gap: SPACE.s, padding: { l: SPACE.s, r: SPACE.s, t: SPACE.s, b: SPACE.s } }, RADIUS.surface);
    // The bar: a workspace pill, the title, status dots and the time.
    const bar = await el('surface.overlay', { size: { x: inner, y: 22 },
      element: { layout: { type: 'row', alignItems: 'center', gap: 6, padding: { l: 6, r: 8, t: 0, b: 0 } } } });
    const barParts = await Promise.all([
      el('surface.accent', { size: { x: 18, y: 12 } }, 6),
      words('text.primary', 'Desktop', 120, 22, 'left', FONT_STRONG),
      UI.createElement(win, { item: { size: { x: 'auto', y: 22 }, flexGrow: 1 } }),
      ...['good', 'warn', 'off'].map(key => el('health.' + key, { size: { x: 8, y: 8 } }, 4)),
      words('text.secondary', '12:34', 36, 22, 'right')
    ]);
    // The card: a focused field, the selected action, a hovered control.
    const pillWidth = 68, fieldWidth = inner - SPACE.s * 2 - pillWidth * 2 - 1 - SPACE.s * 3;
    const card = await framed('surface.card', 'border.surface', { x: inner, y: cardHeight },
      { type: 'row', alignItems: 'center', gap: SPACE.s, padding: { l: SPACE.s, r: SPACE.s, t: (cardHeight - 30) / 2, b: 0 } }, RADIUS.surface);
    // A control: its fill, an optional layer over it (a focus ring, the
    // hover tint) and a label inset by margins.
    const box = async (role, w, [layerRole, inset], [labelRole, value]) => {
      const outer = await el(role, { size: { x: w, y: 30 }, element: { layout: { type: 'none' } } });
      const parts = await Promise.all([
        ...(layerRole ? [el(layerRole, { size: AUTO, inset })] : []),
        words(labelRole, value, 'auto', 'auto', layerRole === 'border.focus' ? 'left' : 'center')
      ]);
      await Promise.all([...parts.map(id => UI.attach(win, outer, id)), UI.setMargin(win, parts.at(-1), { t: 0, r: 8, b: 0, l: 8 })]);
      return outer;
    };
    const cardParts = await Promise.all([
      box('surface.field', fieldWidth, ['border.focus', 1], ['text.secondary', 'Search']),
      box('surface.accent', pillWidth, [], ['text.onAccent', 'Selected']),
      box('surface.control', pillWidth, ['highlight.hover', 0], ['text.primary', 'Hover']),
      el('border.divider', { size: { x: 1, y: 22 } }, 0)
    ]);
    await Promise.all([UI.attach(win, screen.content, bar), UI.attach(win, screen.content, card.id),
      ...barParts.map(id => UI.attach(win, bar, id)), ...cardParts.map(id => UI.attach(win, card.content, id)),
      UI.setElementId(win, screen.id, 'theme-preview'), UI.setHitTarget(win, screen.id, false)]);
    const repaint = () => Promise.all(paints.map(apply => apply()));
    await repaint();
    return { id: screen.id, repaint };
  }

  // A colour sample with a faint edge, so dark or clear colours stay visible.
  const swatch = async (colour, size) => {
    const [fill, edge] = await Promise.all([
      UI.createElement(win, { renderable: { type: 'box', colour, cornerRadius: RADIUS.control, cornerResolution: 16, origin: { x: 0.5, y: 0.5 } },
        layout: { type: 'none' }, item: { size }, contentAlign: 'fill' }),
      UI.createElement(win, { renderable: { type: 'box', colour: BORDER.preview, inset: 1, cornerRadius: RADIUS.control, cornerResolution: 16 },
        item: { size: AUTO }, contentAlign: 'fill' })
    ]);
    await Promise.all([UI.attach(win, fill, edge), UI.setHitTarget(win, fill, false), UI.setHitTarget(win, edge, false)]);
    return fill;
  };

  async function build(route = overview) {
    const page = await frame.newPage(); page.themeRoute = route; page.hint = '';
    const disposals = [], swatches = [], counts = [];
    const shown = await preview(frame.width);
    const areaHeight = frame.stageHeight - GUTTER - SPACE.xs - PREVIEW_HEIGHT - FOOTER_HEIGHT - SPACE.s * 2;
    const [area, footer] = await Promise.all([
      frame.kit.scrollArea({ width: frame.width, height: Math.max(40, areaHeight), gap: SPACE.s, id: 'theme-controls' }),
      UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: frame.width, y: FOOTER_HEIGHT } } })
    ]);
    await Promise.all([UI.attach(win, page.el, shown.id), UI.attach(win, page.el, area.id), UI.attach(win, page.el, footer)]);
    let height = 0;
    const add = async (id, size) => { await UI.attach(win, area.content, id); height += size + SPACE.s; page.items.push(id); };
    const header = async (caption, action) => {
      const built = await frame.kit.sectionHeader({ caption, action });
      await add(built.id, built.height); return built;
    };

    // The palette: six tiles in a row, each a swatch over its name.
    const paletteGrid = async () => {
      const tileWidth = (frame.width - SPACE.s * (PALETTE.length - 1)) / PALETTE.length;
      const line = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: frame.width, y: SWATCH_HEIGHT + SPACE.xs + SWATCH_LABEL } } });
      await Promise.all(PALETTE.map(async key => {
        const path = 'palette.' + key;
        const target = await button(win, null, '', tileWidth, SWATCH_HEIGHT + SPACE.xs + SWATCH_LABEL, () => navigate({ kind: 'colour', path }),
          { gap: SPACE.xs, pressScale: 0.94 });
        const [sample, name] = await Promise.all([swatch(draft.read(path), { x: tileWidth, y: SWATCH_HEIGHT }),
          text(win, null, colourName(key), TYPE.caption, tileWidth, SWATCH_LABEL, TEXT.secondary)]);
        await Promise.all([UI.attach(win, target, sample), UI.attach(win, target, name), UI.setElementId(win, target, 'theme-' + path)]);
        swatches.push({ path, id: sample, colour: shortHex(draft.read(path)) });
        return target;
      })).then(targets => Promise.all(targets.map(id => UI.attach(win, line, id))));
      await add(line, SWATCH_HEIGHT + SPACE.xs + SWATCH_LABEL);
    };
    // Chips of a group's first colours, as a group row's leading picture.
    const chips = async group => {
      const strip = await UI.createElement(win, { layout: { type: 'row', gap: 2 }, item: { size: { x: CHIPS * CHIP.x + (CHIPS - 1) * 2, y: CHIP.y } } });
      const keys = Object.keys(draft.preview[group]).slice(0, CHIPS);
      const ids = await Promise.all(keys.map(key => swatch(draft.read(group + '.' + key), CHIP)));
      await Promise.all(ids.map(id => UI.attach(win, strip, id)));
      keys.forEach((key, index) => swatches.push({ path: group + '.' + key, id: ids[index], colour: '' }));
      return strip;
    };
    const customCount = group => Object.keys(draft.config.overrides?.[group] || {}).length;
    const groupDetail = group => customCount(group) ? customCount(group) + ' custom' : 'Generated';
    const colourDetail = path => shortHex(draft.read(path)) + (draft.custom(path) ? ' · Custom' : '');
    const colourRow = async path => {
      const [group, key] = path.split('.');
      let sample;
      const item = await frame.navigate(null, colourName(key), colourDetail(path), LIST_ROW_HEIGHT,
        () => navigate({ kind: 'colour', path, group }), {
          // The row's gap separates the swatch from the text; count it too.
          lead: 32 + 12, leading: async () => { sample = await swatch(draft.read(path), { x: 32, y: 32 }); return sample; }
        });
      await UI.setElementId(win, item.target, 'theme-' + path);
      swatches.push({ path, id: sample, colour: shortHex(draft.read(path)) });
      counts.push({ label: item.valueLabel, detail: () => colourDetail(path) });
      return item.target;
    };

    let name, picker;
    if (route.kind === 'overview') {
      await header('Name');
      name = await textInput(win, { id: 'theme-name', width: frame.width, height: 36, maxLength: 80, size: TYPE.body,
        value: draft.config.name || 'Custom', onInput: value => { draft.rename(value); update(); } });
      disposals.push(() => name.destroy()); await add(name.master.id, 36);
      await header('Palette');
      await paletteGrid();
      await header('Roles', { label: 'Reset all', id: 'theme-generate', width: 80,
        onActivate: async () => { if (busy || !draft.config.overrides) return; draft.generate(); await update(); } });
      const rows = await Promise.all(Object.entries(themeGroups).map(async ([group, title]) => {
        const item = await frame.navigate(null, title, groupDetail(group), LIST_ROW_HEIGHT, () => navigate({ kind: 'group', group }),
          { lead: CHIPS * CHIP.x + (CHIPS - 1) * 2 + 12, leading: () => chips(group) });
        await UI.setElementId(win, item.target, 'theme-group-' + group);
        counts.push({ label: item.valueLabel, detail: () => groupDetail(group) });
        return item.target;
      }));
      for (const id of rows) await add(id, LIST_ROW_HEIGHT);
    } else if (route.kind === 'group') {
      const rows = await Promise.all(Object.keys(draft.preview[route.group]).map(key => colourRow(route.group + '.' + key)));
      for (const id of rows) await add(id, LIST_ROW_HEIGHT);
    } else {
      picker = await colourPicker(win, { width: frame.width, current: draft.read(route.path),
        opaque: route.path.startsWith('palette.') || route.path === 'surface.background',
        onChange: value => { draft.set(route.path, value); update(); } });
      disposals.push(picker.dispose); await add(picker.id, picker.height);
    }
    await area.setContentHeight(Math.max(0, height - SPACE.s));

    // Footer: state, then a quiet action and the main one.
    const state = await text(win, null, '', TYPE.caption, frame.width - ACTION_WIDTH * 2 - SPACE.s * 2, FOOTER_HEIGHT, TEXT.secondary, FONT, 'left');
    await Promise.all([UI.attach(win, footer, state), UI.setElementId(win, state, 'theme-message')]);
    let quiet, main, quietLabel, mainLabel;
    const labelled = (options = {}) => ({ ...options, onLabel: id => { options.main ? mainLabel = id : quietLabel = id; } });
    if (route.kind === 'colour') {
      [quiet, main] = await Promise.all([
        pill(win, footer, 'Reset', ACTION_WIDTH, async () => { if (busy || !draft.custom(route.path)) return; draft.reset(route.path); await back(); }, labelled()),
        pill(win, footer, 'Done', ACTION_WIDTH, back, labelled({ main: true, colour: SURFACE.accent, labelColour: TEXT.onAccent }))
      ]);
      await Promise.all([UI.setElementId(win, quiet, 'theme-reset-colour'), UI.setElementId(win, main, 'theme-colour-done')]);
    } else {
      [quiet, main] = await Promise.all([
        pill(win, footer, 'Revert', ACTION_WIDTH, async () => {
          if (busy || !draft.dirty) return;
          await name?.blur(); draft.revert(); await update();
        }, labelled()),
        pill(win, footer, 'Save', ACTION_WIDTH, persist, labelled({ main: true, onFeedback: value => { saved = value; } }))
      ]);
      await Promise.all([UI.setElementId(win, quiet, 'theme-revert'), UI.setElementId(win, main, 'theme-save')]);
    }

    // Saved: the preview takes a bow, now that it is the desktop.
    page.applied = () => frame.kit.play(shown.id, presets.bump());
    let ready, stateText = '';
    page.update = async () => {
      if (!page.alive) return;
      const error = draft.error;
      const nextState = error ? problem(error) : draft.dirty ? 'Unsaved' : '';
      const canSave = !busy && !error && draft.dirty;
      const canReset = route.kind === 'colour' ? draft.custom(route.path) : !busy && draft.dirty;
      const changes = swatches.filter(item => {
        const next = shortHex(draft.read(item.path));
        if (next === item.colour) return false;
        item.colour = next; return true;
      });
      await Promise.all([shown.repaint(),
        UI.setTextString(win, state, nextState), UI.setTextColour(win, state, error ? TEXT.accent : TEXT.secondary),
        ...(name && !name.isFocused() ? [name.setValue(draft.config.name || '')] : []),
        ...swatches.map(item => UI.setBoxColour(win, item.id, draft.read(item.path))),
        ...counts.map(item => UI.setTextString(win, item.label, item.detail())),
        UI.setTextColour(win, quietLabel, canReset ? TEXT.primary : TEXT.disabled), UI.setHitTarget(win, quiet, canReset),
        ...(route.kind !== 'colour' ? [UI.setHitTarget(win, main, canSave),
          UI.setBoxColour(win, main, canSave ? SURFACE.accent : SURFACE.control),
          UI.setTextColour(win, mainLabel, canSave ? TEXT.onAccent : TEXT.disabled)] : [])
      ]);
      // A swatch that changed (a reset, Revert) nudges; Save pops when it
      // becomes the thing to do; a new problem shakes into view.
      if (!picker && ready !== undefined) changes.forEach(item => frame.kit.play(item.id, presets.bump()));
      if (canSave && ready === false) frame.kit.play(main, presets.pop(0, 0.85));
      if (error && nextState !== stateText) frame.kit.play(state, presets.shake());
      ready = canSave; stateText = nextState;
    };
    page.dispose = () => Promise.all(disposals.map(dispose => dispose()));
    await page.update();
    return page;
  }
  return { build, back, receive(value) { draft.receive(value); }, get dirty() { return draft.dirty; } };
}
