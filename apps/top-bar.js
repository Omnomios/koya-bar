import * as Compositor from 'Koya/Compositor';
import * as UI from './theme-ui.js';
import * as Log from 'Helix/Log';
import { connect, call } from './session.js';
import { BAR, BAR_HEIGHT, AUTO, FONT_STRONG, CLEAR, RADIUS, TEXT, SURFACE, BORDER, HIGHLIGHT, HEALTH } from './theme.js';
import { icon, text, button, throbber } from './touch-ui.js';
import { topBarStatus } from './status-model.js';
import { createNotifications } from './notifications.js';
import { createVolume } from './volume.js';
import { createNetworkPopup } from './network-popup.js';
import { createPowerPopup } from './power-popup.js';
import { createWorkspaces, WORKSPACE_ROW } from './workspaces.js';
import { speakerStatus } from './audio-model.js';
import { windowLayout } from './window-layout.js';
import { surfaceCursor, destroySurface } from './cursor.js';
import { clockPreferences, clockPresentation, clockRefreshDelay } from './clock-model.js';
import { updatesIndicator } from './updates-model.js';

// A floating strip just below the screen edge, lined up with tiled windows:
// brand and clock on the left, workspaces centred, status on the right.
//
// Layout does all placement. The root is a 'none' container, so each child
// fills the bar: the strip and its edge (inset by margins), the content row,
// and a centring layer for workspaces. Row children leave their height to
// the row (cross-axis fill), so chips reach the top edge of the screen for
// the pointer; their faces, and the non-interactive items, take a top margin
// so they centre on the strip.
const CLOCK_GAP = 8, DATE_WIDTH = 90, ICON_SIZE = 18, STATUS_BUTTON_WIDTH = 34, BATTERY_BUTTON_WIDTH = 66, BAR_PADDING = 6;
const STRIP_MARGIN = { t: BAR.top, r: 0, b: 0, l: 0 };
const clockGroupWidth = view => view.timeWidth + (view.showDate ? CLOCK_GAP + DATE_WIDTH : 0);

export default async ({ display, notifications: shared, volume: sharedVolume, initialState = {} } = {}) => {
  display ||= (await Compositor.listDisplays({ backend: 'wayland' }))[0];
  const win = await Compositor.createWindow({ role: 'bar', edge: 'top', thickness: BAR_HEIGHT,
    reserveSpace: true, display: display.display, namespace: 'koya-top-bar', transparent: true,
    msaaSamples: 1, keyboardInteractivity: 'none', acceptPointerEvents: true });
  const volume = sharedVolume || createVolume(display);
  const network = createNetworkPopup();
  const power = createPowerPopup();
  const notifications = shared || createNotifications(display);
  const texture = name => '/rom/assets/status/' + name + '.png';
  const workspaces = createWorkspaces(win, display.display);

  // A full-height chip ('none' layout) whose face fills it, less margins that
  // put the face 3px inside the strip. Content goes on the face, which also
  // takes the hover highlight. Prepare both for the shared attachment batch.
  const chip = async (width, handler, options = {}) => {
    let face;
    const [id, background] = await Promise.all([
      button(win, null, '', width, 'auto', handler, { colour: CLEAR, hover: HIGHLIGHT.hover, hoverTarget: () => face,
        element: { layout: { type: 'none' } }, ...options }),
      UI.createElement(win, { renderable: { type: 'box', colour: CLEAR, cornerRadius: RADIUS.control, cornerResolution: 16 },
        layout: { type: 'none' }, item: { size: AUTO, margin: { t: BAR.top + 3, r: 0, b: 3, l: 0 } }, contentAlign: 'fill' })
    ]);
    face = background;
    return { id, face };
  };
  const anchored = async (id, open) => {
    try {
      const output = (await Compositor.listDisplays({ backend: 'wayland' })).find(item => item.display === display.display);
      if (!output) return;
      const frame = await UI.getElementFrame(win, id);
      await open(output, { x: frame.min.x, y: frame.min.y, width: frame.max.x - frame.min.x, height: frame.max.y - frame.min.y });
    } catch (error) { Log.error('Top bar: ' + error); }
  };

  const initialClock = clockPresentation(new Date(), clockPreferences(initialState));
  // Updates: the glyph alone, widened for a count or a throbber.
  const initialIndicator = updatesIndicator(initialState);
  const updatesWidth = indicator => STATUS_BUTTON_WIDTH + (indicator.text ? 4 + indicator.text.length * 8 : indicator.busy ? 16 : 0);
  // Prepare every independent node together. Siblings are created in their
  // authored order and attached in that same order, even if replies reverse.
  const [root, strip, edge, row, centre, brand, dateTime, clock, date, spacer,
    updateChip, updateRow, updateGlyph, updateCount, updateSpinner, updateWarning, speakerChip, speakerGlyph, networkChip, networkGlyph, warning,
    batteryChip, batteryRow, batteryIcon, level, charging, percentage, divider, bellChip, bell] = await Promise.all([
    UI.createElement(win, { layout: { type: 'none' }, item: { size: AUTO }, onHover: surfaceCursor(win) }),
    UI.createElement(win, { id: 'top-bar-strip', renderable: { type: 'box', colour: SURFACE.overlay, cornerRadius: RADIUS.surface, cornerResolution: 16 },
      item: { size: AUTO, margin: { t: BAR.top, r: BAR.side, b: 0, l: BAR.side } }, contentAlign: 'fill' }),
    UI.createElement(win, { renderable: { type: 'box', colour: BORDER.surface, inset: 1, cornerRadius: RADIUS.surface, cornerResolution: 16 },
      item: { size: AUTO, margin: { t: BAR.top, r: BAR.side, b: 0, l: BAR.side } }, contentAlign: 'fill' }),
    UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: 2, padding: { t: 0, r: BAR.side + BAR_PADDING, b: 0, l: BAR.side + BAR_PADDING } }, item: { size: AUTO } }),
    UI.createElement(win, { id: 'top-bar-workspaces', layout: WORKSPACE_ROW, item: { size: AUTO } }),
    icon(win, null, '/rom/assets/brand/koya-fish.png', 16, 26, 'auto'),
    UI.createElement(win, { id: 'top-bar-datetime', layout: { type: 'row', gap: CLOCK_GAP, alignItems: 'center' },
      item: { size: { x: clockGroupWidth(initialClock), y: 'auto' }, margin: STRIP_MARGIN } }),
    text(win, null, initialClock.time, 13, initialClock.timeWidth, 'auto', TEXT.primary, FONT_STRONG, 'left'),
    text(win, null, initialClock.date, 12, DATE_WIDTH, 'auto', TEXT.secondary, undefined, 'left'),
    UI.createElement(win, { item: { size: AUTO, flexGrow: 1 } }),
    chip(updatesWidth(initialIndicator), async () => {
      try {
        await Promise.all([volume.close(), network.close(), power.close(), notifications.close()]);
        await call('OpenUpdates');
      } catch (error) { Log.error('Open updates: ' + error); }
    }),
    UI.createElement(win, { layout: { type: 'row', gap: 4, justifyContent: 'center', alignItems: 'center' }, item: { size: AUTO } }),
    icon(win, null, '/rom/assets/launcher/koya-update.png', ICON_SIZE, ICON_SIZE, 'auto'),
    text(win, null, initialIndicator.text, 12, Math.max(8, initialIndicator.text.length * 8), 'auto', TEXT.accent),
    throbber(win, null, 12, TEXT.primary, 12),
    UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 6, y: 6 } }, resolution: 16, colour: HEALTH.warningIndicator },
      item: { size: AUTO }, contentAlign: { x: 'center', y: 'center' } }),
    chip(STATUS_BUTTON_WIDTH, () => anchored(speakerChip.id, async (output, anchor) => {
      await Promise.all([network.close(), power.close(), notifications.close()]); await volume.toggle(output, anchor);
    })),
    icon(win, null, texture('volume-unavailable'), ICON_SIZE, 'auto', 'auto'),
    chip(STATUS_BUTTON_WIDTH, () => anchored(networkChip.id, async (output, anchor) => {
      await Promise.all([volume.close(), power.close(), notifications.close()]); await network.toggle(output, anchor);
    })),
    icon(win, null, texture('wifi-off'), ICON_SIZE, 'auto', 'auto'),
    UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 6, y: 6 } }, resolution: 16, colour: HEALTH.warningIndicator },
      item: { size: AUTO }, contentAlign: { x: 'center', y: 'center' } }),
    chip(BATTERY_BUTTON_WIDTH, () => anchored(batteryChip.id, async (output, anchor) => {
      await Promise.all([volume.close(), network.close(), notifications.close()]); await power.toggle(output, anchor);
    })),
    UI.createElement(win, { layout: { type: 'row', gap: 4, justifyContent: 'center', alignItems: 'center' }, item: { size: AUTO } }),
    UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: ICON_SIZE + 4, y: 'auto' } } }),
    icon(win, null, texture('battery-unknown'), ICON_SIZE + 2, 'auto', 'auto'),
    icon(win, null, texture('charging'), 16, 'auto', 'auto'),
    text(win, null, '—', 12, 34, 'auto', TEXT.primary, undefined, 'left'),
    UI.createElement(win, { renderable: { type: 'box', colour: BORDER.divider, aabb: { min: { x: 0, y: 0 }, max: { x: 1, y: 14 } } },
      item: { size: { x: 9, y: 'auto' }, margin: STRIP_MARGIN }, contentAlign: { x: 'center', y: 'center' } }),
    chip(STATUS_BUTTON_WIDTH, () => anchored(bellChip.id, async output => {
      await Promise.all([volume.close(), network.close(), power.close()]); await notifications.open(output);
    })),
    icon(win, null, '/rom/assets/launcher/bell.png', ICON_SIZE, 'auto', 'auto'),
    Compositor.setClearColor(win, 0, 0, 0, 0)
  ]);
  const speaker = speakerChip.id, networkTarget = networkChip.id, battery = batteryChip.id, target = bellChip.id;
  await Promise.all([
    UI.setHitTarget(win, strip, false), UI.setHitTarget(win, edge, false), UI.setHitTarget(win, centre, false),
    ...[updateChip, speakerChip, networkChip, batteryChip, bellChip].map(chip => UI.attach(win, chip.id, chip.face)),
    UI.attach(win, updateRow, updateGlyph), UI.attach(win, updateRow, updateCount), UI.attach(win, updateRow, updateSpinner.id), UI.attach(win, updateChip.face, updateRow),
    UI.attach(win, updateChip.face, updateWarning), UI.setPosition(win, updateWarning, { x: ICON_SIZE / 2, y: -ICON_SIZE / 2 + 2 }), UI.setHitTarget(win, updateWarning, false),
    UI.attach(win, dateTime, clock), UI.attach(win, dateTime, date),
    UI.attach(win, speakerChip.face, speakerGlyph), UI.attach(win, networkChip.face, networkGlyph), UI.attach(win, networkChip.face, warning),
    UI.setPosition(win, warning, { x: ICON_SIZE / 2, y: -ICON_SIZE / 2 + 2 }), UI.setHitTarget(win, warning, false),
    UI.attach(win, batteryIcon, level), UI.attach(win, batteryIcon, charging),
    UI.attach(win, batteryRow, batteryIcon), UI.attach(win, batteryRow, percentage), UI.attach(win, batteryChip.face, batteryRow),
    UI.attach(win, bellChip.face, bell),
    ...[brand, dateTime, spacer, updateChip.id, speaker, networkTarget, battery, divider, target].map(id => UI.attach(win, row, id)),
    ...[strip, edge, row, centre].map(id => UI.attach(win, root, id)),
    UI.setElementId(win, charging, 'top-bar-battery-charging'), UI.setEnabled(win, charging, false), UI.setHitTarget(win, charging, false),
    UI.setMargin(win, brand, STRIP_MARGIN), UI.setElementId(win, brand, 'top-bar-brand'), UI.setElementId(win, speaker, 'top-bar-volume'),
    UI.setElementId(win, networkTarget, 'top-bar-network'), UI.setElementId(win, target, 'top-bar-notifications'),
    UI.setElementId(win, battery, 'top-bar-battery'), UI.setElementId(win, percentage, 'top-bar-battery-percent'),
    UI.setElementId(win, clock, 'top-bar-clock'), UI.setElementId(win, date, 'top-bar-date'), UI.setEnabled(win, date, initialClock.showDate),
    UI.setEnabled(win, warning, false), UI.setEnabled(win, battery, !!initialState.BatteryPresent),
    UI.setElementId(win, updateChip.id, 'top-bar-updates'), UI.setElementId(win, updateCount, 'top-bar-updates-count'),
    UI.setEnabled(win, updateChip.id, initialIndicator.visible), UI.setEnabled(win, updateCount, !!initialIndicator.text),
    UI.setEnabled(win, updateSpinner.id, initialIndicator.busy), UI.setEnabled(win, updateWarning, initialIndicator.warning)
  ]);
  if (initialIndicator.busy) updateSpinner.start();
  await UI.attachRoot(win, root);
  // Workspace discovery populates the already-visible bar on a later turn.
  workspaces.build(centre);

  const unsubscribeVolume = volume.subscribe(value => UI.setTexture(win, speakerGlyph,
    texture(speakerStatus(value).icon)).catch(error => Log.error('Volume indicator: ' + error)));
  const unsubscribe = notifications.subscribe(count => UI.setTexture(win, bell,
    '/rom/assets/launcher/bell' + (count ? '-active' : '') + '.png').catch(error => Log.error('Notification indicator: ' + error)));
  let timer, disposed = false, clockGeneration = 0;
  let clockSettings = clockPreferences(initialState), clockKey = JSON.stringify(clockSettings), clockUpdates = Promise.resolve();
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
    const popupUpdate = Promise.all([network.onState(value), power.onState(value)]);
    const nextClock = clockPreferences(value), nextClockKey = JSON.stringify(nextClock);
    let clockUpdate;
    if (nextClockKey !== clockKey) {
      clockKey = nextClockKey; clockSettings = nextClock; clockUpdate = refreshClock(true);
    }
    const indicator = updatesIndicator(value);
    const status = topBarStatus(value), key = JSON.stringify([status, value.BatteryPresent, value.NetworkType, indicator]);
    if (key !== previous) {
      previous = key;
      updates = updates.then(() => Promise.all([
        UI.setEnabled(win, updateChip.id, indicator.visible), UI.setTextString(win, updateCount, indicator.text),
        UI.setEnabled(win, updateCount, !!indicator.text), UI.setLayoutSize(win, updateCount, { x: Math.max(8, indicator.text.length * 8) }),
        UI.setEnabled(win, updateSpinner.id, indicator.busy), indicator.busy ? updateSpinner.start() : updateSpinner.stop(),
        UI.setEnabled(win, updateWarning, indicator.warning), UI.setLayoutSize(win, updateChip.id, { x: updatesWidth(indicator) }),
        UI.setTexture(win, networkGlyph, texture(status.wired ? 'ethernet' : value.NetworkType === 'cellular' ? status.cellIcon : status.wifiIcon)),
        UI.setEnabled(win, warning, status.warning),
        UI.setEnabled(win, battery, !!value.BatteryPresent), UI.setTexture(win, level, texture(status.batteryIcon)),
        UI.setEnabled(win, charging, status.charging),
        UI.setTextString(win, percentage, status.batteryText), UI.setTextColour(win, percentage, status.batteryLow ? TEXT.accent : TEXT.primary)
      ])).catch(error => Log.error('Top bar: ' + error));
    }
    return Promise.all([updates, popupUpdate, clockUpdate]);
  });
  const stopLayout = windowLayout(win, async () => {
    if (disposed) return;
    const updated = (await Compositor.listDisplays({ backend: 'wayland' })).find(item => item.display === display.display);
    if (!updated) return;
    // The strip, row and centring layer follow the window through layout.
    const size = { x: Number(updated.logical_width || updated.width), y: Number(updated.logical_height || updated.height) };
    if (notifications.display.display === display.display) await notifications.resize(size);
    await volume.resize({ ...size, display: display.display });
    await Promise.all([network.resize(), power.resize()]);
  });
  return { window: win, notifications, volume, dispose: async () => {
    disposed = true; clearTimeout(timer); disconnect(); unsubscribe(); unsubscribeVolume(); stopLayout(); workspaces.dispose();
    await volume.resize({ display: display.display });
    await Promise.all([network.dispose(), power.dispose()]);
    await destroySurface(win);
  } };
};
