import * as Compositor from 'Koya/Compositor';
import * as UI from './theme-ui.js';
import { clips } from './motion.js';
import { RADIUS } from './theme.js';
import { surfaceCursor, resetCursor, destroySurface } from './cursor.js';

// Keep warm surfaces transparent and input-free while parked. No idle timers.
export async function notificationSurface(display, namespace, size, offset, colour, keyboard = 'none', options = {}) {
  const travel = options.enterOffset || { x: 0, y: -12 };
  const leaving = { x: travel.x * 2 / 3, y: travel.y * 2 / 3 };
  const win = await Compositor.createWindow({ role: 'overlay', anchor: 'top-left', display: display.display,
    size, offset, exclusiveZone: -1, namespace, msaaSamples: 1, transparent: true,
    renderingEnabled: false, keyboardInteractivity: 'none', acceptPointerEvents: false });
  const [root] = await Promise.all([UI.createElement(win, {
    renderable: { type: 'box', colour, cornerRadius: options.cornerRadius ?? (keyboard === 'none' ? RADIUS.surface : 0), cornerResolution: 16, origin: { x: 0.5, y: 0.5 } },
    item: { size }, contentAlign: 'fill', inheritAnimation: true, onHover: surfaceCursor(win)
  }), Compositor.setClearColor(win, 0, 0, 0, 0)]);
  const [motion] = await Promise.all([clips(win, root, {
    enter: [{ time: 0, opacity: 0, position: travel },
      { time: 0.24, opacity: 1, position: { x: 0, y: 0 }, ease: 'outCubic' }],
    hide: [{ time: 0.16, opacity: 0, position: leaving, ease: 'inQuad' },
      { time: 0.23, opacity: 0, position: leaving }],
    park: [{ time: 0, opacity: 0, position: travel },
      { time: 0.06, opacity: 0, position: travel }]
  }), UI.attachRoot(win, root)]);
  await UI.setAnimationTime(win, root, motion.ids.enter, 0);
  let shown = false, closed = false, finish;
  const parked = async () => {
    if (!finish) return;
    await Compositor.setWindowRenderingEnabled(win, false);
    const resolve = finish; finish = null; resolve();
  };
  await Promise.all([motion.onEnd('hide', parked), motion.onEnd('park', parked)]);
  const hide = async immediate => {
    shown = false;
    await Promise.all([Compositor.setPointerEvents(win, false), Compositor.setKeyboardInteractivity(win, 'none')]);
    await resetCursor(win);
    let fallback;
    const done = new Promise(resolve => {
      finish = resolve;
      fallback = setTimeout(async () => {
        closed = true; await destroySurface(win);
        const resolve = finish; finish = null; resolve?.();
      }, 500);
    });
    try {
      await Compositor.setWindowRenderingEnabled(win, true);
      await motion.play(immediate ? 'park' : 'hide');
      await done;
    } finally { clearTimeout(fallback); }
  };
  // Grow or shrink in place (no hide/show); call inside paint().
  const resize = async next => {
    if (next.x === size.x && next.y === size.y) return;
    await Promise.all([Compositor.resizeWindow(win, next.x, next.y), UI.setLayoutSize(win, root, next)]);
    size.x = next.x; size.y = next.y;
  };
  return { win, root, size, resize, get shown() { return shown; }, get closed() { return closed; },
    prepare: () => hide(true), hide,
    show: async () => {
      shown = true;
      await Compositor.setWindowRenderingEnabled(win, true);
      await motion.play('enter');
      await Promise.all([Compositor.setPointerEvents(win, options.pointerEvents !== false), Compositor.setKeyboardInteractivity(win, keyboard)]);
    },
    paint: async callback => {
      if (shown) await Compositor.setWindowRenderingEnabled(win, false);
      try { await callback(); }
      finally { if (shown && !closed) await Compositor.setWindowRenderingEnabled(win, true); }
    }
  };
}
