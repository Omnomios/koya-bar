import * as Compositor from 'Koya/Compositor';
import * as UI from './theme-ui.js';
import * as Event from 'Helix/Event';
import * as Hypr from 'Module/hypr';
import { text, label, button, children } from './touch-ui.js';
import { surfaceCursor, destroySurface } from './cursor.js';
import { passwordInput } from './password-input.js';
import { createKit } from './kit.js';
import { presets } from './motion.js';
import { withShadow, shadowReach } from './shadow.js';
import { FONT, FONT_STRONG, TEXT, ELEVATION, AUTO, TYPE, SURFACE } from './theme.js';

// The passphrase prompt: an elevated panel on its shadow, centred. The
// window carries the shadow's reach around the panel; layout places both.

export async function showSshPrompt(prompt, respond) {
  const displays = await Compositor.listDisplays({ backend: 'wayland' });
  let display = displays[0];
  try {
    const monitors = await Hypr.monitors();
    display = displays.find(item => item.display === monitors.find(monitor => monitor.focused)?.name) || display;
  } catch (_) {}
  if (!display) throw new Error('No display for SSH prompt');
  const width = Math.min(440, Number(display.logical_width || display.width) - 32), height = 264, inner = width - 32;
  const reach = shadowReach(ELEVATION.panel.shadow);
  const win = await Compositor.createWindow({ role: 'overlay', anchor: 'center', display: display.display,
    namespace: 'koya-ssh-passphrase', size: { x: width + reach * 2, y: height + reach * 2 }, exclusiveZone: -1,
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
    const kit = createKit(win);
    const [root, heading, description, control, actions, hint] = await Promise.all([
      UI.createElement(win, { layout: { type: 'none' }, item: { size: AUTO }, onHover: surfaceCursor(win) }),
      text(win, null, 'Unlock SSH key', TYPE.title, inner, 28, TEXT.primary, FONT_STRONG, 'left'),
      label(win, null, prompt, TYPE.detail, inner, 52, TEXT.secondary),
      passwordInput(win, { width: inner, colour: SURFACE.field, placeholder: 'Passphrase', maxLength: 256,
        id: 'ssh-password-input', textId: 'ssh-passphrase', onSubmit: finish }),
      UI.createElement(win, { layout: { type: 'row', gap: 12 }, item: { size: { x: inner, y: 40 } } }),
      text(win, null, 'OpenSSH keeps the unlocked key in memory.', TYPE.caption, inner, 20, TEXT.secondary, FONT, 'left'),
      Compositor.setClearColor(win, 0, 0, 0, 0)
    ]);
    input = control;
    const panel = await kit.surface('panel', { id: 'ssh-prompt', size: { x: width, y: height }, layout: { type: 'column', gap: 12 },
      padding: { t: 16, r: 16, b: 16, l: 16 } });
    const wrapper = await withShadow(win, panel.id, { x: width, y: height }, ELEVATION.panel.shadow);
    await Promise.all([
      UI.attach(win, root, wrapper),
      // Reading order made explicit: siblings sort by order, then creation,
      // and the password control is created inside its own async work.
      ...[heading, description, input.master.id, actions, hint].flatMap((id, index) => [UI.setLayoutOrder(win, id, index), UI.attach(win, panel.content, id)]),
      children(win, actions, [button(win, null, 'Cancel', (inner - 12) / 2, 40, () => finish(null), { colour: SURFACE.control, hover: SURFACE.controlHover, size: TYPE.body, labelHeight: 40 }),
        button(win, null, 'Unlock', (inner - 12) / 2, 40, () => finish(input.getValue()), { colour: SURFACE.accent, labelColour: TEXT.onAccent, size: TYPE.body, labelHeight: 40 })])
    ]);
    await UI.attachRoot(win, root);
    Event.on('keyDown', key);
    await Compositor.setWindowRenderingEnabled(win, true);
    kit.play(wrapper, presets.dropIn());
    await Promise.all([Compositor.setPointerEvents(win, true), Compositor.setKeyboardInteractivity(win, 'exclusive')]);
    await input.focus();
    return { win, dispose };
  } catch (error) { await dispose(); throw error; }
}
