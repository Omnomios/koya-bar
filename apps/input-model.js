import { clampVolume } from './audio-model.js';

// A second contact must not release the visual held by the first one.
export function pressFeedback({ start = () => {}, end = () => {}, cancel = () => {} } = {}) {
  const held = new Set();
  return event => {
    if (event.phase === 'start') {
      const first = held.size === 0;
      held.add(event.interactionId);
      if (first) start(event);
    } else if (event.phase === 'end' || event.phase === 'cancel') {
      if (!held.delete(event.interactionId) || held.size) return;
      (event.phase === 'cancel' ? cancel : end)(event);
    }
  };
}

// The first dragging contact owns this scalar control until it ends or cancels.
// Native capture keeps its local coordinates valid outside the slider.
export function volumeInput({ setPercent, available = () => true, travel = 152, inset = 6 }) {
  let owner, closed = false;
  const seek = event => {
    if (available()) setPercent(clampVolume((event.local.x - inset) / travel * 100));
  };
  return {
    onActivate: event => { if (!closed && owner === undefined) seek(event); },
    onDrag: event => {
      if (closed) return;
      if (event.phase === 'start' && owner === undefined && available()) owner = event.interactionId;
      if (owner !== event.interactionId) return;
      if (event.phase === 'start' || event.phase === 'change' || event.phase === 'end') seek(event);
      if (event.phase === 'end' || event.phase === 'cancel') owner = undefined;
    },
    dispose: () => { closed = true; owner = undefined; }
  };
}
