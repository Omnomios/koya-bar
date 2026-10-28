// Logical desktop pixels; Hyprland owns output scaling.
// Inter, bundled as separate static weights (OFL, assets/fonts). postmarketOS
// ships Inter as a .ttc collection, and Koya loads only its first face, so
// a Fontconfig style such as 'Inter:style=SemiBold' would render Regular.
export const FONT = '/rom/assets/fonts/Inter-Regular.ttf';
export const FONT_STRONG = '/rom/assets/fonts/Inter-SemiBold.ttf';
// The top bar floats: a rounded strip `height` tall, `top` below the screen
// edge and `side` in from the left and right (matching Hyprland's gaps_out,
// so it lines up with tiled windows). Below it, the windows' own gap is the
// only space. BAR_HEIGHT is what it reserves.
export const BAR = { height: 28, top: 2, side: 3 };
export const BAR_HEIGHT = BAR.top + BAR.height;
// Explicit "let layout decide" size for item.size: fills a 'none' parent,
// fills the cross axis or measures the renderable in a flow.
export const AUTO = { x: 'auto', y: 'auto' };

// Colour roles are stable handles. Native UI receives resolved snapshots;
// repaint bindings keep the handles, including a control's current state.
export { createTheme } from './theme-model.js';
import { createTheme, opacity } from './theme-model.js';
import { SKINS, skinConfig, skinValue } from './skins.js';

let theme = createTheme(SKINS[0].config), selectedSkin = 'koya', queue = Promise.resolve();
export let themeRevision = 0;
const roles = new WeakMap(), handles = new Map(), listeners = new Set();
const group = name => Object.fromEntries(Object.entries(theme[name]).map(([key, value]) => {
  const path = name + '.' + key, handle = [...value];
  roles.set(handle, () => theme[name][key]); handles.set(path, handle);
  return [key, handle];
}));
export const TEXT = group('text');
export const SURFACE = group('surface');
export const BORDER = group('border');
export const HIGHLIGHT = group('highlight');
export const HEALTH = group('health');
export const BADGE = group('badge');
export const SHADOW_COLOUR = group('shadow');
export const CLEAR = Object.freeze([0, 0, 0, 0]);
export const currentTheme = () => theme;
export const colourBinding = value => roles.get(value);
export const resolveColour = value => {
  const binding = roles.get(value);
  return binding ? [...binding()] : Array.isArray(value) ? [...value] : value;
};
export const alpha = (value, amount) => {
  const result = opacity(value, amount), binding = roles.get(value);
  if (binding) roles.set(result, () => opacity(binding(), amount));
  return result;
};
export function onThemeChanged(listener) {
  listeners.add(listener); return () => listeners.delete(listener);
}
function install(next, key) {
  const operation = queue.then(async () => {
    if (key === selectedSkin) return;
    theme = next; selectedSkin = key; themeRevision++;
    for (const [path, handle] of handles) {
      const [name, role] = path.split('.'); handle.splice(0, handle.length, ...theme[name][role]);
    }
    // Await repaint before notifying the caller that a skin has been applied.
    const results = await Promise.allSettled([...listeners].map(listener => Promise.resolve().then(() => listener(theme))));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) { selectedSkin = null; throw failed.reason; }
  });
  queue = operation.catch(() => {}); return operation;
}
export function setTheme(config) {
  const next = createTheme(config); return install(next, JSON.stringify(config));
}
export function setSkin(value = 'koya') {
  const key = skinValue(value); return install(createTheme(skinConfig(key)), key);
}
export const configureTheme = settings => {
  let value;
  try { value = skinValue(settings?.Skin || 'koya'); } catch (_) { value = 'koya'; }
  return setSkin(value);
};

// Authored shadows, generated per window at run time (see shadow.js): blur
// radius (the shadow reaches about twice this past the surface), how far it
// drops. Colour and strength come from SHADOW_COLOUR. Popovers and panels
// float high; cards sit low.
export const SHADOW = {
  popover: { blur: 8, offset: 6 },
  card: { blur: 3, offset: 2 }
};

// One spacing scale. GUTTER is the screen edge inset used by every sheet.
export const SPACE = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
export const GUTTER = 20;
// Tight, consistent corners: controls (buttons, fields, rows, switches) and
// surfaces (cards, banners, panels). Only grabbable handles are fully round:
// the on/off switch and the brightness slider thumb.
export const RADIUS = { control: 4, surface: 6 };
// Text sizes for a pointer-driven desktop: window titles, row titles, body
// copy and secondary captions. Display is the lock screen clock.
// `detail` is dense popover and card text, between body and caption.
export const TYPE = { display: 88, title: 20, heading: 16, body: 14, detail: 13, caption: 12 };
// Sheet headers share one height so titles and close buttons line up.
export const HEADER_HEIGHT = 44;
// Minimum hit target: comfortable for a pointer, still usable by touch.
export const MIN_CONTROL_SIZE = 36;
// List rows: a title line over a caption line.
export const LIST_ROW_HEIGHT = 52;

// ---- Elevation ------------------------------------------------------------
// One recipe per level: surface fill, hairline edge, corner radius and the
// authored shadow (a SHADOW key, or null). Inset is a surface sunk into a
// higher one (a card of details inside a popover).
export const ELEVATION = {
  bar: { surface: SURFACE.overlay, edge: BORDER.surface, radius: RADIUS.surface, shadow: null },
  popover: { surface: SURFACE.overlay, edge: BORDER.surface, radius: RADIUS.surface, shadow: 'popover' },
  panel: { surface: SURFACE.overlay, edge: BORDER.surface, radius: RADIUS.surface, shadow: 'popover' },
  banner: { surface: SURFACE.overlay, edge: BORDER.surface, radius: RADIUS.surface, shadow: 'card' },
  inset: { surface: SURFACE.inset, edge: null, radius: RADIUS.control, shadow: null },
  // A search block and the sheet hanging beneath it: solid where you type,
  // translucent where results gather, so the desktop shows through.
  block: { surface: SURFACE.background, edge: BORDER.surface, radius: RADIUS.surface, shadow: 'popover' },
  sheet: { surface: alpha(SURFACE.background, 0.78), edge: BORDER.surface, radius: RADIUS.surface, shadow: null }
};

// ---- Motion ---------------------------------------------------------------
// Durations (seconds), stagger step and easing roles shared by every surface.
export const MOTION = {
  fast: 0.12, base: 0.22, slow: 0.32, stagger: 0.04,
  enter: 'outCubic', exit: 'inQuad', settle: 'inOutQuad',
  // How far things travel as they arrive: a popover drops from the bar,
  // rows rise into place.
  drop: 10, rise: 8
};
