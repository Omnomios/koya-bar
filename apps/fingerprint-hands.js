import * as UI from './theme-ui.js';
import { text } from './touch-ui.js';
import { controlCursor } from './cursor.js';
import { SPACE, TYPE, TEXT, SURFACE, CLEAR } from './theme.js';

// Front-facing hands, thumbs towards the centre. Native shapes stay sharp at
// every display scale and follow the active theme without raster assets.
export async function fingerprintHands(win, parent, width, choose) {
  const gap = SPACE.m, handWidth = (width - gap) / 2, scale = handWidth / 180;
  const drawingHeight = 232 * scale, height = drawingHeight + 28;
  const row = await UI.createElement(win, { layout: { type: 'row', gap }, item: { size: { x: width, y: height } } });
  await UI.attach(win, parent, row);
  const controls = [];
  for (const side of ['left', 'right']) {
    const column = await UI.createElement(win, { layout: { type: 'column' }, item: { size: { x: handWidth, y: height } } });
    const hand = await UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: handWidth, y: drawingHeight } } });
    await UI.attach(win, row, column); await UI.attach(win, column, hand);
    await text(win, column, side === 'left' ? 'Left' : 'Right', TYPE.caption, handWidth, 28, TEXT.secondary);
    const box = async (parent, x, y, w, h, colour, radius = w / 2, extra = {}) => {
      const id = await UI.createElement(win, {
        renderable: { type: 'box', colour, cornerRadius: radius * scale, cornerResolution: 24 },
        item: { position: { x: (side === 'left' ? x : 180 - x - w) * scale, y: y * scale }, size: { x: w * scale, y: h * scale } },
        contentAlign: 'fill', ...extra
      });
      await UI.attach(win, parent, id); return id;
    };
    await box(hand, 42, 185, 68, 43, SURFACE.controlHover, 14);
    await box(hand, 14, 126, 119, 78, SURFACE.controlHover, 30);
    const shapes = [
      ['little-finger', 12, 66, 23, 91], ['ring-finger', 40, 29, 25, 128],
      ['middle-finger', 70, 10, 25, 147], ['index-finger', 100, 32, 25, 125],
      ['thumb', 124, 109, 46, 81]
    ];
    for (const [name, x, y, w, h] of shapes) {
      const finger = side + '-' + name, pieces = [];
      if (name === 'thumb') {
        for (let i = 0; i <= 12; i++) pieces.push(await box(hand, 116 + i * 2.5, 165 - i * 4.5, 26, 26, SURFACE.controlHover));
      } else pieces.push(await box(hand, x, y, w, h, SURFACE.controlHover));
      const tipX = name === 'thumb' ? 146 : x, tipY = name === 'thumb' ? 111 : y;
      const ring = await box(hand, tipX - 2, tipY - 2, 29, 29, CLEAR, 15);
      const centre = await box(hand, tipX, tipY, 25, 25, SURFACE.controlHover, 13);
      const mark = await text(win, null, '✓', TYPE.caption, 25 * scale, 25 * scale, TEXT.onAccent);
      await UI.attach(win, centre, mark); await UI.setEnabled(win, mark, false);
      const action = await box(hand, x - 2, y - 3, w + 4, h + 5, CLEAR, 0, {
        id: 'fingerprint-' + finger, onActivate: () => choose(finger), onHover: controlCursor(win)
      });
      for (const id of [...pieces, ring, centre, mark]) await UI.setHitTarget(win, id, false);
      controls.push({ finger, action, pieces, ring, centre, mark });
    }
  }
  return { id: row, height, async set({ fingers, selected, disabled }) {
    await Promise.all(controls.map(async item => {
      const enrolled = fingers.includes(item.finger), chosen = selected === item.finger;
      const colour = enrolled ? SURFACE.accent : chosen ? SURFACE.selected : SURFACE.controlHover;
      await Promise.all([
        ...[...item.pieces, item.centre].map(id => UI.setBoxColour(win, id, colour)),
        UI.setBoxColour(win, item.ring, chosen ? TEXT.primary : CLEAR),
        UI.setEnabled(win, item.mark, enrolled), UI.setHitTarget(win, item.action, !disabled)
      ]);
    }));
  } };
}
