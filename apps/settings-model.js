import { WALLPAPERS, isUserWallpaper } from './wallpapers.js';
import { clockDefaults } from './clock-model.js';
import { skinValue } from './skins.js';

// GreeterWallpaper: the login screen may show this account's wallpaper
// (built-ins only) once it knows the account.
export const defaults = { Wallpaper: WALLPAPERS[0].id, Skin: 'koya', GreeterWallpaper: false, ...clockDefaults };
export function settingValue(key, value) {
  if (key === 'Skin') return skinValue(value);
  if (key === 'Wallpaper' && (WALLPAPERS.some(item => item.id === value) || isUserWallpaper(value))) return value;
  if (key === 'ClockTimeFormat' && ['24h', '12h'].includes(value)) return value;
  if (['ClockShowDate', 'ClockShowSeconds', 'GreeterWallpaper'].includes(key)) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
  }
  throw new Error('Invalid setting: ' + key);
}
export function readSettings(value) {
  const result = { ...defaults };
  for (const [key, item] of Object.entries(value || {})) {
    try { result[key] = settingValue(key, item); } catch (_) {}
  }
  return result;
}
