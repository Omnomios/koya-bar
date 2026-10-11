// Logical desktop pixels; Hyprland owns output scaling.
// Inter, bundled as separate static weights (OFL, assets/fonts). postmarketOS
// ships Inter as a .ttc collection, and Koya loads only its first face, so
// a Fontconfig style such as 'Inter:style=SemiBold' would render Regular.
export const FONT = '/rom/assets/fonts/Inter-Regular.ttf';
export const FONT_STRONG = '/rom/assets/fonts/Inter-SemiBold.ttf';
export const WALLPAPER = '/rom/assets/wallpapers/waypaper-current.png';
export const WALLPAPER_SIZE = { x: 2560, y: 1600 };
// The top bar floats: a rounded strip `height` tall, `top` below the screen
// edge and `side` in from the left and right (matching Hyprland's gaps_out,
// so it lines up with tiled windows). Below it, the windows' own gap is the
// only space. BAR_HEIGHT is what it reserves.
export const BAR = { height: 28, top: 2, side: 3 };
export const BAR_HEIGHT = BAR.top + BAR.height;
// Explicit "let layout decide" size for item.size: fills a 'none' parent,
// fills the cross axis or measures the renderable in a flow.
export const AUTO = { x: 'auto', y: 'auto' };
export const NAV_HEIGHT = 0;

// Orange and warm cream from the Koya fish, on its deep green background.
export const CREAM = [244/255, 233/255, 216/255, 1];
export const ORANGE = [217/255, 106/255, 29/255, 1];
export const INK = [0.065, 0.13, 0.105, 1];
// Raised surfaces, from quietest to most prominent.
export const CARD = [0.095, 0.18, 0.14, 1];
export const CARD_PRESSED = [0.14, 0.24, 0.19, 1];
export const TONAL = [0.16, 0.25, 0.2, 1];
export const TRACK = [0.2, 0.3, 0.25, 1];
export const MUTED = [0.66, 0.72, 0.66, 1];
export const DISABLED = [0.48, 0.49, 0.44, 1];
export const CLEAR = [0, 0, 0, 0];
export const alpha = (colour, value) => [colour[0], colour[1], colour[2], value];
// Wallpaper tint behind the lock screen: dim enough for cream text.
export const SHEET_TINT = [0.15, 0.19, 0.17, 1];
// Translucent base for every overlay: apps, the launcher, popups and
// banners sit over the desktop instead of carrying their own copy of the
// wallpaper. Layer surfaces are only blurred when the compositor has a layer
// rule for them, so the surface stays legible without one.
export const POPOVER = alpha(INK, 0.95);

// Authored shadows, generated per window at run time (see shadow.js): blur
// radius (the shadow reaches about twice this past the surface), how far it
// drops, and its strength. Popovers and panels float high; cards sit low.
export const SHADOW = {
  popover: { blur: 8, offset: 6, alpha: 0.55 },
  card: { blur: 3, offset: 2, alpha: 0.4 }
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
export const TYPE = { display: 88, title: 20, heading: 16, body: 14, caption: 12 };
// Sheet headers share one height so titles and close buttons line up.
export const HEADER_HEIGHT = 44;
// Minimum hit target: comfortable for a pointer, still usable by touch.
export const TOUCH = 36;
// List rows: a title line over a caption line.
export const ROW = 52;
// Trailing icons (close, lock, chevron) centre this far inside the content
// edge, the same as a sheet header's close button, so they form one column.
export const TRAILING_INSET = TOUCH / 2;
