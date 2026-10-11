import * as Compositor from 'Koya/Compositor';
import * as UI from 'Helix/UserInterface';
import * as Event from 'Helix/Event';
import * as Hypr from 'Module/hypr';
import { text, label, button, children } from './touch-ui.js';
import { surfaceCursor, controlCursor, destroySurface } from './cursor.js';
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
  let password = '', preedit = '', closed = false, submitted = false, field;
  const accepts = event => !closed && !submitted && event.id === win;
  const paint = () => Promise.all([
    UI.setTextString(win, field, password || preedit ? '•'.repeat(Array.from(password + preedit).length) : 'Passphrase'),
    UI.setTextColour(win, field, password || preedit ? CREAM : MUTED)
  ]);
  const repaint = () => paint().catch(() => finish(null));
  const clean = value => Array.from(String(value || '').replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 256).join('');
  const finish = answer => {
    if (closed || submitted) return;
    submitted = true; password = preedit = '';
    // Remove the visible value before returning the secret over the private pipe.
    paint().catch(() => {}); respond(answer); answer = undefined;
  };
  const input = event => { if (accepts(event)) { password = clean(password + clean(event.text)); repaint(); } };
  const method = event => {
    if (!accepts(event) || event.inputId !== field) return;
    const characters = Array.from(password);
    if (event.deleteBefore) characters.splice(Math.max(0, characters.length - event.deleteBefore));
    password = clean(characters.join('') + clean(event.text)); preedit = clean(event.preedit); repaint();
  };
  const key = event => {
    if (!accepts(event)) return;
    if ([14, 65288].includes(Number(event.key))) { password = Array.from(password).slice(0, -1).join(''); preedit = ''; repaint(); }
    if ([28, 96, 65293].includes(Number(event.key))) finish(password);
    if ([1, 65307].includes(Number(event.key))) finish(null);
  };
  const dispose = async () => {
    if (closed) return;
    closed = true; password = preedit = '';
    Event.off('textInput', input); Event.off('textInputMethod', method); Event.off('keyDown', key); Event.off('keyRepeat', key);
    try { await Compositor.setTextInput(win, { enabled: false }); } catch (_) {}
    await destroySurface(win);
  };
  try {
    const [root, heading, description, fieldBox, passwordLabel, actions, hint] = await Promise.all([
      UI.createElement(win, { id: 'ssh-prompt', renderable: { type: 'box', colour: POPOVER, cornerRadius: RADIUS.surface, cornerResolution: 16 },
        layout: { type: 'column', gap: 12, padding: { l: 16, r: 16, t: 16, b: 16 } },
        item: { size: { x: width, y: height } }, contentAlign: 'fill', onHover: surfaceCursor(win) }),
      text(win, null, 'Unlock SSH key', 20, inner, 28, CREAM, FONT, 'left'),
      label(win, null, prompt, 13, inner, 52, MUTED),
      UI.createElement(win, { renderable: { type: 'box', colour: TONAL, cornerRadius: RADIUS.control, cornerResolution: 16 },
        layout: { type: 'none' }, item: { size: { x: inner, y: 44 } }, contentAlign: 'fill', clipToBounds: true, onHover: controlCursor(win, 'text') }),
      text(win, null, 'Passphrase', 15, inner - 24, 44, MUTED, FONT, 'left'),
      UI.createElement(win, { layout: { type: 'row', gap: 12 }, item: { size: { x: inner, y: 40 } } }),
      text(win, null, 'OpenSSH keeps the unlocked key in memory.', 12, inner, 20, MUTED, FONT, 'left'),
      Compositor.setClearColor(win, 0, 0, 0, 0)
    ]);
    field = passwordLabel;
    await Promise.all([
      UI.attachRoot(win, root),
      ...[heading, description, fieldBox, actions, hint].map(id => UI.attach(win, root, id)),
      UI.attach(win, fieldBox, field), UI.setLayoutPosition(win, field, { x: 12, y: 0 }), UI.setElementId(win, field, 'ssh-passphrase'),
      children(win, actions, [button(win, null, 'Cancel', (inner - 12) / 2, 40, () => finish(null), { colour: TONAL, size: 14, labelHeight: 40 }),
        button(win, null, 'Unlock', (inner - 12) / 2, 40, () => finish(password), { colour: ORANGE, labelColour: INK, size: 14, labelHeight: 40 })])
    ]);
    Event.on('textInput', input); Event.on('textInputMethod', method); Event.on('keyDown', key); Event.on('keyRepeat', key);
    await Compositor.setWindowRenderingEnabled(win, true);
    await Promise.all([Compositor.setPointerEvents(win, true), Compositor.setKeyboardInteractivity(win, 'exclusive')]);
    await Compositor.setTextInput(win, { enabled: true, newFocus: true, inputId: field, cursorElement: field, contentPurpose: 8, contentHint: 64 | 128 });
    return { win, dispose };
  } catch (error) { await dispose(); throw error; }
}
