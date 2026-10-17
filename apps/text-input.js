import * as UI from './theme-ui.js';
import { Element, InputText } from '/rom/std/koya-ui.js';
import { controlCursor } from './cursor.js';
import { FONT, RADIUS, TEXT, SURFACE, BORDER } from './theme.js';

// Supply shell visuals to Koya's standard editing, focus and caret control.
export async function textInput(win, options) {
  const { width, height = 44, size = 15, colour = SURFACE.fieldInset, placeholder = '' } = options;
  const window = { id: win, createElement: async value => {
    const element = await Element.fromId(win, await UI.createElement(win, value));
    // Standard InputText calls these methods for placeholder/value changes and
    // cleanup; route them through the same bindings as the rest of the shell.
    element.setTextColour = colour => UI.setTextColour(win, element.id, colour);
    element.setTextColor = element.setTextColour;
    element.attach = parent => UI.attach(win, typeof parent === 'number' ? parent : parent.id, element.id);
    element.detach = parent => UI.detach(win, typeof parent === 'number' ? parent : parent.id, element.id);
    element.destroy = () => UI.destroyElement(win, element.id);
    return element;
  } };
  const [background, foreground, focus] = await Promise.all([
    window.createElement({ renderable: { type: 'box', colour, cornerRadius: RADIUS.control, cornerResolution: 16 },
      item: { size: { x: width, y: height } }, contentAlign: 'fill' }),
    window.createElement({ renderable: { type: 'text', string: '', font: FONT, size, colour: TEXT.primary,
      justify: 'left', vAlign: 'center', metricsBasis: 'line' },
      item: { size: { x: width - 24, y: height } }, contentAlign: { x: 'start', y: 'center' } }),
    window.createElement({ renderable: { type: 'box', colour: BORDER.focus, inset: 2, cornerRadius: RADIUS.control, cornerResolution: 16,
      aabb: { min: { x: 0, y: 0 }, max: { x: width, y: height } } },
      item: { size: { x: width, y: height } }, contentAlign: 'fill' })
  ]);
  const input = await InputText.create(window, { background, foreground, focus, size: { x: width, y: height },
    padding: { l: 12, r: 12, t: 0, b: 0 }, placeholder, password: options.password === true, value: options.value,
    disabled: options.disabled, maxLength: options.maxLength ?? 512,
    textColour: TEXT.primary, placeholderColour: TEXT.secondary, caretColour: TEXT.caret,
    onInput: options.onInput, onFocus: options.onFocus, onBlur: options.onBlur, onSubmit: options.onSubmit });
  await Promise.all([
    input.master.setOnHover(controlCursor(win, 'text')),
    // Use the shell's cursor arbitration for both the backdrop and its children.
    background.setOnHover(controlCursor(win, 'text')),
    ...(options.id ? [UI.setElementId(win, input.master.id, options.id)] : []),
    ...(options.textId ? [UI.setElementId(win, foreground.id, options.textId)] : [])
  ]);
  return input;
}
