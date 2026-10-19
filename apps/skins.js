import { createTheme } from './theme-model.js';

export const SKINS = [
  { id: 'koya', name: 'Koya', config: {
    name: 'Koya', palette: { background: '#0b0f12', foreground: '#e8ecef', accent: '#d96a1d', warn: '#f2a33a' },
    overrides: {
      surface: { overlay: '#12181df5', card: '#1e272e', control: '#2a343d', selected: '#14343a' },
      text: { secondary: '#a7b0b7', disabled: '#6f7a83' },
      border: { surface: '#1e272e' }
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
