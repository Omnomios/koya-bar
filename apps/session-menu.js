import * as UI from './theme-ui.js';
import * as Log from 'Helix/Log';
import { call } from './session.js';
import { createPopover } from './popover.js';
import * as Desktop from 'Module/desktop';
import { KIT_METRICS } from './kit.js';
import { presets } from './motion.js';
import { userAvatar } from './user-avatar.js';
import { row, text, label, icon, pill } from './touch-ui.js';
import { SPACE, TYPE, TEXT, FONT_STRONG, CLEAR, SURFACE, RADIUS, AUTO } from './theme.js';

// The menu behind the Koya logo: who is signed in, then the session's
// actions (lock, log out) and the computer's (suspend through shut down) in
// two cards. Actions that end the session ask first, with their own badge.
const WIDTH = 280, ROW_HEIGHT = 40, ACTION_HEIGHT = 32, DETAIL_HEIGHT = 54, ERROR_MS = 2400;
const texture = name => '/rom/assets/power-menu/' + name + '.png';

export function createSessionMenu({ invoke = call } = {}) {
  let state = {}, popup, placement, actions = [], confirmation, error = '', busy = false, request = 0, errorTimer;
  let queue = Promise.resolve();
  const enqueue = job => {
    const next = queue.then(job); queue = next.catch(reason => Log.error('Session menu: ' + reason)); return next;
  };
  const allowed = () => state.Active && state.ScreenState === 'unlocked';
  const destroy = async () => { const old = popup; popup = undefined; if (old) { await old.avatar?.dispose(); await old.shell.destroy(); } };
  const close = () => { request++; clearTimeout(errorTimer); placement = undefined; confirmation = undefined; error = ''; return enqueue(destroy); };
  const perform = async action => {
    if (busy || !placement || !allowed()) return;
    busy = true;
    // Release the menu's input before logind can request polkit approval or
    // the lock app takes exclusive keyboard input.
    await enqueue(destroy);
    try { await invoke('RunSessionAction', 's', action.id); placement = undefined; confirmation = undefined; }
    catch (reason) {
      Log.error('Session action: ' + reason);
      error = /denied|authoriz|authentication|permission|polkit/i.test(String(reason)) ? 'Permission denied'
        : 'Could not ' + (action.confirmLabel || action.label).replace('…', '').toLowerCase();
      if (placement && allowed()) await enqueue(build);
    } finally { busy = false; }
  };
  const choose = async action => {
    if (busy || !placement || !allowed()) return;
    if (!action.confirmation) { await perform(action); return; }
    confirmation = action; error = ''; await enqueue(build);
  };
  const build = async () => {
    await destroy();
    if (!placement || !allowed()) return;
    const location = placement;
    const shell = await createPopover({ ...location, width: WIDTH, namespace: 'koya-session-menu', id: 'session-menu', onClose: () => close().catch(() => {}) });
    try {
      const { win, kit, inner, content } = shell;
      const sections = [], rows = [];
      const add = section => { sections.push(section); return UI.attach(win, content, section.id); };
      // A failure shows where it happened (the hero's caption) for a moment,
      // with a shake of what was refused, then the caption reads normally.
      let caption, rest = '', refused;
      if (confirmation) {
        // Confirm: the action's badge and question, what will happen, then
        // Cancel beside the action itself.
        const action = confirmation;
        const [hero, badge, words, heading, detail, controls] = await Promise.all([
          UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: { x: 'auto', y: KIT_METRICS.badgeSlotSize } } }),
          kit.badge({ glyph: texture(action.icon), health: 'warn' }),
          UI.createElement(win, { layout: { type: 'column', justifyContent: 'center' }, item: { size: AUTO } }),
          text(win, null, action.confirmLabel + '?', TYPE.heading, 'auto', 24, TEXT.primary, FONT_STRONG, 'left'),
          label(win, null, action.confirmation, TYPE.detail, inner, DETAIL_HEIGHT, TEXT.secondary),
          UI.createElement(win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: 'auto', y: ACTION_HEIGHT } } })
        ]);
        const width = (inner - SPACE.s) / 2;
        const [cancel, confirm] = await Promise.all([
          pill(win, null, 'Cancel', width, async () => { if (busy) return; confirmation = undefined; error = ''; await enqueue(build); },
            { height: ACTION_HEIGHT, size: TYPE.detail }),
          pill(win, null, action.confirmLabel, width, () => perform(action),
            { height: ACTION_HEIGHT, size: TYPE.detail, colour: SURFACE.accent, labelColour: TEXT.onAccent })
        ]);
        await Promise.all([UI.setGrow(win, words, 1), UI.attach(win, words, heading), UI.attach(win, hero, badge.id), UI.attach(win, hero, words),
          UI.attach(win, controls, cancel), UI.attach(win, controls, confirm),
          UI.setElementId(win, cancel, 'session-cancel'), UI.setElementId(win, confirm, 'session-confirm')]);
        await add({ id: hero, height: KIT_METRICS.badgeSlotSize });
        await add({ id: detail, height: DETAIL_HEIGHT });
        await add({ id: controls, height: ACTION_HEIGHT });
        caption = detail; rest = action.confirmation; refused = controls;
        shell.afterShow = () => { badge.pop(); [detail, controls].forEach((id, index) => shell.play(id, presets.rise(index))); };
      } else {
        // The person this session belongs to, then the session's own actions
        // and the computer's, each in a card.
        const user = Desktop.userName();
        const [hero, avatar, title] = await Promise.all([
          UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: { x: 'auto', y: KIT_METRICS.badgeSlotSize } } }),
          userAvatar(win, { size: KIT_METRICS.badgeSize, id: 'session-avatar',
            // A real name heads the hero over the login; a login alone stands by itself.
            onName: value => {
              const name = String(value || '').trim(), real = !!name && name !== user;
              rest = real ? user : '';
              UI.setTextString(win, title.heading, real ? name : user).catch(() => {});
              // Without a caption the heading centres in the hero.
              UI.setLayoutSize(win, title.line, { x: 'auto', y: rest || error ? 18 : 0 }).catch(() => {});
              if (!error) UI.setTextString(win, title.caption, rest).catch(() => {});
            } }),
          kit.titleBlock({ title: user, subtitle: '' })
        ]);
        // The avatar sits in a badge-sized slot, so heroes line up across popovers.
        const inset = (KIT_METRICS.badgeSlotSize - KIT_METRICS.badgeSize) / 2;
        await Promise.all([UI.setMargin(win, avatar.id, { t: inset, r: inset, b: inset, l: inset }),
          UI.attach(win, hero, avatar.id), UI.attach(win, hero, title.id), UI.setElementId(win, title.caption, 'session-caption')]);
        await add({ id: hero, height: KIT_METRICS.badgeSlotSize });
        shell.avatar = avatar; shell.title = title;
        const groups = [actions.filter(action => !action.method), actions.filter(action => action.method)].filter(group => group.length);
        for (const group of groups) {
          const height = group.length * ROW_HEIGHT + SPACE.xs * 2;
          const card = await kit.surface('inset', { size: { x: 'auto', y: height }, padding: { t: SPACE.xs, r: SPACE.xs, b: SPACE.xs, l: SPACE.xs } });
          for (const action of group) {
            const target = await row(win, card.content, inner - SPACE.xs * 2, ROW_HEIGHT, () => choose(action), { colour: CLEAR, gap: SPACE.m, radius: RADIUS.control });
            const [glyph, name] = await Promise.all([
              icon(win, null, texture(action.icon), 20, 24, ROW_HEIGHT),
              text(win, null, action.label, TYPE.body, inner - SPACE.xs * 2 - 12 - 8 - 24 - SPACE.m, ROW_HEIGHT, TEXT.primary, undefined, 'left')
            ]);
            await Promise.all([UI.attach(win, target, glyph), UI.attach(win, target, name), UI.setElementId(win, target, 'session-' + action.id)]);
            rows.push(target);
          }
          await add({ id: card.id, height });
        }
        caption = title.caption; refused = sections[1]?.id;
        avatar.setUser(user);
        shell.afterShow = () => { kit.play(avatar.id, presets.pop()); rows.forEach((id, index) => shell.play(id, presets.rise(index))); };
      }
      if (placement !== location || !allowed()) { await shell.avatar?.dispose(); await shell.destroy(); return; }
      popup = { shell, display: location.display.display, avatar: shell.avatar, title: shell.title };
      await shell.show(sections.reduce((sum, section) => sum + section.height, 0) + SPACE.m * (sections.length - 1));
      shell.afterShow();
      if (error) {
        const shown = popup;
        await Promise.all([UI.setTextString(win, caption, error), ...(popup.title ? [UI.setLayoutSize(win, popup.title.line, { x: 'auto', y: 18 })] : [])]);
        if (refused) shell.play(refused, presets.shake());
        clearTimeout(errorTimer);
        errorTimer = setTimeout(() => {
          error = '';
          if (popup !== shown) return;
          UI.setTextString(win, caption, rest).catch(() => {});
          if (popup.title) UI.setLayoutSize(win, popup.title.line, { x: 'auto', y: rest ? 18 : 0 }).catch(() => {});
        }, ERROR_MS);
      }
    } catch (reason) { if (popup?.shell === shell) popup = undefined; await shell.destroy(); throw reason; }
  };
  return {
    toggle(display, anchor) {
      const token = ++request;
      return enqueue(async () => {
        const same = popup?.display === display.display;
        await destroy();
        if (token !== request) return;
        if (same || !allowed() || busy) { placement = undefined; return; }
        placement = { display, anchor }; confirmation = undefined; error = '';
        try { actions = JSON.parse(await invoke('GetSessionActions')); }
        catch (reason) { actions = []; error = 'Session controls are unavailable'; Log.error('Session menu: ' + reason); }
        if (token !== request) return;
        await build();
      });
    },
    close,
    onState(value) { state = value; return allowed() ? Promise.resolve() : close(); },
    resize: output => !output || popup?.display === output.display ? close() : Promise.resolve(),
    get window() { return popup?.shell.win; }
  };
}
