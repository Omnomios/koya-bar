import { colour, createTheme } from './theme-model.js';
import { skinConfig } from './skins.js';

export const themeGroups = {
  surface: 'Surfaces', text: 'Text', border: 'Borders & dividers',
  highlight: 'Highlights', health: 'Status colours', badge: 'Badges', shadow: 'Shadows'
};
export const colourName = key => ({ background: 'Background', foreground: 'Foreground', accent: 'Accent',
  good: 'Healthy', warn: 'Warning', off: 'Inactive', fieldInset: 'Inset field', rowHover: 'Row hover',
  controlHover: 'Control hover', thumbnailAction: 'Thumbnail action', mutedFill: 'Muted fill',
  onAccent: 'Text on accent', warningIndicator: 'Warning indicator' })[key]
  || (key[0].toUpperCase() + key.slice(1).replace(/[A-Z]/g, letter => ' ' + letter.toLowerCase()));
export const colourHex = value => '#' + value.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

export function themeDraft(value) {
  let savedValue, original, config, preview, error = '';
  const validate = () => {
    try { preview = createTheme(config); error = ''; }
    catch (failure) { error = failure.message; }
  };
  const load = value => {
    savedValue = value;
    config = JSON.parse(JSON.stringify(skinConfig(value)));
    original = JSON.stringify(config);
    validate();
  };
  load(value);
  return {
    get config() { return config; }, get preview() { return preview; }, get error() { return error; },
    get dirty() { return JSON.stringify(config) !== original; },
    get value() { createTheme(config); return JSON.stringify(config); },
    receive(value) {
      if (value === savedValue) return;
      if (JSON.stringify(config) === original) load(value);
      else { savedValue = value; original = JSON.stringify(skinConfig(value)); }
    },
    revert: () => load(savedValue),
    rename(name) { config.name = name; validate(); },
    read(path) {
      const [group, key] = path.split('.');
      const raw = group === 'palette' ? config.palette?.[key] : config.overrides?.[group]?.[key];
      if (raw && !raw.ref) return colour(raw);
      return group === 'palette' ? preview.palette[key] || preview.health[key] : preview[group][key];
    },
    custom(path) {
      const [group, key] = path.split('.');
      return group === 'palette' ? config.palette?.[key] !== undefined : config.overrides?.[group]?.[key] !== undefined;
    },
    set(path, value) {
      const [group, key] = path.split('.');
      if (group === 'palette') (config.palette ||= {})[key] = colour(value);
      else ((config.overrides ||= {})[group] ||= {})[key] = colour(value);
      validate();
    },
    reset(path) {
      const [group, key] = path.split('.');
      if (group === 'palette') delete config.palette?.[key];
      else {
        delete config.overrides?.[group]?.[key];
        if (config.overrides?.[group] && !Object.keys(config.overrides[group]).length) delete config.overrides[group];
        if (config.overrides && !Object.keys(config.overrides).length) delete config.overrides;
      }
      validate();
    },
    generate() { delete config.overrides; validate(); }
  };
}
