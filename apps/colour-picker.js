import * as UI from './theme-ui.js';
import * as Image from 'Koya/Image';
import * as Log from 'Helix/Log';
import { textInput } from './text-input.js';
import { label, text } from './touch-ui.js';
import { controlCursor, dragCursor } from './cursor.js';
import { colour } from './theme-model.js';
import { colourHex } from './theme-editor-model.js';
import { BORDER, SPACE, TYPE, TEXT, FONT } from './theme.js';

// HSV conversion and layered gradients adapted from Deepfield's colour picker.
function clamp (value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// h in [0,360), s/v in [0,1]; returns {r,g,b} in 0-255.
export function hsvToRgb (h, s, v) {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// r/g/b in 0-255; returns {h: [0,360), s: [0,1], v: [0,1]}.
export function rgbToHsv (r, g, b) {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * (((bn - rn) / delta) + 2);
    else h = 60 * (((rn - gn) / delta) + 4);
  }
  if (h < 0) h += 360;
  return {h, s: max <= 0 ? 0 : delta / max, v: max};
}

let serial = 0;
export async function colourPicker(win, { width, current, opaque = false, onChange }) {
  const svHeight = 128, hueHeight = 28, inputs = [];
  const prefix = '/ram/koya-picker-' + (++serial), hueKey = prefix + '-hue', baseKey = prefix + '-base', shadeKey = prefix + '-shade';
  const initial = current.map(channel => Math.round(channel * 255));
  let { h, s, v } = rgbToHsv(...initial), alpha = opaque ? 255 : initial[3];
  let closed = false, dirty = false, redraw = Promise.resolve(), running = false, drawnHue;
  const value = () => { const { r, g, b } = hsvToRgb(h, s, v); return [r / 255, g / 255, b / 255, alpha / 255]; };
  const gradient = async (dst, stops, vertical = false) => {
    const result = await Image.gradient(win, { type: 'linear', dst, width: vertical ? 1 : 360, height: vertical ? 128 : 1,
      mipmaps: false, linear: { from: { x: 0, y: 0 }, to: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 } }, stops });
    if (!result) throw new Error('Could not render colour picker gradient');
  };
  await Promise.all([
    gradient(hueKey, [0, 60, 120, 180, 240, 300, 360].map(hue => {
      const { r, g, b } = hsvToRgb(hue, 1, 1); return { at: hue / 360, colour: [r / 255, g / 255, b / 255, 1] };
    })),
    gradient(shadeKey, [{ at: 0, colour: [0, 0, 0, 0] }, { at: 1, colour: [0, 0, 0, 1] }], true),
    gradient(baseKey, [{ at: 0, colour: [1, 1, 1, 1] }, { at: 1, colour: Object.values(hsvToRgb(h, 1, 1)).map(channel => channel / 255).concat(1) }])
  ]);
  drawnHue = h;
  const box = (colour, x, y, extra = {}) => UI.createElement(win, {
    renderable: { type: 'box', colour, ...extra }, item: { size: { x, y } }, contentAlign: 'fill'
  });
  const root = await UI.createElement(win, { layout: { type: 'column', gap: SPACE.s }, item: { size: { x: width, y: 300 } } });
  const [sv, hue, base, shade, strip, svCursor, hueCursor, channelCaption, channelRow, hexRow, error] = await Promise.all([
    UI.createElement(win, { id: 'colour-picker-sv', layout: { type: 'none' }, item: { size: { x: width, y: svHeight } } }),
    UI.createElement(win, { id: 'colour-picker-hue', layout: { type: 'none' }, item: { size: { x: width, y: hueHeight } } }),
    box([1, 1, 1, 1], width, svHeight, { texture: baseKey }),
    box([1, 1, 1, 1], width, svHeight, { texture: shadeKey }),
    box([1, 1, 1, 1], width, hueHeight, { texture: hueKey }),
    UI.createElement(win, { renderable: { type: 'circle', colour: [1, 1, 1, 1], inset: 2 }, item: { size: { x: 12, y: 12 } }, contentAlign: 'fill' }),
    box([1, 1, 1, 1], 3, hueHeight),
    UI.createElement(win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: width, y: 16 } } }),
    UI.createElement(win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: width, y: 36 } } }),
    UI.createElement(win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: width, y: 36 } } }),
    label(win, null, '', TYPE.caption, width, 16)
  ]);
  const channelWidth = Math.floor((width - SPACE.s * 3) / 4);
  // Each field named above it.
  await Promise.all(['Red', 'Green', 'Blue', 'Opacity'].map(name =>
    text(win, null, name, TYPE.caption, channelWidth, 16, TEXT.secondary, FONT, 'left')))
    .then(ids => Promise.all(ids.map(id => UI.attach(win, channelCaption, id))));
  const channels = await Promise.all(['R', 'G', 'B', 'A'].map((channel, index) => textInput(win, {
    id: 'colour-picker-' + channel.toLowerCase(), width: channelWidth, height: 36, value: String(initial[index]),
    placeholder: channel + ' 0–255', maxLength: 3, disabled: opaque && index === 3,
    onInput: text => {
      if (closed) return;
      if (!/^\d{1,3}$/.test(text) || Number(text) > 255) { UI.setTextString(win, error, channel + ' must be between 0 and 255'); return; }
      const values = channels.map(input => input.getValue());
      if (values.some(text => !/^\d{1,3}$/.test(text) || Number(text) > 255)) return;
      const next = values.map(Number), hsv = rgbToHsv(...next);
      // Keep the chosen hue when passing through grey or black.
      if (hsv.s > 0) h = hsv.h;
      s = hsv.s; v = hsv.v; alpha = opaque ? 255 : next[3];
      changed();
    }
  })));
  inputs.push(...channels);
  const [hex, swatch] = await Promise.all([
    textInput(win, { id: 'colour-picker-hex', width: width - 52, height: 36,
      value: colourHex(current).slice(0, opaque ? 7 : 9), maxLength: 9, placeholder: opaque ? '#RRGGBB' : '#RRGGBBAA',
      onInput: text => {
        if (closed) return;
        try {
          const next = colour(text);
          if (opaque && next[3] !== 1) throw new Error('This colour must be opaque');
          const hsv = rgbToHsv(...next.map(channel => channel * 255));
          if (hsv.s > 0) h = hsv.h;
          s = hsv.s; v = hsv.v; alpha = Math.round(next[3] * 255); changed();
        } catch (_) { UI.setTextString(win, error, opaque ? 'Enter #RRGGBB' : 'Enter #RRGGBB or #RRGGBBAA'); }
      }
    }),
    box(current, 44, 36, { cornerRadius: 4 })
  ]);
  inputs.push(hex);
  // The swatch's border makes fully transparent colours visible as an empty field.
  const edge = await box(BORDER.preview, 44, 36, { inset: 1, cornerRadius: 4 });
  const controls = [];
  const blurInputs = () => {
    // Standard inputs keep focus until another input takes it. Release it
    // when using the graphical picker, so their displayed values follow it.
    for (const input of inputs) input.blur().catch(error => Log.error('Colour picker focus: ' + error));
  };
  const capture = seek => {
    let owner;
    const cursor = dragCursor(win, 'crosshair');
    controls.push(() => { owner = undefined; });
    return { onHover: controlCursor(win, 'crosshair'), onActivate: event => {
      if (!closed && owner === undefined) { blurInputs(); seek(event.local); }
    },
      onDrag: event => {
        if (closed) return;
        if (event.phase === 'start' && owner === undefined) { owner = event.interactionId; blurInputs(); }
        if (owner !== event.interactionId) return;
        cursor(event);
        if (['start', 'change', 'end'].includes(event.phase)) seek(event.local);
        if (['end', 'cancel'].includes(event.phase)) owner = undefined;
      }
    };
  };
  const svEvents = capture(point => { s = clamp(point.x / width, 0, 1); v = 1 - clamp(point.y / svHeight, 0, 1); changed(); });
  const hueEvents = capture(point => { h = clamp(point.x / width, 0, 1) * 359.999; changed(); });
  await Promise.all([
    ...[sv, hue, channelCaption, channelRow, hexRow, error].map(id => UI.attach(win, root, id)),
    ...[base, shade, svCursor].map(id => UI.attach(win, sv, id)),
    ...[strip, hueCursor].map(id => UI.attach(win, hue, id)),
    ...channels.map(input => UI.attach(win, channelRow, input.master.id)),
    UI.attach(win, hexRow, hex.master.id), UI.attach(win, hexRow, swatch), UI.attach(win, swatch, edge),
    ...[base, shade, svCursor, strip, hueCursor, swatch, edge].map(id => UI.setHitTarget(win, id, false)),
    UI.setOnActivate(win, sv, svEvents.onActivate), UI.setOnDrag(win, sv, svEvents.onDrag), UI.setOnHover(win, sv, svEvents.onHover),
    UI.setOnActivate(win, hue, hueEvents.onActivate), UI.setOnDrag(win, hue, hueEvents.onDrag), UI.setOnHover(win, hue, hueEvents.onHover)
  ]);
  function sync() {
    dirty = true;
    if (running) return redraw;
    running = true;
    redraw = (async () => {
      while (dirty && !closed) {
        dirty = false;
        const next = value(), nextHue = h, nextS = s, nextV = v;
        if (drawnHue !== nextHue) {
          const { r, g, b } = hsvToRgb(nextHue, 1, 1);
          await gradient(baseKey, [{ at: 0, colour: [1, 1, 1, 1] }, { at: 1, colour: [r / 255, g / 255, b / 255, 1] }]);
          drawnHue = nextHue;
        }
        if (closed) break;
        await Promise.all([
          UI.setLayoutPosition(win, svCursor, { x: Math.round(nextS * width) - 6, y: Math.round((1 - nextV) * svHeight) - 6 }),
          UI.setLayoutPosition(win, hueCursor, { x: Math.round(nextHue / 360 * (width - 3)), y: 0 }),
          UI.setBoxColour(win, swatch, next),
          ...channels.map((input, i) => input.isFocused() ? undefined : input.setValue(String(Math.round(next[i] * 255)))),
          hex.isFocused() ? undefined : hex.setValue(colourHex(next).slice(0, opaque ? 7 : 9))
        ]);
      }
    })().catch(error => Log.error('Colour picker: ' + error)).finally(() => { running = false; });
    return redraw;
  }
  function changed() {
    UI.setTextString(win, error, '');
    onChange(value());
    sync();
  }
  await sync();
  return { id: root, height: 300, dispose: async () => {
    closed = true; controls.forEach(dispose => dispose());
    await redraw;
    await Promise.all(inputs.map(input => input.destroy()));
  } };
}

