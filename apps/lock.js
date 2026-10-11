import * as Compositor from 'Koya/Compositor';
import * as UI from 'Helix/UserInterface';
import * as Event from 'Helix/Event';
import * as Engine from 'Helix/Engine';
import * as Desktop from 'Module/desktop';
import * as Process from 'Module/process';
import * as PAM from 'Module/pam';
import * as Log from 'Helix/Log';
import { createLockController } from './lock-model.js';
import { configureWallpaper, wallpaperSurface, resizeWallpaper } from './wallpaper-surface.js';
import { windowLayout } from './window-layout.js';
import { text, button, children } from './touch-ui.js';
import { surfaceCursor, controlCursor, destroySurface } from './cursor.js';
import { FONT, CREAM, ORANGE, INK, CARD, MUTED, TYPE, SPACE, RADIUS } from './theme.js';

export default function main() {
  setTimeout(() => build().catch(async () => {
    Log.error('Lock screen startup failed');
    // A confirmed or pending lock is never released after a UI failure.
    try { if (['unlocked', 'finished'].includes(await Compositor.sessionLockState())) Engine.quit(); } catch (_) {}
  }), 0);
}
async function build() {
  const user = Desktop.userName(), service = Process.getEnv('KOYA_PAM_SERVICE', 'login');
  await configureWallpaper(Desktop.loadPreferences());
  const screens = new Map();
  let password = '', preedit = '', message = 'Enter your password to unlock', confirmed = false;
  const setStatus = value => {
    message = value;
    for (const screen of screens.values()) UI.setTextString(screen.win, screen.status, value).catch(() => {});
  };
  const controller = createLockController({ authenticate: answer => PAM.authenticate({ service, user, password: answer }),
    lockState: () => Compositor.sessionLockState(), unlock: () => Compositor.unlockSession(), onStatus: setStatus });
  const updateInput = () => Promise.all([...screens.values()].flatMap(screen => [
    UI.setTextString(screen.win, screen.field, password || preedit ? '•'.repeat(Array.from(password + preedit).length) : 'Password'),
    UI.setTextColour(screen.win, screen.field, password || preedit ? CREAM : MUTED)
  ]));
  const submit = async () => {
    if (!confirmed || controller.busy || controller.unlocked) return;
    let answer = password; password = preedit = ''; updateInput();
    const checking = controller.submit(answer); answer = '';
    if (await checking) Engine.quit();
  };
  const clock = () => {
    const now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  };
  const date = () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const add = async display => {
    const win = await Compositor.createWindow({ role: 'lock', display: display.display, msaaSamples: 1,
      transparent: false, keyboardInteractivity: 'exclusive', acceptPointerEvents: true });
    const info = await Compositor.getWindowInfo(win);
    if (info.role !== 'lock') throw new Error('A compositor lock surface is required');
    const size = { x: info.width, y: info.height };
    const formWidth = size => Math.max(40, Math.min(420, size.x - 40));
    const width = formWidth(size);
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
    let unlockLabel;
    const [timeLabel, dateLabel, userLabel, fieldBox, status, unlock] = await children(win, content, [
      text(win, null, clock(), Math.min(TYPE.display, size.y / 8), width, Math.min(112, size.y / 6)),
      text(win, null, date(), TYPE.caption, width, 28, MUTED),
      text(win, null, user, TYPE.heading, width, 48),
      UI.createElement(win, { renderable: { type: 'box', colour: CARD, cornerRadius: RADIUS.control, cornerResolution: 16 },
        item: { size: { x: width, y: 52 } }, contentAlign: 'fill', onHover: controlCursor(win, 'text') }),
      text(win, null, message, TYPE.caption, width, 36, ORANGE),
      button(win, null, 'Unlock', width, 48, submit, { colour: ORANGE, labelColour: INK, onLabel: id => { unlockLabel = id; } })
    ]);
    const field = await text(win, null, 'Password', TYPE.body, width - 24, 52, MUTED, FONT);
    await Promise.all([
      UI.attachRoot(win, root), UI.attach(win, fieldBox, field),
      UI.setLayoutPosition(win, field, { x: 12, y: 0 }), UI.setElementId(win, field, 'lock-password')
    ]);
    const screen = { win, root, content, wall, field, status, timeLabel, dateLabel };
    screens.set(display.display, screen);
    screen.stopLayout = windowLayout(win, async next => {
      const width = formWidth(next);
      await Promise.all([
        UI.setLayoutSize(win, root, next), resizeWallpaper(win, wall, next),
        UI.setLayoutSize(win, content, { x: width, y: next.y }),
        UI.setLayoutPosition(win, content, { x: (next.x - width) / 2, y: 0 }),
        UI.setLayoutSize(win, timeLabel, { x: width, y: Math.min(112, next.y / 6) }),
        UI.setTextSize(win, timeLabel, Math.round(Math.min(TYPE.display, next.y / 8))),
        UI.setLayoutSize(win, field, { x: width - 24, y: 52 }),
        ...[[dateLabel, 28], [userLabel, 48], [fieldBox, 52], [status, 36], [unlock, 48], [unlockLabel, 32]]
          .map(([id, height]) => UI.setLayoutSize(win, id, { x: width, y: height }))
      ]);
    });
    // Password input never shares surrounding text with an input method.
    try { await Compositor.setTextInput(win, { enabled: true, newFocus: true, inputId: field, cursorElement: field, contentPurpose: 8, contentHint: 64 | 128 }); } catch (_) {}
    await updateInput();
  };
  const sync = async () => {
    const displays = await Compositor.listDisplays(), names = new Set(displays.map(item => item.display));
    for (const [name, screen] of screens) if (!names.has(name)) {
      screen.stopLayout(); screens.delete(name); await destroySurface(screen.win);
    }
    for (const display of displays) if (!screens.has(display.display)) await add(display);
  };
  const accepts = event => confirmed && !controller.busy && [...screens.values()].some(screen => screen.win === event.id);
  Event.on('textInput', event => {
    if (!accepts(event)) return;
    password = (password + String(event.text || '').replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 512); updateInput();
  });
  Event.on('textInputMethod', event => {
    if (!accepts(event)) return;
    const characters = Array.from(password);
    if (event.deleteBefore) characters.splice(Math.max(0, characters.length - event.deleteBefore));
    password = (characters.join('') + String(event.text || '').replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 512);
    preedit = String(event.preedit || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512); updateInput();
  });
  const key = event => {
    if (!accepts(event)) return;
    if ([14, 65288].includes(Number(event.key))) { preedit = ''; password = Array.from(password).slice(0, -1).join(''); updateInput(); }
    if ([28, 96, 65293].includes(Number(event.key))) submit();
    if ([1, 65307].includes(Number(event.key))) { password = preedit = ''; updateInput(); }
  };
  Event.on('keyDown', key); Event.on('keyRepeat', key);
  await sync();
  if (!screens.size) throw new Error('No lock display available');
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await Compositor.sessionLockState();
    if (state === 'locked') { confirmed = true; break; }
    if (state === 'unlocked' || state === 'finished') throw new Error('The compositor refused the lock');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!confirmed) throw new Error('The compositor did not confirm the lock');
  // Hypridle observes the compositor lock and continues its display/sleep policy.
  let updating = false;
  setInterval(async () => {
    if (controller.unlocked || updating) return;
    updating = true;
    try {
      if (await Compositor.sessionLockState() === 'finished') { Engine.quit(); return; }
      await sync();
      await Promise.all([...screens.values()].flatMap(screen => [
        UI.setTextString(screen.win, screen.timeLabel, clock()), UI.setTextString(screen.win, screen.dateLabel, date())
      ]));
    } catch (_) { Log.error('Lock screen could not update'); }
    finally { updating = false; }
  }, 1000);
}
