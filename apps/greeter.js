import * as Compositor from 'Koya/Compositor';
import * as Login from 'Module/login';
import * as Engine from 'Helix/Engine';
import * as Event from 'Helix/Event';
import * as Log from 'Helix/Log';
import * as Process from 'Module/process';
import * as Assets from 'Koya/Assets';
import * as UI from './theme-ui.js';
import { createLoginController } from './login-model.js';
import { clockDefaults } from './clock-model.js';
import { WALLPAPERS, isUserWallpaper, setUserWallpapers } from './wallpapers.js';
import { configureWallpaper } from './wallpaper-surface.js';
import { authScreen, AUTH_CARD_WIDTH, AUTH_CARD_PADDING } from './auth-screen.js';
import { userAvatar } from './user-avatar.js';
import { accounts } from './accounts.js';
import { textInput } from './text-input.js';
import { passwordInput } from './password-input.js';
import { button, text, icon } from './touch-ui.js';
import { glyph } from './app-frame.js';
import { destroySurface } from './cursor.js';
import { presets } from './motion.js';
import { TYPE, SPACE, TEXT, SURFACE, FONT, FONT_STRONG, RADIUS, CLEAR, AUTO, HIGHLIGHT } from './theme.js';

// The login greeter, styled as the lock screen's sibling: the wallpaper and
// clock with a centred card. The card keeps one shape through the
// conversation: the person (an avatar and a heading), one field, a status
// line and the action. Asking for the account, the field is the user name
// and the avatar follows what is typed; once greetd prompts, the name becomes
// the heading and the field becomes the answer. Refusals shake the card.
// With more than one session, a chip under the card opens the list.
//
// `surface: 'window'` renders into a normal fullscreen window on the focused
// output, so the design can be previewed (and driven) inside a desktop session.
const AVATAR_SIZE = 40, FIELD_HEIGHT = 48, STATUS_HEIGHT = 28, ACTION_HEIGHT = 44, CHIP_HEIGHT = 30, SESSION_ROW = 32;
const CARD_HEIGHT = AUTH_CARD_PADDING * 2 + AVATAR_SIZE + SPACE.l + FIELD_HEIGHT + SPACE.m + STATUS_HEIGHT + SPACE.s + ACTION_HEIGHT;
const INNER = AUTH_CARD_WIDTH - AUTH_CARD_PADDING * 2, RAW_HEIGHT = 900;
// PAM prompts end in a colon ("Password:"); as a placeholder they read better without.
const placeholder = prompt => String(prompt || '').replace(/:\s*$/, '') || 'Password';
// An administrator may choose the login wallpaper; only built-ins qualify.
// An opted-in account may also share its selected imported image. The login
// module returns a rendered copy in the greeter cache, not the account's paths.
const accountWallpaper = async name => {
  if (typeof Login.userPreferences !== 'function') return '';
  try {
    const settings = JSON.parse(Login.userPreferences(name) || 'null');
    if (settings?.GreeterWallpaper !== true) return '';
    const id = settings.Wallpaper;
    if (WALLPAPERS.some(item => item.id === id)) return id;
    if (!isUserWallpaper(id) || typeof Login.userWallpaper !== 'function') return '';
    const shared = Login.userWallpaper(name);
    if (shared?.wallpaper?.id !== id || !shared.directory) return '';
    await Assets.mount(shared.directory, '/rom');
    setUserWallpapers([shared.wallpaper]);
    return id;
  } catch (_) { return ''; }
};
const lastUser = () => typeof Login.lastUser === 'function' ? Login.lastUser() : '';
// Each account's last session lives in AccountsService, as display managers
// keep it: the session file's name without ".desktop".
const sessionName = session => String(session?.id || '').replace(/\.desktop$/, '');
const systemWallpaper = () => {
  const id = Process.getEnv('KOYA_GREETER_WALLPAPER', '');
  return WALLPAPERS.some(item => item.id === id) ? id : WALLPAPERS[0].id;
};

async function openWindow(surface) {
  if (surface !== 'window') {
    const win = await Compositor.createWindow({ role: 'raw', keyboardInteractivity: 'exclusive', acceptPointerEvents: true, msaaSamples: 1 });
    const info = await Compositor.getWindowInfo(win);
    if (info.role !== 'raw') { await destroySurface(win); throw new Error('The login screen requires a raw output'); }
    // A raw output has no compositor scale: one unit per pixel. Lay the UI
    // out on a canvas RAW_HEIGHT units tall, as a desktop's logical size
    // would be, so the shared sizes read the same. A Koya without scaling
    // still signs people in, at one unit per pixel.
    if (typeof Compositor.setUiScaling !== 'function') {
      Log.warn('Login screen: this Koya cannot scale raw output');
      return { win, size: { x: Number(info.width), y: Number(info.height) } };
    }
    const canvas = await Compositor.setUiScaling(win, { referenceWidth: RAW_HEIGHT * 16 / 9, referenceHeight: RAW_HEIGHT, mode: 'matchHeight' });
    return { win, size: { x: Math.round(canvas.width), y: Math.round(canvas.height) } };
  }
  const displays = await Compositor.listDisplays({ backend: 'wayland' });
  const display = displays.find(item => item.focused) || displays[0];
  const size = { x: Number(display.logical_width || display.width), y: Number(display.logical_height || display.height) };
  const win = await Compositor.createWindow({ role: 'window', title: 'Koya login preview', appId: 'koya-greeter-preview', display: display.display,
    size, state: { maximized: false, fullscreen: true }, msaaSamples: 1, acceptPointerEvents: true });
  const info = await Compositor.getWindowInfo(win);
  return { win, size: { x: Number(info.width) || size.x, y: Number(info.height) || size.y } };
}

export async function createGreeter({ preview = false, surface = 'raw' } = {}) {
  const sessions = Login.sessions().sort((a, b) => (a.id !== 'hyprland.desktop') - (b.id !== 'hyprland.desktop') || a.name.localeCompare(b.name));
  if (preview && !sessions.length) sessions.push({ id: 'preview', name: 'Hyprland', cmd: ['Hyprland'], env: [] });
  // Prefill the last account and its wallpaper. Authentication begins when
  // the person submits the account, leaving PAM idle until then.
  const returning = lastUser();
  let shownWallpaper = await accountWallpaper(returning) || systemWallpaper();
  await configureWallpaper({ Wallpaper: shownWallpaper });
  const { win, size } = await openWindow(surface);
  let screen, user, answer, avatar, heading, status, actionLabel, feedback, back, chip, chipLabel, list, controller, clockTimer;
  let accountName = '', avatarUser = '';
  let selected = 0, closed = false, previewComplete = false, promptKey = '', phase = '', listOpen = false, shownStatus = '';
  // A refused answer starts a fresh conversation for the same account, so
  // the card stays on the answer with the refusal showing.
  let retrying = false, refusal = '';
  const dispose = async () => {
    if (closed) return;
    closed = true; Event.off('keyDown', key); clearInterval(clockTimer); screen?.stop();
    await Promise.all([user?.destroy(), answer?.destroy(), avatar?.dispose()]);
    Login.close(); await destroySurface(win);
  };
  const goBack = async () => {
    if (closed || controller.state.busy || previewComplete || controller.state.phase !== 'prompt') return;
    refusal = ''; await answer.setValue(''); await controller.cancel();
  };
  const key = async event => {
    if (event.id !== win || ![1, 65307].includes(Number(event.key))) return;
    if (listOpen) return showList(false);
    if (preview && controller.state.phase !== 'prompt') { await dispose(); Engine.quit(); }
    else await goBack();
  };
  // Changing account cross-fades the wallpaper through the dark backdrop.
  const showWallpaper = async id => {
    if (closed || id === shownWallpaper) return;
    shownWallpaper = id;
    await screen.play(screen.wall, [{ time: 0.2, opacity: 0, ease: 'inQuad' }]);
    await new Promise(resolve => setTimeout(resolve, 200));
    if (closed || shownWallpaper !== id) return;
    await configureWallpaper({ Wallpaper: id });
    screen.play(screen.wall, [{ time: 0.45, opacity: 1, ease: 'outCubic' }]);
  };
  const setAvatar = name => { avatarUser = name.trim(); avatar.setUser(avatarUser); };
  const render = async state => {
    if (closed) return;
    if (state.phase === 'username' && state.refused && !retrying && state.username) {
      retrying = true; refusal = state.message; screen.play(screen.card, presets.shake());
      setTimeout(() => controller.begin(state.username, sessions[selected]).catch(() => {}), 0);
      return;
    }
    // Hold the answer step while the retry asks again.
    if (retrying && state.phase === 'username' && (state.busy || !state.error)) return;
    if (retrying && !state.busy) retrying = false;
    if (state.phase !== 'prompt' && !retrying) refusal = '';
    const asking = state.phase === 'username', challenge = state.phase === 'prompt';
    const nextPrompt = state.phase + ':' + state.prompt + ':' + state.secret;
    if (nextPrompt !== promptKey) {
      promptKey = nextPrompt;
      await Promise.all([answer.setValue(''), answer.setRevealed(challenge && !state.secret), answer.setPlaceholder(placeholder(state.prompt))]);
    }
    if (closed) return;
    // Failures come back to the account step. Answering, the line carries what
    // PAM said and any prompt other than the password (a verification code).
    const failed = asking && state.error;
    const message = previewComplete ? 'Preview complete' : !sessions.length ? 'No Wayland sessions installed' : failed ? state.message
      : challenge ? refusal || [state.notice, /^password:?\s*$/i.test(state.prompt) ? '' : state.prompt].filter(Boolean).join(' · ') : '';
    const nextPhase = asking ? 'account' : 'answer';
    await Promise.all([
      user.setDisabled(state.busy || !asking), answer.setDisabled(state.busy || !challenge),
      UI.setTextString(win, heading, asking ? 'Sign in' : avatarUser === state.username ? accountName || state.username : state.username),
      UI.setTextString(win, status, message), UI.setTextColour(win, status, failed || (challenge && refusal) || !sessions.length ? TEXT.accent : TEXT.secondary),
      UI.setTextString(win, actionLabel, previewComplete ? 'Restart preview' : asking ? 'Continue' : 'Sign in'),
      UI.setEnabled(win, back, challenge), UI.setHitTarget(win, chip, !state.busy && (asking || challenge)),
      state.busy ? feedback.begin() : feedback.end()
    ]);
    // The field swaps: the account slides out, the answer slides in (and back).
    if (nextPhase !== phase) {
      const forward = nextPhase === 'answer', first = !phase;
      phase = nextPhase;
      await Promise.all([UI.setEnabled(win, user.master.id, !forward), UI.setEnabled(win, answer.master.id, forward)]);
      if (!first) {
        screen.play(forward ? answer.master.id : user.master.id, presets.glide({ x: forward ? 24 : -24 }));
        screen.play(avatar.id, presets.pop(0, 0.6));
        if (forward) await setAvatar(state.username);
      }
    }
    if (failed && message !== shownStatus) screen.play(screen.card, presets.shake());
    shownStatus = message;
    if (closed || state.busy) return;
    if (asking) await user.focus(); else if (challenge) await answer.focus();
  };
  const newController = () => createLoginController({
    request: preview ? async text => {
      const request = JSON.parse(text);
      if (request.type === 'create_session') return { type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' };
      if (request.type === 'post_auth_message_response') return request.response === 'koya' ? { type: 'success' }
        : { type: 'error', error_type: 'auth_error' };
      return { type: 'success' };
    } : Login.request,
    onState: render,
    onStarted: async () => {
      if (typeof Login.rememberUser === 'function') Login.rememberUser(controller.state.username);
      if (/\.desktop$/.test(sessions[selected]?.id || '')) await accounts.setSession(controller.state.username, sessionName(sessions[selected])).catch(() => {});
      if (preview) { previewComplete = true; return; }
      try { await dispose(); } finally { Engine.quit(); }
    }
  });
  const submit = async () => {
    if (closed || controller.state.busy) return;
    if (listOpen) await showList(false);
    if (previewComplete) { previewComplete = false; phase = ''; controller = newController(); await render(controller.state); return; }
    if (controller.state.phase === 'username') {
      const name = user.getValue().trim();
      showWallpaper(await accountWallpaper(name) || systemWallpaper()).catch(() => {});
      await recallSession(name);
      return controller.begin(name, sessions[selected]);
    }
    if (controller.state.phase === 'prompt') {
      refusal = '';
      let value = answer.getValue(); await answer.setValue('');
      const result = controller.respond(value); value = ''; return result;
    }
  };
  // The session list floats over the screen above its chip, placed against
  // the chip's measured frame; a click elsewhere closes it.
  const showList = async open => {
    if (!list || open === listOpen) return;
    listOpen = open;
    if (open) {
      const frame = await UI.getElementFrame(win, chip);
      const height = sessions.length * SESSION_ROW + SPACE.xs * 2, width = list.width;
      const x = Math.round((frame.min.x + frame.max.x) / 2 - width / 2), y = Math.round(frame.min.y - SPACE.xs - height);
      await UI.setLayoutAABB(win, list.id, { min: { x, y }, max: { x: x + width, y: y + height } });
      await Promise.all(list.rows.map((row, index) => UI.setEnabled(win, row.check, index === selected)));
    }
    await UI.setEnabled(win, list.id, open);
    if (open) screen.play(list.id, presets.rise(0, 0));
  };
  const choose = async (index, byHand = true) => {
    picked ||= byHand;
    selected = index; controller.chooseSession(sessions[index]);
    await Promise.all([UI.setTextString(win, chipLabel, sessions[index].name), showList(false)]);
    screen.play(chip, presets.bump());
  };
  // Once the account is known, its last session is preselected, unless one
  // was already picked here by hand.
  let picked = false;
  const recallSession = async name => {
    if (picked) return;
    const last = await accounts.session(name);
    if (picked || !last) return;
    const index = sessions.findIndex(session => sessionName(session) === last);
    if (index >= 0 && index !== selected) await choose(index, false);
  };
  try {
    const clock = clockDefaults;
    screen = await authScreen(win, { size, name: 'greeter', cardHeight: CARD_HEIGHT, clock, build: async card => {
      // The person: avatar, heading and (answering) a way back.
      const person = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' },
        item: { size: { x: 'auto', y: AVATAR_SIZE }, margin: { t: 0, r: 0, b: SPACE.l - SPACE.s, l: 0 } } });
      [avatar, heading, back] = await Promise.all([
        userAvatar(win, { size: AVATAR_SIZE, id: 'greeter-avatar', onName: name => {
          accountName = name;
          if (!closed && heading && controller?.state.phase !== 'username' && controller?.state.username === avatarUser)
            UI.setTextString(win, heading, name || avatarUser).catch(() => {});
        } }),
        text(win, null, 'Sign in', TYPE.heading, INNER - AVATAR_SIZE - SPACE.m * 2 - 32, AVATAR_SIZE, TEXT.primary, FONT_STRONG, 'left'),
        button(win, null, '', 32, 32, goBack, { colour: CLEAR, hover: HIGHLIGHT.hover, icon: glyph('previous'), iconSize: 14, radius: RADIUS.control })
      ]);
      await UI.setElementId(win, heading, 'greeter-name');
      for (const id of [avatar.id, heading, back]) await UI.attach(win, person, id);
      // One slot, two fields: only the current one is enabled.
      const slot = await UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: INNER, y: FIELD_HEIGHT } } });
      [user, answer] = await Promise.all([
        textInput(win, { width: INNER, height: FIELD_HEIGHT, size: TYPE.body, placeholder: 'User name', maxLength: 256, id: 'greeter-user',
          onSubmit: submit, onInput: setAvatar }),
        passwordInput(win, { width: INNER, height: FIELD_HEIGHT, size: TYPE.body, disabled: true, maxLength: 4096,
          id: 'greeter-answer', textId: 'greeter-answer-text', onSubmit: submit })
      ]);
      await Promise.all([UI.attach(win, slot, user.master.id), UI.attach(win, slot, answer.master.id)]);
      status = await text(win, null, '', TYPE.caption, INNER, STATUS_HEIGHT, TEXT.secondary);
      const action = await button(win, null, 'Continue', INNER, ACTION_HEIGHT, submit, { colour: SURFACE.accent, labelColour: TEXT.onAccent, size: TYPE.body,
        onLabel: id => { actionLabel = id; }, onFeedback: value => { feedback = value; } });
      for (const [index, id] of [person, slot, status, action].entries()) { await UI.setLayoutOrder(win, id, index); await UI.attach(win, card.content, id); }
      await Promise.all([UI.setElementId(win, action, 'greeter-submit'), UI.setElementId(win, back, 'greeter-back'), UI.setElementId(win, status, 'greeter-status')]);
    } });
    // The session chip, under the card when there is a choice to make.
    chip = await button(win, null, '', 200, CHIP_HEIGHT, () => showList(!listOpen), {
      colour: CLEAR, hover: HIGHLIGHT.hover, radius: RADIUS.control, element: { layout: { type: 'row', justifyContent: 'center', alignItems: 'center', gap: SPACE.s } } });
    const chipIcon = await icon(win, chip, glyph('desktops'), 14, 14, CHIP_HEIGHT);
    chipLabel = await text(win, chip, sessions[0]?.name || '', TYPE.caption, 150, CHIP_HEIGHT, TEXT.secondary, FONT, 'left');
    await Promise.all([UI.setHitTarget(win, chipIcon, false), UI.setElementId(win, chip, 'greeter-session'),
      UI.setLayoutOrder(win, chip, 3), UI.attach(win, screen.content, chip), UI.setEnabled(win, chip, sessions.length > 1),
      UI.setMargin(win, chip, { t: SPACE.s, r: 0, b: 0, l: 0 })]);
    if (sessions.length > 1) {
      const width = 220;
      const panel = await screen.kit.surface('popover', { layout: { type: 'column' }, padding: { t: SPACE.xs, r: SPACE.xs, b: SPACE.xs, l: SPACE.xs } });
      const rows = await Promise.all(sessions.map(async (session, index) => {
        const row = await button(win, null, '', width - SPACE.xs * 2, SESSION_ROW, () => choose(index), {
          colour: CLEAR, hover: HIGHLIGHT.hover, radius: RADIUS.control, pressScale: 0.98,
          element: { layout: { type: 'row', alignItems: 'center', gap: SPACE.s, padding: { l: SPACE.s, r: SPACE.s, t: 0, b: 0 } } } });
        const [name, check] = await Promise.all([
          text(win, row, session.name, TYPE.detail, width - SPACE.xs * 2 - SPACE.s * 3 - 8, SESSION_ROW, TEXT.primary, FONT, 'left'),
          UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 8, y: 8 } }, resolution: 16, colour: SURFACE.accent }, item: { size: { x: 8, y: 8 } } })
        ]);
        await Promise.all([UI.attach(win, row, check), UI.setElementId(win, row, 'greeter-session-' + index)]);
        return { id: row, name, check };
      }));
      for (const row of rows) await UI.attach(win, panel.content, row.id);
      list = { id: panel.id, rows, width };
      await Promise.all([UI.attach(win, screen.root, panel.id), UI.setEnabled(win, panel.id, false)]);
      // Activation may arrive here from the chip or a row too: only a click
      // outside both closes the list.
      await UI.setOnActivate(win, screen.root, async event => {
        if (!listOpen) return;
        const within = frame => frame && event.local.x >= frame.min.x && event.local.x <= frame.max.x && event.local.y >= frame.min.y && event.local.y <= frame.max.y;
        const [chipFrame, listFrame] = await Promise.all([UI.getElementFrame(win, chip), UI.getElementFrame(win, list.id)]);
        if (!within(chipFrame) && !within(listFrame)) showList(false);
      });
    }
    controller = newController();
    Event.on('keyDown', key);
    clockTimer = setInterval(() => screen.paintClock().catch(() => {}), 1000);
    await Compositor.focusWindow(win).catch(() => {});
    await render(controller.state);
    if (returning && sessions.length) {
      await Promise.all([user.setValue(returning), setAvatar(returning), recallSession(returning)]);
    }
    return { win, dispose };
  } catch (error) { await dispose(); throw error; }
}

export default function main() {
  setTimeout(() => createGreeter().catch(error => {
    Log.error('Login screen: ' + error); setTimeout(() => Engine.quit(), 50);
  }), 0);
}
