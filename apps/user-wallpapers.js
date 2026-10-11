import * as Desktop from 'Module/desktop';
import * as Assets from 'Koya/Assets';
import * as Process from 'Module/process';
import * as Log from 'Helix/Log';
import { setUserWallpapers, allWallpapers } from './wallpapers.js';

// Rendered textures live in the cache; remount after changes so new files
// are visible under /rom.
const cache = () => Process.getEnv('XDG_CACHE_HOME', Process.getEnv('HOME', '') + '/.cache') + '/koya/wallpapers';
const mount = () => Assets.mount(cache(), '/rom');

export async function loadUserWallpapers() {
  try { const list = await Desktop.wallpapers(); await mount(); setUserWallpapers(list); }
  catch (error) { Log.error('Wallpapers: ' + error); }
  return allWallpapers();
}
export async function importWallpaper(source) {
  const item = await Desktop.importWallpaper(source);
  await loadUserWallpapers();
  return item;
}
export async function removeWallpaper(id) {
  await Desktop.removeWallpaper(id);
  return loadUserWallpapers();
}
