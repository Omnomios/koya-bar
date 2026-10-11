import { BAR_HEIGHT } from './theme.js';

// Cards: an app icon column, then app · time, a title, up to two lines of
// body and a row of actions. Banners and the centre share the anatomy.
export const NOTIFICATION_WIDTH = 360, NOTIFICATION_MARGIN = 10, MAX_VISIBLE = 5;
export const CARD_PAD = 12, CARD_ICON = 32, CARD_ICON_GAP = 12;
export const CARD_HEADER = 18, CARD_SUMMARY = 20, CARD_LINE = 18, ACTION_HEIGHT = 28, ACTION_GAP = 6, ACTIONS_PER_ROW = 3;
export const CENTER_HEADER = 36, CENTER_FOOTER = 32, CARD_GAP = 8, CENTER_EMPTY = 120;
export const notificationBody = item => String(item.body || '').replace(/\s+/g, ' ').trim();
// Width of the text column inside a card of the given outer width.
export const notificationTextWidth = width => Math.max(1, width - CARD_PAD * 2 - CARD_ICON - CARD_ICON_GAP);
export const notificationActions = (item, actions = true) => actions && item.active ? item.actions.filter(action => action.key !== 'default') : [];
export function notificationHeight(item, width, actions = true) {
  const body = notificationBody(item);
  const lines = body ? Math.min(2, Math.ceil(body.length * 6.5 / notificationTextWidth(width))) : 0;
  const rows = Math.ceil(notificationActions(item, actions).length / ACTIONS_PER_ROW);
  return CARD_PAD * 2 + CARD_HEADER + CARD_SUMMARY + (lines ? 2 + lines * CARD_LINE : 0)
    + (rows ? 10 + rows * ACTION_HEIGHT + (rows - 1) * ACTION_GAP : 0);
}
export function notificationGeometry(size, barHeight = BAR_HEIGHT) {
  const width = Math.min(NOTIFICATION_WIDTH, Math.max(1, size.x - NOTIFICATION_MARGIN * 2));
  return { width, x: Math.round(Math.max(0, size.x - width - NOTIFICATION_MARGIN)), y: barHeight + NOTIFICATION_MARGIN,
    height: Math.max(1, size.y - barHeight - NOTIFICATION_MARGIN * 2) };
}
export function notificationPages(items, width, available) {
  const pages = [[]]; let used = 0;
  for (const item of items.filter(item => !item.transient)) {
    const height = notificationHeight(item, width);
    const current = pages[pages.length - 1];
    if (current.length && (current.length >= MAX_VISIBLE || used + CARD_GAP + height > available)) {
      pages.push([]); used = 0;
    }
    const next = pages[pages.length - 1];
    used += height + (next.length ? CARD_GAP : 0); next.push(item);
  }
  return pages;
}
// Short relative times: "now", "5 min", "3 h", then the date.
export function notificationTime(time, now = Date.now()) {
  const minutes = Math.floor((now - time) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return minutes + ' min';
  if (minutes < 24 * 60) return Math.floor(minutes / 60) + ' h';
  const date = new Date(time);
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
