import * as UI from './theme-ui.js';
import * as Image from 'Koya/Image';
import { text } from './touch-ui.js';
import { controlCursor } from './cursor.js';
import { SPACE, TYPE, TEXT, SURFACE, CLEAR } from './theme.js';

// Authored SVG layers, exported at 4x for Koya's texture loader. All layers
// share the same viewBox so selected and enrolled regions follow the outline.
export async function fingerprintHands(win, parent, width, choose) {
  const gap = SPACE.m, handWidth = (width - gap) / 2, scale = handWidth / 240;
  const drawingHeight = 320 * scale, height = drawingHeight + 28;
  const row = await UI.createElement(win, { layout: { type: 'row', gap }, item: { size: { x: width, y: height } } });
  await UI.attach(win, parent, row);
  const controls = [], textures = [];
  const regions = [
    ['little-finger', [[22, 85, 29, 61]]], ['ring-finger', [[45, 39, 32, 99]]],
    ['middle-finger', [[81, 14, 34, 126]]], ['index-finger', [[123, 36, 33, 118]]],
    ['thumb', [[181, 122, 39, 43], [165, 165, 32, 34]]]
  ];
  for (const side of ['left', 'right']) {
    const column = await UI.createElement(win, { layout: { type: 'column' }, item: { size: { x: handWidth, y: height } } });
    const hand = await UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: handWidth, y: drawingHeight } } });
    await UI.attach(win, row, column); await UI.attach(win, column, hand);
    await text(win, column, side === 'left' ? 'Left' : 'Right', TYPE.caption, handWidth, 28, TEXT.secondary);
    const layer = async (name, colour) => {
      const texture = await Image.load(win, { path: `assets/fingerprints/${side}-${name}.png`, id: `fingerprints-${win}-${row}-${side}-${name}` });
      textures.push(texture);
      const id = await UI.createElement(win, {
        renderable: { type: 'box', colour, cornerRadius: 0 },
        item: { position: { x: 0, y: 0 }, size: { x: handWidth, y: drawingHeight } }, contentAlign: 'fill'
      });
      await UI.setTexture(win, id, texture);
      await UI.attach(win, hand, id); await UI.setHitTarget(win, id, false);
      return id;
    };
    const entries = [];
    for (const [name, areas] of regions) {
      const enrolled = await layer(name, SURFACE.accent);
      const selected = await layer(name + '-selected', TEXT.primary);
      await UI.setEnabled(win, enrolled, false); await UI.setEnabled(win, selected, false);
      entries.push({ finger: side + '-' + name, enrolled, selected, areas, targets: [] });
    }
    await layer('base', TEXT.primary);
    for (const entry of entries) {
      for (const [index, [x, y, w, h]] of entry.areas.entries()) {
        const target = await UI.createElement(win, {
          id: 'fingerprint-' + entry.finger + (index ? '-' + index : ''),
          renderable: { type: 'box', colour: CLEAR },
          item: { position: { x: (side === 'left' ? x : 240 - x - w) * scale, y: y * scale }, size: { x: w * scale, y: h * scale } },
          onActivate: () => choose(entry.finger), onHover: controlCursor(win)
        });
        await UI.attach(win, hand, target); entry.targets.push(target);
      }
      controls.push(entry);
    }
  }
  return { id: row, height, async set({ fingers, selected, disabled }) {
    await Promise.all(controls.flatMap(item => [
      UI.setEnabled(win, item.enrolled, fingers.includes(item.finger)),
      UI.setEnabled(win, item.selected, selected === item.finger),
      ...item.targets.map(id => UI.setHitTarget(win, id, !disabled))
    ]));
  }, async dispose() {
    await Promise.all(textures.map(texture => Image.destroy(win, texture)));
  } };
}
