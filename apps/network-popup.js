import * as UI from './theme-ui.js';
import * as Log from 'Helix/Log';
import { networkView } from './network-model.js';
import { createPopover } from './popover.js';
import { KIT_METRICS } from './kit.js';
import { presets } from './motion.js';
import { call } from './session.js';
import { pill } from './touch-ui.js';
import { TEXT, SPACE, TYPE, SURFACE } from './theme.js';

// The bar's network popover, on the shared shell and kit: a hero (badge,
// name, health), a segmented signal meter for Wi-Fi, a card of details (IP
// addresses copy on click) and one action. It drops in; the badge pops and
// sends out a ring (looping while connecting), meter segments light in turn
// and rows rise after it.
const POPUP_WIDTH = 320, ACTION_HEIGHT = 32;
const texture = name => '/rom/assets/status/' + name + '.png';
const shape = view => JSON.stringify([view.kind, !!view.signal, view.details.map(item => item.key), view.action]);

export function createNetworkPopup() {
  let state = {}, popup, placement, request = 0, openingWifi = false, previous = '';
  let queue = Promise.resolve();
  const enqueue = job => {
    const next = queue.then(job); queue = next.catch(error => Log.error('Network popup: ' + error)); return next;
  };
  const destroy = async () => {
    if (!popup) return;
    const old = popup; popup = undefined; old.details?.dispose(); await old.shell.destroy();
  };
  const close = () => { request++; placement = undefined; return enqueue(destroy); };
  const configureWifi = async () => {
    if (openingWifi) return;
    openingWifi = true;
    try { await call('OpenWifi'); await close(); }
    catch (error) {
      Log.error('Open Wi-Fi: ' + error);
      if (popup) await UI.setTextString(popup.shell.win, popup.title.caption, 'Could not open Wi-Fi settings');
    } finally { openingWifi = false; }
  };

  const build = async view => {
    const shell = await createPopover({ ...placement, width: POPUP_WIDTH, namespace: 'koya-network', id: 'network-popup', onClose: () => close().catch(() => {}) });
    try {
      const { win, kit } = shell;
      // Hero: badge, then the name and health line taking the rest.
      const hero = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: { x: 'auto', y: KIT_METRICS.badgeSlotSize } } });
      const badge = await kit.badge({ glyph: texture(view.icon), health: view.health });
      const title = await kit.titleBlock({ title: view.name, subtitle: view.status, dot: view.health });
      await Promise.all([UI.attach(win, hero, badge.id), UI.attach(win, hero, title.id), UI.setElementId(win, title.caption, 'network-connection-status')]);
      const meter = view.signal ? await kit.meter({ label: 'Signal', width: shell.inner }) : undefined;
      const details = view.details.length ? await kit.keyValue(view.details) : undefined;
      const action = await pill(win, null, view.action.label, shell.inner, configureWifi, view.action.primary
        ? { colour: SURFACE.accent, labelColour: TEXT.onAccent, height: ACTION_HEIGHT, size: TYPE.detail } : { colour: SURFACE.control, labelColour: TEXT.accent, height: ACTION_HEIGHT, size: TYPE.detail });
      await UI.setElementId(win, action, 'network-configure-wifi');
      const sections = [{ id: hero, height: KIT_METRICS.badgeSlotSize }, meter, details, { id: action, height: ACTION_HEIGHT }].filter(Boolean);
      for (const section of sections) await UI.attach(win, shell.content, section.id);
      await shell.show(sections.reduce((sum, section) => sum + section.height, 0) + SPACE.m * (sections.length - 1));
      // Juice: the badge pops and rings, segments light, rows rise.
      badge.pop(); badge.pulse(view.connecting);
      if (meter) await meter.set(view.signal.percent, view.signal.label + ' · ' + view.signal.percent + '%', true);
      [...(details?.rows || []), action].forEach((id, index) => shell.play(id, presets.rise(index)));
      popup = { shell, view, shape: shape(view), badge, title, meter, details };
    } catch (error) { await shell.destroy(); throw error; }
  };
  // Same structure: update in place. Otherwise rebuild.
  const paint = async () => {
    if (!placement) return;
    const view = networkView(state);
    if (!popup || shape(view) !== popup.shape) { await destroy(); await build(view); return; }
    const { win } = popup.shell; popup.view = view;
    await Promise.all([UI.setTextString(win, popup.title.heading, view.name), UI.setTextString(win, popup.title.caption, view.status),
      popup.title.setDot(view.health), popup.badge.setGlyph(texture(view.icon)),
      ...(popup.meter && view.signal ? [popup.meter.set(view.signal.percent, view.signal.label + ' · ' + view.signal.percent + '%')] : []),
      ...(popup.details ? [popup.details.set(view.details.map(item => item.value))] : [])]);
  };
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
      const key = JSON.stringify(networkView(state));
      if (key === previous) return Promise.resolve();
      previous = key; return enqueue(paint);
    },
    resize: close,
    dispose: () => close(),
    get window() { return popup?.shell.win; }
  };
}
