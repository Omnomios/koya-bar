import * as UI from './theme-ui.js';
import * as Log from 'Helix/Log';
import { pulseAudio } from './pulse-audio.js';
import { speakerStatus, clampVolume } from './audio-model.js';
import { volumeInput } from './input-model.js';
import { createPopover } from './popover.js';
import { presets } from './motion.js';
import { controlCursor, dragCursor } from './cursor.js';
import { KIT_METRICS } from './kit.js';
import { text, label as wrappedLabel, icon, row as choiceRow, button, pill, throbber } from './touch-ui.js';
import { TEXT, CLEAR, AUTO, RADIUS, SPACE, TYPE, SURFACE, HIGHLIGHT } from './theme.js';

// Mute, slider and percentage above the sound outputs. Rail and thumb sit in
// the slider by margins; the level is the rail's fill scaled to the value and
// the thumb a visual offset along the travel. Muting pops the speaker. The
// chosen output carries an accent dot (a throbber while switching to it); a
// failed switch shakes the list and flashes in its caption.
const POPUP_WIDTH = 340, POPUP_PADDING = 12, ROW_HEIGHT = 36, OUTPUT_ROW_HEIGHT = 48, ACTION_HEIGHT = 32, MARK = 14, ERROR_MS = 2400;
const MUTE_BUTTON_WIDTH = 32, PERCENT_LABEL_WIDTH = 40, THUMB_SIZE = 12, CONTROL_GAP = SPACE.s;
const SLIDER_WIDTH = POPUP_WIDTH - POPUP_PADDING * 2 - MUTE_BUTTON_WIDTH - PERCENT_LABEL_WIDTH - CONTROL_GAP * 2;
const THUMB_TRAVEL = SLIDER_WIDTH - THUMB_SIZE;
const texture = name => '/rom/assets/status/' + name + '.png';
// An output: its glyph, the port over the device it belongs to, and a mark.
async function outputRow(win, kit, device, index, width, choose) {
  const textWidth = width - 12 - SPACE.m - 24 - MARK - SPACE.m * 2;
  const target = await choiceRow(win, null, width, OUTPUT_ROW_HEIGHT, () => choose(device.id), { colour: CLEAR, gap: SPACE.m, right: SPACE.m, radius: RADIUS.control });
  const [glyph, words, slot, dot, spinner] = await Promise.all([
    icon(win, null, texture(device.icon), 20, 24, OUTPUT_ROW_HEIGHT),
    UI.createElement(win, { layout: { type: 'column', justifyContent: 'center' }, item: { size: { x: textWidth, y: OUTPUT_ROW_HEIGHT } } }),
    UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: MARK, y: OUTPUT_ROW_HEIGHT } } }),
    UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 8, y: 8 } }, resolution: 16, colour: SURFACE.accent, origin: { x: 0.5, y: 0.5 } },
      item: { size: AUTO }, contentAlign: { x: 'center', y: 'center' } }),
    throbber(win, null, MARK, TEXT.primary, OUTPUT_ROW_HEIGHT)
  ]);
  await wrappedLabel(win, words, device.name, TYPE.body, textWidth, device.device ? 20 : OUTPUT_ROW_HEIGHT);
  if (device.device) await wrappedLabel(win, words, device.device, TYPE.caption, textWidth, 18, TEXT.secondary);
  await Promise.all([UI.attach(win, slot, dot), UI.attach(win, slot, spinner.id), UI.setEnabled(win, dot, false), UI.setHitTarget(win, words, false)]);
  await Promise.all([UI.attach(win, target, glyph), UI.attach(win, target, words), UI.attach(win, target, slot), UI.setElementId(win, target, 'volume-output-' + index)]);
  let state;
  return {
    id: target, device: device.id,
    // 'on' (chosen), 'busy' (switching to it) or 'off'. A newly chosen dot pops.
    mark: async next => {
      if (next === state) return;
      const was = state; state = next;
      await Promise.all([UI.setEnabled(win, dot, next === 'on'), next === 'busy' ? spinner.start() : spinner.stop()]);
      if (next === 'on' && was) kit.play(dot, presets.pop(0, 0.3));
    },
    dispose: () => spinner.stop()
  };
}
const outputShape = value => JSON.stringify([(value.outputs || []).map(item => [item.id, item.name, item.device, item.icon]), !!value.settingsAvailable]);
export function createVolume(display, options = {}) {
  let latest = { available: false, percent: 0, muted: false, outputs: [] }, popup, started = false, request = 0, selecting = '';
  let flash = '', flashTimer;
  const caption = () => flash || (latest.available ? 'Output' : latest.error || 'Output');
  const listeners = new Set();
  let queue = Promise.resolve();
  const enqueue = task => {
    const job = queue.then(task); queue = job.catch(error => Log.error('Volume popup: ' + error)); return job;
  };
  const paint = async (rebuild = true) => {
    if (!popup) return;
    if (rebuild && popup.shape !== outputShape(latest)) {
      const { output, anchor } = popup;
      await destroy(); await build(output, anchor); return;
    }
    const status = speakerStatus(latest), percent = clampVolume(latest.percent);
    if (popup.muted !== undefined && popup.muted !== status.muted) popup.play(popup.glyph, presets.pop(0, 0.7));
    popup.muted = status.muted;
    await Promise.all([
      UI.setTexture(popup.win, popup.glyph, texture(status.icon)),
      UI.setTextString(popup.win, popup.label, status.label),
      UI.setBoxColour(popup.win, popup.fill, status.muted ? SURFACE.mutedFill : SURFACE.accent),
      UI.setScale(popup.win, popup.fill, { x: percent / 100, y: 1 }),
      UI.setPosition(popup.win, popup.thumb, { x: THUMB_TRAVEL * percent / 100, y: 0 }),
      UI.setEnabled(popup.win, popup.thumb, !!latest.available),
      popup.setCaption(caption()),
      ...popup.outputs.map(item => item.mark(selecting === item.device ? 'busy' : latest.outputs?.find(output => output.id === item.device)?.selected ? 'on' : 'off'))
    ]);
  };
  const audio = (options.audioFactory || pulseAudio)({ ...options, changed: value => {
    // A switch ends when its output is chosen, fails or disappears.
    const chosen = value.outputs?.find(item => item.selected)?.id;
    if (value.error || chosen === selecting || !value.outputs?.some(item => item.id === selecting)) selecting = '';
    if (value.error && value.error !== latest.error && popup) {
      flash = value.error; clearTimeout(flashTimer);
      popup.play(popup.card, presets.shake());
      flashTimer = setTimeout(() => { flash = ''; enqueue(() => paint(false)).catch(() => {}); }, ERROR_MS);
    }
    latest = value;
    for (const listener of listeners) listener(value);
    enqueue(paint).catch(() => {});
  } });
  const destroy = async () => {
    if (!popup) return;
    const previous = popup; popup = undefined;
    previous.input.dispose(); previous.outputs.forEach(item => item.dispose());
    await previous.shell.destroy();
  };
  const close = () => { request++; clearTimeout(flashTimer); flash = ''; return enqueue(destroy); };
  const chooseOutput = id => {
    if (selecting || latest.outputs?.find(item => item.id === id)?.selected) return;
    selecting = id;
    audio.selectOutput(id);
    enqueue(paint).catch(() => {});
  };
  const build = async (output, anchor) => {
    const shell = await createPopover({ display: output, anchor, width: POPUP_WIDTH, namespace: 'koya-volume', id: 'volume-popup', padding: POPUP_PADDING,
      onClose: () => close().catch(() => {}) });
    try {
      const { win } = shell;
      const input = volumeInput({ available: () => latest.available, setPercent: value => audio.setPercent(value), travel: THUMB_TRAVEL, inset: THUMB_SIZE / 2 });
      const cursorDrag = dragCursor(win);
      let glyph;
      const row = await UI.createElement(win, { layout: { type: 'row', gap: CONTROL_GAP, alignItems: 'center' }, item: { size: { x: 'auto', y: ROW_HEIGHT } } });
      const mute = await button(win, row, '', MUTE_BUTTON_WIDTH, ROW_HEIGHT, () => { if (latest.available) audio.toggleMute(); },
        { colour: CLEAR, hover: HIGHLIGHT.hover, radius: RADIUS.control, icon: texture('volume'), iconSize: 20,
          cursor: () => latest.available ? 'pointer' : 'default', onIcon: id => { glyph = id; } });
      const slider = await UI.createElement(win, { id: 'volume-slider', layout: { type: 'none' }, item: { size: { x: SLIDER_WIDTH, y: ROW_HEIGHT } },
        inputOptions: { dragAxis: 'x' }, onActivate: input.onActivate,
        onHover: controlCursor(win, () => latest.available ? 'ew-resize' : 'default'),
        onDrag: event => { input.onDrag(event); cursorDrag(event); } });
      // Rail centred across the travel; the fill scales from its left edge.
      const rail = await UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.track, cornerRadius: 2, cornerResolution: 16 },
        layout: { type: 'none' }, item: { size: AUTO, margin: { t: ROW_HEIGHT / 2 - 2, r: THUMB_SIZE / 2, b: ROW_HEIGHT / 2 - 2, l: THUMB_SIZE / 2 } }, contentAlign: 'fill' });
      const fill = await UI.createElement(win, { id: 'volume-level', renderable: { type: 'box', colour: SURFACE.accent, cornerRadius: 2, cornerResolution: 16, origin: { x: 0, y: 0.5 } },
        item: { size: AUTO }, contentAlign: 'fill' });
      // Thumb at the start of the travel; the value moves it.
      const thumb = await UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.thumb, cornerRadius: THUMB_SIZE / 2, cornerResolution: 24, origin: { x: 0.5, y: 0.5 } },
        item: { size: AUTO, margin: { t: (ROW_HEIGHT - THUMB_SIZE) / 2, r: SLIDER_WIDTH - THUMB_SIZE, b: (ROW_HEIGHT - THUMB_SIZE) / 2, l: 0 } }, contentAlign: 'fill' });
      const label = await text(win, null, '—', TYPE.detail, PERCENT_LABEL_WIDTH, ROW_HEIGHT, TEXT.primary);
      await Promise.all([UI.attach(win, slider, rail), UI.attach(win, rail, fill), UI.attach(win, slider, thumb),
        UI.setHitTarget(win, rail, false), UI.setHitTarget(win, fill, false), UI.setHitTarget(win, thumb, false)]);
      await Promise.all([UI.attach(win, row, slider)]);
      await UI.attach(win, row, label);
      await Promise.all([UI.setElementId(win, mute, 'volume-mute'), UI.setElementId(win, label, 'volume-percent'), UI.attach(win, shell.content, row)]);
      // Outputs: a caption over an inset card of rows (scrolling past five
      // and a half, so a cut-off row says there is more), then the settings.
      const { kit } = shell, choices = latest.outputs || [], shape = outputShape(latest);
      const inner = shell.inner - SPACE.xs * 2;
      const rowsHeight = choices.length ? choices.length * OUTPUT_ROW_HEIGHT : KIT_METRICS.emptyStateHeight;
      const settingsHeight = latest.settingsAvailable ? SPACE.m + ACTION_HEIGHT : 0;
      const reserved = POPUP_PADDING * 2 + ROW_HEIGHT + SPACE.m + KIT_METRICS.headerHeight + SPACE.xs * 3 + settingsHeight + 80;
      const listHeight = Math.min(rowsHeight, OUTPUT_ROW_HEIGHT * 5.5,
        Math.max(OUTPUT_ROW_HEIGHT, Number(output.logical_height || output.height) - reserved));
      const cardHeight = listHeight + SPACE.xs * 2, groupHeight = KIT_METRICS.headerHeight + SPACE.xs + cardHeight;
      const [group, header, card, area] = await Promise.all([
        UI.createElement(win, { layout: { type: 'column', gap: SPACE.xs }, item: { size: { x: 'auto', y: groupHeight } } }),
        kit.sectionHeader({ caption: caption() }),
        kit.surface('inset', { size: { x: 'auto', y: cardHeight }, padding: { t: SPACE.xs, r: SPACE.xs, b: SPACE.xs, l: SPACE.xs } }),
        kit.scrollArea({ width: inner, height: listHeight, id: 'volume-outputs' })
      ]);
      const outputRows = await Promise.all(choices.map((device, index) => outputRow(win, kit, device, index, inner, chooseOutput)));
      for (const item of outputRows) await UI.attach(win, area.content, item.id);
      if (!choices.length) await UI.attach(win, area.content, (await kit.emptyState({ glyph: texture('audio-card'), message: 'No sound outputs', width: inner })).id);
      await area.setContentHeight(rowsHeight);
      await Promise.all([UI.attach(win, card.content, area.id), UI.attach(win, group, header.id), UI.attach(win, group, card.id)]);
      await UI.attach(win, shell.content, group);
      let settings;
      if (latest.settingsAvailable) {
        settings = await pill(win, shell.content, 'Sound Settings', shell.inner, () => {
          try { audio.openSettings(); close().catch(() => {}); }
          catch (error) { Log.error('Sound settings: ' + error); }
        }, { colour: SURFACE.control, labelColour: TEXT.accent, height: ACTION_HEIGHT, size: TYPE.detail });
        await UI.setElementId(win, settings, 'volume-sound-settings');
      }
      const selected = choices.findIndex(item => item.selected);
      if (selected >= 0) await area.reveal(selected * OUTPUT_ROW_HEIGHT, (selected + 1) * OUTPUT_ROW_HEIGHT);
      // The caption keeps its measured width, so a flashed error stays on one line.
      const setCaption = async value => {
        if (popup?.caption === value) return;
        if (popup) popup.caption = value;
        await UI.setTextString(win, header.label, value);
        const measured = await UI.measureText(win, header.label).catch(() => undefined);
        if (measured?.size?.x) await UI.setLayoutSize(win, header.label, { x: Math.min(shell.inner, Math.ceil(measured.size.x) + 2), y: KIT_METRICS.headerHeight });
      };
      popup = { shell, win, play: shell.play, display: output.display, output, anchor, shape, outputs: outputRows, card: card.id, caption: caption(), setCaption,
        glyph, label, fill, thumb, input };
      await paint(false);
      await shell.show(ROW_HEIGHT + SPACE.m + groupHeight + settingsHeight);
      [...outputRows.map(item => item.id), ...(settings ? [settings] : [])].forEach((id, index) => shell.play(id, presets.rise(index)));
    } catch (error) { if (popup?.shell === shell) popup = undefined; await shell.destroy(); throw error; }
  };
  return { audio,
    subscribe: listener => { listeners.add(listener); listener(latest); return () => listeners.delete(listener); },
    toggle: (output, anchor) => {
      const token = ++request;
      audio.refresh();
      return enqueue(async () => {
        if (token !== request) return;
        const same = popup?.display === output.display;
        await destroy();
        if (same) return;
        display = output; await build(output, anchor);
        if (token !== request) await destroy();
      });
    }, close,
    get display() { return display; },
    setDisplay: next => { display = next; return close(); },
    resize: next => { if (popup?.display === next.display) return close(); return Promise.resolve(); },
    onState: value => {
      if (!started && value.Active) { started = true; audio.start(); }
      if (!value.Active || value.ScreenState !== 'unlocked') return close();
      return Promise.resolve();
    },
    get window() { return popup?.win; }
  };
}
