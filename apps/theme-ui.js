import * as Native from 'Helix/UserInterface';
import * as Compositor from 'Koya/Compositor';
import { colourBinding, resolveColour, onThemeChanged, themeRevision } from './theme.js';

// Keep native operations available; intercept colour and lifetime operations.
export * from 'Helix/UserInterface';
const windows = new Map();
function windowFor(win) {
  if (!windows.has(win)) windows.set(win, { elements: new Map(), clear: null, closed: false });
  return windows.get(win);
}
function elementFor(win, id) {
  const window = windowFor(win);
  if (!window.elements.has(id)) window.elements.set(id, { colours: new Map(), children: new Set(), parent: null });
  return window.elements.get(id);
}
const setters = { text: 'setTextColour', box: 'setBoxColour', circle: 'setCircleColour', panel: 'setPanelColour' };
function remember(win, id, setter, value) {
  const colours = windows.get(win)?.elements.get(id)?.colours, binding = colourBinding(value);
  if (!colours) return;
  if (binding) colours.set(setter, binding); else colours.delete(setter);
}
export async function createElement(win, options) {
  const revision = themeRevision, window = windowFor(win), renderable = options.renderable;
  let prepared = options;
  if (renderable) {
    const copy = { ...renderable };
    if (renderable.colour) copy.colour = resolveColour(renderable.colour);
    if (renderable.frame?.colour) copy.frame = { ...renderable.frame, colour: resolveColour(renderable.frame.colour) };
    prepared = { ...options, renderable: copy };
  }
  const id = await Native.createElement(win, prepared);
  if (window.closed) return id;
  elementFor(win, id);
  const setter = setters[renderable?.type];
  const value = renderable?.type === 'panel' ? renderable.frame?.colour : renderable?.colour;
  if (setter && value) remember(win, id, setter, value);
  // A skin may change while the native create reply is in flight.
  if (revision !== themeRevision) await paintElement(win, id);
  return id;
}
const setColour = (setter, win, id, value) => {
  remember(win, id, setter, value);
  return Native[setter](win, id, resolveColour(value));
};
export const setTextColour = (win, id, value) => setColour('setTextColour', win, id, value);
export const setBoxColour = (win, id, value) => setColour('setBoxColour', win, id, value);
export const setCircleColour = (win, id, value) => setColour('setCircleColour', win, id, value);
export const setPanelColour = (win, id, value) => setColour('setPanelColour', win, id, value);
export const setTextColor = setTextColour;
export const setBoxColor = setBoxColour;
export const setCircleColor = setCircleColour;
export const setPanelColor = setPanelColour;

function unparent(win, id) {
  const element = windows.get(win)?.elements.get(id);
  if (element?.parent !== null) windows.get(win)?.elements.get(element?.parent)?.children.delete(id);
  if (element) element.parent = null;
}
export const attach = (win, parent, child) => {
  unparent(win, child);
  elementFor(win, parent).children.add(child); elementFor(win, child).parent = parent;
  return Native.attach(win, parent, child);
};
export const detach = (win, parent, child) => {
  unparent(win, child); return Native.detach(win, parent, child);
};
function forgetElement(win, id) {
  const element = windows.get(win)?.elements.get(id);
  if (!element) return;
  for (const child of [...element.children]) forgetElement(win, child);
  unparent(win, id); windows.get(win).elements.delete(id);
}
export const destroyElement = (win, id) => {
  forgetElement(win, id); return Native.destroyElement(win, id);
};
export function forgetWindow(win) {
  const window = windows.get(win);
  if (window) window.closed = true;
  windows.delete(win);
}
export function setClearColour(win, value) {
  windowFor(win).clear = colourBinding(value) || null;
  return Compositor.setClearColor(win, ...resolveColour(value));
}
function paintElement(win, id) {
  const element = windows.get(win)?.elements.get(id);
  return Promise.all(element ? [...element.colours].map(([setter, binding]) => Native[setter](win, id, [...binding()])) : []);
}
export async function repaint() {
  const pending = [];
  for (const [win, window] of windows) {
    if (window.clear) pending.push(Compositor.setClearColor(win, ...window.clear()));
    for (const id of window.elements.keys()) pending.push(paintElement(win, id));
  }
  // In-flight native writes precede a later destroy in the same native queue.
  const results = await Promise.allSettled(pending);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}
onThemeChanged(repaint);
