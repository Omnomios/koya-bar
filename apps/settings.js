import * as UI from 'Helix/UserInterface';
import * as Log from 'Helix/Log';
import { connect, call } from './session.js';
import { WALLPAPERS, wallpaperFor, wallpaperFrame } from './wallpapers.js';
import { appFrame } from './app-frame.js';
import { button, label, toggle, children } from './touch-ui.js';
import { clockPreferences, clockPresentation } from './clock-model.js';
import { CREAM, ORANGE, CARD, MUTED, GUTTER, SPACE, TYPE, RADIUS, ROW } from './theme.js';

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
    const page = await frame.newPage(); page.hint = 'Clock options apply immediately to the top bar';
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
  const wallpapers = async () => {
    const page = await frame.newPage(); page.hint = 'Choose a wallpaper to apply it immediately';
    const columns = frame.width >= 500 ? 4 : 2;
    const width = (frame.width - SPACE.m * (columns - 1)) / columns;
    const height = Math.min(300, (frame.stageHeight - GUTTER - SPACE.l) / Math.ceil(WALLPAPERS.length / columns));
    const lines = Array.from({ length: Math.ceil(WALLPAPERS.length / columns) }, (_, index) => WALLPAPERS.slice(index * columns, (index + 1) * columns));
    const built = await Promise.all(lines.map(async wallpapers => {
      const line = await UI.createElement(frame.win, { layout: { type: 'row', gap: SPACE.m }, item: { size: { x: frame.width, y: height } } });
      const targets = await children(frame.win, line, wallpapers.map(async wallpaper => {
        const target = await button(frame.win, null, '', width, height, async () => {
          await save('Wallpaper', wallpaper.id); await go('wallpaper', 0, false);
        }, { colour: CARD, radius: RADIUS.surface, gap: 4 });
        const size = { x: width - 16, y: Math.max(48, height - 56) };
        await Promise.all([
          UI.setElementId(frame.win, target, 'wallpaper-' + wallpaper.id),
          children(frame.win, target, [
            UI.createElement(frame.win, { renderable: { type: 'sprite', texture: wallpaper.texture, frames: [wallpaperFrame(wallpaper, size)] }, item: { size } }),
            label(frame.win, null, wallpaper.name, TYPE.caption, width - 16, 18),
            label(frame.win, null, state.Wallpaper === wallpaper.id ? 'Selected' : 'Choose', TYPE.caption, width - 16, 18,
              state.Wallpaper === wallpaper.id ? ORANGE : MUTED)
          ])
        ]);
        return target;
      }));
      // Keep animation order stable even when lines finish in a different order.
      return { line, targets };
    }));
    await Promise.all(built.map(({ line }) => UI.attach(frame.win, page.el, line)));
    page.items.push(...built.flatMap(({ targets }) => targets));
    return page;
  };
  const go = (next, direction, animate = true) => {
    return frame.go(({ home, wallpaper: wallpapers, clock })[next],
      { title: ({ home: 'Settings', wallpaper: 'Wallpaper', clock: 'Date & time' })[next],
        direction, back: next !== 'home', animate });
  };
  connect('settings', async value => {
    const initial = !state; state = value;
    if (initial) await go('home', 0);
    else await Promise.all([frame.current?.update(), frame.refreshHint()]);
  });
  return frame;
};
