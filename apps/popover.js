import * as UI from './theme-ui.js';
import * as Compositor from 'Koya/Compositor';
import * as Event from 'Helix/Event';
import * as Log from 'Helix/Log';
import { createKit } from './kit.js';
import { presets } from './motion.js';
import { shadow } from './shadow.js';
import { popupPosition, popupContains } from './popup-layout.js';
import { surfaceCursor, destroySurface } from './cursor.js';
import { ELEVATION, AUTO, SPACE } from './theme.js';

// The shell every bar popover shares: a transparent overlay covering the
// output (so a click outside closes it), an elevated panel, its authored
// shadow, Esc to close and the drop-in. The caller fills `content` (a
// column) with kit components and calls show(height) with their total; the
// panel is then placed against the anchor's measured frame.
export async function createPopover({ display, anchor, width, namespace, id, onClose, padding = 14, gap = SPACE.m, level = 'popover' }) {
  const screen = { x: Number(display.logical_width || display.width), y: Number(display.logical_height || display.height) };
  const win = await Compositor.createWindow({ role: 'overlay', anchor: 'top-left', display: display.display,
    size: screen, exclusiveZone: -1, namespace, msaaSamples: 1, transparent: true,
    keyboardInteractivity: 'exclusive', acceptPointerEvents: true });
  const kit = createKit(win);
  let placed, closed = false;
  const close = () => { if (!closed) onClose?.(); };
  const keyDown = event => { if (event.id === win && [1, 65307].includes(Number(event.key))) close(); };
  try {
    const [root] = await Promise.all([
      UI.createElement(win, { layout: { type: 'none' }, item: { size: AUTO }, onHover: surfaceCursor(win),
        onActivate: event => { if (placed && !popupContains(event.local, placed.position, placed.size)) close(); } }),
      Compositor.setClearColor(win, 0, 0, 0, 0)
    ]);
    const panel = await kit.surface(level, { id, layout: { type: 'column', gap }, padding: { t: padding, r: padding, b: padding, l: padding } });
    await UI.setClipToBounds(win, panel.id, true);
    Event.on('keyDown', keyDown);
    return {
      win, kit, play: kit.play, content: panel.content, inner: width - padding * 2,
      // Place, shade and reveal. `height` is the content's total plus padding.
      show: async contentHeight => {
        const size = { x: Math.min(width, screen.x - 16), y: Math.min(screen.y - 16, contentHeight + padding * 2) };
        const position = popupPosition(screen, anchor, size.x, size.y);
        placed = { position, size };
        const shade = ELEVATION[level].shadow ? await shadow(win, root, size, position, ELEVATION[level].shadow) : undefined;
        await Promise.all([UI.attach(win, root, panel.id),
          UI.setLayoutAABB(win, panel.id, { min: position, max: { x: position.x + size.x, y: position.y + size.y } })]);
        // Clicks on the panel never count as outside.
        await UI.attachRoot(win, root);
        kit.play(panel.id, presets.dropIn());
        if (shade) kit.play(shade, presets.dropIn());
      },
      contains: point => !!placed && popupContains(point, placed.position, placed.size),
      destroy: async () => { closed = true; Event.off('keyDown', keyDown); await destroySurface(win); }
    };
  } catch (error) { Event.off('keyDown', keyDown); await destroySurface(win); Log.error('Popover: ' + error); throw error; }
}
