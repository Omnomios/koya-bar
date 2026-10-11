import { WALLPAPERS, isUserWallpaper } from './wallpapers.js';
import { clockDefaults } from './clock-model.js';

export const defaults = { Wallpaper: WALLPAPERS[0].id, ...clockDefaults };
export function settingValue(key, value) {
  if (key === 'Wallpaper' && (WALLPAPERS.some(item => item.id === value) || isUserWallpaper(value))) return value;
  if (key === 'ClockTimeFormat' && ['24h', '12h'].includes(value)) return value;
  if (['ClockShowDate', 'ClockShowSeconds'].includes(key)) {
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
