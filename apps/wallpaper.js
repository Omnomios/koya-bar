import * as Compositor from 'Koya/Compositor';
import * as UI from 'Helix/UserInterface';
import { connect } from './session.js';
import { wallpaperSurface, resizeWallpaper } from './wallpaper-surface.js';
import { windowLayout } from './window-layout.js';

export default async (options = {}) => {
  const displays = await Compositor.listDisplays();
  const display = options.display || displays[0];
  const win = await Compositor.createWindow({
    role: 'background', display: display?.display || '',
    exclusiveZone: -1, namespace: 'koya-background', msaaSamples: 1,
    keyboardInteractivity: 'none', acceptPointerEvents: false
  });
  const info = await Compositor.getWindowInfo(win);
  if (info.role !== 'background') throw new Error('Wallpaper requires layer-shell');
  const wallpaper = await wallpaperSurface(win, { x: info.width, y: info.height });
  await UI.attachRoot(win, wallpaper);
  const stopLayout = windowLayout(win, async size => {
    await Compositor.setWindowRenderingEnabled(win, false);
    try { await resizeWallpaper(win, wallpaper, size); }
    finally { await Compositor.setWindowRenderingEnabled(win, true); }
  });
  const disconnect = connect('wallpaper');
  return { window: win, dispose: async () => { disconnect(); stopLayout(); await Compositor.destroyWindow(win); } };
};
