import { session as Bus } from 'Module/dbus';
import * as UI from 'Helix/UserInterface';
import * as Compositor from 'Koya/Compositor';
import * as Assets from 'Koya/Assets';
import * as Event from 'Helix/Event';
import * as Process from 'Module/process';
import * as Log from 'Helix/Log';
import { Notifications } from './notifications-model.js';
import { startNotifications, emitNotification } from './notifications-service.js';
import { notificationSurface } from './notification-surface.js';
import { button, icon, text, label, children } from './touch-ui.js';
import { call } from './session.js';
import { controlCursor, destroySurface } from './cursor.js';
import { CREAM, ORANGE, INK, CARD, MUTED, CLEAR, POPOVER, BAR_HEIGHT, RADIUS } from './theme.js';
import { MAX_VISIBLE, CARD_PAD, CARD_HEADER, CARD_SUMMARY, CARD_LINE, ACTION_HEIGHT, CENTER_HEADER,
  CENTER_FOOTER, CARD_GAP, notificationBody, notificationHeight, notificationGeometry, notificationPages } from './notifications-layout.js';

const shellIcon = name => '/rom/assets/launcher/' + name + '.png';
const preview = (value, limit) => value.length > limit ? value.slice(0, Math.max(0, limit - 1)).trimEnd() + '…' : value;
const outputSize = display => ({ x: Number(display.logical_width || display.width), y: Number(display.logical_height || display.height) });
export function createNotifications(display, onUnread = () => {}) {
  let size = outputSize(display), center, toast, centerBoard, toastBoard, apps = [], connected = false;
  let requested = false, page = 0, centerKey, bannerKey, iconVersion = 0;
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
  const card = async (surface, parent, item, width, actions = true) => {
    const win = surface.win, height = notificationHeight(item, width, actions), inner = width - CARD_PAD * 2;
    const node = await UI.createElement(win, {
      // Banners float over the desktop on their own; in the centre, cards sit on its surface.
      renderable: { type: 'box', colour: surface === toast ? POPOVER : CARD, cornerRadius: RADIUS.surface, cornerResolution: 16 },
      layout: { type: 'column', padding: { l: CARD_PAD, r: CARD_PAD, t: CARD_PAD, b: CARD_PAD } },
      item: { size: { x: width, y: height } }, contentAlign: 'fill', onActivate: () => activate(item), onHover: controlCursor(win)
    });
    const body = notificationBody(item);
    const bodyHeight = notificationHeight(item, width, false) - CARD_PAD * 2 - CARD_HEADER - CARD_SUMMARY - 4;
    const choices = actions && item.active ? item.actions.filter(action => action.key !== 'default') : [];
    const spacer = height => UI.createElement(win, { item: { size: { x: inner, y: height } } });
    const header = async () => {
      const row = await UI.createElement(win, { layout: { type: 'row', gap: 6, alignItems: 'center' }, item: { size: { x: inner, y: CARD_HEADER } } });
      await children(win, row, [
        icon(win, null, appIcon(item), 16, 18, CARD_HEADER),
        label(win, null, preview(item.app, 30), 12, inner - 18 - 24 - 12, CARD_HEADER, item.urgency === 2 ? ORANGE : MUTED),
        button(win, null, '', 24, CARD_HEADER, () => unlocked() && model.close(item.id),
          { colour: CLEAR, icon: shellIcon('close'), iconSize: 12 })
      ]);
      return row;
    };
    const actionRow = async choices => {
      const row = await UI.createElement(win, { layout: { type: 'row', gap: 4 }, item: { size: { x: inner, y: ACTION_HEIGHT } } });
      await children(win, row, choices.map(action => button(win, null, preview(action.label, 18), (inner - 4) / 2, ACTION_HEIGHT,
        () => { if (unlocked()) { model.invoke(item.id, action.key); closeCenter(); } },
        { colour: INK, labelColour: ORANGE, size: 12, labelHeight: ACTION_HEIGHT })));
      return row;
    };
    await Promise.all([
      children(win, node, [
        header(), label(win, null, preview(item.summary || item.app, Math.floor(inner / 8)), 14, inner, CARD_SUMMARY),
        ...(body ? [spacer(4), label(win, null, preview(body, Math.floor(inner / 7) * Math.round(bodyHeight / CARD_LINE)), 13, inner, bodyHeight, CREAM)] : []),
        ...Array.from({ length: Math.ceil(choices.length / 2) }, (_, index) => [
          spacer(index ? 4 : 6), actionRow(choices.slice(index * 2, index * 2 + 2))
        ]).flat()
      ]),
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
  const paintCenter = async () => {
    const geometry = notificationGeometry(size, BAR_HEIGHT), width = geometry.width;
    const available = Math.min(600, geometry.height) - CARD_PAD * 2 - CENTER_HEADER - CENTER_FOOTER - CARD_GAP * 2;
    const groups = notificationPages(model.items, width - CARD_PAD * 2, available);
    page = Math.min(page, groups.length - 1);
    const items = groups[page], inner = width - CARD_PAD * 2;
    const listHeight = items.length ? items.reduce((sum, item) => sum + notificationHeight(item, inner), 0) + (items.length - 1) * CARD_GAP : 64;
    const height = Math.min(geometry.height, CARD_PAD * 2 + CENTER_HEADER + CARD_GAP + listHeight + (groups.length > 1 ? CENTER_FOOTER + CARD_GAP : 0));
    if (!center || center.closed || center.size.y !== height) {
      if (center && !center.closed) await destroySurface(center.win);
      center = await notificationSurface(display, 'koya-notifications', { x: width, y: height },
        { x: geometry.x, y: geometry.y }, POPOVER, 'exclusive', { cornerRadius: RADIUS.surface });
      centerBoard = centerKey = undefined; await center.prepare();
      await UI.setElementId(center.win, center.root, 'notifications-root');
    }
    const key = JSON.stringify([page, model.items, iconVersion]);
    if (centerKey === key) return;
    await center.paint(async () => {
      if (centerBoard) await UI.destroyElement(center.win, centerBoard);
      const win = center.win;
      centerBoard = await UI.createElement(win, { layout: { type: 'column', gap: CARD_GAP,
        padding: { l: CARD_PAD, r: CARD_PAD, t: CARD_PAD, b: CARD_PAD } }, item: { size: { x: width, y: height } }, clipToBounds: true });
      await UI.attach(win, center.root, centerBoard);
      const header = async () => {
        const row = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center' }, item: { size: { x: inner, y: CENTER_HEADER } } });
        await children(win, row, [
          label(win, null, 'Notifications', 15, inner - 64, CENTER_HEADER),
          button(win, null, '', 32, CENTER_HEADER, () => unlocked() && model.clear(), { colour: CLEAR, icon: shellIcon('clear'), iconSize: 16 }),
          button(win, null, '', 32, CENTER_HEADER, closeCenter, { colour: CLEAR, icon: shellIcon('close'), iconSize: 16 })
        ]);
        return row;
      };
      const list = async () => {
        const node = await UI.createElement(win, { layout: { type: 'column', gap: CARD_GAP }, item: { size: { x: inner, y: listHeight } } });
        await children(win, node, items.length ? items.map(item => card(center, null, item, inner))
          : [text(win, null, 'All caught up', 14, inner, 64, MUTED)]);
        return node;
      };
      const footer = async () => {
        const row = await UI.createElement(win, { layout: { type: 'row', justifyContent: 'center', alignItems: 'center' }, item: { size: { x: inner, y: CENTER_FOOTER } } });
        await children(win, row, [
          button(win, null, '', 32, CENTER_FOOTER, () => { if (page > 0) { page--; enqueue(reconcile); } }, { colour: CLEAR, icon: shellIcon('previous'), iconSize: 16 }),
          text(win, null, (page + 1) + ' / ' + groups.length, 12, 80, CENTER_FOOTER, MUTED),
          button(win, null, '', 32, CENTER_FOOTER, () => { if (page + 1 < groups.length) { page++; enqueue(reconcile); } }, { colour: CLEAR, icon: shellIcon('next'), iconSize: 16 })
        ]);
        return row;
      };
      await children(win, centerBoard, [header(), list(), ...(groups.length > 1 ? [footer()] : [])]);
    });
    centerKey = key;
  };
  const showBanners = async () => {
    const outputs = await Compositor.listDisplays();
    const focused = outputs.find(output => output.focused);
    if (focused) await move(focused);
    const geometry = notificationGeometry(size, BAR_HEIGHT), width = geometry.width;
    const items = []; let height = 0;
    for (const item of model.items.filter(item => banners.has(item.id) && item.active).slice(0, MAX_VISIBLE)) {
      const next = notificationHeight(item, width, false) + (items.length ? CARD_GAP : 0);
      if (height + next > geometry.height) break;
      height += next; items.push(item);
    }
    if (!items.length) { if (toast?.shown) await toast.hide(); return; }
    const key = JSON.stringify([items.map(item => [item.id, item.revision]), iconVersion, geometry]);
    if (bannerKey !== key) {
      if (toast && !toast.closed) await destroySurface(toast.win);
      toast = await notificationSurface(display, 'koya-notification-banner', { x: width, y: height },
        { x: geometry.x, y: geometry.y }, CLEAR);
      toastBoard = await UI.createElement(toast.win, { layout: { type: 'column', gap: CARD_GAP }, item: { size: { x: width, y: height } } });
      await UI.attach(toast.win, toast.root, toastBoard);
      await children(toast.win, toastBoard, items.map(item => card(toast, null, item, width, false)));
      bannerKey = key; await toast.prepare();
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
    requested = true; page = 0; clearBanners(); model.read(); return enqueue(reconcile);
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
      requested = true; page = 0; clearBanners(); model.read(); await reconcile();
    }), close: closeCenter, onApplications: refreshApps,
    onState: next => { state = next; return enqueue(reconcile); },
    get bannerWindow() { return toast?.shown ? toast.win : undefined; },
    get centerWindow() { return center?.shown ? center.win : undefined; }
  };
}
