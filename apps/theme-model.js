// Skin resolution is independent of the renderer and native services.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function colour(value) {
  if (typeof value === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) {
    const hex = value.slice(1);
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).concat(hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1);
  }
  if (Array.isArray(value) && [3, 4].includes(value.length)
    && value.every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1)) {
    return [...value.slice(0, 3), value.length === 4 ? value[3] : 1];
  }
  throw new Error('Expected a #RRGGBB colour or an RGB/RGBA array with channels between 0 and 1');
}
export const opacity = (value, alpha) => [...value.slice(0, 3), alpha];
export const mix = (base, tint, amount) => base.map((channel, i) => channel + (tint[i] - channel) * amount);
const luminance = value => value.slice(0, 3).reduce((sum, channel, i) => sum + [0.2126, 0.7152, 0.0722][i]
  * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4), 0);
export function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
const composite = (value, background) => mix(background, opacity(value, 1), value[3]);
function readable(value, backgrounds, preferred, minimum = 4.5) {
  const surfaces = Array.isArray(backgrounds[0]) ? backgrounds : [backgrounds];
  for (let step = 0; step <= 100; step++) {
    const candidate = mix(value, preferred, step / 100);
    if (surfaces.every(background => contrast(candidate, background) >= minimum)) return candidate;
  }
  return preferred;
}

const defaultPalette = { background: '#111f1b', foreground: '#f4e9d8', accent: '#d96a1d' };
const paletteKeys = ['background', 'foreground', 'accent', 'good', 'warn', 'off'];

// Overrides may contain literal colours or references such as {ref:'surface.card'}.
// Resolve references after applying overrides, so aliases follow their final values.
export function createTheme(config = {}) {
  if (!object(config)) throw new Error('Skin must be an object');
  for (const key of Object.keys(config)) if (!['name', 'palette', 'overrides'].includes(key)) throw new Error('Unknown skin field: ' + key);
  if (config.name !== undefined && (typeof config.name !== 'string' || !config.name.trim() || config.name.length > 80)) throw new Error('Invalid skin name');
  if (config.palette !== undefined && !object(config.palette)) throw new Error('Palette must be an object');
  const supplied = config.palette || {};
  for (const key of Object.keys(supplied)) if (!paletteKeys.includes(key)) throw new Error('Unknown palette colour: ' + key);
  const palette = Object.fromEntries(Object.entries({ ...defaultPalette, ...supplied }).map(([key, value]) => [key, colour(value)]));
  for (const [key, value] of Object.entries(palette)) if (value[3] !== 1) throw new Error('Palette colours must be opaque: ' + key);
  const { background, foreground, accent } = palette;
  const ref = path => ({ ref: path });
  const derive = (dependencies, compute) => ({ dependencies, compute });
  const tokens = {};
  const group = (name, values) => { for (const [key, value] of Object.entries(values)) tokens[name + '.' + key] = value; };
  group('surface', {
    background, accent, card: mix(background, foreground, 0.06), control: mix(background, foreground, 0.14),
    field: ref('surface.control'), fieldInset: ref('surface.card'), selected: mix(background, accent, 0.22),
    rowHover: ref('surface.control'), controlHover: mix(background, foreground, 0.21),
    track: ref('surface.controlHover'), thumb: foreground, overlay: opacity(background, 0.95),
    avatar: derive(['surface.accent'], value => opacity(value, 0.2)),
    thumbnailAction: derive(['surface.card'], value => opacity(value, 0.85)),
    inset: derive(['surface.card'], value => opacity(value, 0.9)), mutedFill: ref('health.off')
  });
  group('text', {
    primary: foreground,
    secondary: derive(['surface.background', 'surface.card', 'surface.control', 'surface.field', 'surface.fieldInset', 'surface.selected', 'text.primary'],
      (background, card, control, field, inset, selected, text) => readable(mix(card, text, 0.62),
        [background, card, control, field, inset, selected].map(value => composite(value, background)), text)),
    disabled: mix(background, foreground, 0.42), caret: ref('surface.accent'),
    accent: derive(['surface.background', 'surface.accent', 'text.primary'], (base, tint, text) => readable(tint, base, text)),
    onAccent: derive(['surface.accent', 'surface.background', 'text.primary'], (base, bg, fg) => {
      const candidates = [bg, fg, [0, 0, 0, 1], [1, 1, 1, 1]];
      return candidates.find(value => contrast(value, composite(base, bg)) >= 4.5) || candidates[2];
    })
  });
  group('border', {
    surface: derive(['text.primary'], value => opacity(value, 0.07)),
    preview: derive(['text.primary'], value => opacity(value, 0.12)),
    divider: derive(['text.primary'], value => opacity(value, 0.14)),
    focus: ref('surface.accent'), selected: ref('surface.accent')
  });
  group('highlight', { hover: derive(['text.primary'], value => opacity(value, 0.08)) });
  group('health', { good: palette.good || ref('surface.accent'), warn: palette.warn || ref('text.primary'),
    off: palette.off || ref('text.secondary'), warningIndicator: ref('health.warn') });
  for (const state of ['good', 'warn', 'off']) {
    group('badge', {
      [state + 'Ring']: derive(['health.' + state], value => opacity(value, 0.45)),
      [state + 'Disc']: derive(['health.' + state], value => opacity(value, state === 'off' ? 0.16 : 0.18))
    });
  }
  group('shadow', { popover: [0, 0, 0, 0.55], card: [0, 0, 0, 0.4] });

  if (config.overrides !== undefined && !object(config.overrides)) throw new Error('Overrides must be an object');
  for (const [name, values] of Object.entries(config.overrides || {})) {
    if (!object(values)) throw new Error('Role group must be an object: ' + name);
    for (const [key, value] of Object.entries(values)) {
      const path = name + '.' + key;
      if (!own(tokens, path)) throw new Error('Unknown skin role: ' + path);
      if (object(value)) {
        if (Object.keys(value).length !== 1 || typeof value.ref !== 'string') throw new Error('Invalid role reference: ' + path);
        tokens[path] = ref(value.ref);
      } else tokens[path] = colour(value);
    }
  }
  const resolved = {}, resolving = new Set();
  const resolve = path => {
    if (own(resolved, path)) return resolved[path];
    if (!own(tokens, path)) throw new Error('Unknown role reference: ' + path);
    if (resolving.has(path)) throw new Error('Circular role reference: ' + path);
    resolving.add(path);
    const value = tokens[path];
    const result = value.ref ? resolve(value.ref) : value.compute ? value.compute(...value.dependencies.map(resolve)) : value;
    resolved[path] = colour(result); resolving.delete(path); return resolved[path];
  };
  const theme = { name: config.name || 'Custom', palette };
  for (const path of Object.keys(tokens)) {
    const [name, key] = path.split('.');
    (theme[name] ||= {})[key] = resolve(path);
  }
  if (theme.surface.background[3] !== 1) throw new Error('Surface background must be opaque');
  const textSurfaces = ['background', 'overlay', 'card', 'control', 'field', 'fieldInset', 'selected'];
  for (const [text, surface] of [...textSurfaces.map(surface => ['primary', surface]),
    ...textSurfaces.map(surface => ['secondary', surface]), ['onAccent', 'accent']]) {
    const base = composite(theme.surface[surface], theme.surface.background);
    if (contrast(composite(theme.text[text], base), base) < 4.5) throw new Error('Insufficient contrast: text.' + text + ' on surface.' + surface);
  }
  for (const values of Object.values(theme)) {
    if (!object(values)) continue;
    for (const value of Object.values(values)) Object.freeze(value);
    Object.freeze(values);
  }
  return Object.freeze(theme);
}
