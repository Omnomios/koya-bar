import * as Compositor from 'Koya/Compositor';
import * as UI from 'Helix/UserInterface';
import * as Event from 'Helix/Event';
import * as Hypr from 'Module/hypr';
import { text, label, button, children } from './touch-ui.js';
import { surfaceCursor, destroySurface } from './cursor.js';
import { passwordInput } from './password-input.js';
import { FONT, CREAM, ORANGE, INK, TONAL, MUTED, POPOVER, RADIUS } from './theme.js';

export async function showSshPrompt(prompt, respond) {
  const displays = await Compositor.listDisplays();
  let display = displays[0];
  try {
    const monitors = await Hypr.monitors();
    display = displays.find(item => item.display === monitors.find(monitor => monitor.focused)?.name) || display;
  } catch (_) {}
  if (!display) throw new Error('No display for SSH prompt');
  const width = Math.min(440, Number(display.logical_width || display.width) - 32), height = 264, inner = width - 32;
  const win = await Compositor.createWindow({ role: 'overlay', anchor: 'center', display: display.display,
    namespace: 'koya-ssh-passphrase', size: { x: width, y: height }, exclusiveZone: -1,
    msaaSamples: 1, transparent: true, renderingEnabled: false,
    keyboardInteractivity: 'none', acceptPointerEvents: false });
  let closed = false, submitted = false, input;
  const accepts = event => !closed && !submitted && event.id === win;
  const finish = async answer => {
    if (closed || submitted) return;
    submitted = true;
    // Clear both the control's value and composition before responding.
    await Promise.all([input.setValue(''), input.setDisabled(true)]);
    respond(answer); answer = undefined;
  };
  const key = event => {
    if (accepts(event) && [1, 65307].includes(Number(event.key))) finish(null);
  };
  const dispose = async () => {
    if (closed) return;
    closed = true;
    Event.off('keyDown', key);
    await input?.destroy();
    try { await Compositor.setTextInput(win, { enabled: false }); } catch (_) {}
    await destroySurface(win);
  };
  try {
    const [root, heading, description, control, actions, hint] = await Promise.all([
      UI.createElement(win, { id: 'ssh-prompt', renderable: { type: 'box', colour: POPOVER, cornerRadius: RADIUS.surface, cornerResolution: 16 },
        layout: { type: 'column', gap: 12, padding: { l: 16, r: 16, t: 16, b: 16 } },
        item: { size: { x: width, y: height } }, contentAlign: 'fill', onHover: surfaceCursor(win) }),
      text(win, null, 'Unlock SSH key', 20, inner, 28, CREAM, FONT, 'left'),
      label(win, null, prompt, 13, inner, 52, MUTED),
      passwordInput(win, { width: inner, colour: TONAL, placeholder: 'Passphrase', maxLength: 256,
        id: 'ssh-password-input', textId: 'ssh-passphrase', onSubmit: finish }),
      UI.createElement(win, { layout: { type: 'row', gap: 12 }, item: { size: { x: inner, y: 40 } } }),
      text(win, null, 'OpenSSH keeps the unlocked key in memory.', 12, inner, 20, MUTED, FONT, 'left'),
      Compositor.setClearColor(win, 0, 0, 0, 0)
    ]);
    input = control;
    await Promise.all([
      UI.attachRoot(win, root),
      ...[heading, description, input.master.id, actions, hint].map(id => UI.attach(win, root, id)),
      children(win, actions, [button(win, null, 'Cancel', (inner - 12) / 2, 40, () => finish(null), { colour: TONAL, size: 14, labelHeight: 40 }),
        button(win, null, 'Unlock', (inner - 12) / 2, 40, () => finish(input.getValue()), { colour: ORANGE, labelColour: INK, size: 14, labelHeight: 40 })])
    ]);
    Event.on('keyDown', key);
    await Compositor.setWindowRenderingEnabled(win, true);
    await Promise.all([Compositor.setPointerEvents(win, true), Compositor.setKeyboardInteractivity(win, 'exclusive')]);
    await input.focus();
    return { win, dispose };
  } catch (error) { await dispose(); throw error; }
}
