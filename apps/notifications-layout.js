import { BAR_HEIGHT } from './theme.js';

// Cards: an app icon column, then app · time, a title, up to two lines of
// body and a row of actions. Banners and the centre share the anatomy.
export const NOTIFICATION_WIDTH = 360, NOTIFICATION_MARGIN = 10, MAX_VISIBLE_BANNERS = 5;
export const CARD_PADDING = 12, CARD_ICON_SIZE = 32, CARD_ICON_GAP = 12;
export const CARD_HEADER_HEIGHT = 18, CARD_SUMMARY_HEIGHT = 20, BODY_LINE_HEIGHT = 18, ACTION_HEIGHT = 28, ACTION_GAP = 6, ACTIONS_PER_ROW = 3;
export const CENTER_HEADER_HEIGHT = 36, CARD_GAP = 8, CENTER_EMPTY_HEIGHT = 120;
export const notificationBody = item => String(item.body || '').replace(/\s+/g, ' ').trim();
// Width of the text column inside a card of the given outer width.
export const notificationTextWidth = width => Math.max(1, width - CARD_PADDING * 2 - CARD_ICON_SIZE - CARD_ICON_GAP);
export const notificationActions = (item, actions = true) => actions && item.active ? item.actions.filter(action => action.key !== 'default') : [];
export function notificationHeight(item, width, actions = true) {
  const body = notificationBody(item);
  const lines = body ? Math.min(2, Math.ceil(body.length * 6.5 / notificationTextWidth(width))) : 0;
  const rows = Math.ceil(notificationActions(item, actions).length / ACTIONS_PER_ROW);
  return CARD_PADDING * 2 + CARD_HEADER_HEIGHT + CARD_SUMMARY_HEIGHT + (lines ? 2 + lines * BODY_LINE_HEIGHT : 0)
    + (rows ? 10 + rows * ACTION_HEIGHT + (rows - 1) * ACTION_GAP : 0);
}
export function notificationGeometry(size, barHeight = BAR_HEIGHT) {
  const width = Math.min(NOTIFICATION_WIDTH, Math.max(1, size.x - NOTIFICATION_MARGIN * 2));
  return { width, x: Math.round(Math.max(0, size.x - width - NOTIFICATION_MARGIN)), y: barHeight + NOTIFICATION_MARGIN,
    height: Math.max(1, size.y - barHeight - NOTIFICATION_MARGIN * 2) };
}
// The centre lists every lasting notification (transient ones only banner);
// they scroll, so the content is as tall as the whole list.
export const centreItems = items => items.filter(item => !item.transient);
export const centreListHeight = (items, width) => items.length
  ? items.reduce((sum, item) => sum + notificationHeight(item, width), 0) + (items.length - 1) * CARD_GAP : CENTER_EMPTY_HEIGHT;
// Short relative times: "now", "5 min", "3 h", then the date.
export function notificationTime(time, now = Date.now()) {
  const minutes = Math.floor((now - time) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return minutes + ' min';
  if (minutes < 24 * 60) return Math.floor(minutes / 60) + ' h';
  const date = new Date(time);
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
