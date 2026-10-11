import * as UI from 'Helix/UserInterface';
import * as Hypr from 'Module/hypr';
import * as Log from 'Helix/Log';
import { button, text } from './touch-ui.js';
import { FONT_STRONG, INK, CREAM, MUTED, ORANGE, alpha, BAR, AUTO } from './theme.js';

// Hyprland workspaces on one monitor, for the top bar: a numbered cell per
// workspace (cream when it has windows, muted when empty) with an orange pill
// behind the active number.
//
// Layout places everything. Cells are full-height buttons placed directly in
// the caller's centring row (a wrapper row would measure zero wide and lean
// the block off centre by half its width); each has
// a face that fills it less margins that put it on the strip, and the pill
// and label both fill the face. On a switch the new cell's pill appears and
// glides in from the old cell's measured position, coming to rest at zero.
const CELL = 26, GAP = 2, INSET = 4, PILL = BAR.height - INSET * 2;
const EVENTS = ['workspacev2', 'createworkspacev2', 'destroyworkspacev2', 'focusedmonv2', 'moveworkspacev2',
  'openwindow', 'closewindow', 'movewindowv2'];

// Layout for the row the caller provides.
export const WORKSPACE_ROW = { type: 'row', justifyContent: 'center', gap: GAP };

export function createWorkspaces(win, monitor) {
  let container, cells = [], shape = '', active, shown, disposed = false, queue = Promise.resolve(), timer;
  const glides = new Map();
  const glide = async (cell, from) => {
    const frames = [{ time: 0, position: { x: from, y: 0 } }, { time: 0.24, position: { x: 0, y: 0 }, ease: 'outCubic' }];
    const clip = glides.get(cell.pill);
    if (clip !== undefined && await UI.updateAnimation(win, cell.pill, clip, frames)) return UI.startAnimation(win, cell.pill, clip);
    const created = await UI.addAnimation(win, cell.pill, frames);
    glides.set(cell.pill, created);
    return UI.startAnimation(win, cell.pill, created);
  };
  const paint = async animate => {
    const next = cells.find(cell => cell.id === active), previous = cells.find(cell => cell.id === shown);
    await Promise.all(cells.map(cell => UI.setTextColour(win, cell.label, cell === next ? INK : cell.windows ? CREAM : MUTED)));
    if (next === previous) return;
    shown = next?.id;
    // Measure before swapping, so the glide starts exactly over the old pill.
    const [from, to] = animate && previous && next
      ? await Promise.all([UI.getElementFrame(win, previous.face), UI.getElementFrame(win, next.face)]) : [];
    await Promise.all([previous && UI.setEnabled(win, previous.pill, false), next && UI.setEnabled(win, next.pill, true)]);
    if (from && to) await glide(next, from.min.x - to.min.x);
  };
  const focus = async id => {
    if (id === active || !cells.some(cell => cell.id === id)) return;
    // Move first; Hyprland's event confirms it.
    active = id; await paint(true);
    try {
      const reply = String(await Hypr.send('dispatch hl.dsp.focus({ workspace = ' + id + ' })'));
      if (!/^ok/i.test(reply.trim())) await Hypr.send('dispatch workspace ' + id);
    } catch (error) { Log.error('Workspace: ' + error); }
  };
  const build = async list => {
    await Promise.all(cells.map(cell => UI.destroyElement(win, cell.target)));
    shown = undefined;
    cells = await Promise.all(list.map(async workspace => {
      let face;
      const target = await button(win, null, '', CELL, 'auto', () => focus(workspace.id), {
        colour: [0, 0, 0, 0], hover: alpha(CREAM, 0.08), hoverTarget: () => face, element: { layout: { type: 'none' } } });
      face = await UI.createElement(win, { renderable: { type: 'box', colour: [0, 0, 0, 0], cornerRadius: PILL / 2, cornerResolution: 16 },
        layout: { type: 'none' }, item: { size: AUTO, margin: { t: BAR.top + INSET, r: 0, b: INSET, l: 0 } }, contentAlign: 'fill' });
      const pill = await UI.createElement(win, { renderable: { type: 'box', colour: ORANGE, cornerRadius: PILL / 2, cornerResolution: 16 },
        item: { size: AUTO }, contentAlign: 'fill' });
      const label = await text(win, null, workspace.name, 12, 'auto', 'auto', MUTED, FONT_STRONG);
      await Promise.all([UI.attach(win, target, face), UI.attach(win, face, pill), UI.attach(win, face, label),
        UI.setEnabled(win, pill, false), UI.setHitTarget(win, pill, false), UI.setElementId(win, target, 'workspace-' + workspace.id)]);
      await UI.attach(win, container, target);
      return { id: workspace.id, windows: workspace.windows, target, face, pill, label };
    }));
  };
  // Events arrive in bursts (a move fires several), so they settle first;
  // the first load runs at once.
  const refresh = (immediate = false) => {
    clearTimeout(timer);
    const run = () => { queue = queue.then(async () => {
      if (disposed) return;
      const [workspaces, monitors] = await Promise.all([Hypr.workspaces(), Hypr.monitors()]);
      const list = (Array.isArray(workspaces) ? workspaces : []).filter(item => item.monitor === monitor && Number(item.id) > 0)
        .sort((a, b) => a.id - b.id).map(item => ({ id: Number(item.id), name: String(item.name), windows: Number(item.windows) || 0 }));
      active = Number((Array.isArray(monitors) ? monitors : []).find(item => item.name === monitor)?.activeWorkspace?.id);
      const nextShape = JSON.stringify(list.map(item => item.id));
      const rebuilt = nextShape !== shape;
      if (rebuilt) { shape = nextShape; await build(list); }
      else list.forEach((item, index) => { cells[index].windows = item.windows; });
      await paint(!rebuilt);
    }).catch(error => Log.error('Workspaces: ' + error)); };
    if (immediate === true) run(); else timer = setTimeout(run, 30);
  };
  const changed = () => refresh();
  for (const name of EVENTS) Hypr.on(name, changed);
  return {
    // `row`: a full-width row with justifyContent 'center' and gap GAP
    // (see WORKSPACE_ROW); the cells become its children.
    build: async row => {
      container = row;
      // Hyprland connects after the bar is built: poll until it answers.
      const first = async (attempt = 0) => {
        if (disposed) return;
        try { await Promise.all([Hypr.workspaces(), Hypr.monitors()]); refresh(true); }
        catch (_) { setTimeout(() => first(attempt + 1), Math.min(2000, 200 * (attempt + 1))); }
      };
      setTimeout(first, 0);
    },
    dispose: () => { disposed = true; clearTimeout(timer); for (const name of EVENTS) Hypr.off(name, changed); }
  };
}
