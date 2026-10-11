// Native hover runs for the entire ancestry. Resolve all hovered targets before
// applying a cursor so a surface background cannot overwrite its child control.
export function createCursorState() {
  const hovered = new Map(), captured = new Map();
  return {
    hover: (token, shape, priority, event) => {
      if (event.source !== 'mouse') return false;
      if (event.phase === 'leave') hovered.delete(token);
      else if (event.phase === 'enter' || event.phase === 'move') hovered.set(token, { shape, priority });
      return true;
    },
    drag: (shape, event) => {
      if (event.source !== 'mouse') return false;
      if (event.phase === 'start') captured.set(event.interactionId, shape);
      else if (event.phase === 'end' || event.phase === 'cancel') captured.delete(event.interactionId);
      return true;
    },
    clear: () => { hovered.clear(); captured.clear(); },
    get active() { return hovered.size > 0 || captured.size > 0; },
    get shape() {
      if (captured.size) return captured.values().next().value;
      let shape = 'default', priority = -Infinity;
      for (const target of hovered.values()) if (target.priority >= priority) { shape = target.shape; priority = target.priority; }
      return shape;
    }
  };
}
