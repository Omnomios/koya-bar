import { createTheme } from './theme-model.js';

export const SKINS = [
  { id: 'koya', name: 'Koya', config: {
    name: 'Koya', palette: { background: [0.065, 0.13, 0.105, 1], foreground: '#f4e9d8', accent: '#d96a1d' },
    overrides: {
      text: { secondary: [0.66, 0.72, 0.66, 1], disabled: [0.48, 0.49, 0.44, 1] },
      surface: { card: [0.095, 0.18, 0.14, 1], control: [0.16, 0.25, 0.2, 1], selected: { ref: 'surface.control' },
        controlHover: [0.2, 0.3, 0.25, 1] },
      // Preserve the original badge treatment for the default skin.
      badge: { warnRing: { ref: 'badge.goodRing' }, warnDisc: { ref: 'badge.goodDisc' } },
      health: { warningIndicator: { ref: 'surface.accent' } }
    }
  } },
  { id: 'koya-light', name: 'Koya light', config: {
    name: 'Koya light', palette: { background: '#f4e9d8', foreground: '#11211b', accent: '#a6440a' }
  } }
];

export function skinConfig(value = 'koya') {
  const builtIn = SKINS.find(skin => skin.id === value);
  if (builtIn) return builtIn.config;
  if (typeof value !== 'string' || value.length > 32768) throw new Error('Invalid skin');
  let config;
  try { config = JSON.parse(value); } catch (_) { throw new Error('Unknown skin: ' + value); }
  createTheme(config);
  return config;
}
export function skinValue(value) {
  const config = skinConfig(value);
  return SKINS.some(skin => skin.id === value) ? value : JSON.stringify(config);
}
export const skinName = value => skinConfig(value).name || 'Custom';
