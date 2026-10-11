import * as UI from 'Helix/UserInterface';
import * as Log from 'Helix/Log';
import { connect, call } from './session.js';
import { WALLPAPERS, allWallpapers, wallpaperFor, wallpaperFrame, previewOf } from './wallpapers.js';
import { loadUserWallpapers, importWallpaper, removeWallpaper } from './user-wallpapers.js';
import { chooseImage } from './portal.js';
import { appFrame } from './app-frame.js';
import { button, icon, label, toggle, children } from './touch-ui.js';
import { clockPreferences, clockPresentation } from './clock-model.js';
import { CREAM, ORANGE, CARD, TONAL, MUTED, CLEAR, GUTTER, SPACE, TYPE, RADIUS, ROW, TOUCH, alpha } from './theme.js';

export default async () => {
  let state;
  const pending = new Set();
  const frame = await appFrame({ title: 'Settings', namespace: 'koya-settings',
    hint: () => state ? '' : 'Connecting to the shell…', onBack: () => go('home', -1) });
  const save = async (key, value) => {
    if (!state || pending.has(key)) return;
    pending.add(key);
    try { state = await call('SetSetting', 'ss', key, String(value)); frame.flash('Saved', ORANGE); }
    catch (error) { Log.error('Settings: ' + error); frame.flash('Could not save that change', ORANGE); }
    finally { pending.delete(key); }
  };
  const home = async () => {
    const page = await frame.newPage();
    page.hint = 'Personalise your desktop';
    const clock = clockPreferences(state);
    const [item, clockItem, note] = await Promise.all([
      frame.navigate(null, 'Wallpaper', wallpaperFor(state.Wallpaper).name, ROW, () => go('wallpaper', 1)),
      frame.navigate(null, 'Date & time', (clock.ClockTimeFormat === '24h' ? '24-hour' : '12-hour')
        + ' time · ' + (clock.ClockShowDate ? 'ISO date' : 'Date hidden'), ROW, () => go('clock', 1)),
      label(frame.win, null, 'Keyboard, locking and display controls are managed by your desktop session.', TYPE.caption, frame.width, 48, MUTED)
    ]);
    await Promise.all([UI.attach(frame.win, page.el, item.target), UI.attach(frame.win, page.el, clockItem.target), UI.attach(frame.win, page.el, note),
      UI.setElementId(frame.win, item.target, 'settings-wallpaper'), UI.setElementId(frame.win, clockItem.target, 'settings-clock')]);
    page.items.push(item.target, clockItem.target);
    return page;
  };
  const clock = async () => {
    const page = await frame.newPage(); page.hint = 'Clock options apply to the top bar and lock screen';
    const controls = [
      { key: 'ClockTimeFormat', title: '24-hour time', on: value => value.ClockTimeFormat === '24h',
        next: value => value.ClockTimeFormat === '24h' ? '12h' : '24h',
        detail: value => clockPresentation(new Date(), value).time },
      { key: 'ClockShowDate', title: 'Show date', on: value => value.ClockShowDate, next: value => !value.ClockShowDate,
        detail: value => value.ClockShowDate ? clockPresentation(new Date(), value).date + ' · YYYY-MM-DD' : 'Hidden' },
      { key: 'ClockShowSeconds', title: 'Show seconds', on: value => value.ClockShowSeconds, next: value => !value.ClockShowSeconds,
        detail: value => value.ClockShowSeconds ? 'Update every second' : 'Update every minute' }
    ];
    const rows = await Promise.all(controls.map(async control => {
      const change = () => save(control.key, control.next(clockPreferences(state)));
      const options = clockPreferences(state);
      let switchControl;
      const item = await frame.navigate(null, control.title, control.detail(options), ROW, change, { trailing: 56,
        trailingBuild: async parent => { switchControl = await toggle(frame.win, parent, control.on(options), change); return switchControl; }
      });
      await UI.setElementId(frame.win, item.target, 'settings-' + control.key);
      return { ...item, switchControl, control };
    }));
    await Promise.all(rows.map(item => UI.attach(frame.win, page.el, item.target)));
    page.items.push(...rows.map(item => item.target));
    page.update = () => {
      const options = clockPreferences(state);
      return Promise.all(rows.flatMap(item => [
        UI.setTextString(frame.win, item.valueLabel, item.control.detail(options)), item.switchControl.set(item.control.on(options))
      ]));
    };
    return page;
  };
  // A grid of previews in the display's own aspect ratio. The selection is
  // an orange ring; imported images can be removed; the last tile adds one.
  let wallpaperPage = 0, busy = false, reveal;
  const wallpapers = async () => {
    const page = await frame.newPage(SPACE.m); page.hint = 'Choose a wallpaper, or add your own image';
    const columns = 3, gap = SPACE.m, NAME = 20;
    const width = Math.floor((frame.width - gap * (columns - 1)) / columns);
    const screen = { x: Number(frame.display.logical_width || frame.display.width), y: Number(frame.display.logical_height || frame.display.height) };
    const preview = { x: width, y: Math.round(width * screen.y / screen.x) }, height = preview.y + SPACE.xs + NAME;
    const entries = [...allWallpapers(), { add: true }];
    const available = frame.stageHeight - SPACE.xs - GUTTER;
    const fit = space => Math.max(1, Math.floor((space + gap) / (height + gap)));
    let rows = fit(available);
    if (entries.length > rows * columns) rows = fit(available - TOUCH - SPACE.s);
    const perPage = rows * columns, pages = Math.ceil(entries.length / perPage);
    // After an import, open the page that holds the new image.
    if (reveal) { const index = entries.findIndex(entry => entry.id === reveal); if (index >= 0) wallpaperPage = Math.floor(index / perPage); reveal = undefined; }
    wallpaperPage = Math.min(wallpaperPage, pages - 1);
    const visible = entries.slice(wallpaperPage * perPage, (wallpaperPage + 1) * perPage);
    const tiles = new Map();
    const box = (colour, extra = {}) => ({ renderable: { type: 'box', colour, aabb: { min: { x: 0, y: 0 }, max: preview }, ...extra },
      item: { size: { ...preview } }, contentAlign: 'fill' });
    const tile = async entry => {
      const win = frame.win;
      if (entry.add) {
        const target = await button(win, null, '', width, height, addImage, { colour: CLEAR, radius: 0, gap: SPACE.xs, pressScale: 0.97 });
        const face = await UI.createElement(win, { ...box(TONAL), layout: { type: 'column', justifyContent: 'center', alignItems: 'center' } });
        await Promise.all([children(win, target, [Promise.resolve(face), label(win, null, 'Add image…', TYPE.caption, width, NAME, MUTED)]),
          icon(win, face, '/rom/assets/launcher/add.png', 22, width, preview.y), UI.setElementId(win, target, 'wallpaper-add')]);
        return target;
      }
      const chosen = () => state.Wallpaper === entry.id;
      const target = await button(win, null, '', width, height, async () => {
        if (busy || chosen()) return;
        await save('Wallpaper', entry.id);
      }, { colour: CLEAR, radius: 0, gap: SPACE.xs, pressScale: 0.97 });
      const art = previewOf(entry);
      const [face, sprite, edge, ring, name] = await Promise.all([
        UI.createElement(win, { ...box(CARD), layout: { type: 'none' }, clipToBounds: true }),
        UI.createElement(win, { renderable: { type: 'sprite', texture: art.texture, frames: [wallpaperFrame(art, preview)] }, item: { size: { ...preview } } }),
        // A faint edge keeps dark images from melting into the panel.
        UI.createElement(win, box(alpha(CREAM, 0.12), { inset: 1 })),
        UI.createElement(win, box(ORANGE, { inset: 2 })),
        label(win, null, entry.name, TYPE.caption, width, NAME, chosen() ? CREAM : MUTED)
      ]);
      await Promise.all([children(win, target, [Promise.resolve(face), Promise.resolve(name)]),
        ...[sprite, edge, ring].map(id => UI.attach(win, face, id)),
        UI.setEnabled(win, ring, chosen()), UI.setElementId(win, target, 'wallpaper-' + entry.id)]);
      if (entry.user) {
        const remove = await button(win, face, '', 24, 24, () => forget(entry), { colour: alpha(CARD, 0.85), radius: RADIUS.control,
          icon: '/rom/assets/launcher/close.png', iconSize: 10 });
        await UI.setLayoutPosition(win, remove, { x: preview.x - 24 - SPACE.xs, y: SPACE.xs });
      }
      tiles.set(entry.id, { ring, name });
      return target;
    };
    const lines = Array.from({ length: Math.ceil(visible.length / columns) }, (_, index) => visible.slice(index * columns, (index + 1) * columns));
    const built = await Promise.all(lines.map(async row => {
      const line = await UI.createElement(frame.win, { layout: { type: 'row', gap }, item: { size: { x: frame.width, y: height } } });
      const targets = await children(frame.win, line, row.map(tile));
      return { line, targets };
    }));
    await Promise.all(built.map(({ line }) => UI.attach(frame.win, page.el, line)));
    page.items.push(...built.flatMap(({ targets }) => targets));
    page.pager = pages > 1 ? { group: 'wallpapers', count: pages, index: wallpaperPage,
      turn: step => { const next = wallpaperPage + step; if (next >= 0 && next < pages) { wallpaperPage = next; go('wallpaper', step); } } } : undefined;
    // Selection changes update in place; nothing is rebuilt.
    page.update = () => Promise.all([...tiles].flatMap(([id, item]) => [
      UI.setEnabled(frame.win, item.ring, state.Wallpaper === id),
      UI.setTextColour(frame.win, item.name, state.Wallpaper === id ? CREAM : MUTED)]));
    return page;
  };
  const addImage = async () => {
    if (busy) return;
    busy = true;
    try {
      // The chooser is a normal window; it cannot appear above this overlay.
      await frame.suspend();
      let uri;
      try { uri = await chooseImage('Add a wallpaper'); } finally { await frame.resume(); }
      if (!uri) return;
      frame.flash('Adding image…', MUTED, 10000);
      const item = await importWallpaper(uri);
      await save('Wallpaper', item.id);
      reveal = item.id; await go('wallpaper', 0, false);
    } catch (error) {
      Log.error('Add wallpaper: ' + error);
      frame.flash(/supported image/i.test(String(error)) ? 'That file is not an image Koya can use' : 'Could not add that image', ORANGE, 4000);
    } finally { busy = false; }
  };
  const forget = async entry => {
    if (busy) return;
    busy = true;
    try {
      if (state.Wallpaper === entry.id) await save('Wallpaper', WALLPAPERS[0].id);
      await removeWallpaper(entry.id);
      await go('wallpaper', 0, false);
    } catch (error) { Log.error('Remove wallpaper: ' + error); frame.flash('Could not remove that image', ORANGE, 4000); }
    finally { busy = false; }
  };
  const go = (next, direction, animate = true) => {
    return frame.go(({ home, wallpaper: wallpapers, clock })[next],
      { title: ({ home: 'Settings', wallpaper: 'Wallpaper', clock: 'Date & time' })[next],
        direction, back: next !== 'home', animate });
  };
  connect('settings', async value => {
    const initial = !state; state = value;
    if (initial) { await loadUserWallpapers(); await go('home', 0); }
    else await Promise.all([frame.current?.update(), frame.refreshHint()]);
  });
  globalThis.koyaSettings = { go, addImage };
  return frame;
};
