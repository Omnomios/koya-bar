import * as Compositor from 'Koya/Compositor';
import * as UI from 'Helix/UserInterface';
import * as Log from 'Helix/Log';
import { connect } from './session.js';
import { BAR, BAR_HEIGHT, AUTO, FONT_STRONG, CREAM, ORANGE, MUTED, CLEAR, POPOVER, RADIUS, alpha } from './theme.js';
import { icon, text, button } from './touch-ui.js';
import { topBarStatus } from './status-model.js';
import { createNotifications } from './notifications.js';
import { createVolume } from './volume.js';
import { createNetworkPopup } from './network-popup.js';
import { createWorkspaces, WORKSPACE_ROW } from './workspaces.js';
import { speakerStatus } from './audio-model.js';
import { windowLayout } from './window-layout.js';
import { surfaceCursor, destroySurface } from './cursor.js';
import { clockPreferences, clockPresentation, clockRefreshDelay } from './clock-model.js';

// A floating strip just below the screen edge, lined up with tiled windows:
// brand and clock on the left, workspaces centred, status on the right.
//
// Layout does all placement. The root is a 'none' container, so each child
// fills the bar: the strip and its edge (inset by margins), the content row,
// and a centring layer for workspaces. Row children leave their height to
// the row (cross-axis fill), so chips reach the top edge of the screen for
// the pointer; their faces, and the non-interactive items, take a top margin
// so they centre on the strip.
const CLOCK_GAP = 8, DATE_WIDTH = 90, ICON = 18, CHIP = 34, BATTERY = 66, PAD = 6;
const HOVER = alpha(CREAM, 0.08), EDGE = alpha(CREAM, 0.07);
const ON_STRIP = { t: BAR.top, r: 0, b: 0, l: 0 };
const clockGroupWidth = view => view.timeWidth + (view.showDate ? CLOCK_GAP + DATE_WIDTH : 0);

export default async ({ display, notifications: shared, volume: sharedVolume } = {}) => {
  display ||= (await Compositor.listDisplays())[0];
  const win = await Compositor.createWindow({ role: 'bar', edge: 'top', thickness: BAR_HEIGHT,
    reserveSpace: true, display: display.display, namespace: 'koya-top-bar', transparent: true,
    msaaSamples: 1, keyboardInteractivity: 'none', acceptPointerEvents: true });
  const volume = sharedVolume || createVolume(display);
  const network = createNetworkPopup();
  const notifications = shared || createNotifications(display);
  const texture = name => '/rom/assets/status/' + name + '.png';
  const workspaces = createWorkspaces(win, display.display);

  // A full-height chip ('none' layout) whose face fills it, less margins that
  // put the face 3px inside the strip. Content goes on the face, which also
  // takes the hover highlight. Resolves to { id, face }.
  const chip = async (width, handler, options = {}) => {
    let face;
    const id = await button(win, null, '', width, 'auto', handler, { colour: CLEAR, hover: HOVER, hoverTarget: () => face,
      element: { layout: { type: 'none' } }, ...options });
    face = await UI.createElement(win, { renderable: { type: 'box', colour: CLEAR, cornerRadius: RADIUS.control, cornerResolution: 16 },
      layout: { type: 'none' }, item: { size: AUTO, margin: { t: BAR.top + 3, r: 0, b: 3, l: 0 } }, contentAlign: 'fill' });
    await UI.attach(win, id, face);
    return { id, face };
  };
  const anchored = async (id, open) => {
    try {
      const output = (await Compositor.listDisplays()).find(item => item.display === display.display);
      if (!output) return;
      const frame = await UI.getElementFrame(win, id);
      await open(output, { x: frame.min.x, y: frame.min.y, width: frame.max.x - frame.min.x, height: frame.max.y - frame.min.y });
    } catch (error) { Log.error('Top bar: ' + error); }
  };

  const [root, strip, edge, row, centre] = await Promise.all([
    UI.createElement(win, { layout: { type: 'none' }, item: { size: AUTO }, onHover: surfaceCursor(win) }),
    UI.createElement(win, { id: 'top-bar-strip', renderable: { type: 'box', colour: POPOVER, cornerRadius: RADIUS.surface, cornerResolution: 16 },
      item: { size: AUTO, margin: { t: BAR.top, r: BAR.side, b: 0, l: BAR.side } }, contentAlign: 'fill' }),
    UI.createElement(win, { renderable: { type: 'box', colour: EDGE, inset: 1, cornerRadius: RADIUS.surface, cornerResolution: 16 },
      item: { size: AUTO, margin: { t: BAR.top, r: BAR.side, b: 0, l: BAR.side } }, contentAlign: 'fill' }),
    UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: 2, padding: { t: 0, r: BAR.side + PAD, b: 0, l: BAR.side + PAD } }, item: { size: AUTO } }),
    // Workspace cells sit directly in this full-width row, so centring uses
    // their real widths whatever the sides hold.
    UI.createElement(win, { id: 'top-bar-workspaces', layout: WORKSPACE_ROW, item: { size: AUTO } }),
    Compositor.setClearColor(win, 0, 0, 0, 0)
  ]);
  await Promise.all([UI.setHitTarget(win, strip, false), UI.setHitTarget(win, edge, false), UI.setHitTarget(win, centre, false)]);
  await workspaces.build(centre);

  // ---- Left: brand and clock ---------------------------------------------
  const initialClock = clockPresentation(new Date());
  let speakerGlyph, bell, networkGlyph, warning, level, percentage;
  const brand = await icon(win, null, '/rom/assets/brand/koya-fish.png', 16, 26, 'auto');
  const dateTime = await UI.createElement(win, { id: 'top-bar-datetime', layout: { type: 'row', gap: CLOCK_GAP, alignItems: 'center' },
    item: { size: { x: clockGroupWidth(initialClock), y: 'auto' }, margin: ON_STRIP } });
  const clock = await text(win, dateTime, initialClock.time, 13, initialClock.timeWidth, 'auto', CREAM, FONT_STRONG, 'left');
  const date = await text(win, dateTime, initialClock.date, 12, DATE_WIDTH, 'auto', MUTED, undefined, 'left');
  const spacer = await UI.createElement(win, { item: { size: AUTO, flexGrow: 1 } });

  // ---- Right: status chips -----------------------------------------------
  const speakerChip = await chip(CHIP, () => anchored(speaker, async (output, anchor) => {
    await Promise.all([network.close(), notifications.close()]); await volume.toggle(output, anchor);
  }));
  const speaker = speakerChip.id;
  speakerGlyph = await icon(win, speakerChip.face, texture('volume-unavailable'), ICON, 'auto', 'auto');
  const networkChip = await chip(CHIP, () => anchored(networkTarget, async (output, anchor) => {
    await Promise.all([volume.close(), notifications.close()]); await network.toggle(output, anchor);
  }));
  const networkTarget = networkChip.id;
  networkGlyph = await icon(win, networkChip.face, texture('wifi-off'), ICON, 'auto', 'auto');
  // The warning is a small orange dot on the icon's shoulder: centred like the
  // icon, then nudged by a visual offset.
  warning = await UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 6, y: 6 } }, resolution: 16, colour: ORANGE },
    item: { size: AUTO }, contentAlign: { x: 'center', y: 'center' } });
  await Promise.all([UI.attach(win, networkChip.face, warning), UI.setPosition(win, warning, { x: ICON / 2, y: -ICON / 2 + 2 }), UI.setHitTarget(win, warning, false)]);
  const batteryChip = await chip(BATTERY, () => {}, { cursor: 'default', hover: undefined });
  const battery = batteryChip.id;
  const batteryRow = await UI.createElement(win, { layout: { type: 'row', gap: 4, justifyContent: 'center', alignItems: 'center' }, item: { size: AUTO } });
  level = await icon(win, batteryRow, texture('battery-unknown'), ICON + 2, ICON + 4, 'auto');
  percentage = await text(win, batteryRow, '—', 12, 34, 'auto', CREAM, undefined, 'left');
  await UI.attach(win, batteryChip.face, batteryRow);
  // A hairline between status and notifications, centred on the strip.
  const divider = await UI.createElement(win, { renderable: { type: 'box', colour: alpha(CREAM, 0.14), aabb: { min: { x: 0, y: 0 }, max: { x: 1, y: 14 } } },
    item: { size: { x: 9, y: 'auto' }, margin: ON_STRIP }, contentAlign: { x: 'center', y: 'center' } });
  const bellChip = await chip(CHIP, () => anchored(target, async output => {
    await Promise.all([volume.close(), network.close()]); await notifications.open(output);
  }));
  const target = bellChip.id;
  bell = await icon(win, bellChip.face, '/rom/assets/launcher/bell.png', ICON, 'auto', 'auto');

  for (const id of [brand, dateTime, spacer, speaker, networkTarget, battery, divider, target]) await UI.attach(win, row, id);
  await Promise.all([UI.attach(win, root, strip), UI.attach(win, root, edge), UI.attach(win, root, row), UI.attach(win, root, centre)]);
  await Promise.all([UI.attachRoot(win, root), UI.setMargin(win, brand, ON_STRIP), UI.setElementId(win, brand, 'top-bar-brand'), UI.setElementId(win, speaker, 'top-bar-volume'),
    UI.setElementId(win, networkTarget, 'top-bar-network'), UI.setElementId(win, target, 'top-bar-notifications'),
    UI.setElementId(win, percentage, 'top-bar-battery-percent'), UI.setElementId(win, clock, 'top-bar-clock'), UI.setElementId(win, date, 'top-bar-date'),
    UI.setEnabled(win, warning, false)]);

  const unsubscribeVolume = volume.subscribe(value => UI.setTexture(win, speakerGlyph,
    texture(speakerStatus(value).icon)).catch(error => Log.error('Volume indicator: ' + error)));
  const unsubscribe = notifications.subscribe(count => UI.setTexture(win, bell,
    '/rom/assets/launcher/bell' + (count ? '-active' : '') + '.png').catch(error => Log.error('Notification indicator: ' + error)));
  let timer, disposed = false, clockGeneration = 0, clockKey;
  let clockSettings = clockPreferences(), clockUpdates = Promise.resolve();
  const refreshClock = (configure = false) => {
    clearTimeout(timer);
    const generation = ++clockGeneration;
    clockUpdates = clockUpdates.then(() => {
      if (disposed) return;
      const view = clockPresentation(new Date(), clockSettings);
      return Promise.all([
        UI.setTextString(win, clock, view.time), UI.setTextString(win, date, view.date),
        ...(configure ? [UI.setLayoutSize(win, clock, { x: view.timeWidth }),
          UI.setLayoutSize(win, dateTime, { x: clockGroupWidth(view) }),
          UI.setEnabled(win, date, view.showDate)] : [])
      ]);
    }).catch(error => Log.error('Clock: ' + error));
    return clockUpdates.then(() => {
      if (!disposed && generation === clockGeneration)
        timer = setTimeout(() => refreshClock(), clockRefreshDelay(Date.now(), clockSettings));
    });
  };
  timer = setTimeout(() => refreshClock(), clockRefreshDelay(Date.now(), clockSettings));
  // Audio and notification services are shared between monitors.
  let updates = Promise.resolve(), previous = '';
  const disconnect = connect('top-bar', value => {
    const popupUpdate = network.onState(value);
    const nextClock = clockPreferences(value), nextClockKey = JSON.stringify(nextClock);
    let clockUpdate;
    if (nextClockKey !== clockKey) {
      clockKey = nextClockKey; clockSettings = nextClock; clockUpdate = refreshClock(true);
    }
    const status = topBarStatus(value), key = JSON.stringify([status, value.BatteryPresent, value.NetworkType]);
    if (key !== previous) {
      previous = key;
      updates = updates.then(() => Promise.all([
        UI.setTexture(win, networkGlyph, texture(status.wired ? 'ethernet' : value.NetworkType === 'cellular' ? status.cellIcon : status.wifiIcon)),
        UI.setEnabled(win, warning, status.warning),
        UI.setEnabled(win, battery, !!value.BatteryPresent), UI.setTexture(win, level, texture(status.batteryIcon)),
        UI.setTextString(win, percentage, status.batteryText), UI.setTextColour(win, percentage, status.batteryLow ? ORANGE : CREAM)
      ])).catch(error => Log.error('Top bar: ' + error));
    }
    return Promise.all([updates, popupUpdate, clockUpdate]);
  });
  const stopLayout = windowLayout(win, async () => {
    if (disposed) return;
    const updated = (await Compositor.listDisplays()).find(item => item.display === display.display);
    if (!updated) return;
    // The strip, row and centring layer follow the window through layout.
    const size = { x: Number(updated.logical_width || updated.width), y: Number(updated.logical_height || updated.height) };
    if (notifications.display.display === display.display) await notifications.resize(size);
    await volume.resize({ ...size, display: display.display });
    await network.resize();
  });
  return { window: win, notifications, volume, dispose: async () => {
    disposed = true; clearTimeout(timer); disconnect(); unsubscribe(); unsubscribeVolume(); stopLayout(); workspaces.dispose();
    await volume.resize({ display: display.display });
    await network.dispose();
    await destroySurface(win);
  } };
};
