import * as Compositor from 'Koya/Compositor';
import * as UI from 'Helix/UserInterface';
import * as Event from 'Helix/Event';
import * as Engine from 'Helix/Engine';
import * as Desktop from 'Module/desktop';
import * as Process from 'Module/process';
import * as PAM from 'Module/pam';
import * as Log from 'Helix/Log';
import { createLockController } from './lock-model.js';
import { clockPreferences, clockPresentation } from './clock-model.js';
import { readSettings } from './settings-model.js';
import { configureWallpaper, wallpaperSurface, resizeWallpaper } from './wallpaper-surface.js';
import { windowLayout } from './window-layout.js';
import { passwordInput } from './password-input.js';
import { text, button, children } from './touch-ui.js';
import { surfaceCursor, destroySurface } from './cursor.js';
import { CREAM, ORANGE, INK, MUTED, TYPE, SPACE } from './theme.js';

export default function main() {
  setTimeout(() => build().catch(async () => {
    Log.error('Lock screen startup failed');
    // A confirmed or pending lock is never released after a UI failure.
    try { if (['unlocked', 'finished'].includes(await Compositor.sessionLockState())) Engine.quit(); } catch (_) {}
  }), 0);
}
async function build() {
  const user = Desktop.userName(), service = Process.getEnv('KOYA_PAM_SERVICE', 'login');
  const settings = readSettings(Desktop.loadPreferences());
  await configureWallpaper(settings);
  let clockSettings = clockPreferences(settings);
  const screens = new Map();
  let password = '', message = 'Enter your password to unlock', confirmed = false;
  const setStatus = value => {
    message = value;
    for (const screen of screens.values()) UI.setTextString(screen.win, screen.status, value).catch(() => {});
  };
  const controller = createLockController({ authenticate: answer => PAM.authenticate({ service, user, password: answer }),
    lockState: () => Compositor.sessionLockState(), unlock: () => Compositor.unlockSession(), onStatus: setStatus });
  const updateInput = source => Promise.all([...screens.values()].filter(screen => screen.input !== source).map(screen => screen.input.setValue(password)));
  const updateAvailability = () => Promise.all([...screens.values()].map(async screen => {
    const disabled = !confirmed || controller.busy || controller.unlocked;
    await screen.input.setDisabled(disabled);
    if (!disabled && !screen.input.isFocused()) await screen.input.focus();
  }));
  const submit = async () => {
    if (!confirmed || controller.busy || controller.unlocked) return;
    let answer = password; password = '';
    const checking = controller.submit(answer); answer = '';
    await Promise.all([updateInput(), updateAvailability()]);
    if (await checking) Engine.quit();
    else await updateAvailability();
  };
  const formWidth = size => Math.max(40, Math.min(420, size.x - 40));
  // timeWidth reserves room for the longest clock string at the bar's 14 px
  // reference size. Scale that allowance to keep AM/PM and seconds in the form.
  const timeSize = (size, view) => Math.min(TYPE.display, size.y / 8, formWidth(size) * 14 / view.timeWidth);
  const paintClock = async () => {
    const view = clockPresentation(new Date(), clockSettings);
    const key = JSON.stringify([view.time, view.date, view.showDate]);
    await Promise.all([...screens.values()].map(async screen => {
      if (screen.clockKey === key) return;
      await Promise.all([
        UI.setTextString(screen.win, screen.timeLabel, view.time),
        UI.setTextString(screen.win, screen.dateLabel, view.date),
        UI.setEnabled(screen.win, screen.dateLabel, view.showDate),
        UI.setTextSize(screen.win, screen.timeLabel, timeSize(screen.size, view))
      ]);
      screen.clockKey = key;
    }));
  };
  const add = async display => {
    const win = await Compositor.createWindow({ role: 'lock', display: display.display, msaaSamples: 1,
      transparent: false, keyboardInteractivity: 'exclusive', acceptPointerEvents: true });
    const info = await Compositor.getWindowInfo(win);
    if (info.role !== 'lock') throw new Error('A compositor lock surface is required');
    const size = { x: info.width, y: info.height };
    const width = formWidth(size);
    const view = clockPresentation(new Date(), clockSettings);
    const [root] = await Promise.all([
      UI.createElement(win, { renderable: { type: 'box', colour: INK }, layout: { type: 'none' }, item: { size }, contentAlign: 'fill', onHover: surfaceCursor(win) }),
      Compositor.setClearColor(win, ...INK)
    ]);
    // Position the form column explicitly; cross-axis alignment uses its child widths.
    const [wall, content] = await children(win, root, [
      wallpaperSurface(win, size, [0.4, 0.45, 0.4, 1]),
      UI.createElement(win, { layout: { type: 'column', gap: SPACE.m, justifyContent: 'center', alignItems: 'center' },
        item: { position: { x: (size.x - width) / 2, y: 0 }, size: { x: width, y: size.y } } })
    ]);
    let unlockLabel, input;
    const [timeLabel, dateLabel, userLabel, passwordBox, status, unlock] = await children(win, content, [
      text(win, null, view.time, timeSize(size, view), width, Math.min(112, size.y / 6)),
      text(win, null, view.date, TYPE.caption, width, 28, MUTED),
      text(win, null, user, TYPE.heading, width, 48),
      passwordInput(win, { width, height: 52, size: TYPE.body, disabled: true, textId: 'lock-password', id: 'lock-password-input',
        onSubmit: submit, onInput: value => { password = value; updateInput(input).catch(() => {}); } })
        .then(control => { input = control; return control.master.id; }),
      text(win, null, message, TYPE.caption, width, 36, ORANGE),
      button(win, null, 'Unlock', width, 48, submit, { colour: ORANGE, labelColour: INK, onLabel: id => { unlockLabel = id; } })
    ]);
    await Promise.all([
      UI.attachRoot(win, root),
      UI.setElementId(win, timeLabel, 'lock-clock'), UI.setElementId(win, dateLabel, 'lock-date'),
      UI.setEnabled(win, dateLabel, view.showDate)
    ]);
    const screen = { win, root, content, wall, input, status, timeLabel, dateLabel, size,
      clockKey: JSON.stringify([view.time, view.date, view.showDate]) };
    screens.set(display.display, screen);
    screen.stopLayout = windowLayout(win, async next => {
      screen.size = next;
      const width = formWidth(next);
      await Promise.all([
        UI.setLayoutSize(win, root, next), resizeWallpaper(win, wall, next),
        UI.setLayoutSize(win, content, { x: width, y: next.y }),
        UI.setLayoutPosition(win, content, { x: (next.x - width) / 2, y: 0 }),
        UI.setLayoutSize(win, timeLabel, { x: width, y: Math.min(112, next.y / 6) }),
        UI.setTextSize(win, timeLabel, timeSize(next, clockPresentation(new Date(), clockSettings))),
        input.setSize({ x: width, y: 52 }),
        ...[[dateLabel, 28], [userLabel, 48], [status, 36], [unlock, 48], [unlockLabel, 32]]
          .map(([id, height]) => UI.setLayoutSize(win, id, { x: width, y: height }))
      ]);
    });
    await updateInput();
    await updateAvailability();
  };
  const sync = async () => {
    const displays = await Compositor.listDisplays(), names = new Set(displays.map(item => item.display));
    for (const [name, screen] of screens) if (!names.has(name)) {
      screen.stopLayout(); screens.delete(name); await screen.input.destroy(); await destroySurface(screen.win);
    }
    for (const display of displays) if (!screens.has(display.display)) await add(display);
  };
  const accepts = event => confirmed && !controller.busy && [...screens.values()].some(screen => screen.win === event.id);
  Event.on('keyDown', event => {
    if (accepts(event) && [1, 65307].includes(Number(event.key))) { password = ''; updateInput(); }
  });
  await sync();
  if (!screens.size) throw new Error('No lock display available');
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await Compositor.sessionLockState();
    if (state === 'locked') { confirmed = true; break; }
    if (state === 'unlocked' || state === 'finished') throw new Error('The compositor refused the lock');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!confirmed) throw new Error('The compositor did not confirm the lock');
  await updateAvailability();
  // Hypridle observes the compositor lock and continues its display/sleep policy.
  let updating = false;
  setInterval(async () => {
    if (controller.unlocked || updating) return;
    updating = true;
    try {
      if (await Compositor.sessionLockState() === 'finished') { Engine.quit(); return; }
      clockSettings = clockPreferences(readSettings(Desktop.loadPreferences()));
      await sync();
      await paintClock();
    } catch (_) { Log.error('Lock screen could not update'); }
    finally { updating = false; }
  }, 1000);
}
