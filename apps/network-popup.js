import * as UI from 'Helix/UserInterface';
import * as Compositor from 'Koya/Compositor';
import * as Event from 'Helix/Event';
import * as Log from 'Helix/Log';
import { networkView } from './network-model.js';
import { popupPosition, popupContains } from './popup-layout.js';
import { call } from './session.js';
import { button, pill, icon, text, children } from './touch-ui.js';
import { clips } from './motion.js';
import { shadow } from './shadow.js';
import { surfaceCursor, controlCursor, destroySurface } from './cursor.js';
import { FONT_STRONG, INK, CREAM, MUTED, ORANGE, CARD, TONAL, TRACK, CLEAR, POPOVER, RADIUS, TYPE, alpha } from './theme.js';

// The bar's network popover: a hero (glowing badge, name, health), a
// segmented signal meter for Wi-Fi, a card of details (IP addresses copy on
// click) and one action. It drops in; the badge pops and sends out a ring,
// meter segments light in turn and rows rise after it.
const WIDTH = 320, PAD = 14, GAP = 12, HERO = 52, BADGE = 44, METER = 34, SEGMENTS = 5, ROW = 26, CARD_PAD = 8, ACTION = 32;
const HEALTH = { good: ORANGE, warn: CREAM, off: MUTED };
const texture = name => '/rom/assets/status/' + name + '.png';
const shape = view => JSON.stringify([view.kind, !!view.signal, view.details.map(item => item.key), view.action]);
const heightOf = view => PAD * 2 + HERO + GAP + (view.signal ? METER + GAP : 0)
  + (view.details.length ? view.details.length * ROW + CARD_PAD * 2 + GAP : 0) + ACTION;

export function createNetworkPopup() {
  let state = {}, popup, placement, request = 0, openingWifi = false, previous = '';
  let queue = Promise.resolve();
  const enqueue = job => {
    const next = queue.then(job); queue = next.catch(error => Log.error('Network popup: ' + error)); return next;
  };
  const destroy = async () => {
    if (!popup) return;
    const old = popup; popup = undefined; clearTimeout(old.copied); await destroySurface(old.win);
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

  const build = async view => {
    const { display, anchor } = placement;
    const size = { x: Number(display.logical_width || display.width), y: Number(display.logical_height || display.height) };
    const width = Math.min(WIDTH, size.x - 16), inner = width - PAD * 2, height = Math.min(size.y - 16, heightOf(view));
    const position = popupPosition(size, anchor, width, height);
    const win = await Compositor.createWindow({ role: 'overlay', anchor: 'top-left', display: display.display,
      size, exclusiveZone: -1, namespace: 'koya-network', msaaSamples: 1, transparent: true,
      keyboardInteractivity: 'exclusive', acceptPointerEvents: true });
    try {
      const motion = (id, frames) => clips(win, id, { enter: frames }).then(clip => clip.play('enter'));
      const [root, panel] = await Promise.all([
        UI.createElement(win, { layout: { type: 'none' }, item: { size }, onHover: surfaceCursor(win), onActivate: event => {
          if (!popupContains(event.local, position, { x: width, y: height })) close().catch(() => {});
        } }),
        // Box-backed and inheriting: the panel's drop-in carries everything inside.
        UI.createElement(win, { id: 'network-popup', renderable: { type: 'box', colour: POPOVER, cornerRadius: RADIUS.surface, cornerResolution: 16, origin: { x: 0.5, y: 0 } },
          layout: { type: 'column', gap: GAP, padding: { l: PAD, r: PAD, t: PAD, b: PAD } }, inheritAnimation: true,
          item: { position, size: { x: width, y: height } }, contentAlign: 'fill', clipToBounds: true, inputOptions: { blockInput: true } }),
        Compositor.setClearColor(win, 0, 0, 0, 0)
      ]);

      // ---- Hero: badge with a pulse ring, name, health dot and status ----
      const hero = async () => {
        const row = await UI.createElement(win, { layout: { type: 'row', gap: GAP, alignItems: 'center' }, item: { size: { x: inner, y: HERO } } });
        const slot = await UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: HERO, y: HERO } } });
        const tint = view.health === 'off' ? alpha(MUTED, 0.16) : alpha(ORANGE, 0.18);
        const centred = (side, extra) => ({ item: { position: { x: (HERO - side) / 2, y: (HERO - side) / 2 }, size: { x: side, y: side } }, contentAlign: 'fill', ...extra });
        const [ring, badge, column] = await Promise.all([
          UI.createElement(win, { renderable: { type: 'box', colour: alpha(view.health === 'off' ? MUTED : ORANGE, 0.45), cornerRadius: BADGE / 2, cornerResolution: 32, origin: { x: 0.5, y: 0.5 } }, ...centred(BADGE) }),
          UI.createElement(win, { renderable: { type: 'box', colour: tint, cornerRadius: BADGE / 2, cornerResolution: 32, origin: { x: 0.5, y: 0.5 } },
            layout: { type: 'row', justifyContent: 'center', alignItems: 'center' }, inheritAnimation: true, ...centred(BADGE) }),
          UI.createElement(win, { layout: { type: 'column', justifyContent: 'center' }, item: { size: { x: inner - HERO - GAP, y: HERO } } })
        ]);
        const [glyph] = await Promise.all([icon(win, badge, texture(view.icon), 24, BADGE, BADGE),
          UI.attach(win, slot, ring), UI.attach(win, slot, badge), UI.attach(win, row, slot), UI.attach(win, row, column)]);
        // Name above status, attached in turn.
        const name = await text(win, column, view.name, TYPE.heading, inner - HERO - GAP, 24, CREAM, FONT_STRONG, 'left');
        const statusRow = await UI.createElement(win, { layout: { type: 'row', gap: 6, alignItems: 'center' }, item: { size: { x: inner - HERO - GAP, y: 18 } } });
        await UI.attach(win, column, statusRow);
        const [dot, status] = await children(win, statusRow, [
          UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 7, y: 7 } }, resolution: 16, colour: HEALTH[view.health] }, item: { size: { x: 7, y: 7 } } }),
          text(win, null, view.status, 12, inner - HERO - GAP - 13, 18, MUTED, undefined, 'left')
        ]);
        // Juice: the badge pops; the ring swells out and fades (looping while connecting).
        motion(badge, [{ time: 0, scale: { x: 0.4, y: 0.4 } }, { time: 0.05, scale: { x: 0.4, y: 0.4 } },
          { time: 0.22, scale: { x: 1.14, y: 1.14 }, ease: 'outCubic' }, { time: 0.36, scale: { x: 1, y: 1 }, ease: 'inOutQuad' }]);
        const pulse = [{ time: 0, scale: { x: 1, y: 1 }, opacity: 0 }, { time: 0.12, scale: { x: 1, y: 1 }, opacity: 0.9 },
          { time: 0.9, scale: { x: 1.7, y: 1.7 }, opacity: 0, ease: 'outCubic' }];
        motion(ring, view.connecting ? [...pulse, { time: 1.3, scale: { x: 1.7, y: 1.7 }, opacity: 0, looping: true }] : pulse);
        return { row, name, status, dot, glyph };
      };

      // ---- Signal meter: quality and percent over lit segments ----
      const meter = async () => {
        const box = await UI.createElement(win, { layout: { type: 'column', gap: 6 }, item: { size: { x: inner, y: METER } } });
        const [labels, bar] = await children(win, box, [
          UI.createElement(win, { layout: { type: 'row', alignItems: 'center' }, item: { size: { x: inner, y: 22 } } }),
          UI.createElement(win, { layout: { type: 'row', gap: 4 }, item: { size: { x: inner, y: 6 } } })
        ]);
        const [, reading] = await children(win, labels, [text(win, null, 'Signal', 12, inner / 2, 22, MUTED, undefined, 'left'),
          text(win, null, view.signal.label + ' · ' + view.signal.percent + '%', 12, inner / 2, 22, CREAM, undefined, 'right')]);
        const segment = (inner - 4 * (SEGMENTS - 1)) / SEGMENTS;
        const segments = await children(win, bar, Array.from({ length: SEGMENTS }, () => UI.createElement(win, {
          renderable: { type: 'box', colour: TRACK, cornerRadius: 3, cornerResolution: 8, origin: { x: 0.5, y: 0.5 } },
          item: { size: { x: segment, y: 6 } }, contentAlign: 'fill' })));
        return { box, reading, segments };
      };
      const lit = percent => Math.max(1, Math.round(percent * SEGMENTS / 100));
      const lightSegments = async (segments, percent, animate) => {
        await Promise.all(segments.map((id, i) => UI.setBoxColour(win, id, i < lit(percent) ? ORANGE : TRACK)));
        if (animate) segments.forEach((id, i) => i < lit(percent) && motion(id, [
          { time: 0, scale: { x: 1, y: 0.2 }, opacity: 0.3 }, { time: 0.16 + i * 0.06, scale: { x: 1, y: 0.2 }, opacity: 0.3 },
          { time: 0.28 + i * 0.06, scale: { x: 1, y: 1.6 }, opacity: 1, ease: 'outCubic' }, { time: 0.4 + i * 0.06, scale: { x: 1, y: 1 }, opacity: 1, ease: 'inOutQuad' }]));
      };

      // ---- Details card: key on the left, value on the right ----
      const details = async () => {
        const card = await UI.createElement(win, { renderable: { type: 'box', colour: alpha(CARD, 0.9), cornerRadius: RADIUS.control, cornerResolution: 16 },
          layout: { type: 'column', padding: { l: 12, r: 12, t: CARD_PAD, b: CARD_PAD } }, item: { size: { x: inner, y: view.details.length * ROW + CARD_PAD * 2 } }, contentAlign: 'fill' });
        const rows = await Promise.all(view.details.map(async (item, index) => {
          const width = inner - 24;
          const row = await UI.createElement(win, { renderable: { type: 'box', colour: CLEAR, origin: { x: 0.5, y: 0.5 } }, inheritAnimation: true,
            layout: { type: 'row', alignItems: 'center' }, item: { size: { x: width, y: ROW } }, contentAlign: 'fill',
            ...(item.copy ? { onActivate: () => copy(index), onHover: controlCursor(win) } : {}) });
          const [, value] = await children(win, row, [text(win, null, item.key, 12, 78, ROW, MUTED, undefined, 'left'),
            text(win, null, item.value, 13, width - 78, ROW, CREAM, undefined, 'right')]);
          return { row, value };
        }));
        await Promise.all(rows.map(({ row }) => UI.attach(win, card, row)));
        return { card, rows };
      };

      const [heroParts, meterParts, detailParts, action] = await Promise.all([
        hero(), view.signal ? meter() : undefined, view.details.length ? details() : undefined,
        pill(win, null, view.action.label, inner, configureWifi, view.action.primary
          ? { colour: ORANGE, labelColour: INK, height: ACTION, size: 13 } : { colour: TONAL, labelColour: ORANGE, height: ACTION, size: 13 })
      ]);
      const sections = [heroParts.row, meterParts?.box, detailParts?.card, action].filter(Boolean);
      // The shadow sorts under the panel (item.order) and drops in with it.
      const shade = await shadow(win, root, { x: width, y: height }, position, 'popover');
      await Promise.all([...sections.map(id => UI.attach(win, panel, id)), UI.attach(win, root, panel), UI.attachRoot(win, root),
        UI.setElementId(win, heroParts.status, 'network-connection-status'), UI.setElementId(win, action, 'network-configure-wifi')]);
      if (meterParts) await lightSegments(meterParts.segments, view.signal.percent, true);
      // Drop in from the bar; detail rows and the action rise in turn.
      const dropIn = [{ time: 0, opacity: 0, position: { x: 0, y: -10 }, scale: { x: 0.97, y: 0.97 } },
        { time: 0.22, opacity: 1, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, ease: 'outCubic' }];
      motion(panel, dropIn);
      if (shade) motion(shade, dropIn);
      [...(detailParts?.rows.map(item => item.row) || []), action].forEach((id, i) => motion(id, [
        { time: 0, opacity: 0, position: { x: 0, y: 8 } }, { time: 0.1 + i * 0.04, opacity: 0, position: { x: 0, y: 8 } },
        { time: 0.32 + i * 0.04, opacity: 1, position: { x: 0, y: 0 }, ease: 'outCubic' }]));

      popup = { win, view, shape: shape(view), status: heroParts.status, name: heroParts.name, dot: heroParts.dot, glyph: heroParts.glyph,
        meter: meterParts, rows: detailParts?.rows || [] };
      // Copy an address: the value flashes "Copied" in orange and bumps.
      const copy = async index => {
        const item = popup?.view.details[index], row = popup?.rows[index];
        if (!item || !row) return;
        try { await Compositor.setClipboardText(item.value); } catch (error) { Log.error('Copy address: ' + error); return; }
        clearTimeout(popup.copied);
        await Promise.all([UI.setTextString(win, row.value, 'Copied'), UI.setTextColour(win, row.value, ORANGE)]);
        motion(row.row, [{ time: 0.07, scale: { x: 1.03, y: 1.03 }, ease: 'outQuad' }, { time: 0.22, scale: { x: 1, y: 1 }, ease: 'outCubic' }]);
        popup.copied = setTimeout(() => {
          if (!popup || popup.win !== win) return;
          const current = popup.view.details[index];
          Promise.all([UI.setTextString(win, row.value, current?.value || ''), UI.setTextColour(win, row.value, CREAM)]).catch(() => {});
        }, 1200);
      };
    } catch (error) { await destroySurface(win); throw error; }
  };
  // Same structure: update in place. Otherwise rebuild.
  const paint = async () => {
    if (!placement) return;
    const view = networkView(state);
    if (!popup || shape(view) !== popup.shape) { await destroy(); await build(view); return; }
    const { win } = popup; popup.view = view;
    await Promise.all([UI.setTextString(win, popup.name, view.name), UI.setTextString(win, popup.status, view.status),
      UI.setCircleColour(win, popup.dot, HEALTH[view.health]), UI.setTexture(win, popup.glyph, texture(view.icon)),
      ...(popup.meter && view.signal ? [UI.setTextString(win, popup.meter.reading, view.signal.label + ' · ' + view.signal.percent + '%'),
        ...popup.meter.segments.map((id, i) => UI.setBoxColour(win, id, i < Math.max(1, Math.round(view.signal.percent * SEGMENTS / 100)) ? ORANGE : TRACK))] : []),
      ...view.details.map((item, index) => popup.copied ? Promise.resolve() : UI.setTextString(win, popup.rows[index].value, item.value))]);
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
      const key = JSON.stringify(networkView(state));
      if (key === previous) return Promise.resolve();
      previous = key; return enqueue(paint);
    },
    resize: close,
    dispose: () => { Event.off('keyDown', keyDown); return close(); },
    get window() { return popup?.win; }
  };
}
