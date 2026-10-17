import * as UI from './theme-ui.js';
import * as Log from 'Helix/Log';
import { pulseAudio } from './pulse-audio.js';
import { speakerStatus, clampVolume } from './audio-model.js';
import { volumeInput } from './input-model.js';
import { createPopover } from './popover.js';
import { presets } from './motion.js';
import { controlCursor, dragCursor } from './cursor.js';
import { text, button } from './touch-ui.js';
import { TEXT, CLEAR, AUTO, RADIUS, SPACE, TYPE, SURFACE, HIGHLIGHT } from './theme.js';

// The bar's volume popover, on the shared shell: mute, a slider and the
// percentage in one row. Rail and thumb sit in the slider by margins; the
// level is the rail's fill scaled to the value and the thumb a visual offset
// along the travel. Muting pops the speaker.
const POPUP_WIDTH = 300, POPUP_PADDING = 12, ROW_HEIGHT = 36;
const MUTE_BUTTON_WIDTH = 32, PERCENT_LABEL_WIDTH = 40, THUMB_SIZE = 12, CONTROL_GAP = SPACE.s;
const SLIDER_WIDTH = POPUP_WIDTH - POPUP_PADDING * 2 - MUTE_BUTTON_WIDTH - PERCENT_LABEL_WIDTH - CONTROL_GAP * 2;
const THUMB_TRAVEL = SLIDER_WIDTH - THUMB_SIZE;
const texture = name => '/rom/assets/status/' + name + '.png';
export function createVolume(display, options = {}) {
  let latest = { available: false, percent: 0, muted: false }, popup, started = false, request = 0;
  const listeners = new Set();
  let queue = Promise.resolve();
  const enqueue = task => {
    const job = queue.then(task); queue = job.catch(error => Log.error('Volume popup: ' + error)); return job;
  };
  const paint = async () => {
    if (!popup) return;
    const status = speakerStatus(latest), percent = clampVolume(latest.percent);
    if (popup.muted !== undefined && popup.muted !== status.muted) popup.play(popup.glyph, presets.pop(0, 0.7));
    popup.muted = status.muted;
    await Promise.all([
      UI.setTexture(popup.win, popup.glyph, texture(status.icon)),
      UI.setTextString(popup.win, popup.label, status.label),
      UI.setBoxColour(popup.win, popup.fill, status.muted ? SURFACE.mutedFill : SURFACE.accent),
      UI.setScale(popup.win, popup.fill, { x: percent / 100, y: 1 }),
      UI.setPosition(popup.win, popup.thumb, { x: THUMB_TRAVEL * percent / 100, y: 0 }),
      UI.setEnabled(popup.win, popup.thumb, !!latest.available)
    ]);
  };
  const audio = pulseAudio({ ...options, changed: value => {
    latest = value;
    for (const listener of listeners) listener(value);
    enqueue(paint).catch(() => {});
  } });
  const destroy = async () => {
    if (!popup) return;
    const previous = popup; popup = undefined;
    previous.input.dispose();
    await previous.shell.destroy();
  };
  const close = () => { request++; return enqueue(destroy); };
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
      popup = { shell, win, play: shell.play, display: output.display, glyph, label, fill, thumb, input };
      await paint();
      await shell.show(ROW_HEIGHT);
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
