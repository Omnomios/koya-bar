import { BAR_HEIGHT } from './theme.js';

// Keep Mako's dimensions and spacing, aligned to the bar's notification icon.
export const NOTIFICATION_WIDTH = 300, NOTIFICATION_MARGIN = 10, MAX_VISIBLE = 5;
export const CARD_PAD = 8, CARD_HEADER = 20, CARD_SUMMARY = 22, CARD_LINE = 18, ACTION_HEIGHT = 30;
export const CENTER_HEADER = 32, CENTER_FOOTER = 32, CARD_GAP = 10;
export const notificationBody = item => String(item.body || '').replace(/\s+/g, ' ').trim();
export function notificationHeight(item, width, actions = true) {
  const body = notificationBody(item);
  const lines = body ? Math.min(2, Math.ceil(body.length * 7 / Math.max(1, width - CARD_PAD * 2))) : 0;
  const actionCount = actions && item.active ? item.actions.filter(action => action.key !== 'default').length : 0;
  return CARD_PAD * 2 + CARD_HEADER + CARD_SUMMARY + (lines ? 4 + lines * CARD_LINE : 0)
    + (actionCount ? 6 + Math.ceil(actionCount / 2) * ACTION_HEIGHT + (Math.ceil(actionCount / 2) - 1) * 4 : 0);
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
