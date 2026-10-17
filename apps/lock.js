import * as Compositor from 'Koya/Compositor';
import * as UI from './theme-ui.js';
import * as Event from 'Helix/Event';
import * as Engine from 'Helix/Engine';
import * as Desktop from 'Module/desktop';
import * as Process from 'Module/process';
import * as PAM from 'Module/pam';
import * as Log from 'Helix/Log';
import { createLockController } from './lock-model.js';
import { clockPreferences } from './clock-model.js';
import { readSettings } from './settings-model.js';
import { configureWallpaper } from './wallpaper-surface.js';
import { authScreen, AUTH_CARD_WIDTH, AUTH_CARD_PADDING } from './auth-screen.js';
import { userAvatar } from './user-avatar.js';
import { passwordInput } from './password-input.js';
import { text, button } from './touch-ui.js';
import { destroySurface } from './cursor.js';
import { presets } from './motion.js';
import { TYPE, SPACE, TEXT, FONT_STRONG, SURFACE, configureTheme } from './theme.js';

// The lock screen: the shared auth screen (wallpaper, clock, centred card)
// with the person, their password, a status line and Unlock in the card.
// The card shakes on a refusal.
const AVATAR_SIZE = 40;

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
  await configureTheme(settings);
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
    else {
      for (const screen of screens.values()) screen.play(screen.card, presets.shake());
      await updateAvailability();
    }
  };
  const paintClock = () => Promise.all([...screens.values()].map(screen => screen.paintClock(clockSettings)));
  const add = async display => {
    const win = await Compositor.createWindow({ role: 'lock', display: display.display, msaaSamples: 1,
      transparent: false, keyboardInteractivity: 'exclusive', acceptPointerEvents: true });
    const info = await Compositor.getWindowInfo(win);
    if (info.role !== 'lock') throw new Error('A compositor lock surface is required');
    const size = { x: info.width, y: info.height };
    const inner = AUTH_CARD_WIDTH - AUTH_CARD_PADDING * 2;
    // The card: avatar and name, the password, status and Unlock.
    const cardHeight = AUTH_CARD_PADDING * 2 + AVATAR_SIZE + SPACE.l + 48 + SPACE.m + 28 + SPACE.s + 44;
    let input, status, avatar, name;
    const screen = await authScreen(win, { size, name: 'lock', cardHeight, clock: clockSettings, build: async card => {
      const person = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: { x: 'auto', y: AVATAR_SIZE }, margin: { t: 0, r: 0, b: SPACE.l - SPACE.s, l: 0 } } });
      [avatar, name] = await Promise.all([
        userAvatar(win, { size: AVATAR_SIZE, id: 'lock-avatar', onName: value => {
          if (name) UI.setTextString(win, name, value || user).catch(() => {});
        } }),
        text(win, null, user, TYPE.heading, 'auto', 'auto', TEXT.primary, FONT_STRONG, 'left')
      ]);
      await Promise.all([UI.attach(win, person, avatar.id), UI.attach(win, person, name), UI.setElementId(win, name, 'lock-name')]);
      const passwordBox = await passwordInput(win, { width: inner, height: 48, size: TYPE.body, disabled: true, textId: 'lock-password', id: 'lock-password-input',
        onSubmit: submit, onInput: value => { password = value; updateInput(input).catch(() => {}); } }).then(control => { input = control; return control.master.id; });
      status = await text(win, null, message, TYPE.caption, inner, 28, TEXT.accent);
      const unlock = await button(win, null, 'Unlock', inner, 44, submit, { colour: SURFACE.accent, labelColour: TEXT.onAccent, size: TYPE.body });
      // Reading order made explicit (siblings sort by order, then creation).
      for (const [index, id] of [person, passwordBox, status, unlock].entries()) { await UI.setLayoutOrder(win, id, index); await UI.attach(win, card.content, id); }
    } });
    screen.input = input; screen.status = status; screen.avatar = avatar;
    screens.set(display.display, screen);
    avatar.setUser(user);
    await updateInput();
    await updateAvailability();
  };
  const sync = async () => {
    const displays = await Compositor.listDisplays({ backend: 'wayland' }), names = new Set(displays.map(item => item.display));
    for (const [name, screen] of screens) if (!names.has(name)) {
      screen.stop(); screens.delete(name); await Promise.all([screen.input.destroy(), screen.avatar.dispose()]); await destroySurface(screen.win);
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
      const settings = readSettings(Desktop.loadPreferences());
      await configureTheme(settings);
      clockSettings = clockPreferences(settings);
      await sync();
      await paintClock();
    } catch (_) { Log.error('Lock screen could not update'); }
    finally { updating = false; }
  }, 1000);
}
