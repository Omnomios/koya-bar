// A single contact owns the gesture. Hardware writes happen on release;
// cancelling or disposing a drag never commits its preview value.
export function scalarInput({ minimum = 0, maximum = 100, width, inset = 6, step = 1, available = () => true, preview, commit, cancel = () => {} }) {
  let owner, dragging = false, disposed = false, suppressActivation;
  const seek = event => Math.max(minimum, Math.min(maximum, Math.round((minimum +
    Math.max(0, Math.min(1, (event.local.x - inset) / (width - inset * 2))) * (maximum - minimum)) / step) * step));
  return {
    onActivate(event) {
      if (suppressActivation !== undefined && suppressActivation === event.interactionId) { suppressActivation = undefined; return; }
      if (!disposed && !dragging && available()) { const value = seek(event); preview(value); commit(value); }
    },
    onDrag(event) {
      if (disposed) return;
      if (event.phase === 'start' && !dragging && available()) { owner = event.interactionId; dragging = true; }
      if (!dragging || owner !== event.interactionId) return;
      if (event.phase === 'cancel' || !available()) { dragging = false; owner = undefined; cancel(); return; }
      preview(seek(event));
      if (event.phase === 'end') { dragging = false; owner = undefined; suppressActivation = event.interactionId; commit(seek(event)); }
    },
    get dragging() { return dragging; },
    dispose() { disposed = true; dragging = false; owner = undefined; }
  };
}
