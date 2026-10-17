import * as Compositor from 'Koya/Compositor';
import * as Engine from 'Helix/Engine';
import * as Event from 'Helix/Event';
import * as Log from 'Helix/Log';
import * as UI from '../apps/theme-ui.js';
import { passwordInput } from '../apps/password-input.js';
import { button, label } from '../apps/touch-ui.js';
import { surfaceCursor, destroySurface } from '../apps/cursor.js';
import { AUTO, FONT_STRONG, TEXT, SURFACE, BORDER } from '../apps/theme.js';

// A direct-output/input exercise. There is no PAM, D-Bus or disk unlock call.
export async function createRawUnlockDemo() {
  // Omitting display selects an available output, preferring the internal panel.
  // Do not use default listDisplays(): that queries Wayland rather than DRM.
  const win = await Compositor.createWindow({ role: 'raw', keyboardInteractivity: 'exclusive', acceptPointerEvents: true, msaaSamples: 1 });
  let input, status, actionLabel, closed = false, busy = false, unlocked = false;
  const prompt = 'Enter the demo password: koya';
  const dispose = async () => {
    if (closed) return;
    closed = true;
    Event.off('keyDown', key);
    await input?.destroy();
    await destroySurface(win);
  };
  const exit = async () => { await dispose(); Engine.quit(); };
  const key = event => {
    if (event.id === win && Number(event.key) === 1) return exit();
  };
  const submit = async () => {
    if (closed || busy) return;
    busy = true;
    try {
      if (unlocked) {
        unlocked = false;
        await Promise.all([input.setValue(''), input.setDisabled(false), UI.setTextString(win, status, prompt),
          UI.setTextString(win, actionLabel, 'Unlock')]);
        await input.focus();
        return;
      }
      let answer = input.getValue();
      if (!answer) { await UI.setTextString(win, status, prompt); await input.focus(); return; }
      const accepted = answer === 'koya'; answer = '';
      await input.setValue('');
      if (closed) return;
      unlocked = accepted;
      await Promise.all([
        UI.setTextString(win, status, accepted ? 'Unlocked — demo complete.' : 'That password is incorrect. Try again.'),
        UI.setTextString(win, actionLabel, accepted ? 'Restart demo' : 'Unlock'), input.setDisabled(accepted)
      ]);
      if (!accepted && !closed) await input.focus();
    } finally { busy = false; }
  };
  try {
    const info = await Compositor.getWindowInfo(win);
    if (info.role !== 'raw') throw new Error('The unlock demo requires a raw output');
    const scale = Math.max(1, Math.min(2, Number(info.height) / 900));
    const padding = 24 * scale, gap = 12 * scale;
    const width = Math.min(440 * scale, Number(info.width) - padding * 2), inner = width - padding * 2;
    const [root, form, edge, title, detail, control, message, actions, note] = await Promise.all([
      UI.createElement(win, { id: 'raw-unlock-root', layout: { type: 'column', justifyContent: 'center', alignItems: 'center' },
        item: { size: AUTO }, onHover: surfaceCursor(win) }),
      UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.card, cornerRadius: 12 * scale },
        layout: { type: 'none' }, item: { size: { x: width, y: 352 * scale } }, contentAlign: 'fill' }),
      UI.createElement(win, { renderable: { type: 'box', colour: BORDER.surface, inset: 1, cornerRadius: 12 * scale },
        item: { size: AUTO }, contentAlign: 'fill' }),
      label(win, null, 'Unlock your disk', 28 * scale, inner, 36 * scale, TEXT.primary, FONT_STRONG),
      label(win, null, 'Koya direct-output demo\nEnter a password to test the unlock screen.', 15 * scale, inner, 44 * scale, TEXT.secondary),
      passwordInput(win, { width: inner, height: 48 * scale, size: 18 * scale, maxLength: 256,
        id: 'raw-unlock-input', textId: 'raw-unlock-password', onSubmit: submit }),
      label(win, null, prompt, 14 * scale, inner, 40 * scale, TEXT.accent),
      UI.createElement(win, { layout: { type: 'row', gap }, item: { size: { x: inner, y: 44 * scale } } }),
      label(win, null, 'Demo only · no disk is unlocked.\nPress Escape or Exit to return to the console.', 13 * scale, inner, 32 * scale, TEXT.secondary),
      UI.setClearColour(win, SURFACE.background)
    ]);
    input = control; status = message;
    const column = await UI.createElement(win, { layout: { type: 'column', gap, padding: { l: padding, r: padding, t: padding, b: padding } },
      item: { size: AUTO } });
    const controls = await Promise.all([
      button(win, null, 'Unlock', inner - 80 * scale - gap, 44 * scale, submit, {
        colour: SURFACE.accent, labelColour: TEXT.onAccent, size: 16 * scale, onLabel: id => { actionLabel = id; } }),
      button(win, null, 'Exit', 80 * scale, 44 * scale, exit, { colour: SURFACE.control, size: 16 * scale })
    ]);
    await Promise.all([
      UI.attach(win, root, form), UI.attach(win, form, edge), UI.attach(win, form, column), UI.setHitTarget(win, edge, false),
      ...[title, detail, input.master.id, status, actions, note].flatMap((id, index) => [UI.setLayoutOrder(win, id, index), UI.attach(win, column, id)]),
      ...controls.map(id => UI.attach(win, actions, id)), UI.setElementId(win, controls[0], 'raw-unlock-submit'),
      UI.setElementId(win, controls[1], 'raw-unlock-exit'), UI.setElementId(win, status, 'raw-unlock-status'), UI.attachRoot(win, root)
    ]);
    Event.on('keyDown', key);
    await Compositor.focusWindow(win);
    await input.focus();
    return { win, dispose };
  } catch (error) { await dispose(); throw error; }
}

export default function main() {
  setTimeout(() => createRawUnlockDemo().then(() => {
    Log.info('Raw unlock demo ready. Demo password: koya; Escape exits.');
  }).catch(error => {
    Log.error('Raw unlock demo: ' + error);
    // Allow the native logger to drain even if output creation failed before
    // the first window/frame. Otherwise a windowless failure can exit silently.
    setTimeout(() => Engine.quit(), 50);
  }), 0);
}
