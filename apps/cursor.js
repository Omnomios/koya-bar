import * as Compositor from 'Koya/Compositor';
import * as Log from 'Helix/Log';
import { createCursorState } from './cursor-model.js';
import { forgetWindow } from './theme-ui.js';

const windows = new Map();
function cursorFor(win) {
  if (windows.has(win)) return windows.get(win);
  const state = createCursorState();
  let applied, dirty = false, running = false, stopped = false, pending = Promise.resolve(), serial = 0;
  const apply = () => {
    dirty = true;
    if (running) return pending;
    running = true;
    pending = Promise.resolve().then(async () => {
      while (dirty) {
        dirty = false;
        const shape = state.shape;
        if (shape === applied) continue;
        try {
          // Failed requests (e.g. before pointer enter) are retried on movement.
          if (await Compositor.setCursor(win, shape)) applied = shape;
        } catch (error) { if (!stopped) Log.error('Cursor: ' + error); }
      }
    }).finally(() => { running = false; if (dirty) return apply(); });
    return pending;
  };
  const cursor = {
    hover: (shape, priority) => {
      const token = ++serial;
      return event => {
        if (stopped || !state.hover(token, typeof shape === 'function' ? shape() : shape, priority, event)) return;
        // Reentering a surface must replace the previous client's cursor even
        // when our last requested shape was the same.
        if (event.phase === 'enter') applied = undefined;
        return apply();
      };
    },
    drag: shape => event => { if (!stopped && state.drag(shape, event)) return apply(); },
    reset: () => {
      const active = state.active; state.clear();
      if (active) { applied = undefined; return apply(); }
      return pending;
    },
    dispose: async () => {
      stopped = true;
      await cursor.reset();
      windows.delete(win);
    }
  };
  windows.set(win, cursor); return cursor;
}

export const surfaceCursor = win => cursorFor(win).hover('default', 0);
export const controlCursor = (win, shape = 'pointer') => cursorFor(win).hover(shape, 10);
export const dragCursor = (win, shape = 'ew-resize') => cursorFor(win).drag(shape);
export const resetCursor = win => windows.get(win)?.reset() || Promise.resolve();
export async function destroySurface(win) {
  const cursor = windows.get(win);
  if (cursor) await cursor.dispose();
  forgetWindow(win);
  return Compositor.destroyWindow(win);
}
