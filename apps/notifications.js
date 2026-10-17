import { session as Bus } from 'Module/dbus';
import * as UI from './theme-ui.js';
import * as Compositor from 'Koya/Compositor';
import * as Assets from 'Koya/Assets';
import * as Event from 'Helix/Event';
import * as Process from 'Module/process';
import * as Log from 'Helix/Log';
import { Notifications } from './notifications-model.js';
import { startNotifications, emitNotification } from './notifications-service.js';
import { notificationSurface } from './notification-surface.js';
import { button, pill, icon, text, label, children } from './touch-ui.js';
import { call } from './session.js';
import { controlCursor, surfaceCursor, destroySurface } from './cursor.js';
import { clips, animator, presets } from './motion.js';
import { shadow, withShadow, shadowReach } from './shadow.js';
import { createKit } from './kit.js';
import { popupContains } from './popup-layout.js';
import { FONT_STRONG, CLEAR, BAR_HEIGHT, RADIUS, TYPE, TEXT, ELEVATION, AUTO, SURFACE, HIGHLIGHT } from './theme.js';
import { MAX_VISIBLE_BANNERS, CARD_PADDING, CARD_ICON_SIZE, CARD_ICON_GAP, CARD_HEADER_HEIGHT, CARD_SUMMARY_HEIGHT, BODY_LINE_HEIGHT, ACTION_HEIGHT, ACTION_GAP,
  ACTIONS_PER_ROW, CENTER_HEADER_HEIGHT, CENTER_EMPTY_HEIGHT, CARD_GAP, notificationBody, notificationHeight,
  notificationTextWidth, notificationActions, notificationGeometry, centreItems, centreListHeight, notificationTime } from './notifications-layout.js';

const shellIcon = name => '/rom/assets/launcher/' + name + '.png';
const preview = (value, limit) => value.length > limit ? value.slice(0, Math.max(0, limit - 1)).trimEnd() + '…' : value;
const outputSize = display => ({ x: Number(display.logical_width || display.width), y: Number(display.logical_height || display.height) });
export function createNotifications(display, onUnread = () => {}) {
  let size = outputSize(display), center, toast, centerBoard, toastBoard, apps = [], connected = false;
  let requested = false, centerKey, bannerKey, iconVersion = 0;
  const icons = new Map(), banners = new Map(), unreadListeners = new Set([onUnread]);
  let state = {}, queue = Promise.resolve();
  const enqueue = job => {
    const next = queue.then(job); queue = next.catch(error => Log.error('Notifications: ' + error)); return next;
  };
  const unlocked = () => state.Active && state.ScreenState === 'unlocked' && state.PowerMenuState === 'closed';
  const mountIcons = () => Assets.mount(Process.getEnv('XDG_CACHE_HOME', Process.getEnv('HOME', '') + '/.cache') + '/koya/icons', '/rom');
  const resolveIcon = async item => {
    if (!item.icon) item.icon = apps.find(app => app.id === item.desktop + '.desktop' || app.id === item.desktop || app.name === item.app)?.iconName || '';
    if (!item.icon || icons.has(item.icon)) return;
    icons.set(item.icon, '');
    try {
      const texture = await call('ResolveIcon', 's', item.icon);
      if (texture) { await mountIcons(); icons.set(item.icon, texture); iconVersion++; enqueue(reconcile); }
    } catch (error) { Log.error('Notification icon: ' + error); }
  };
  const removeBanner = id => { clearTimeout(banners.get(id)); banners.delete(id); };
  const clearBanners = () => { for (const id of banners.keys()) removeBanner(id); };
  const model = new Notifications({ signal: (...args) => {
    try { emitNotification(Bus, ...args); } catch (error) { Log.error('Notification signal: ' + error); }
  }, changed: event => {
    if (event.type === 'notify') {
      removeBanner(event.item.id);
      if (event.item.urgency > 0) banners.set(event.item.id, setTimeout(() => {
        banners.delete(event.item.id); enqueue(reconcile);
      }, 5000));
      resolveIcon(event.item);
    }
    for (const id of banners.keys()) if (!model.records.get(id)?.active) removeBanner(id);
    for (const listener of unreadListeners) listener(model.unread, model.records.size);
    enqueue(reconcile);
  } });
  const activate = item => {
    if (!unlocked()) return;
    if (item.active && item.actions.some(action => action.key === 'default')) { model.invoke(item.id, 'default'); closeCenter(); }
    else openCenter();
  };
  const appIcon = item => icons.get(item.icon) || shellIcon('bell');
  // Icon column on the left; app · time, title, body and actions on the
  // right. Dismissing slides the card away before the model drops it.
  const card = async (surface, parent, item, width, actions = true) => {
    const win = surface.win, height = notificationHeight(item, width, actions), inner = height - CARD_PADDING * 2;
    const column = notificationTextWidth(width), body = notificationBody(item), choices = notificationActions(item, actions);
    const bodyHeight = notificationHeight(item, width, false) - CARD_PADDING * 2 - CARD_HEADER_HEIGHT - CARD_SUMMARY_HEIGHT - 2;
    const node = await UI.createElement(win, {
      // Banners float over the desktop on their own; in the centre, cards sit on its surface.
      renderable: { type: 'box', colour: surface === toast ? ELEVATION.banner.surface : SURFACE.card, cornerRadius: RADIUS.surface, cornerResolution: 16, origin: { x: 0.5, y: 0.5 } },
      layout: { type: 'row', gap: CARD_ICON_GAP, padding: { l: CARD_PADDING, r: CARD_PADDING, t: CARD_PADDING, b: CARD_PADDING } },
      item: { size: { x: width, y: height } }, contentAlign: 'fill', inheritAnimation: true,
      onActivate: () => activate(item), onHover: controlCursor(win)
    });
    let leaving = false;
    const [motion] = await Promise.all([clips(win, node, { leave: [{ time: 0.16, opacity: 0, position: { x: 28, y: 0 }, ease: 'inQuad' }] })]);
    const dismiss = () => {
      if (!unlocked() || leaving) return;
      leaving = true; motion.play('leave');
      setTimeout(() => model.close(item.id), 160);
    };
    const spacer = size => UI.createElement(win, { item: { size: { x: column, y: size } } });
    const iconColumn = async () => {
      const slot = await UI.createElement(win, { layout: { type: 'column' }, item: { size: { x: CARD_ICON_SIZE, y: inner } } });
      await icon(win, slot, appIcon(item), CARD_ICON_SIZE, CARD_ICON_SIZE, CARD_ICON_SIZE);
      return slot;
    };
    const header = async () => {
      const row = await UI.createElement(win, { layout: { type: 'row', gap: 6, alignItems: 'center' }, item: { size: { x: column, y: CARD_HEADER_HEIGHT } } });
      await children(win, row, [
        label(win, null, preview(item.app, 32), TYPE.caption, column - 6 - 56 - 6 - 18, CARD_HEADER_HEIGHT, item.urgency === 2 ? TEXT.accent : TEXT.secondary),
        text(win, null, notificationTime(item.time), TYPE.caption, 56, CARD_HEADER_HEIGHT, TEXT.secondary, undefined, 'right'),
        button(win, null, '', 18, CARD_HEADER_HEIGHT, dismiss, { colour: CLEAR, icon: shellIcon('close'), iconSize: 10 })
      ]);
      return row;
    };
    const actionRow = async row => {
      const line = await UI.createElement(win, { layout: { type: 'row', gap: ACTION_GAP }, item: { size: { x: column, y: ACTION_HEIGHT } } });
      const each = (column - ACTION_GAP * (ACTIONS_PER_ROW - 1)) / ACTIONS_PER_ROW;
      const share = (column - ACTION_GAP * (row.length - 1)) / row.length;
      await children(win, line, row.map(action => pill(win, null, preview(action.label, 20), row.length === ACTIONS_PER_ROW ? each : share,
        () => { if (unlocked()) { model.invoke(item.id, action.key); closeCenter(); } },
        { colour: surface === toast ? SURFACE.card : SURFACE.control, hover: HIGHLIGHT.hover, height: ACTION_HEIGHT, size: TYPE.caption })));
      return line;
    };
    const content = async () => {
      const node = await UI.createElement(win, { layout: { type: 'column' }, item: { size: { x: column, y: inner } } });
      await children(win, node, [
        header(),
        label(win, null, preview(item.summary || item.app, Math.floor(column / 7.5)), TYPE.body, column, CARD_SUMMARY_HEIGHT, TEXT.primary, FONT_STRONG),
        ...(body ? [spacer(2), label(win, null, preview(body, Math.floor(column / 6.5) * Math.round(bodyHeight / BODY_LINE_HEIGHT)), TYPE.detail, column, bodyHeight, TEXT.secondary)] : []),
        ...Array.from({ length: Math.ceil(choices.length / ACTIONS_PER_ROW) }, (_, index) => [
          spacer(index ? ACTION_GAP : 10), actionRow(choices.slice(index * ACTIONS_PER_ROW, (index + 1) * ACTIONS_PER_ROW))
        ]).flat()
      ]);
      return node;
    };
    await Promise.all([
      children(win, node, [iconColumn(), content()]),
      UI.setElementId(win, node, 'notification-' + item.id),
      ...(parent != null ? [UI.attach(win, parent, node)] : [])
    ]);
    return node;
  };
  const resetSurfaces = async () => {
    for (const surface of [center, toast]) if (surface && !surface.closed) await destroySurface(surface.win);
    center = toast = centerBoard = toastBoard = undefined; centerKey = bannerKey = undefined;
  };
  const move = async next => {
    if (next.display === display.display) { size = outputSize(next); return; }
    display = next; size = outputSize(next); await resetSurfaces();
  };
  // The centre is one transparent overlay covering the output, created once
  // per output size. The panel inside it resizes and repaints in place, so
  // dismissing never hides and re-shows the window. A click outside closes.
  let panel, panelShade, panelPlace, panelSize, centerKit;
  const placePanel = async () => {
    const win = center.win;
    if (panelShade) await UI.destroyElement(win, panelShade);
    panelShade = await shadow(win, center.root, panelSize, panelPlace, ELEVATION.popover.shadow);
    await UI.setLayoutAABB(win, panel.id, { min: panelPlace, max: { x: panelPlace.x + panelSize.x, y: panelPlace.y + panelSize.y } });
  };
  const paintCenter = async () => {
    const geometry = notificationGeometry(size, BAR_HEIGHT), width = geometry.width, inner = width - CARD_PADDING * 2;
    // Every lasting notification in one list; the panel fits it up to the
    // available height, and the list scrolls beyond that.
    const items = centreItems(model.items), listHeight = centreListHeight(items, inner);
    const available = Math.min(720, geometry.height) - CARD_PADDING * 2 - CENTER_HEADER_HEIGHT - CARD_GAP;
    const viewHeight = Math.min(listHeight, available);
    const height = CARD_PADDING * 2 + CENTER_HEADER_HEIGHT + CARD_GAP + viewHeight;
    if (!center || center.closed) {
      center = await notificationSurface(display, 'koya-notifications', { ...size }, { x: 0, y: 0 }, CLEAR, 'exclusive', { cornerRadius: 0 });
      centerBoard = centerKey = panelShade = undefined; centerKit = createKit(center.win);
      panelPlace = { x: geometry.x, y: geometry.y }; panelSize = { x: width, y: height };
      const catcher = await UI.createElement(center.win, { layout: { type: 'none' }, item: { size: AUTO }, onHover: surfaceCursor(center.win),
        onActivate: event => { if (!popupContains(event.local, panelPlace, panelSize)) closeCenter(); } });
      panel = await centerKit.surface('popover', { id: 'notifications-root', layout: { type: 'column', gap: CARD_GAP },
        padding: { t: CARD_PADDING, r: CARD_PADDING, b: CARD_PADDING, l: CARD_PADDING } });
      await Promise.all([UI.attach(center.win, center.root, catcher), UI.setClipToBounds(center.win, panel.id, true)]);
      await UI.attach(center.win, center.root, panel.id);
      await placePanel();
      await center.prepare();
    }
    const key = JSON.stringify([model.items, iconVersion, viewHeight]);
    if (centerKey === key) return;
    await center.paint(async () => {
      const win = center.win;
      // Grow or shrink in place; the shadow follows the panel's new size.
      if (panelSize.y !== height) { panelSize = { x: width, y: height }; await placePanel(); }
      if (centerBoard) await UI.destroyElement(win, centerBoard);
      // An explicit height: a sizeless container in the content column would
      // measure zero tall, and hit-testing skips children outside their
      // parent's bounds (everything would draw but nothing could be clicked).
      centerBoard = await UI.createElement(win, { id: 'notifications-board', layout: { type: 'column', gap: CARD_GAP },
        item: { size: { x: 'auto', y: CENTER_HEADER_HEIGHT + CARD_GAP + viewHeight } } });
      await UI.attach(win, panel.content, centerBoard);
      const header = async () => {
        const row = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center' }, item: { size: { x: 'auto', y: CENTER_HEADER_HEIGHT } } });
        // Both full header height, so they line up regardless of line metrics.
        const title = await text(win, row, 'Notifications', TYPE.heading, 'auto', CENTER_HEADER_HEIGHT, TEXT.primary, FONT_STRONG, 'left');
        await UI.setGrow(win, title, 1);
        if (items.length) await button(win, row, 'Clear all', 80, CENTER_HEADER_HEIGHT, () => unlocked() && model.clear(),
          { colour: CLEAR, hover: HIGHLIGHT.hover, labelColour: TEXT.accent, size: TYPE.caption, labelHeight: 28 });
        return row;
      };
      const list = async () => {
        const area = await centerKit.scrollArea({ height: viewHeight, gap: CARD_GAP, id: 'notifications-list' });
        if (items.length) await children(win, area.content, items.map(item => card(center, null, item, inner)));
        else await UI.attach(win, area.content, (await centerKit.emptyState({ glyph: shellIcon('bell'), message: 'No notifications', width: inner, height: CENTER_EMPTY_HEIGHT })).id);
        await area.setContentHeight(listHeight);
        return area.id;
      };
      await children(win, centerBoard, [header(), list()]);
    });
    centerKey = key;
  };
  // Banners live in one window for good: a change repaints it in place (with
  // rendering paused) and resizes it to fit, so nothing hides and re-shows;
  // only newly arrived cards rise in. Each card floats on its own shadow, so
  // the window carries the shadow's reach around the stack.
  let bannerIds = new Set(), bannerPlay;
  const showBanners = async () => {
    const outputs = await Compositor.listDisplays({ backend: 'wayland' });
    const focused = outputs.find(output => output.focused);
    if (focused) await move(focused);
    const geometry = notificationGeometry(size, BAR_HEIGHT), width = geometry.width, reach = shadowReach(ELEVATION.banner.shadow);
    const items = []; let height = 0;
    for (const item of model.items.filter(item => banners.has(item.id) && item.active).slice(0, MAX_VISIBLE_BANNERS)) {
      const next = notificationHeight(item, width, false) + reach * 2;
      if (height + next > geometry.height) break;
      height += next; items.push(item);
    }
    if (!items.length) { bannerIds = new Set(); if (toast?.shown) await toast.hide(); return; }
    const key = JSON.stringify([items.map(item => [item.id, item.revision]), iconVersion, geometry]);
    if (bannerKey !== key) {
      const windowSize = { x: width + reach * 2, y: height };
      if (!toast || toast.closed) {
        toast = await notificationSurface(display, 'koya-notification-banner', { ...windowSize },
          { x: geometry.x - reach, y: geometry.y - reach }, CLEAR);
        bannerPlay = animator(toast.win, 'Banners'); toastBoard = undefined; bannerIds = new Set();
        await toast.prepare();
      }
      const arrived = [];
      await toast.paint(async () => {
        const win = toast.win;
        await toast.resize(windowSize);
        if (toastBoard) await UI.destroyElement(win, toastBoard);
        toastBoard = await UI.createElement(win, { layout: { type: 'column' }, item: { size: AUTO } });
        await UI.attach(win, toast.root, toastBoard);
        for (const item of items) {
          const node = await card(toast, null, item, width, false);
          const wrapper = await withShadow(win, node, { x: width, y: notificationHeight(item, width, false) }, ELEVATION.banner.shadow);
          await UI.attach(win, toastBoard, wrapper);
          if (!bannerIds.has(item.id)) arrived.push(wrapper);
        }
      });
      bannerIds = new Set(items.map(item => item.id)); bannerKey = key;
      if (toast.shown) arrived.forEach((id, index) => bannerPlay(id, presets.rise(index, 0)));
    }
    if (!toast.shown) await toast.show();
  };
  async function reconcile() {
    if (!unlocked()) requested = false;
    if (!requested && center?.shown) await center.hide(!unlocked());
    if ((!unlocked() || requested || !banners.size) && toast?.shown) await toast.hide(!unlocked());
    if (!unlocked()) return;
    if (requested) { await paintCenter(); if (requested && !center.shown) await center.show(); }
    else if (banners.size) await showBanners();
  }
  function closeCenter() { requested = false; return enqueue(reconcile); }
  function openCenter() {
    if (!unlocked()) return Promise.resolve();
    requested = true; clearBanners(); model.read(); return enqueue(reconcile);
  }
  Event.on('keyDown', event => { if (center?.shown && event.id === center.win && [1, 65307].includes(Number(event.key))) closeCenter(); });
  const refreshApps = async () => {
    apps = await call('GetApplications'); await mountIcons();
    for (const item of model.items) resolveIcon(item);
    iconVersion++; enqueue(reconcile);
  };
  return { model,
    start: async () => {
      if (connected) return;
      await startNotifications(Bus, model); connected = true;
      refreshApps().catch(error => Log.error('Notification icons: ' + error));
    },
    get display() { return display; }, setDisplay: next => enqueue(() => move(next)),
    subscribe: listener => { unreadListeners.add(listener); listener(model.unread, model.records.size); return () => unreadListeners.delete(listener); },
    resize: next => enqueue(async () => {
      if (size.x === next.x && size.y === next.y) return;
      size = next; await resetSurfaces(); await reconcile();
    }),
    open: next => enqueue(async () => {
      if (requested && (!next || next.display === display.display)) { requested = false; await reconcile(); return; }
      if (next) await move(next);
      if (!unlocked()) return;
      requested = true; clearBanners(); model.read(); await reconcile();
    }), close: closeCenter, onApplications: refreshApps,
    onState: next => { state = next; return enqueue(reconcile); },
    get bannerWindow() { return toast?.shown ? toast.win : undefined; },
    get centerWindow() { return center?.shown ? center.win : undefined; }
  };
}
