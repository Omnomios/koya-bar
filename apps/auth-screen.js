import * as UI from './theme-ui.js';
import { clockPresentation } from './clock-model.js';
import { wallpaperSurface, resizeWallpaper } from './wallpaper-surface.js';
import { windowLayout } from './window-layout.js';
import { text, children } from './touch-ui.js';
import { surfaceCursor } from './cursor.js';
import { createKit } from './kit.js';
import { animator, presets } from './motion.js';
import { withShadow } from './shadow.js';
import { TYPE, SPACE, TEXT, ELEVATION, AUTO, SURFACE } from './theme.js';

// The screen the lock and the login greeter share: the wallpaper, dimmed,
// with the clock and date over a centred card. Layout places everything.
// Cross-axis alignment only centres children within their line (the widest
// child), so horizontal centring comes from a full-screen row's
// justifyContent; inside it, a form-width column (its height left to the
// row) centres the stack vertically. The card rises in.
export const AUTH_CARD_WIDTH = 320, AUTH_CARD_PADDING = 20;
const DIM = [0.4, 0.45, 0.4, 1];

const formWidth = size => Math.max(40, Math.min(420, size.x - 40));
// timeWidth reserves room for the longest clock string at the bar's 14 px
// reference size. Scale that allowance to keep AM/PM and seconds in the form.
const timeSize = (size, view) => Math.min(TYPE.display, size.y / 8, formWidth(size) * 14 / view.timeWidth);

// `build(card)` fills the card's content column; `name` prefixes element ids.
// Resolves to the screen: its parts, play, paintClock(settings) and stop().
export async function authScreen(win, { size, name, cardHeight, clock, build }) {
  const kit = createKit(win), play = animator(win, name);
  const width = formWidth(size);
  const view = clockPresentation(new Date(), clock);
  const [root] = await Promise.all([
    UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.background }, layout: { type: 'none' }, item: { size: AUTO }, contentAlign: 'fill', onHover: surfaceCursor(win) }),
    UI.setClearColour(win, SURFACE.background)
  ]);
  // The wallpaper crop needs the output size; the content column fills.
  const [wall, centre] = await children(win, root, [
    wallpaperSurface(win, size, DIM),
    UI.createElement(win, { layout: { type: 'row', justifyContent: 'center' }, item: { size: AUTO } })
  ]);
  const content = await UI.createElement(win, { layout: { type: 'column', gap: SPACE.s, justifyContent: 'center', alignItems: 'center' },
    item: { size: { x: width, y: 'auto' } } });
  await UI.attach(win, centre, content);
  const card = await kit.surface('panel', { size: { x: AUTH_CARD_WIDTH, y: cardHeight }, layout: { type: 'column', gap: SPACE.s },
    padding: { t: AUTH_CARD_PADDING, r: AUTH_CARD_PADDING, b: AUTH_CARD_PADDING, l: AUTH_CARD_PADDING } });
  const [timeLabel, dateLabel] = await Promise.all([
    text(win, null, view.time, timeSize(size, view), width, Math.min(112, size.y / 6), TEXT.primary),
    text(win, null, view.date, TYPE.body, width, 28, TEXT.secondary)
  ]);
  await build(card, kit);
  const cardWrapper = await withShadow(win, card.id, { x: AUTH_CARD_WIDTH, y: cardHeight }, ELEVATION.panel.shadow);
  // Reading order made explicit (siblings sort by order, then creation).
  for (const [index, id] of [timeLabel, dateLabel, cardWrapper].entries()) { await UI.setLayoutOrder(win, id, index); await UI.attach(win, content, id); }
  await UI.setMargin(win, cardWrapper, { t: SPACE.xl, r: 0, b: 0, l: 0 });
  await Promise.all([
    UI.attachRoot(win, root),
    UI.setElementId(win, timeLabel, name + '-clock'), UI.setElementId(win, dateLabel, name + '-date'),
    UI.setEnabled(win, dateLabel, view.showDate)
  ]);
  play(cardWrapper, presets.rise(0, 0.05));
  const screen = { win, root, wall, content, card: cardWrapper, panel: card, timeLabel, dateLabel, size, play, kit, clock,
    clockKey: JSON.stringify([view.time, view.date, view.showDate]) };
  // Layout follows the output; only the wallpaper crop and the clock's size
  // depend on it.
  screen.stop = windowLayout(win, async next => {
    screen.size = next;
    const width = formWidth(next);
    await Promise.all([
      resizeWallpaper(win, wall, next),
      UI.setLayoutSize(win, content, { x: width, y: 'auto' }),
      UI.setLayoutSize(win, timeLabel, { x: width, y: Math.min(112, next.y / 6) }),
      UI.setLayoutSize(win, dateLabel, { x: width, y: 28 }),
      UI.setTextSize(win, timeLabel, timeSize(next, clockPresentation(new Date(), screen.clock)))
    ]);
  });
  // Repaint the clock when its text changes (call every second).
  screen.paintClock = async (clock = screen.clock) => {
    screen.clock = clock;
    const view = clockPresentation(new Date(), clock);
    const key = JSON.stringify([view.time, view.date, view.showDate]);
    if (screen.clockKey === key) return;
    await Promise.all([
      UI.setTextString(win, timeLabel, view.time),
      UI.setTextString(win, dateLabel, view.date),
      UI.setEnabled(win, dateLabel, view.showDate),
      UI.setTextSize(win, timeLabel, timeSize(screen.size, view))
    ]);
    screen.clockKey = key;
  };
  return screen;
}
