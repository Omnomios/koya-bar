import * as UI from './theme-ui.js';
import * as Event from 'Helix/Event';
import { system } from 'Module/dbus';
import { createFingerprintService, fingerName, suggestedFinger, enrollPrompt } from './fingerprint-model.js';
import { KIT_METRICS } from './kit.js';
import { text, icon, pill, button } from './touch-ui.js';
import { haptic } from './haptics.js';
import { presets } from './motion.js';
import { SPACE, TYPE, TEXT, SURFACE, BADGE, MOTION, FONT, FONT_STRONG, alpha } from './theme.js';

// Fingerprints: the enrolled fingers as a list, each with Remove (tap twice),
// and Add… for a second page. There a finger is chosen by hand and name (the
// suggested one already picked, enrolled ones dimmed) and Scan starts the
// reader. While scanning, a large badge listens: it pops at each good touch
// as the meter lights a segment, shakes at a poor one and turns to a tick
// when the print is complete; the list then highlights the new finger.
const GLYPH = '/rom/assets/status/fingerprint.png', TICK = '/rom/assets/status/check.png';
const ROW = 44, ACTION_WIDTH = 88, CHIP = 36, SECTION = 32, SLOT = 120, DISC = 92;
const KINDS = [['thumb', 'Thumb'], ['index-finger', 'Index'], ['middle-finger', 'Middle'], ['ring-finger', 'Ring'], ['little-finger', 'Little']];
// Changed words arrive from just below.
const ARRIVE = [{ time: 0, opacity: 0, position: { x: 0, y: 5 } }, { time: MOTION.base, opacity: 1, position: { x: 0, y: 0 }, ease: MOTION.enter }];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const order = fingers => KINDS.flatMap(([kind]) => ['right', 'left'].map(side => side + '-' + kind)).filter(finger => fingers.includes(finger));

// `go(build, direction)` navigates within the host app. Each page owns its
// own reader connection; leaving a page cancels whatever it was doing.
// `bus` is the system bus (a stand-in when previewing without a reader).
export function fingerprintPages(frame, go, { bus = system } = {}) {
  let fresh = '';

  async function list() {
    const page = await frame.newPage(SPACE.m), win = frame.win, kit = frame.kit, width = frame.width;
    // The hero sits above the scrolling list, which clips: its badge's ring
    // swells past the slot when it pulses.
    const area = await kit.scrollArea({ width, height: frame.stageHeight - 24 - KIT_METRICS.badgeSlotSize - SPACE.m, gap: SPACE.s, id: 'fingerprints-content' });
    let addLabel, body, rows = new Map(), shape = '', shown = '', armed = '', armTimer, pending = false, rendering = Promise.resolve();
    const service = createFingerprintService(bus, { changed: state => render(state) });

    const hero = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: { x: width, y: KIT_METRICS.badgeSlotSize } } });
    const badge = await kit.badge({ glyph: GLYPH });
    const words = await kit.titleBlock({ title: 'Fingerprint reader', subtitle: 'Looking for the reader…', dot: 'off' });
    await Promise.all([UI.attach(win, hero, badge.id), UI.attach(win, hero, words.id)]);
    // Reading order made explicit (siblings sort by order, then creation).
    for (const [index, id] of [hero, area.id].entries()) { await UI.setLayoutOrder(win, id, index); await UI.attach(win, page.el, id); }
    const header = await frame.section(area.content, 'Enrolled', ACTION_WIDTH, () => pill(win, null, 'Add…', ACTION_WIDTH, addFinger,
      { height: 28, onLabel: id => { addLabel = id; } }));
    await UI.setElementId(win, header.extra, 'fingerprints-add');

    function addFinger() {
      const state = service.state;
      if (pending || state.busy) return;
      if (!state.available) { service.refresh(); return; }
      if (!suggestedFinger(state.fingers)) { frame.flash('Every finger is enrolled', TEXT.secondary); return; }
      go(add, 1);
    }
    // Remove asks once more on the same button, and forgets after a moment.
    const paintArmed = (row, on) => row && Promise.all([UI.setTextString(win, row.label, on ? 'Remove?' : 'Remove'),
      UI.setBoxColour(win, row.remove, on ? SURFACE.accent : SURFACE.control), UI.setTextColour(win, row.label, on ? TEXT.onAccent : TEXT.primary)]).catch(() => {});
    const arm = finger => {
      clearTimeout(armTimer);
      if (armed) paintArmed(rows.get(armed), false);
      armed = finger;
      if (!finger) return;
      paintArmed(rows.get(finger), true); kit.play(rows.get(finger).remove, presets.bump()); haptic();
      armTimer = setTimeout(() => arm(''), 3000);
    };
    const removeFinger = async finger => {
      if (pending || service.state.busy) return;
      if (armed !== finger) { arm(finger); return; }
      arm(''); pending = true;
      try {
        // Claiming the reader may ask for authorization in a normal window.
        await frame.suspend();
        if (page.alive) await service.remove(finger);
      } finally { pending = false; await frame.resume(); }
    };
    const fingerRow = async (parent, finger) => {
      const line = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.m }, item: { size: { x: 'auto', y: ROW } } });
      let label;
      await icon(win, line, GLYPH, 16, 20, ROW);
      const name = await text(win, line, fingerName(finger), TYPE.body, 'auto', ROW, TEXT.primary, FONT, 'left');
      await UI.setGrow(win, name, 1);
      const remove = await pill(win, line, 'Remove', ACTION_WIDTH, () => removeFinger(finger), { height: 28, onLabel: id => { label = id; } });
      await Promise.all([UI.attach(win, parent, line), UI.setElementId(win, remove, 'fingerprint-remove-' + finger)]);
      return { line, name, remove, label };
    };
    // The list rebuilds only when its shape changes.
    const buildBody = async state => {
      if (body) { await UI.destroyElement(win, body); page.items = page.items.filter(id => id !== body); }
      rows = new Map(); armed = '';
      let height;
      if (!state.available || !state.fingers.length) {
        const message = state.available ? 'Add a finger to unlock with a touch' : state.busy ? '' : state.message || 'No fingerprint reader available';
        const empty = await kit.emptyState({ glyph: GLYPH, message, width });
        body = empty.id; height = empty.height;
      } else {
        height = state.fingers.length * ROW + SPACE.s * 2;
        const surface = await kit.surface('inset', { size: { x: width, y: height }, layout: { type: 'column' },
          padding: { t: SPACE.s, r: SPACE.m, b: SPACE.s, l: SPACE.m } });
        body = surface.id;
        for (const finger of order(state.fingers)) rows.set(finger, await fingerRow(surface.content, finger));
      }
      await UI.attach(win, area.content, body);
      await area.setContentHeight(SECTION + height + SPACE.s);
    };
    const subtitle = state => !state.available ? (state.busy ? 'Looking for the reader…' : 'Unavailable')
      : !state.fingers.length ? 'No fingerprints yet' : state.fingers.length + ' enrolled · unlocks with a touch';
    const render = state => {
      rendering = rendering.then(async () => {
        if (!page.alive) return;
        const count = state.fingers.length, looking = state.busy && !state.available;
        await Promise.all([
          UI.setTextString(win, words.heading, state.name || 'Fingerprint reader'),
          UI.setTextString(win, words.caption, subtitle(state)),
          words.setDot(!state.available && !state.busy ? 'warn' : count ? 'good' : 'off'),
          UI.setTextString(win, addLabel, !state.available && !state.busy ? 'Retry' : 'Add…'),
          UI.setHitTarget(win, header.extra, !state.busy && !pending)
        ]);
        badge.pulse(looking);
        if (state.message && state.message !== shown && state.available) frame.flash(state.message, /removed/.test(state.message) ? TEXT.secondary : TEXT.accent);
        shown = state.message;
        const next = JSON.stringify([state.available, looking, order(state.fingers), state.available ? '' : state.message]);
        if (next === shape) return;
        const first = !shape; shape = next;
        // A removed finger slides away before the list closes up.
        const gone = [...rows].filter(([finger]) => !state.fingers.includes(finger));
        gone.forEach(([, row]) => kit.play(row.line, presets.leave()));
        if (gone.length) await pause(180);
        await buildBody(state);
        if (first) page.items.push(body);
        else frame.rise(body, 0);
        if (fresh && rows.has(fresh)) {
          // Just added: the row lifts and its name glows for a moment.
          const row = rows.get(fresh); fresh = '';
          await UI.setTextColour(win, row.name, TEXT.accent);
          setTimeout(() => { frame.punch(row.line, 1.03); UI.setTextColour(win, row.name, TEXT.primary).catch(() => {}); }, 900);
        }
      }).catch(() => {});
    };
    page.items.push(hero, header.line);
    page.dispose = async () => { page.alive = false; clearTimeout(armTimer); await service.dispose(); await rendering; };
    // Show the page at once, looking; the list arrives when the reader answers.
    service.refresh();
    await rendering;
    return page;
  }

  async function add() {
    const page = await frame.newPage(SPACE.m), win = frame.win, kit = frame.kit, width = frame.width;
    page.back = list;
    const service = createFingerprintService(bus, { changed: state => render(state) });
    let hand = 'right', finger = '', mode = 'choose', started = false, events = 0, completed = 0, meter, scanLabel, heading = '', notice = '', seen = '';
    let rendering = Promise.resolve();
    const flash = alpha(SURFACE.accent, 0.5);

    // Choosing: a hand, a finger and Scan.
    const chooserHeight = SECTION * 2 + CHIP * 2 + 24 + 44 + SPACE.s * 5;
    const chooser = await UI.createElement(win, { layout: { type: 'column', gap: SPACE.s }, item: { size: { x: width, y: chooserHeight } } });
    const chips = async (count, labels, choose) => {
      const line = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.s }, item: { size: { x: width, y: CHIP } } });
      const each = (width - SPACE.s * (count - 1)) / count, built = [];
      for (const [key, label] of labels) {
        const chip = { key };
        chip.id = await pill(win, line, label, each, () => choose(key), { height: CHIP, onLabel: id => { chip.label = id; } });
        built.push(chip);
      }
      await UI.attach(win, chooser, line);
      return built;
    };
    await frame.section(chooser, 'Hand');
    const hands = await chips(2, [['left', 'Left hand'], ['right', 'Right hand']], side => {
      if (hand === side) return;
      hand = side; haptic();
      if (!finger.startsWith(side + '-')) finger = suggestedFinger(service.state.fingers, side);
      kit.play(hands.find(chip => chip.key === side).id, presets.bump());
      setNotice(''); paintChooser();
    });
    await frame.section(chooser, 'Finger');
    const kinds = await chips(5, KINDS, kind => {
      if (finger === hand + '-' + kind) return;
      finger = hand + '-' + kind; haptic();
      kit.play(kinds.find(chip => chip.key === kind).id, presets.bump());
      setNotice(''); paintChooser();
    });
    const hint = await text(win, chooser, '', TYPE.caption, width, 24, TEXT.accent);
    const scan = await button(win, chooser, 'Scan', width, 44, () => start(), { colour: SURFACE.accent, labelColour: TEXT.onAccent, size: TYPE.body,
      onLabel: id => { scanLabel = id; } });
    await UI.setElementId(win, scan, 'fingerprint-scan');

    // Scanning: the badge, what to do next, the finger and the meter.
    const sessionHeight = SLOT + 36 + 20 + KIT_METRICS.meterHeight + 36 + SPACE.s * 4 + SPACE.m;
    const session = await UI.createElement(win, { layout: { type: 'column', gap: SPACE.s }, item: { size: { x: width, y: sessionHeight } } });
    const centred = async (child, height) => {
      const line = await UI.createElement(win, { layout: { type: 'row', justifyContent: 'center' }, item: { size: { x: width, y: height } } });
      await UI.attach(win, line, child); await UI.attach(win, session, line);
      return line;
    };
    const margin = (SLOT - DISC) / 2, inset = { item: { size: { x: 'auto', y: 'auto' }, margin: { t: margin, r: margin, b: margin, l: margin } }, contentAlign: 'fill' };
    const [slot, ring, disc] = await Promise.all([
      UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: SLOT, y: SLOT } } }),
      UI.createElement(win, { renderable: { type: 'box', colour: BADGE.goodRing, cornerRadius: DISC / 2, cornerResolution: 48, origin: { x: 0.5, y: 0.5 } }, ...inset }),
      UI.createElement(win, { renderable: { type: 'box', colour: BADGE.goodDisc, cornerRadius: DISC / 2, cornerResolution: 48, origin: { x: 0.5, y: 0.5 } },
        layout: { type: 'none' }, ...inset })
    ]);
    const glyph = await icon(win, disc, GLYPH, 48, 'auto', 'auto');
    await Promise.all([UI.attach(win, slot, ring), UI.attach(win, slot, disc)]);
    await centred(slot, SLOT);
    const title = await text(win, session, '', TYPE.title, width, 36, TEXT.primary, FONT_STRONG);
    const caption = await text(win, session, '', TYPE.caption, width, 20, TEXT.secondary);
    const gauge = await UI.createElement(win, { layout: { type: 'column' }, item: { size: { x: width, y: KIT_METRICS.meterHeight } } });
    await UI.attach(win, session, gauge);
    const cancel = await pill(win, null, 'Cancel', 112, () => service.cancel(), { height: 32 });
    const cancelLine = await centred(cancel, 36);
    await UI.setElementId(win, cancel, 'fingerprint-cancel');
    await UI.setMargin(win, cancelLine, { t: SPACE.m - SPACE.s, r: 0, b: 0, l: 0 });
    await Promise.all([UI.attach(win, page.el, chooser), UI.attach(win, page.el, session), UI.setEnabled(win, session, false),
      UI.setElementId(win, title, 'fingerprint-prompt'), kit.play(ring, [{ time: 0, opacity: 0 }])]);

    const setNotice = value => {
      if (value === notice) return;
      notice = value;
      UI.setTextString(win, hint, value).then(() => value && kit.play(hint, ARRIVE)).catch(() => {});
    };
    const setHeading = async (value, tone = 'info') => {
      await UI.setTextColour(win, title, tone === 'error' ? TEXT.accent : TEXT.primary);
      if (value === heading) return;
      heading = value;
      await UI.setTextString(win, title, value);
      kit.play(title, ARRIVE);
    };
    const look = (chip, state) => Promise.all([
      UI.setBoxColour(win, chip.id, state === 'on' ? SURFACE.accent : SURFACE.control),
      UI.setTextColour(win, chip.label, state === 'on' ? TEXT.onAccent : state === 'off' ? TEXT.disabled : TEXT.primary),
      UI.setHitTarget(win, chip.id, state !== 'off')]);
    const paintChooser = () => {
      const state = service.state, ready = state.available && !state.busy && !!finger;
      return Promise.all([
        ...hands.map(chip => look(chip, chip.key === hand ? 'on' : 'rest')),
        ...kinds.map(chip => {
          const name = hand + '-' + chip.key;
          return look(chip, state.fingers.includes(name) ? 'off' : name === finger ? 'on' : 'rest');
        }),
        UI.setTextString(win, scanLabel, !state.available ? (state.busy ? 'Looking for the reader…' : 'Reader unavailable')
          : finger ? 'Scan ' + fingerName(finger).toLowerCase() : 'This hand is done'),
        UI.setBoxColour(win, scan, ready ? SURFACE.accent : SURFACE.control),
        UI.setTextColour(win, scanLabel, ready ? TEXT.onAccent : TEXT.disabled),
        UI.setHitTarget(win, scan, ready)
      ]).catch(() => {});
    };
    const showView = async which => {
      const scanning = which === 'session';
      await Promise.all([UI.setEnabled(win, chooser, !scanning), UI.setEnabled(win, session, scanning)]);
      frame.rise(scanning ? session : chooser, 0);
    };

    async function start() {
      const state = service.state;
      if (mode !== 'choose' || !finger || !state.available || state.busy) return;
      mode = 'enrolling'; started = false; completed = 0; events = state.events; heading = '';
      haptic();
      if (meter) await UI.destroyElement(win, meter.id);
      meter = await kit.meter({ label: 'Scans', width, segments: Math.min(state.stages, 20) });
      await UI.attach(win, gauge, meter.id);
      await Promise.all([setHeading('Getting ready…'), UI.setTextString(win, caption, fingerName(finger)), UI.setTexture(win, glyph, GLYPH),
        UI.setBoxColour(win, disc, BADGE.goodDisc), UI.setHitTarget(win, cancel, true), showView('session')]);
      kit.play(cancel, presets.fade(1));
      kit.play(ring, presets.pulse(true));
      try {
        // Claiming the reader may ask for authorization in a normal window.
        await frame.suspend();
        if (page.alive) await service.enroll(finger);
      } catch (_) {}
      finally { await frame.resume(); }
      started = true;
      render(service.state);
    }
    const progress = state => {
      haptic();
      const percent = completed * 100 / Math.max(1, state.stages);
      meter.set(percent, completed + ' of ' + state.stages, true, { charging: completed < state.stages });
      kit.play(disc, presets.pop(0, 0.8));
    };
    const retry = () => {
      kit.play(slot, presets.shake());
      UI.setBoxColour(win, disc, flash).catch(() => {});
      setTimeout(() => { if (mode === 'enrolling') UI.setBoxColour(win, disc, BADGE.goodDisc).catch(() => {}); }, 450);
    };
    const done = async state => {
      mode = 'done'; fresh = finger; haptic();
      meter.set(100, state.stages + ' of ' + state.stages, completed < state.stages);
      kit.play(ring, presets.pulse(false));
      // Nothing left to cancel.
      kit.play(cancel, presets.fade(0)); await UI.setHitTarget(win, cancel, false);
      await Promise.all([setHeading('Fingerprint added'), UI.setTexture(win, glyph, TICK)]);
      kit.play(disc, presets.pop(0, 0.5));
      setTimeout(() => { if (page.alive && frame.current === page) go(list, -1); }, 1300);
    };
    const fail = async message => {
      mode = 'choose';
      kit.play(ring, presets.fade(0));
      // Usually the same finger can be tried again; a duplicate needs another.
      finger = service.state.fingers.includes(finger) || /already registered/.test(message) ? suggestedFinger([...service.state.fingers, finger], hand) : finger;
      await showView('chooser');
      seen = message; setNotice(message);
      if (message) kit.play(hint, presets.shake());
      await paintChooser();
    };

    const render = state => {
      rendering = rendering.then(async () => {
        if (!page.alive) return;
        if (mode === 'choose') {
          if (!finger && state.available && !state.busy) {
            finger = suggestedFinger(state.fingers);
            hand = finger.split('-')[0] || hand;
          }
          // Later news from the reader (a timeout after a cancel, an error).
          if (state.message !== seen && !state.busy) { seen = state.message; setNotice(state.message); }
          return paintChooser();
        }
        if (mode !== 'enrolling') return;
        const reported = state.events > events, advanced = state.completed > completed;
        events = state.events;
        if (advanced) { completed = state.completed; progress(state); }
        else if (reported && state.message !== 'Fingerprint added') retry();
        if (state.busy || state.enrolling) return setHeading(enrollPrompt(state.message), reported && !advanced ? 'error' : 'info');
        if (!started) return;
        if (state.fingers.includes(finger)) return done(state);
        return fail(state.message);
      }).catch(() => {});
    };
    // Enter scans the chosen finger.
    const key = event => { if (event.id === win && [28, 65293].includes(Number(event.key))) start(); };
    Event.on('keyDown', key);
    page.scan = start;
    page.items.push(chooser);
    page.dispose = async () => { page.alive = false; Event.off('keyDown', key); await service.dispose(); await rendering; };
    service.refresh();
    return page;
  }

  async function available() {
    const reader = createFingerprintService(bus);
    try { await reader.refresh(); return reader.state.available; }
    finally { await reader.dispose(); }
  }
  return { list, add, available };
}
