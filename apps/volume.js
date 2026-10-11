import * as UI from 'Helix/UserInterface';
import * as Compositor from 'Koya/Compositor';
import * as Event from 'Helix/Event';
import * as Log from 'Helix/Log';
import { pulseAudio } from './pulse-audio.js';
import { speakerStatus, clampVolume, volumePopupPosition } from './audio-model.js';
import { volumeInput } from './input-model.js';
import { popupContains } from './popup-layout.js';
import { surfaceCursor, controlCursor, dragCursor, destroySurface } from './cursor.js';
import { text, button } from './touch-ui.js';
import { CREAM, ORANGE, POPOVER, TRACK, MUTED, CLEAR, RADIUS } from './theme.js';

const PANEL = { x: 280, y: 64 }, SLIDER = 164, THUMB = 12, TRAVEL = SLIDER - THUMB;
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
    await Promise.all([
      UI.setTexture(popup.win, popup.glyph, texture(status.icon)),
      UI.setTextString(popup.win, popup.label, status.label),
      UI.setBoxColour(popup.win, popup.fill, status.muted ? MUTED : ORANGE),
      UI.setScale(popup.win, popup.fill, { x: percent / 100, y: 1 }),
      UI.setPosition(popup.win, popup.thumb, { x: TRAVEL * percent / 100, y: 0 }),
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
    await destroySurface(previous.win);
  };
  const close = () => { request++; return enqueue(destroy); };
  const build = async (output, anchor) => {
    const size = { x: Number(output.logical_width || output.width), y: Number(output.logical_height || output.height) };
    const offset = volumePopupPosition(size, anchor, PANEL.x, PANEL.y);
    // The transparent surround dismisses the popup on an outside click.
    const win = await Compositor.createWindow({ role: 'overlay', anchor: 'top-left', display: output.display,
      size, exclusiveZone: -1, namespace: 'koya-volume', msaaSamples: 1, transparent: true,
      keyboardInteractivity: 'exclusive', acceptPointerEvents: true });
    try {
      const input = volumeInput({ available: () => latest.available, setPercent: value => audio.setPercent(value), travel: TRAVEL, inset: THUMB / 2 });
      const cursorDrag = dragCursor(win);
      let glyph;
      const [root, panel, mute, slider, rail, fill, thumb, label] = await Promise.all([
        UI.createElement(win, { item: { size }, layout: { type: 'none' }, onHover: surfaceCursor(win),
          onActivate: event => { if (!popupContains(event.local, offset, PANEL)) close().catch(() => {}); } }),
        UI.createElement(win, { id: 'volume-popup', renderable: { type: 'box', colour: POPOVER,
          cornerRadius: RADIUS.surface, cornerResolution: 16 },
          layout: { type: 'row', gap: 10, padding: { l: 12, r: 12, t: 0, b: 0 }, alignItems: 'center' },
          item: { position: offset, size: PANEL }, contentAlign: 'fill', inputOptions: { blockInput: true } }),
        button(win, null, '', 32, PANEL.y, () => { if (latest.available) audio.toggleMute(); },
          { colour: CLEAR, icon: texture('volume'), iconSize: 20, cursor: () => latest.available ? 'pointer' : 'default', onIcon: id => { glyph = id; } }),
        UI.createElement(win, { id: 'volume-slider', item: { size: { x: SLIDER, y: PANEL.y } }, layout: { type: 'none' },
          inputOptions: { dragAxis: 'x' }, onActivate: input.onActivate,
          onHover: controlCursor(win, () => latest.available ? 'ew-resize' : 'default'),
          onDrag: event => { input.onDrag(event); cursorDrag(event); } }),
        UI.createElement(win, { renderable: { type: 'box', colour: TRACK, cornerRadius: 2, cornerResolution: 16 },
          item: { position: { x: THUMB / 2, y: PANEL.y / 2 - 2 }, size: { x: TRAVEL, y: 4 } }, contentAlign: 'fill' }),
        UI.createElement(win, { id: 'volume-level', renderable: { type: 'box', colour: ORANGE, origin: { x: 0, y: 0.5 } },
          item: { size: { x: TRAVEL, y: 4 } }, contentAlign: 'fill' }),
        UI.createElement(win, { renderable: { type: 'box', colour: CREAM, cornerRadius: THUMB / 2, cornerResolution: 24 },
          item: { position: { x: 0, y: PANEL.y / 2 - THUMB / 2 }, size: { x: THUMB, y: THUMB } }, contentAlign: 'fill' }),
        text(win, null, '—', 13, 40, PANEL.y), Compositor.setClearColor(win, 0, 0, 0, 0)
      ]);
      await Promise.all([
        UI.attach(win, root, panel),
        UI.attach(win, panel, mute), UI.attach(win, panel, slider), UI.attach(win, panel, label),
        UI.attach(win, slider, rail), UI.attach(win, rail, fill), UI.attach(win, slider, thumb),
        UI.setHitTarget(win, rail, false), UI.setHitTarget(win, fill, false), UI.setHitTarget(win, thumb, false),
        UI.setElementId(win, mute, 'volume-mute'), UI.setElementId(win, label, 'volume-percent')
      ]);
      popup = { win, display: output.display, glyph, label, fill, thumb, input };
      await Promise.all([paint(), UI.attachRoot(win, root)]);
    } catch (error) { if (popup?.win === win) popup = undefined; await destroySurface(win); throw error; }
  };
  Event.on('keyDown', event => {
    if (popup?.win === event.id && [1, 65307].includes(Number(event.key))) close().catch(() => {});
  });
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
