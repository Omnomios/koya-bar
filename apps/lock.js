import * as Compositor from 'Koya/Compositor';
import * as UI from './theme-ui.js';
import * as Event from 'Helix/Event';
import * as Engine from 'Helix/Engine';
import * as Desktop from 'Module/desktop';
import * as Process from 'Module/process';
import * as PAM from 'Module/pam';
import { createFingerprintAuth } from './fingerprint-auth.js';
import { system } from 'Module/dbus';
import * as Log from 'Helix/Log';
import { createLockController } from './lock-model.js';
import { createFingerprintService } from './fingerprint-model.js';
import { clockPreferences } from './clock-model.js';
import { readSettings } from './settings-model.js';
import { configureWallpaper } from './wallpaper-surface.js';
import { authScreen, AUTH_CARD_WIDTH, AUTH_CARD_PADDING } from './auth-screen.js';
import { userAvatar } from './user-avatar.js';
import { setLockedHint } from './session-state.js';
import { passwordInput } from './password-input.js';
import { text, icon, button } from './touch-ui.js';
import { destroySurface } from './cursor.js';
import { presets } from './motion.js';
import { TYPE, SPACE, TEXT, FONT, FONT_STRONG, SURFACE, BADGE, MOTION, alpha, configureTheme } from './theme.js';

// The lock screen: the shared auth screen (wallpaper, clock, centred card)
// with the person, their password, a status line and Unlock in the card.
// The card shakes on a refusal. With a fingerprint enrolled, a badge beside
// the status line shows the sensor: its ring pulses while listening, it
// shakes at an unknown finger, dims while a password is typed and counts
// down while the reader rests after too many attempts.
const AVATAR_SIZE = 40, SENSOR_SLOT = 32, SENSOR_SIZE = 28;
const SENSOR_GLYPH = '/rom/assets/status/fingerprint.png';
// An error stays readable this long before a prompt may replace it.
const ERROR_HOLD = 2000;
// A changed status line arrives from just below.
const STATUS_IN = [{ time: 0, opacity: 0, position: { x: 0, y: 4 } }, { time: MOTION.base, opacity: 1, position: { x: 0, y: 0 }, ease: MOTION.enter }];
const COUNT_IN = [{ time: 0, opacity: 0, position: { x: 0, y: -3 } }, { time: MOTION.base, opacity: 1, position: { x: 0, y: 0 }, ease: MOTION.enter }];

export default function main() {
  setTimeout(() => build().catch(async () => {
    Log.error('Lock screen startup failed');
    // A confirmed or pending lock is never released after a UI failure.
    try { if (['unlocked', 'finished'].includes(await Compositor.sessionLockState())) Engine.quit(); } catch (_) {}
  }), 0);
}
async function build() {
  const user = Desktop.userName(), service = Process.getEnv('KOYA_PAM_SERVICE', 'login');
  const fingerprint = createFingerprintAuth(PAM, { user, configured: () => Process.exists('/etc/pam.d/koya-fingerprint') });
  const settings = readSettings(Desktop.loadPreferences());
  await configureTheme(settings);
  await configureWallpaper(settings);
  let clockSettings = clockPreferences(settings);
  const screens = new Map();
  let password = '', confirmed = false, fingerprintReady = false;
  let notice = { text: '', tone: 'info' }, holdUntil = 0, held, holdTimer;
  let sensor = { phase: 'hidden' }, countdown;
  const flash = alpha(SURFACE.accent, 0.55);
  const showStatus = async (screen, animate) => {
    await Promise.all([UI.setTextString(screen.win, screen.status, notice.text),
      UI.setTextColour(screen.win, screen.status, notice.tone === 'error' ? TEXT.accent : TEXT.secondary)]);
    if (animate && notice.text) screen.play(screen.status, STATUS_IN);
  };
  // Errors hold the line for a moment; a prompt that arrives meanwhile waits.
  // Clearing the line (typing, checking) never waits.
  const setStatus = (text, tone = 'info') => {
    if (tone !== 'error' && text && Date.now() < holdUntil) { held = [text, tone]; return; }
    clearTimeout(holdTimer); held = undefined; holdUntil = 0;
    if (tone === 'error') {
      holdUntil = Date.now() + ERROR_HOLD;
      holdTimer = setTimeout(() => { holdUntil = 0; if (held) setStatus(...held); }, ERROR_HOLD);
    }
    if (notice.text === text && notice.tone === tone) return;
    notice = { text, tone };
    for (const screen of screens.values()) showStatus(screen, true).catch(() => {});
  };
  const showSensor = async (screen, reaction) => {
    const { win, play } = screen, { slot, ring, disc, glyph, count } = screen.sensor, { phase } = sensor;
    if (reaction === 'mismatch') {
      play(slot, presets.shake());
      await UI.setBoxColour(win, disc, flash);
      setTimeout(() => { if (sensor.phase === 'listening') UI.setBoxColour(win, disc, BADGE.goodDisc).catch(() => {}); }, 450);
      return;
    }
    if (reaction === 'adjust') { play(ring, presets.pulse()); return; }
    if (screen.sensorPhase === phase) return;
    const previous = screen.sensorPhase; screen.sensorPhase = phase;
    const listening = phase === 'listening' || phase === 'matched';
    await Promise.all([UI.setEnabled(win, slot, phase !== 'hidden' && phase !== 'unavailable'),
      UI.setBoxColour(win, disc, listening ? BADGE.goodDisc : BADGE.offDisc)]);
    play(ring, listening ? presets.pulse(true) : presets.fade(0));
    play(glyph, presets.fade(phase === 'resting' ? 0 : listening ? 1 : 0.4));
    if (phase !== 'resting') play(count, presets.fade(0));
    // Waking up (or recognising a finger) pops the badge.
    if (phase === 'matched' || listening && previous !== 'listening') play(disc, presets.pop(0, 0.7));
  };
  // Resting counts the seconds down inside the badge.
  const tick = () => {
    clearInterval(countdown); countdown = undefined;
    if (sensor.phase !== 'resting') return;
    let shown;
    const update = () => {
      const seconds = Math.max(1, Math.ceil((sensor.resumeAt - Date.now()) / 1000));
      if (seconds === shown) return;
      shown = seconds;
      for (const screen of screens.values()) UI.setTextString(screen.win, screen.sensor.count, String(seconds))
        .then(() => screen.play(screen.sensor.count, COUNT_IN)).catch(() => {});
    };
    update(); countdown = setInterval(update, 200);
  };
  const setSensor = (phase, detail = {}) => {
    const reaction = phase === 'mismatch' || phase === 'adjust';
    // Typing pauses a sensor; one that never showed stays hidden.
    if (phase === 'paused' && ['hidden', 'unavailable'].includes(sensor.phase)) return;
    if (!reaction) { sensor = { phase, ...detail }; tick(); }
    for (const screen of screens.values()) showSensor(screen, reaction ? phase : null).catch(() => {});
  };
  const controller = createLockController({ authenticate: answer => PAM.authenticate({ service, user, password: answer }),
    fingerprint,
    lockState: () => Compositor.sessionLockState(), unlock: () => Compositor.unlockSession(), onStatus: setStatus, onSensor: setSensor });
  const updateInput = source => Promise.all([...screens.values()].filter(screen => screen.input !== source).map(screen => screen.input.setValue(password)));
  const updateAvailability = () => Promise.all([...screens.values()].map(async screen => {
    const disabled = !confirmed || controller.busy || controller.unlocked;
    await screen.input.setDisabled(disabled);
    if (!disabled && !screen.input.isFocused()) await screen.input.focus();
  }));
  const finishUnlock = async () => {
    await setLockedHint(false).catch(error => Log.error('Unlock session state: ' + error));
    Engine.quit();
  };
  const scan = async () => {
    if (!confirmed || !fingerprintReady || password || controller.busy || controller.unlocked) return;
    const checking = controller.scanWhile({
      enabled: () => confirmed && fingerprintReady && !password && !controller.busy && !controller.unlocked,
      changed: updateAvailability
    });
    await updateAvailability();
    if (await checking) await finishUnlock();
    else await updateAvailability();
  };
  const submit = async () => {
    if (!confirmed || controller.busy || controller.unlocked) return;
    let answer = password; password = '';
    const checking = controller.submit(answer); answer = '';
    await Promise.all([updateInput(), updateAvailability(), ...[...screens.values()].map(screen => screen.feedback?.begin())]);
    if (await checking) {
      await finishUnlock();
    }
    else {
      await Promise.all([...screens.values()].map(screen => screen.feedback?.end()));
      for (const screen of screens.values()) screen.play(screen.card, presets.shake());
      await updateAvailability();
      // The sensor listens again; its prompt waits behind the refusal.
      scan().catch(() => {});
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
    const cardHeight = AUTH_CARD_PADDING * 2 + AVATAR_SIZE + SPACE.l + 48 + SPACE.m + 44 + SPACE.s + 44;
    let input, status, avatar, name, feedback;
    const sensorParts = {};
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
        onSubmit: submit, onInput: value => {
          password = value; updateInput(input).catch(() => {});
          if (value) controller.cancelFingerprint().then(() => {
            if (!controller.busy && !controller.unlocked) {
              if (password) setStatus('');
              else scan().catch(() => {});
            }
            updateAvailability().catch(() => {});
          });
          else scan().catch(() => {});
        } }).then(control => { input = control; return control.master.id; });
      // The status line: the fingerprint badge (hidden until a reader with an
      // enrolled finger answers) and a few words beside it.
      const line = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: inner, y: 44 } } });
      const margin = (SENSOR_SLOT - SENSOR_SIZE) / 2, inset = { item: { size: { x: 'auto', y: 'auto' }, margin: { t: margin, r: margin, b: margin, l: margin } }, contentAlign: 'fill' };
      const [slot, ring, disc] = await Promise.all([
        UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: SENSOR_SLOT, y: SENSOR_SLOT } } }),
        UI.createElement(win, { renderable: { type: 'box', colour: BADGE.goodRing, cornerRadius: SENSOR_SIZE / 2, cornerResolution: 32, origin: { x: 0.5, y: 0.5 } }, ...inset }),
        UI.createElement(win, { renderable: { type: 'box', colour: BADGE.goodDisc, cornerRadius: SENSOR_SIZE / 2, cornerResolution: 32, origin: { x: 0.5, y: 0.5 } },
          layout: { type: 'none' }, ...inset })
      ]);
      const [glyph, count] = await Promise.all([icon(win, disc, SENSOR_GLYPH, 18, 'auto', 'auto'),
        text(win, disc, '', TYPE.caption, 'auto', 'auto', TEXT.primary, FONT_STRONG)]);
      await Promise.all([UI.attach(win, slot, ring), UI.attach(win, slot, disc), UI.setEnabled(win, slot, false), UI.setElementId(win, slot, 'lock-sensor')]);
      Object.assign(sensorParts, { slot, ring, disc, glyph, count });
      status = await text(win, null, '', TYPE.detail, 'auto', 44, TEXT.secondary, FONT, 'left');
      await Promise.all([UI.attach(win, line, slot), UI.attach(win, line, status), UI.setGrow(win, status, 1), UI.setElementId(win, status, 'lock-status')]);
      const unlock = await button(win, null, 'Unlock', inner, 44, submit, { colour: SURFACE.accent, labelColour: TEXT.onAccent, size: TYPE.body,
        onFeedback: control => { feedback = control; } });
      // Reading order made explicit (siblings sort by order, then creation).
      for (const [index, id] of [person, passwordBox, line, unlock].entries()) { await UI.setLayoutOrder(win, id, index); await UI.attach(win, card.content, id); }
    } });
    screen.input = input; screen.status = status; screen.avatar = avatar; screen.feedback = feedback; screen.sensor = sensorParts;
    screen.play(sensorParts.ring, [{ time: 0, opacity: 0 }]); screen.play(sensorParts.count, [{ time: 0, opacity: 0 }]);
    screens.set(display.display, screen);
    // A display that arrives later starts in the current state.
    await Promise.all([showStatus(screen, false), showSensor(screen, null)]);
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
    if (accepts(event) && [1, 65307].includes(Number(event.key))) { password = ''; updateInput().then(scan).catch(() => {}); }
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
  await setLockedHint(true).catch(error => Log.error('Lock session state: ' + error));
  await updateAvailability();
  if (fingerprint.available()) {
    const reader = createFingerprintService(system);
    reader.refresh().then(async () => {
      fingerprintReady = reader.state.available && reader.state.fingers.length > 0;
      await reader.dispose(); await updateAvailability();
      if (!password && !controller.busy && !controller.unlocked) await scan();
    }).catch(() => {});
  }
  // Hypridle observes the compositor lock and continues its display/sleep policy.
  let updating = false;
  setInterval(async () => {
    if (controller.unlocked || updating) return;
    updating = true;
    try {
      if (await Compositor.sessionLockState() === 'finished') { await controller.cancelFingerprint(); Engine.quit(); return; }
      const settings = readSettings(Desktop.loadPreferences());
      await configureTheme(settings);
      clockSettings = clockPreferences(settings);
      await sync();
      await paintClock();
    } catch (_) { Log.error('Lock screen could not update'); }
    finally { updating = false; }
  }, 1000);
}
