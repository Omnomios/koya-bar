import * as UI from 'Helix/UserInterface';
import * as Log from 'Helix/Log';
import { WALLPAPERS, wallpaperFor, wallpaperFrame, knownWallpaper, isUserWallpaper } from './wallpapers.js';
import { loadUserWallpapers } from './user-wallpapers.js';

let selected = WALLPAPERS[0], serial = 0, queue = Promise.resolve();
const surfaces = new Set();

// Share the current artwork across the desktop background and lock screen.
// The catalogue can grow at run time (imported images), so each surface holds
// one sprite for the current wallpaper and swaps it when the choice changes.
const artwork = (win, size, colour) => UI.createElement(win, {
  renderable: { type: 'sprite', texture: selected.texture, frame: 0, frames: [wallpaperFrame(selected, size, colour)] },
  item: { size }, contentAlign: 'fill'
});

export async function wallpaperSurface(win, size, colour = [1, 1, 1, 1]) {
  // Keep the host (and its animation identity) while replacing the sprite.
  const name = 'wallpaper-surface-' + ++serial;
  const [id, sprite] = await Promise.all([UI.createElement(win, {
    id: name, renderable: { type: 'box', colour: [0, 0, 0, 0] },
    item: { size }, contentAlign: 'fill', inheritAnimation: true
  }), artwork(win, size, colour)]);
  const surface = { win, id, name, size: { ...size }, colour, sprite };
  await UI.attach(win, id, surface.sprite);
  surfaces.add(surface);
  return id;
}

const replace = async (surface, size = surface.size) => {
  const sprite = await artwork(surface.win, size, surface.colour);
  await Promise.all([UI.attach(surface.win, surface.id, sprite), UI.destroyElement(surface.win, surface.sprite)]);
  surface.sprite = sprite;
};

export function resizeWallpaper(win, id, size) {
  queue = queue.then(async () => {
    const surface = [...surfaces].find(value => value.win === win && value.id === id);
    if (!surface || surface.size.x === size.x && surface.size.y === size.y) return;
    await Promise.all([replace(surface, size), UI.setLayoutSize(win, id, size)]);
    surface.size = { ...size };
  });
  return queue;
}

export function configureWallpaper(state) {
  queue = queue.then(async () => {
    // A newly imported wallpaper is not in this process's catalogue yet.
    if (isUserWallpaper(state.Wallpaper) && !knownWallpaper(state.Wallpaper)) await loadUserWallpapers();
    const next = wallpaperFor(state.Wallpaper);
    if (next.id === selected.id && next.texture === selected.texture) return;
    selected = next;
    await Promise.all([...surfaces].map(async surface => {
      try {
        // Sheets can be destroyed while parked. Drop those bindings safely.
        if (await UI.getElementById(surface.win, surface.name) !== surface.id) { surfaces.delete(surface); return; }
        await replace(surface);
      } catch (error) {
        surfaces.delete(surface);
        Log.error('Wallpaper surface: ' + error);
      }
    }));
  });
  return queue;
}
