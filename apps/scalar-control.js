import * as UI from './theme-ui.js';
import { text } from './touch-ui.js';
import { scalarInput } from './scalar-input.js';
import { controlCursor, dragCursor } from './cursor.js';
import { CLEAR, AUTO, TYPE, TEXT, SURFACE, SPACE } from './theme.js';

export async function scalarControl(win, { id, width, title = '', value = 0, minimum = 0, maximum = 100, step = 1, format = n => n + '%', available = () => true, commit, report = () => {} }) {
  const height = title ? 72 : 40, sliderWidth = width - 60 - SPACE.s;
  let current = value, shown = value, busy = false, dead = false;
  const root = await UI.createElement(win, { layout: { type: 'column' }, item: { size: { x: width, y: height } } });
  if (title) await text(win, root, title, TYPE.detail, width, 28, TEXT.primary, undefined, 'left');
  const row = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s, alignItems: 'center' }, item: { size: { x: width, y: 40 } } });
  const output = await text(win, null, format(value), TYPE.detail, 60, 40, TEXT.secondary, undefined, 'right');
  const allowed = () => !dead && !busy && available();
  const paint = async next => {
    shown = next; const fraction = Math.max(0, Math.min(1, (next - minimum) / (maximum - minimum)));
    await Promise.all([UI.setTextString(win, output, busy ? 'Saving…' : format(next)), UI.setScale(win, fill, { x: fraction, y: 1 }),
      UI.setPosition(win, thumb, { x: (sliderWidth - 12) * fraction, y: 0 }), UI.setHitTarget(win, slider, allowed()),
      UI.setBoxColour(win, fill, allowed() ? SURFACE.accent : SURFACE.mutedFill)]);
  };
  const save = async next => {
    if (!allowed()) return;
    const previous = current; current = next; busy = true;
    await paint(next);
    try { await commit(next); }
    catch (error) { current = previous; report(error); }
    finally { busy = false; if (!dead) await paint(current); }
  };
  const input = scalarInput({ minimum, maximum, width: sliderWidth, step, available: allowed,
    preview: next => { paint(next).catch(report); }, commit: next => { save(next).catch(report); }, cancel: () => { paint(current).catch(report); } });
  const cursorDrag = dragCursor(win);
  const slider = await UI.createElement(win, { id, layout: { type: 'none' }, item: { size: { x: sliderWidth, y: 40 } }, inputOptions: { dragAxis: 'x' },
    onActivate: input.onActivate, onDrag: event => { cursorDrag(event); input.onDrag(event); }, onHover: controlCursor(win, 'ew-resize') });
  const rail = await UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.rail, cornerRadius: 3, origin: { x: 0, y: 0.5 } },
    item: { size: AUTO, margin: { t: 17, r: 6, b: 17, l: 6 } }, contentAlign: 'fill' });
  const fill = await UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.accent, cornerRadius: 3, origin: { x: 0, y: 0.5 } }, item: { size: AUTO }, contentAlign: 'fill' });
  const thumb = await UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.thumb, cornerRadius: 6, origin: { x: .5, y: .5 } },
    item: { size: AUTO, margin: { t: 14, r: sliderWidth - 12, b: 14, l: 0 } }, contentAlign: 'fill' });
  await Promise.all([UI.attach(win, slider, rail), UI.attach(win, rail, fill), UI.attach(win, slider, thumb),
    UI.setHitTarget(win, rail, false), UI.setHitTarget(win, fill, false), UI.setHitTarget(win, thumb, false)]);
  await UI.attach(win, row, slider); await UI.attach(win, row, output); await UI.attach(win, root, row); await paint(value);
  return { id: root, height, async set(next) { current = next; if (!busy && !input.dragging && !dead) await paint(next); },
    dispose() { dead = true; input.dispose(); }, get value() { return shown; } };
}
