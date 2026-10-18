import * as Compositor from 'Koya/Compositor';
import * as UI from './theme-ui.js';
import * as Event from 'Helix/Event';
import * as Hypr from 'Module/hypr';
import * as Process from 'Module/process';
import { text, button } from './touch-ui.js';
import { surfaceCursor, destroySurface } from './cursor.js';
import { passwordInput } from './password-input.js';
import { userAvatar } from './user-avatar.js';
import { createKit, KIT_METRICS } from './kit.js';
import { presets } from './motion.js';
import { withShadow, shadowReach } from './shadow.js';
import { authenticationView } from './authentication-view.js';
import { FONT, FONT_STRONG, TEXT, ELEVATION, AUTO, TYPE, SURFACE, SPACE } from './theme.js';

// The one password dialog for polkit, sudo and SSH: a badge naming what is
// being unlocked, a title that names the action, the account in use, the
// field and its actions. The panel is sized to its wrapped text. While an
// answer is checked the badge rings and the confirm button holds a throbber;
// a refusal shakes the dialog and clears the field in place.
const WIDTH = 400, PADDING = 20, GAP = 14, FIELD_HEIGHT = 40, ACTION_HEIGHT = 32, IDENTITY_HEIGHT = 32, AVATAR_SIZE = 28;
const CANCEL_WIDTH = 96, CONFIRM_WIDTH = 128;
const glyphs = { lock: '/rom/assets/status/lock.png', key: '/rom/assets/status/key.png' };

// Word-wrapped, top-aligned text whose height is measured from its lines.
async function wrapped(win, value, size, width, colour, font = FONT) {
  const id = await UI.createElement(win, {
    renderable: { type: 'text', string: value, size, font, colour, layoutMode: 'word-wrap', justify: 'left', vAlign: 'top',
      metricsBasis: 'line', aabb: { min: { x: 0, y: 0 }, max: { x: width, y: 1000 } } },
    item: { size: { x: width, y: 1000 } }, contentAlign: { x: 'start', y: 'start' }
  });
  const metrics = await UI.measureText(win, id);
  const height = Math.ceil(Math.max(Number(metrics?.size?.y || 0), Number(metrics?.lineCount || 1) * Number(metrics?.lineAdvance || size * 1.3)));
  await UI.setLayoutSize(win, id, { x: width, y: height });
  return { id, height };
}

export async function showAuthenticationPrompt(prompt, respond, entry = {}) {
  let view = authenticationView({ text: prompt, options: entry.options, status: entry.status, error: entry.error }, Process.getEnv('HOME', ''));
  const displays = await Compositor.listDisplays({ backend: 'wayland' });
  let display = displays[0];
  try {
    const monitors = await Hypr.monitors();
    display = displays.find(item => item.display === monitors.find(monitor => monitor.focused)?.name) || display;
  } catch (_) {}
  if (!display) throw new Error('No display for authentication prompt');
  const width = Math.min(WIDTH, Number(display.logical_width || display.width) - 32), inner = width - PADDING * 2;
  const textWidth = inner - KIT_METRICS.badgeSlotSize - SPACE.m;
  const reach = shadowReach(ELEVATION.panel.shadow);
  const win = await Compositor.createWindow({ role: 'overlay', anchor: 'center', display: display.display,
    namespace: view.glyph === 'key' ? 'koya-ssh-passphrase' : 'koya-authentication', size: { x: width + reach * 2, y: 240 + reach * 2 },
    exclusiveZone: -1, msaaSamples: 1, transparent: true, renderingEnabled: false, keyboardInteractivity: 'none', acceptPointerEvents: false });
  let closed = false, busy = false, input, avatar, feedback, status, wrapper, badge;
  const kit = createKit(win);
  const answer = () => view.input ? input.getValue() : '';
  const submit = async () => {
    if (closed || busy) return;
    busy = true;
    const value = answer();
    await Promise.all([input?.setDisabled(true), feedback?.begin(), setStatus('', false)]);
    badge.pulse(true);
    respond(value);
    // Clear the secret as soon as it has been handed over.
    await input?.setValue('');
  };
  const cancel = () => { if (!closed && !busy) respond(null); };
  const key = event => {
    if (closed || event.id !== win) return;
    const code = Number(event.key);
    if ([1, 65307].includes(code)) cancel();
    else if (!view.input && [28, 65293].includes(code)) submit();
  };
  const setStatus = (value, error) => status ? Promise.all([UI.setTextString(win, status, value || ''),
    UI.setTextColour(win, status, error ? TEXT.accent : TEXT.secondary)]) : Promise.resolve();
  const dispose = async () => {
    if (closed) return;
    closed = true;
    Event.off('keyDown', key);
    await Promise.all([input?.destroy(), avatar?.dispose()]);
    try { await Compositor.setTextInput(win, { enabled: false }); } catch (_) {}
    await destroySurface(win);
  };
  // A new prompt for the same request: PAM refused the answer. Same dialog,
  // emptied and shaken, with the reason beside the actions.
  const refuse = async () => {
    busy = false;
    badge.pulse(false);
    await Promise.all([feedback?.end(), input?.setValue(''), input?.setDisabled(false), setStatus(view.status || 'Incorrect password', true)]);
    kit.play(wrapper, presets.shake());
    if (view.input) await input.focus();
  };
  try {
    const [root, hero, words, title, body, detail] = await Promise.all([
      UI.createElement(win, { layout: { type: 'none' }, item: { size: AUTO }, onHover: surfaceCursor(win) }),
      UI.createElement(win, { layout: { type: 'row', gap: SPACE.m }, item: { size: { x: inner, y: 'auto' } } }),
      UI.createElement(win, { layout: { type: 'column', gap: 2 }, item: { size: { x: textWidth, y: 'auto' } } }),
      wrapped(win, view.title, TYPE.heading, textWidth, TEXT.primary, FONT_STRONG),
      view.body ? wrapped(win, view.body, TYPE.detail, textWidth, TEXT.secondary) : undefined,
      view.detail ? wrapped(win, view.detail, TYPE.caption, textWidth, TEXT.disabled) : undefined,
      Compositor.setClearColor(win, 0, 0, 0, 0)
    ]);
    badge = await kit.badge({ glyph: glyphs[view.glyph], health: 'good' });
    const wordsHeight = [title, body, detail].filter(Boolean).reduce((sum, item, index) => sum + item.height + (index ? 2 : 0), 0);
    // Centre a short title against the badge; longer copy starts at its top.
    const heroHeight = Math.max(KIT_METRICS.badgeSlotSize, wordsHeight);
    const wordsTop = Math.max(0, (KIT_METRICS.badgeSlotSize - wordsHeight) / 2);
    await Promise.all([
      UI.setLayoutSize(win, hero, { x: inner, y: heroHeight }), UI.setLayoutSize(win, words, { x: textWidth, y: wordsHeight }),
      UI.setMargin(win, words, { t: wordsTop, r: 0, b: 0, l: 0 }),
      // The badge was created after the words; order puts it first.
      UI.setLayoutOrder(win, badge.id, 0), UI.setLayoutOrder(win, words, 1),
      UI.attach(win, hero, badge.id), UI.attach(win, hero, words),
      ...[title, body, detail].filter(Boolean).map(item => UI.attach(win, words, item.id))
    ]);
    const sections = [{ id: hero, height: heroHeight }];

    // The account being used: its picture and name, as on the lock screen.
    if (view.user && view.input) {
      const identity = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s, alignItems: 'center' }, item: { size: { x: inner, y: IDENTITY_HEIGHT } } });
      let name;
      avatar = await userAvatar(win, { size: AVATAR_SIZE, id: 'authentication-avatar', onName: value => name && UI.setTextString(win, name, value || view.user).catch(() => {}) });
      name = await text(win, null, view.user, TYPE.body, 'auto', IDENTITY_HEIGHT, TEXT.primary, FONT_STRONG, 'left');
      await Promise.all([UI.attach(win, identity, avatar.id), UI.attach(win, identity, name)]);
      avatar.setUser(view.user);
      sections.push({ id: identity, height: IDENTITY_HEIGHT });
    }
    if (view.input) {
      input = await passwordInput(win, { width: inner, height: FIELD_HEIGHT, colour: SURFACE.field, placeholder: view.placeholder, maxLength: 512,
        id: 'authentication-input', textId: 'authentication-secret', onSubmit: () => submit() });
      await input.setRevealed(view.echo);
      sections.push({ id: input.master.id, height: FIELD_HEIGHT });
    }

    // Actions on the right, macOS style; the status line takes the rest.
    const actions = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s, alignItems: 'center' }, item: { size: { x: inner, y: ACTION_HEIGHT } } });
    const statusWidth = inner - CONFIRM_WIDTH - (view.cancel ? CANCEL_WIDTH + SPACE.s : 0) - SPACE.s;
    status = await text(win, actions, '', TYPE.caption, statusWidth, ACTION_HEIGHT, TEXT.secondary, FONT, 'left');
    if (view.cancel) await button(win, actions, view.cancel, CANCEL_WIDTH, ACTION_HEIGHT, cancel,
      { colour: SURFACE.control, hover: SURFACE.controlHover, size: TYPE.detail, labelHeight: ACTION_HEIGHT });
    await button(win, actions, view.confirm, CONFIRM_WIDTH, ACTION_HEIGHT, () => submit(),
      { colour: SURFACE.accent, labelColour: TEXT.onAccent, size: TYPE.detail, labelHeight: ACTION_HEIGHT, onFeedback: value => { feedback = value; } });
    sections.push({ id: actions, height: ACTION_HEIGHT });

    const height = PADDING * 2 + sections.reduce((sum, section) => sum + section.height, 0) + GAP * (sections.length - 1);
    const panel = await kit.surface('panel', { id: 'authentication-prompt', size: { x: width, y: height }, layout: { type: 'column', gap: GAP },
      padding: { t: PADDING, r: PADDING, b: PADDING, l: PADDING } });
    wrapper = await withShadow(win, panel.id, { x: width, y: height }, ELEVATION.panel.shadow);
    await Promise.all([
      Compositor.resizeWindow(win, width + reach * 2, height + reach * 2),
      UI.attach(win, root, wrapper),
      // Siblings sort by order, then creation; some were created out of order.
      ...sections.flatMap((section, index) => [UI.setLayoutOrder(win, section.id, index), UI.attach(win, panel.content, section.id)])
    ]);
    await setStatus(view.status, view.error);
    await UI.attachRoot(win, root);
    Event.on('keyDown', key);
    await Compositor.setWindowRenderingEnabled(win, true);
    // Drop in, the badge pops, the rows below the hero rise in turn.
    // A retry arriving as a new prompt (sudo asks afresh) shakes once it lands.
    kit.play(wrapper, view.retry ? [...presets.dropIn(), ...presets.shake().map(frame => ({ ...frame, time: frame.time + 0.3 }))] : presets.dropIn());
    badge.pop();
    sections.slice(1).forEach((section, index) => kit.play(section.id, presets.rise(index)));
    await Promise.all([Compositor.setPointerEvents(win, true), Compositor.setKeyboardInteractivity(win, 'exclusive')]);
    if (view.input) await input.focus();
    return {
      win, dispose,
      update: next => {
        if (closed) return Promise.resolve();
        view = authenticationView({ text: next.text, options: next.options, status: next.status, error: next.error }, Process.getEnv('HOME', ''));
        if (next.retry) return refuse();
        return setStatus(next.status, next.error);
      }
    };
  } catch (error) { await dispose(); throw error; }
}

export const showSshPrompt = (prompt, respond, entry = {}) =>
  showAuthenticationPrompt(prompt, respond, { ...entry, options: { source: 'ssh', question: prompt, mode: 'entry' } });
