import * as UI from './theme-ui.js';
import * as Log from 'Helix/Log';
import { createPopover } from './popover.js';
import { scalarControl } from './scalar-control.js';
import { powerView } from './power-model.js';
import { PROFILE_LABELS } from './power-profiles.js';
import { call } from './session.js';
import { KIT_METRICS } from './kit.js';
import { text, pill, toggle, throbber } from './touch-ui.js';
import { presets } from './motion.js';
import { TEXT, TYPE, SPACE, SURFACE, FONT } from './theme.js';

const POPUP_WIDTH = 340;
const MODES_HEIGHT = 60, CHARGE_ROW_HEIGHT = 44, CHARGE_RANGE_WIDTH = 64, CHARGE_SWITCH_WIDTH = 56, SPINNER = 14, CHARGE_SLIDER_HEIGHT = 40;
// A failure shows where it happened (the switch's value, the modes' caption)
// for this long, then the control reads normally again.
const ERROR_MS = 2400;
const texture = name => '/rom/assets/status/' + name + '.png';
const shape = view => JSON.stringify([view.details.map(row => row.key), view.chargeControls.map(control => [control.path, control.adjustable]),
  view.profiles, !!view.degraded, view.percent === null]);
// The meter reads like the status line: what the battery is doing, then the level.
const reading = view => (view.charging ? 'Charging · ' : '') + Math.round(view.percent) + '%';

export function createPowerPopup() {
  let state = {}, popup, placement, request = 0, disposed = false, busy = false, error = '', previous = '';
  // The switch being applied and where it is heading (shown at once; a
  // refusal slides it back).
  let chargePath = '', chargeTarget = false, chargeError = '', chargeErrorPath = '', errorTimer;
  // Busy feedback for the mode being applied: its pill breathes. (A
  // throbber beside the label does not fit three pills across.)
  const BREATHE = [{ time: 0, opacity: 1 }, { time: 0.45, opacity: 0.55, ease: 'inOutQuad' }, { time: 0.9, opacity: 1, ease: 'inOutQuad', looping: true }];
  const breathe = (profile, on) => {
    const id = popup?.buttons.find(button => button.profile === profile)?.id;
    if (id) popup.shell.play(id, on ? BREATHE : presets.steady());
  };
  let queue = Promise.resolve();
  const enqueue = job => {
    const next = queue.then(job); queue = next.catch(reason => Log.error('Power popup: ' + reason)); return next;
  };
  const destroy = async () => {
    if (!popup) return;
    const old = popup; popup = undefined; old.details.dispose(); old.chargeControls.forEach(control => control.slider?.dispose()); await old.shell.destroy();
  };
  const close = () => { request++; placement = undefined; clearTimeout(errorTimer); error = chargeError = ''; return enqueue(destroy); };
  const fail = target => {
    clearTimeout(errorTimer);
    if (popup && target) popup.shell.play(target, presets.shake());
    errorTimer = setTimeout(() => { error = chargeError = ''; if (!disposed) enqueue(paint); }, ERROR_MS);
  };
  const choose = async profile => {
    if (busy || disposed || !placement || !state.Active || state.ScreenState !== 'unlocked'
      || !powerView(state).profiles.includes(profile) || profile === state.PowerProfile) return;
    busy = true; error = '';
    breathe(profile, true);
    try {
      await enqueue(paint);
      const value = await call('SetPowerProfile', 's', profile);
      if (!disposed) state = value;
    } catch (reason) {
      error = /denied|authorized|permission|polkit/i.test(String(reason)) ? 'Permission denied' : 'Could not change power mode';
      Log.error('Power mode: ' + reason);
      fail(popup?.modeRow);
    } finally {
      busy = false;
      breathe(profile, false);
      if (!disposed) await enqueue(paint);
    }
  };
  const changeChargeControl = async (path, limit) => {
    const control = powerView(state).chargeControls.find(item => item.path === path);
    if (busy || disposed || !placement || !state.Active || state.ScreenState !== 'unlocked' || !control) return;
    busy = true; chargePath = path; chargeTarget = limit === undefined ? !control.enabled : limit < 100; chargeError = '';
    try {
      await enqueue(paint);
      const value = limit === undefined ? await call('SetChargeControl', 'sb', path, !control.enabled) : await call('SetChargeLimit', 'su', path, limit);
      if (!disposed) state = value;
    } catch (reason) {
      chargeError = /denied|authorized|permission|polkit/i.test(String(reason)) ? 'Denied' : 'Failed';
      chargeErrorPath = path;
      Log.error('Charge control: ' + reason);
      fail(popup?.chargeControls.find(item => item.path === path)?.id);
      if (limit !== undefined) throw reason;
    } finally {
      busy = false; chargePath = '';
      if (!disposed) await enqueue(paint);
    }
  };
  const build = async (view, location) => {
    const shell = await createPopover({ ...location, width: POPUP_WIDTH, namespace: 'koya-power', id: 'power-popup', onClose: () => close().catch(() => {}) });
    try {
      const { win, kit } = shell;
      // A charge meter under the hero when the level is known.
      const meter = view.percent !== null ? await kit.meter({ label: 'Charge', width: shell.inner, segments: 10 }) : undefined;
      const [hero, badge, title, details, modes] = await Promise.all([
        UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: { x: 'auto', y: KIT_METRICS.badgeSlotSize } } }),
        kit.badge({ glyph: texture(view.icon), health: view.health }),
        kit.titleBlock({ title: view.title, subtitle: view.status, dot: view.health }),
        kit.keyValue(view.details, { keyWidth: view.details.some(row => row.key.length > 12) ? 120 : 78 }),
        view.profiles.length ? UI.createElement(win, { layout: { type: 'column', gap: SPACE.s }, item: { size: { x: 'auto', y: MODES_HEIGHT } } }) : undefined
      ]);
      await Promise.all([UI.attach(win, hero, badge.id), UI.attach(win, hero, title.id),
        UI.setElementId(win, title.caption, 'power-battery-status'), UI.setElementId(win, title.heading, 'power-battery-percent')]);
      let buttons = [], modeCaption, modeRow;
      if (modes) {
        const [caption, row, entries] = await Promise.all([
          text(win, null, 'Power mode', TYPE.caption, shell.inner, 20, TEXT.secondary, undefined, 'left'),
          UI.createElement(win, { layout: { type: 'row', gap: SPACE.xs }, item: { size: { x: 'auto', y: 32 } } }),
          Promise.all(view.profiles.map(async profile => {
            let labelId;
            const selected = view.active === profile;
            const id = await pill(win, null, PROFILE_LABELS[profile], (shell.inner - SPACE.xs * (view.profiles.length - 1)) / view.profiles.length,
              () => choose(profile), { height: 32, size: TYPE.caption, colour: selected ? SURFACE.accent : SURFACE.control,
                labelColour: selected ? TEXT.onAccent : TEXT.primary, onLabel: id => { labelId = id; } });
            await UI.setElementId(win, id, 'power-mode-' + profile);
            return { profile, id, labelId };
          }))
        ]);
        buttons = entries; modeCaption = caption; modeRow = row;
        await Promise.all([UI.attach(win, modes, caption), UI.attach(win, modes, row),
          ...buttons.map(button => UI.attach(win, row, button.id)), UI.setElementId(win, caption, 'power-mode-caption')]);
      }
      // One card per limit-capable battery: name, a throbber while applying,
      // the range (or a failure) and the switch; an adjustable ceiling adds
      // its slider inside the card, which then carries the value itself.
      const chargeControls = await Promise.all(view.chargeControls.map(async control => {
        const height = CHARGE_ROW_HEIGHT + (control.adjustable ? CHARGE_SLIDER_HEIGHT + SPACE.xs : 0);
        const group = await kit.surface('inset', { size: { x: shell.inner, y: height }, padding: { t: 0, r: SPACE.xs, b: control.adjustable ? SPACE.xs : 0, l: SPACE.m } });
        const card = { id: await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: 'auto', y: CHARGE_ROW_HEIGHT } } }) };
        card.content = card.id;
        const width = shell.inner - SPACE.m - SPACE.xs - CHARGE_RANGE_WIDTH - SPINNER - CHARGE_SWITCH_WIDTH - SPACE.s * 3;
        // Requested in reading order (ids follow it): the throbber before the
        // range, so the range sits against the switch.
        const [title, spinner, range, switchControl] = await Promise.all([
          text(win, null, control.title, TYPE.detail, width, CHARGE_ROW_HEIGHT, TEXT.primary, FONT, 'left'),
          throbber(win, null, SPINNER, TEXT.primary, CHARGE_ROW_HEIGHT),
          text(win, null, control.range, TYPE.detail, CHARGE_RANGE_WIDTH, CHARGE_ROW_HEIGHT, TEXT.secondary, FONT, 'right'),
          toggle(win, null, control.enabled, () => changeChargeControl(control.path))
        ]);
        await Promise.all([UI.attach(win, card.content, title), UI.attach(win, card.content, spinner.id), UI.attach(win, card.content, range),
          UI.attach(win, card.content, switchControl.id), UI.setElementId(win, switchControl.id, 'power-charge-' + control.path.split('/').pop()),
          UI.setElementId(win, range, 'power-charge-range-' + control.path.split('/').pop())]);
        await UI.attach(win, group.content, card.id);
        // Live only while the limit is on: the switch turns it on at the
        // remembered ceiling, and the slider then moves it.
        const enabled = () => powerView(state).chargeControls.find(item => item.path === control.path)?.enabled;
        const slider = control.adjustable ? await scalarControl(win, { id: 'power-charge-limit-' + control.path.split('/').pop(), width: shell.inner - SPACE.m - SPACE.xs,
          value: control.enabled ? control.end : state.FrameworkChargeLimit || 80, minimum: control.minimum, maximum: Math.min(control.maximum, 100) - 5, step: 5,
          available: () => !busy && enabled() && state.Active && state.ScreenState === 'unlocked', commit: value => changeChargeControl(control.path, value) }) : undefined;
        if (slider) await UI.attach(win, group.content, slider.id);
        return { id: group.id, height, path: control.path, title, range, spinner, switchControl, slider, adjustable: control.adjustable };
      }));
      const limitation = view.degraded ? await text(win, null, view.degraded, TYPE.caption, shell.inner, 20, TEXT.secondary, FONT, 'left') : undefined;
      // The hero stays above the scroll area: a scroll viewport clips, and
      // would cut off the badge's pulse.
      const sections = [...(meter ? [meter] : []), details,
        ...chargeControls, ...(modes ? [{ id: modes, height: MODES_HEIGHT }] : []),
        ...(limitation ? [{ id: limitation, height: 20 }] : [])];
      const height = sections.reduce((sum, item) => sum + item.height, 0) + SPACE.m * (sections.length - 1);
      const screenHeight = Number(location.display.logical_height || location.display.height);
      const above = KIT_METRICS.badgeSlotSize + SPACE.m;
      const viewportHeight = Math.min(height, Math.max(60, screenHeight - location.anchor.y - location.anchor.height - 56 - above));
      const scroll = await kit.scrollArea({ height: viewportHeight, gap: SPACE.m, id: 'power-content' });
      await Promise.all([UI.attach(win, shell.content, hero), UI.attach(win, shell.content, scroll.id), scroll.setContentHeight(height),
        // Reading order made explicit: siblings sort by order, then creation,
        // and the meter is created before the hero.
        UI.setLayoutOrder(win, hero, 0), UI.setLayoutOrder(win, scroll.id, 1),
        ...sections.flatMap((item, index) => [UI.setLayoutOrder(win, item.id, index), UI.attach(win, scroll.content, item.id)])]);
      popup = { shell, shape: shape(view), badge, title, meter, details, buttons, modeCaption, modeRow, limitation,
        chargeControls, charging: view.charging, active: view.active };
      await shell.show(above + viewportHeight);
      // Juice: the badge pops and rings (looping while charging), the charge
      // lights up segment by segment (dim past a limit), then the rest rises.
      badge.pop(); badge.pulse(view.charging);
      if (meter) await meter.set(view.percent, reading(view), true, { charging: view.charging, limit: view.limit });
      [...details.rows, ...chargeControls.map(control => control.id), ...(modes ? [modes] : []), ...(limitation ? [limitation] : [])]
        .forEach((id, index) => shell.play(id, presets.rise(index)));
    } catch (reason) { popup = undefined; await shell.destroy(); throw reason; }
  };
  const paint = async () => {
    if (!placement || disposed) return;
    const view = powerView(state);
    if (!popup || popup.shape !== shape(view)) {
      await destroy();
      if (!placement || disposed) return;
      await build(view, placement);
    }
    const { win } = popup.shell;
    // Charging started or stopped: the ring follows. A new mode pops.
    if (view.charging !== popup.charging) { popup.charging = view.charging; popup.badge.pulse(view.charging); }
    if (view.active !== popup.active) {
      popup.active = view.active;
      const chosen = popup.buttons.find(button => button.profile === view.active);
      if (chosen) popup.shell.play(chosen.id, presets.pop(0, 0.9));
    }
    await Promise.all([
      ...(popup.meter && view.percent !== null ? [popup.meter.set(view.percent, reading(view), false, { charging: view.charging, limit: view.limit })] : []),
      UI.setTextString(win, popup.title.heading, view.title), UI.setTextString(win, popup.title.caption, view.status),
      popup.title.setDot(view.health), popup.badge.setGlyph(texture(view.icon)), popup.details.set(view.details.map(row => row.value)),
      ...popup.buttons.flatMap(button => [
        UI.setHitTarget(win, button.id, !busy),
        UI.setBoxColour(win, button.id, button.profile === view.active ? SURFACE.accent : SURFACE.control),
        UI.setTextColour(win, button.labelId, busy ? TEXT.secondary : button.profile === view.active ? TEXT.onAccent : TEXT.primary)
      ]),
      ...popup.chargeControls.flatMap(control => {
        const current = view.chargeControls.find(item => item.path === control.path);
        const applying = chargePath === control.path, failed = chargeError && chargeErrorPath === control.path;
        // The slider wakes with the switch and rests faded while it is off.
        const live = applying ? chargeTarget : current.enabled;
        if (control.slider && live !== control.live) { control.live = live; popup.shell.play(control.slider.id, presets.fade(live ? 1 : 0.35)); }
        return [...(control.slider ? [control.slider.set(current.enabled ? current.end : state.FrameworkChargeLimit || 80)] : []), control.switchControl.set(applying ? chargeTarget : current.enabled), UI.setHitTarget(win, control.switchControl.id, !busy),
          UI.setTextString(win, control.title, current.title),
          UI.setTextString(win, control.range, failed ? chargeError : control.adjustable ? (current.enabled ? '' : 'Off') : current.range),
          UI.setTextColour(win, control.range, failed ? TEXT.accent : TEXT.secondary),
          applying ? control.spinner.start() : control.spinner.stop()];
      }),
      ...(popup.modeCaption ? [UI.setTextString(win, popup.modeCaption, error || 'Power mode'),
        UI.setTextColour(win, popup.modeCaption, error ? TEXT.accent : TEXT.secondary)] : []),
      ...(popup.limitation ? [UI.setTextString(win, popup.limitation, view.degraded)] : [])
    ]);
  };
  return {
    toggle: (display, anchor) => {
      const token = ++request;
      return enqueue(async () => {
        if (disposed || token !== request) return;
        if (popup) { placement = undefined; await destroy(); return; }
        if (!state.Active || state.ScreenState !== 'unlocked' || !state.BatteryPresent) return;
        error = ''; chargeError = ''; placement = { display, anchor }; await paint();
        if (token !== request) await destroy();
      });
    }, close,
    onState: value => {
      state = value;
      if (!state.Active || state.ScreenState !== 'unlocked' || !state.BatteryPresent) return close();
      const key = JSON.stringify(powerView(state));
      if (key === previous) return Promise.resolve();
      previous = key; return enqueue(paint);
    },
    resize: close,
    dispose: () => { disposed = true; return close(); },
    get window() { return popup?.shell.win; }
  };
}
