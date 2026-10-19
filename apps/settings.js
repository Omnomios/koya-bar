import * as UI from './theme-ui.js';
import * as Log from 'Helix/Log';
import { connect, call } from './session.js';
import { WALLPAPERS, allWallpapers, wallpaperFor, wallpaperFrame, previewOf } from './wallpapers.js';
import { loadUserWallpapers, importWallpaper, removeWallpaper } from './user-wallpapers.js';
import { chooseImage } from './portal.js';
import { appFrame } from './app-frame.js';
import { button, icon, label, toggle, children } from './touch-ui.js';
import { clockPreferences, clockPresentation } from './clock-model.js';
import { skinName } from './skins.js';
import { themeEditor } from './theme-editor.js';
import { UPDATE_INTERVALS, intervalLabel } from './updates-model.js';
import { CLEAR, GUTTER, SPACE, TYPE, RADIUS, LIST_ROW_HEIGHT, TEXT, SURFACE, BORDER, configureTheme } from './theme.js';

export default async () => {
  let state, author;
  const pending = new Set();
  const frame = await appFrame({ title: 'Settings', namespace: 'koya-settings',
    hint: () => state ? '' : 'Connecting to the shell…', onBack: () => frame.current?.themeRoute ? author.back()
      : go(frame.current?.intervalPage ? 'updates' : 'home', -1) });
  const save = async (key, value) => {
    if (!state || pending.has(key)) return;
    pending.add(key);
    try {
      state = await call('SetSetting', 'ss', key, String(value));
      if (key === 'Skin') await configureTheme(state);
      frame.flash('Saved', TEXT.accent);
      return true;
    }
    catch (error) { Log.error('Settings: ' + error); frame.flash('Could not save that change', TEXT.accent); return false; }
    finally { pending.delete(key); }
  };
  // The state of updates, as a row's value.
  const updatesSummary = value => value.UpdatesError ? 'Check failed' : value.UpdatesCount > 0
    ? value.UpdatesCount + (value.UpdatesCount === 1 ? ' update' : ' updates') : value.UpdatesCheckedAt ? 'Up to date' : 'Not checked';
  const home = async () => {
    const page = await frame.newPage();
    const clock = clockPreferences(state);
    const [item, skinItem, clockItem, updatesItem] = await Promise.all([
      frame.navigate(null, 'Wallpaper', wallpaperFor(state.Wallpaper).name, LIST_ROW_HEIGHT, () => go('wallpaper', 1)),
      frame.navigate(null, 'Theme', skinName(state.Skin), LIST_ROW_HEIGHT, () => go('skin', 1)),
      frame.navigate(null, 'Date & time', (clock.ClockTimeFormat === '24h' ? '24-hour' : '12-hour')
        + ' time · ' + (clock.ClockShowDate ? 'ISO date' : 'Date hidden'), LIST_ROW_HEIGHT, () => go('clock', 1)),
      frame.navigate(null, 'OS updates', updatesSummary(state), LIST_ROW_HEIGHT, () => go('updates', 1))
    ]);
    await Promise.all([UI.attach(frame.win, page.el, item.target), UI.attach(frame.win, page.el, skinItem.target),
      UI.attach(frame.win, page.el, clockItem.target), UI.attach(frame.win, page.el, updatesItem.target),
      UI.setElementId(frame.win, item.target, 'settings-wallpaper'), UI.setElementId(frame.win, skinItem.target, 'settings-skin'),
      UI.setElementId(frame.win, clockItem.target, 'settings-clock'), UI.setElementId(frame.win, updatesItem.target, 'settings-updates')]);
    page.items.push(item.target, skinItem.target, clockItem.target, updatesItem.target);
    page.height = SPACE.xs + LIST_ROW_HEIGHT * 4 + SPACE.s * 3;
    page.update = () => Promise.all([UI.setTextString(frame.win, skinItem.valueLabel, skinName(state.Skin)),
      UI.setTextString(frame.win, updatesItem.valueLabel, updatesSummary(state))]);
    return page;
  };
  const skins = async () => {
    author ||= themeEditor(frame, { value: state.Skin, save: value => save('Skin', value), exit: () => go('home', -1) });
    author.receive(state.Skin);
    return author.build();
  };
  const clock = async () => {
    const page = await frame.newPage();
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
      const item = await frame.navigate(null, control.title, control.detail(options), LIST_ROW_HEIGHT, change, { trailing: 56,
        trailingBuild: async parent => { switchControl = await toggle(frame.win, parent, control.on(options), change); return switchControl; }
      });
      await UI.setElementId(frame.win, item.target, 'settings-' + control.key);
      return { ...item, switchControl, control };
    }));
    await Promise.all(rows.map(item => UI.attach(frame.win, page.el, item.target)));
    page.items.push(...rows.map(item => item.target));
    page.height = SPACE.xs + LIST_ROW_HEIGHT * rows.length + SPACE.s * (rows.length - 1);
    page.update = () => {
      const options = clockPreferences(state);
      return Promise.all(rows.flatMap(item => [
        UI.setTextString(frame.win, item.valueLabel, item.control.detail(options)), item.switchControl.set(item.control.on(options))
      ]));
    };
    return page;
  };
  const updates = async () => {
    const page = await frame.newPage();
    let aurToggle;
    const changeAUR = () => save('UpdatesIncludeAUR', !state.UpdatesIncludeAUR);
    const [open, interval, aur] = await Promise.all([
      frame.navigate(null, 'Open OS updates', updatesSummary(state), LIST_ROW_HEIGHT, async () => {
        try { await call('OpenUpdates'); frame.close(); }
        catch (_) { frame.flash('Could not open OS updates', TEXT.accent); }
      }),
      frame.navigate(null, 'Check interval', intervalLabel(state.UpdatesCheckInterval), LIST_ROW_HEIGHT, () => go('updateInterval', 1)),
      frame.navigate(null, 'Include AUR packages', 'yay', LIST_ROW_HEIGHT, changeAUR, {
        trailing: 56, trailingBuild: async parent => { aurToggle = await toggle(frame.win, parent, state.UpdatesIncludeAUR, changeAUR); return aurToggle; }
      })
    ]);
    await Promise.all([open.target, interval.target, aur.target].map(id => UI.attach(frame.win, page.el, id)));
    await Promise.all([UI.setElementId(frame.win, interval.target, 'settings-updates-interval'), UI.setElementId(frame.win, aur.target, 'settings-updates-aur')]);
    page.items.push(open.target, interval.target, aur.target);
    page.height = SPACE.xs + 3 * LIST_ROW_HEIGHT + 2 * SPACE.s;
    page.update = () => Promise.all([UI.setTextString(frame.win, open.valueLabel, updatesSummary(state)),
      UI.setTextString(frame.win, interval.valueLabel, intervalLabel(state.UpdatesCheckInterval)), aurToggle.set(state.UpdatesIncludeAUR)]);
    return page;
  };
  const updateInterval = async () => {
    const page = await frame.newPage(); page.intervalPage = true;
    const height = Math.min(frame.stageHeight - SPACE.xs - GUTTER, UPDATE_INTERVALS.length * (48 + SPACE.xs));
    const area = await frame.kit.scrollArea({ width: frame.width, height, gap: SPACE.xs, id: 'settings-update-intervals' });
    await UI.attach(frame.win, page.el, area.id);
    // One line each; the chosen interval carries an accent dot.
    const marks = [];
    const mark = minutes => minutes === state.UpdatesCheckInterval ? SURFACE.accent : CLEAR;
    const rows = await Promise.all(UPDATE_INTERVALS.map((minutes, index) => frame.navigate(null, intervalLabel(minutes), '', 48, async () => {
        if (await save('UpdatesCheckInterval', minutes)) await go('updates', -1);
      }, { trailing: 24, trailingBuild: async () => (marks[index] = await UI.createElement(frame.win, { renderable: { type: 'circle',
        aabb: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }, resolution: 24, colour: mark(minutes) }, item: { size: { x: 24, y: 48 } }, contentAlign: { x: 'center', y: 'center' } })) })));
    await Promise.all(rows.flatMap(item => [UI.attach(frame.win, area.content, item.target), UI.setEnabled(frame.win, item.valueLabel, false)]));
    await area.setContentHeight(rows.length * (48 + SPACE.xs) - SPACE.xs);
    page.height = SPACE.xs + height + GUTTER;
    page.update = () => Promise.all(marks.map((id, index) => UI.setCircleColour(frame.win, id, mark(UPDATE_INTERVALS[index]))));
    return page;
  };
  // A grid of previews in the display's own aspect ratio. The selection is
  // an accent ring; imported images can be removed; the last tile adds one.
  let busy = false, reveal;
  const wallpapers = async () => {
    const page = await frame.newPage(SPACE.m);
    const columns = 3, gap = SPACE.m, WALLPAPER_LABEL_HEIGHT = 20;
    const width = Math.floor((frame.width - gap * (columns - 1)) / columns);
    const screen = { x: Number(frame.display.logical_width || frame.display.width), y: Number(frame.display.logical_height || frame.display.height) };
    const preview = { x: width, y: Math.round(width * screen.y / screen.x) }, height = preview.y + SPACE.xs + WALLPAPER_LABEL_HEIGHT;
    const entries = [...allWallpapers(), { add: true }];
    // The login screen row: what it shows once it knows this account.
    const loginShows = () => state.GreeterWallpaper && allWallpapers().some(item => item.id === state.Wallpaper) ? wallpaperFor(state.Wallpaper).name : 'System wallpaper';
    let loginSwitch;
    const toggleLogin = () => save('GreeterWallpaper', !state.GreeterWallpaper);
    const loginRow = await frame.navigate(null, 'Show on login screen', loginShows(), LIST_ROW_HEIGHT, toggleLogin, { trailing: 56,
      trailingBuild: async parent => { loginSwitch = await toggle(frame.win, parent, !!state.GreeterWallpaper, toggleLogin); return loginSwitch; } });
    await UI.setElementId(frame.win, loginRow.target, 'settings-GreeterWallpaper');
    const available = frame.stageHeight - SPACE.xs - GUTTER - LIST_ROW_HEIGHT - gap;
    // Every tile, in rows that scroll once they outgrow the page.
    const visible = entries;
    const lineCount = Math.ceil(visible.length / columns), contentHeight = lineCount * height + (lineCount - 1) * gap;
    const viewHeight = Math.min(contentHeight, available);
    const tiles = new Map();
    const box = (colour, extra = {}) => ({ renderable: { type: 'box', colour, aabb: { min: { x: 0, y: 0 }, max: preview }, ...extra },
      item: { size: { ...preview } }, contentAlign: 'fill' });
    const tile = async entry => {
      const win = frame.win;
      if (entry.add) {
        const target = await button(win, null, '', width, height, addImage, { colour: CLEAR, radius: 0, gap: SPACE.xs, pressScale: 0.97 });
        const face = await UI.createElement(win, { ...box(SURFACE.control), layout: { type: 'column', justifyContent: 'center', alignItems: 'center' } });
        await Promise.all([children(win, target, [Promise.resolve(face), label(win, null, 'Add image…', TYPE.caption, width, WALLPAPER_LABEL_HEIGHT, TEXT.secondary)]),
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
        UI.createElement(win, { ...box(SURFACE.card), layout: { type: 'none' }, clipToBounds: true }),
        UI.createElement(win, { renderable: { type: 'sprite', texture: art.texture, frames: [wallpaperFrame(art, preview)] }, item: { size: { ...preview } } }),
        // A faint edge keeps dark images from melting into the panel.
        UI.createElement(win, box(BORDER.preview, { inset: 1 })),
        UI.createElement(win, box(BORDER.selected, { inset: 2 })),
        label(win, null, entry.name, TYPE.caption, width, WALLPAPER_LABEL_HEIGHT, chosen() ? TEXT.primary : TEXT.secondary)
      ]);
      await Promise.all([children(win, target, [Promise.resolve(face), Promise.resolve(name)]),
        ...[sprite, edge, ring].map(id => UI.attach(win, face, id)),
        UI.setEnabled(win, ring, chosen()), UI.setElementId(win, target, 'wallpaper-' + entry.id)]);
      if (entry.user) {
        const remove = await button(win, face, '', 24, 24, () => forget(entry), { colour: SURFACE.thumbnailAction, radius: RADIUS.control,
          icon: '/rom/assets/launcher/close.png', iconSize: 10 });
        await UI.setLayoutPosition(win, remove, { x: preview.x - 24 - SPACE.xs, y: SPACE.xs });
      }
      tiles.set(entry.id, { ring, name });
      return target;
    };
    const lines = Array.from({ length: Math.ceil(visible.length / columns) }, (_, index) => visible.slice(index * columns, (index + 1) * columns));
    const area = await frame.kit.scrollArea({ width: frame.width, height: viewHeight, gap, id: 'wallpaper-grid' });
    const built = await Promise.all(lines.map(async row => {
      const line = await UI.createElement(frame.win, { layout: { type: 'row', gap }, item: { size: { x: frame.width, y: height } } });
      const targets = await children(frame.win, line, row.map(tile));
      return { line, targets };
    }));
    for (const { line } of built) await UI.attach(frame.win, area.content, line);
    await UI.attach(frame.win, page.el, loginRow.target);
    await Promise.all([UI.attach(frame.win, page.el, area.id), area.setContentHeight(contentHeight)]);
    page.items.push(loginRow.target, ...built.flatMap(({ targets }) => targets));
    page.height = SPACE.xs + LIST_ROW_HEIGHT + gap + viewHeight;
    // After an import, scroll the new image's row into view.
    if (reveal) {
      const index = entries.findIndex(entry => entry.id === reveal), line = Math.floor(Math.max(0, index) / columns);
      reveal = undefined;
      if (index >= 0) await area.reveal(line * (height + gap), line * (height + gap) + height);
    }
    // Selection changes update in place; nothing is rebuilt.
    page.update = () => Promise.all([loginSwitch.set(!!state.GreeterWallpaper), UI.setTextString(frame.win, loginRow.valueLabel, loginShows()),
      ...[...tiles].flatMap(([id, item]) => [
      UI.setEnabled(frame.win, item.ring, state.Wallpaper === id),
      UI.setTextColour(frame.win, item.name, state.Wallpaper === id ? TEXT.primary : TEXT.secondary)])]);
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
      frame.flash('Adding image…', TEXT.secondary, 10000);
      const item = await importWallpaper(uri);
      await save('Wallpaper', item.id);
      reveal = item.id; await go('wallpaper', 0, false);
    } catch (error) {
      Log.error('Add wallpaper: ' + error);
      frame.flash(/supported image/i.test(String(error)) ? 'That file is not an image Koya can use' : 'Could not add that image', TEXT.accent, 4000);
    } finally { busy = false; }
  };
  const forget = async entry => {
    if (busy) return;
    busy = true;
    try {
      if (state.Wallpaper === entry.id) await save('Wallpaper', WALLPAPERS[0].id);
      await removeWallpaper(entry.id);
      await go('wallpaper', 0, false);
    } catch (error) { Log.error('Remove wallpaper: ' + error); frame.flash('Could not remove that image', TEXT.accent, 4000); }
    finally { busy = false; }
  };
  const go = (next, direction, animate = true) => {
    return frame.go(({ home, wallpaper: wallpapers, skin: skins, clock, updates, updateInterval })[next],
      { title: ({ home: 'Settings', wallpaper: 'Wallpaper', skin: 'Theme', clock: 'Date & time', updates: 'OS updates', updateInterval: 'Check interval' })[next],
        direction, back: next !== 'home', animate });
  };
  connect('settings', async value => {
    const initial = !state; state = value;
    author?.receive(state.Skin);
    if (initial) { await loadUserWallpapers(); await go('home', 0); }
    else await Promise.all([frame.current?.update(), frame.refreshHint()]);
  });
  globalThis.koyaSettings = { go, addImage };
  return frame;
};
