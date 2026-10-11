import * as Compositor from 'Koya/Compositor';
import * as UI from 'Helix/UserInterface';
import * as Log from 'Helix/Log';
import { connect } from './session.js';
import { BAR_HEIGHT, CREAM, INK, ORANGE, CLEAR, MUTED } from './theme.js';
import { icon, text, button, children } from './touch-ui.js';
import { topBarStatus } from './status-model.js';
import { createNotifications } from './notifications.js';
import { createVolume } from './volume.js';
import { createNetworkPopup } from './network-popup.js';
import { speakerStatus } from './audio-model.js';
import { windowLayout } from './window-layout.js';
import { surfaceCursor, controlCursor, destroySurface } from './cursor.js';
import { clockPreferences, clockPresentation, clockRefreshDelay } from './clock-model.js';

const CLOCK_SIZE = 14, DATE_WIDTH = 90, CLOCK_GAP = 8;
const clockGroupWidth = view => view.timeWidth + (view.showDate ? CLOCK_GAP + DATE_WIDTH : 0);

export default async ({ display, notifications: shared, volume: sharedVolume } = {}) => {
  display ||= (await Compositor.listDisplays())[0];
  const win = await Compositor.createWindow({ role: 'bar', edge: 'top', thickness: BAR_HEIGHT,
    reserveSpace: true, display: display.display, namespace: 'koya-top-bar',
    msaaSamples: 1, keyboardInteractivity: 'none', acceptPointerEvents: true });
  const volume = sharedVolume || createVolume(display);
  const network = createNetworkPopup();
  const notifications = shared || createNotifications(display);
  const texture = name => '/rom/assets/status/' + name + '.png';
  const [root] = await Promise.all([
    UI.createElement(win, { onHover: surfaceCursor(win),
      layout: { type: 'row', justifyContent: 'start', alignItems: 'center', gap: 12,
        padding: { l: 4, r: 4, t: 0, b: 0 } }, item: { size: { x: 'auto', y: BAR_HEIGHT } }
    }), Compositor.setClearColor(win, ...INK)
  ]);
  let speakerGlyph, bell;
  const initialClock = clockPresentation(new Date());
  const [brand, dateTime, , speaker, indicators, target] = await children(win, root, [
    icon(win, null, '/rom/assets/brand/koya-fish.png', 16, 20, BAR_HEIGHT),
    UI.createElement(win, { id: 'top-bar-datetime', layout: { type: 'row', gap: CLOCK_GAP, alignItems: 'center' },
      item: { size: { x: clockGroupWidth(initialClock), y: BAR_HEIGHT } } }),
    UI.createElement(win, { item: { size: { x: 'auto', y: 'auto' }, flexGrow: 1 } }),
    button(win, null, '', 36, BAR_HEIGHT, async () => {
      try {
        const output = (await Compositor.listDisplays()).find(item => item.display === display.display);
        if (!output) return;
        const frame = await UI.getElementFrame(win, speaker);
        await Promise.all([network.close(), notifications.close()]);
        await volume.toggle(output, { x: frame.min.x, y: frame.min.y,
          width: frame.max.x - frame.min.x, height: frame.max.y - frame.min.y });
      } catch (error) { Log.error('Volume control: ' + error); }
    }, { colour: CLEAR, icon: texture('volume-unavailable'), iconSize: 20, onIcon: id => { speakerGlyph = id; } }),
    UI.createElement(win, { layout: { type: 'row', gap: 10, alignItems: 'center' }, item: { size: { x: 140, y: BAR_HEIGHT } } }),
    button(win, null, '', 24, BAR_HEIGHT, async () => {
      try {
        await Promise.all([volume.close(), network.close()]);
        const output = (await Compositor.listDisplays()).find(item => item.display === display.display);
        if (output) await notifications.open(output);
      } catch (error) { Log.error('Notification control: ' + error); }
    }, { colour: CLEAR, icon: '/rom/assets/launcher/bell.png', iconSize: 20, onIcon: id => { bell = id; } })
  ]);
  const [networkTarget, battery] = await children(win, indicators, [
    UI.createElement(win, { id: 'top-bar-network', layout: { type: 'row', gap: 4, alignItems: 'center' },
      item: { size: { x: 48, y: BAR_HEIGHT } }, onHover: controlCursor(win), onActivate: async () => {
        try {
          const output = (await Compositor.listDisplays()).find(item => item.display === display.display);
          if (!output) return;
          const frame = await UI.getElementFrame(win, networkTarget);
          await Promise.all([volume.close(), notifications.close()]);
          await network.toggle(output, { x: frame.min.x, y: frame.min.y,
            width: frame.max.x - frame.min.x, height: frame.max.y - frame.min.y });
        } catch (error) { Log.error('Network control: ' + error); }
      } }),
    UI.createElement(win, { layout: { type: 'row', gap: 4, alignItems: 'center' }, item: { size: { x: 72, y: BAR_HEIGHT } } })
  ]);
  const [[networkGlyph, warning], [level, percentage], [clock, date]] = await Promise.all([
    children(win, networkTarget, [icon(win, null, texture('wifi-off'), 21, 24, BAR_HEIGHT), text(win, null, '!', 16, 12, BAR_HEIGHT, ORANGE)]),
    children(win, battery, [icon(win, null, texture('battery-unknown'), 24, 24, BAR_HEIGHT), text(win, null, '—', 14, 44, BAR_HEIGHT)]),
    children(win, dateTime, [
      text(win, null, initialClock.time, CLOCK_SIZE, initialClock.timeWidth, BAR_HEIGHT, CREAM, undefined, 'left'),
      text(win, null, initialClock.date, CLOCK_SIZE, DATE_WIDTH, BAR_HEIGHT, MUTED, undefined, 'left')
    ]),
    UI.setElementId(win, brand, 'top-bar-brand'),
    UI.setElementId(win, speaker, 'top-bar-volume'), UI.setElementId(win, target, 'top-bar-notifications')
  ]);
  await Promise.all([UI.attachRoot(win, root), UI.setElementId(win, percentage, 'top-bar-battery-percent'),
    UI.setElementId(win, clock, 'top-bar-clock'), UI.setElementId(win, date, 'top-bar-date')]);
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
        ...(configure ? [UI.setLayoutSize(win, clock, { x: view.timeWidth, y: BAR_HEIGHT }),
          UI.setLayoutSize(win, dateTime, { x: clockGroupWidth(view), y: BAR_HEIGHT }),
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
    const size = { x: Number(updated.logical_width || updated.width), y: Number(updated.logical_height || updated.height) };
    if (notifications.display.display === display.display) await notifications.resize(size);
    await volume.resize({ ...size, display: display.display });
    await network.resize();
  });
  return { window: win, notifications, volume, dispose: async () => {
    disposed = true; clearTimeout(timer); disconnect(); unsubscribe(); unsubscribeVolume(); stopLayout();
    await volume.resize({ display: display.display });
    await network.dispose();
    await destroySurface(win);
  } };
};
