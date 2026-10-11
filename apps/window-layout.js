import * as Event from 'Helix/Event';
import * as Log from 'Helix/Log';

// The engine has already resized the surface and reflowed its layout. Only
// application geometry (grid capacity, pagination and artwork crops) is rebuilt.
export function windowLayout(win, apply) {
  let queue = Promise.resolve();
  let disposed = false;
  const handler = event => {
    if (disposed) return;
    if (event.id !== win) return;
    queue = queue.then(() => { if (!disposed) return apply({ x: event.width, y: event.height }); })
      .catch(error => Log.error('Window layout: ' + error));
  };
  Event.on('windowResized', handler);
  return () => { disposed = true; Event.off('windowResized', handler); };
}
