import * as UI from 'Helix/UserInterface';
import * as Compositor from 'Koya/Compositor';
import * as Event from 'Helix/Event';
import * as Log from 'Helix/Log';
import { networkSummary } from './network-model.js';
import { popupPosition, popupContains } from './popup-layout.js';
import { call } from './session.js';
import { button, label, children } from './touch-ui.js';
import { surfaceCursor, destroySurface } from './cursor.js';
import { INK, CREAM, MUTED, ORANGE, POPOVER, RADIUS } from './theme.js';

export function createNetworkPopup() {
  let state = {}, popup, placement, request = 0, openingWifi = false, previous = '';
  let queue = Promise.resolve();
  const enqueue = job => {
    const next = queue.then(job); queue = next.catch(error => Log.error('Network popup: ' + error)); return next;
  };
  const destroy = async () => {
    if (!popup) return;
    const old = popup; popup = undefined; await destroySurface(old.win);
  };
  const close = () => { request++; placement = undefined; return enqueue(destroy); };
  const configureWifi = async () => {
    if (openingWifi) return;
    openingWifi = true;
    try { await call('OpenWifi'); await close(); }
    catch (error) {
      Log.error('Open Wi-Fi: ' + error);
      if (popup) await UI.setTextString(popup.win, popup.status, 'Could not open Wi-Fi settings');
    } finally { openingWifi = false; }
  };
  const build = async summary => {
    const { display, anchor } = placement;
    const size = { x: Number(display.logical_width || display.width), y: Number(display.logical_height || display.height) };
    const width = Math.min(320, size.x - 16), inner = width - 24;
    const rowHeight = name => name === 'IPv6' ? 58 : 42;
    const height = Math.min(size.y - 16, 24 + 32 + 40 + 32 + summary.rows.reduce((sum, [name]) => sum + rowHeight(name), 0) + 8 * (summary.rows.length + 2));
    const position = popupPosition(size, anchor, width, height);
    const win = await Compositor.createWindow({ role: 'overlay', anchor: 'top-left', display: display.display,
      size, exclusiveZone: -1, namespace: 'koya-network', msaaSamples: 1, transparent: true,
      keyboardInteractivity: 'exclusive', acceptPointerEvents: true });
    try {
      const [root, panel] = await Promise.all([
        UI.createElement(win, { layout: { type: 'none' }, item: { size }, onHover: surfaceCursor(win), onActivate: event => {
          if (!popupContains(event.local, position, { x: width, y: height })) close().catch(() => {});
        } }),
        UI.createElement(win, { id: 'network-popup', renderable: { type: 'box', colour: POPOVER, cornerRadius: RADIUS.surface, cornerResolution: 16 },
          layout: { type: 'column', gap: 8, padding: { l: 12, r: 12, t: 12, b: 12 } },
          item: { position, size: { x: width, y: height } }, contentAlign: 'fill', clipToBounds: true, inputOptions: { blockInput: true } }),
        Compositor.setClearColor(win, 0, 0, 0, 0)
      ]);
      const fields = new Array(summary.rows.length);
      const [title, status, ...rest] = await children(win, panel, [
        label(win, null, summary.title, 17, inner, 32),
        label(win, null, summary.status, 13, inner, 40, MUTED),
        ...summary.rows.map(async ([name, value], index) => {
          const row = await UI.createElement(win, { layout: { type: 'column' }, item: { size: { x: inner, y: rowHeight(name) } } });
          const [, field] = await children(win, row, [
            label(win, null, name, 11, inner, 18, MUTED), label(win, null, value, 13, inner, rowHeight(name) - 18, CREAM)
          ]);
          fields[index] = field;
          return row;
        }),
        button(win, null, 'Configure Wi-Fi', inner, 32, configureWifi,
          { colour: ORANGE, labelColour: INK, size: 13, labelHeight: 32 })
      ]);
      await Promise.all([
        UI.attach(win, root, panel), UI.attachRoot(win, root),
        UI.setElementId(win, status, 'network-connection-status'), UI.setElementId(win, rest[rest.length - 1], 'network-configure-wifi')
      ]);
      popup = { win, title, status, fields, shape: JSON.stringify(summary.rows.map(([name]) => name)) };
    } catch (error) { await destroySurface(win); throw error; }
  };
  const paint = async () => {
    if (!placement) return;
    const summary = networkSummary(state), shape = JSON.stringify(summary.rows.map(([name]) => name));
    if (!popup || shape !== popup.shape) { await destroy(); await build(summary); return; }
    await Promise.all([UI.setTextString(popup.win, popup.title, summary.title), UI.setTextString(popup.win, popup.status, summary.status),
      ...summary.rows.map(([, value], index) => UI.setTextString(popup.win, popup.fields[index], value))]);
  };
  const keyDown = event => { if (popup?.win === event.id && [1, 65307].includes(Number(event.key))) close().catch(() => {}); };
  Event.on('keyDown', keyDown);
  return {
    toggle: (display, anchor) => {
      const token = ++request;
      return enqueue(async () => {
        if (token !== request) return;
        if (popup) { placement = undefined; await destroy(); return; }
        if (!state.Active || state.ScreenState !== 'unlocked') return;
        placement = { display, anchor }; await paint();
        if (token !== request) await destroy();
      });
    }, close,
    onState: value => {
      state = value;
      if (!state.Active || state.ScreenState !== 'unlocked') return close();
      const key = JSON.stringify(networkSummary(state));
      if (key === previous) return Promise.resolve();
      previous = key; return enqueue(paint);
    },
    resize: close,
    dispose: () => { Event.off('keyDown', keyDown); return close(); },
    get window() { return popup?.win; }
  };
}
