import * as UI from 'Helix/UserInterface';
import { FONT, FONT_STRONG, CREAM, CLEAR, CARD, TONAL, TRACK, ORANGE, RADIUS, TYPE, HEADER_HEIGHT, TOUCH } from './theme.js';
import { clips } from './motion.js';
import { haptic } from './haptics.js';
import { pressFeedback } from './input-model.js';
import { controlCursor } from './cursor.js';

// Build siblings concurrently, then enqueue attachments in their authored order.
// Pass null as a helper's parent when preparing a child for this batch.
export async function children(win, parent, pending) {
  const ids = await Promise.all(pending);
  await Promise.all(ids.map(id => UI.attach(win, parent, id)));
  return ids;
}

// contentAlign places the text's bounds in its slot. With the default 'ink'
// basis those bounds are the tight glyph box, which changes with every string
// (ascenders, descenders, width), so labels jump when their text changes.
// 'line' uses the font's stable line box instead.
export async function text(win, parent, value, size, width, height, colour = CREAM, font = FONT, justify = 'center') {
  const align = { left: 'start', center: 'center', right: 'end' }[justify];
  const id = await UI.createElement(win, {
    renderable: { type: 'text', string: value, size, font, colour, justify, vAlign: 'center', metricsBasis: 'line' },
    item: { size: { x: width, y: height } }, contentAlign: { x: align, y: 'center' }
  });
  if (parent != null) await UI.attach(win, parent, id);
  return id;
}

// Start-aligned, clipped and word-wrapped: row titles, captions and body copy.
// Fluid labels inherit their reflow box from the layout bounds.
export async function label(win, parent, value, size, width, height, colour = CREAM, font = FONT) {
  const fluid = width === 'auto' || width === 0;
  const id = await UI.createElement(win, {
    renderable: { type: 'text', string: value, size, font, colour, layoutMode: 'word-wrap', justify: 'left', vAlign: 'center',
      metricsBasis: 'line', ...(!fluid ? { aabb: { min: { x: 0, y: 0 }, max: { x: width, y: height } } } : {}) },
    item: { size: { x: width, y: height } }, contentAlign: fluid ? 'fill' : { x: 'start', y: 'center' }, clipToBounds: true
  });
  if (parent != null) await UI.attach(win, parent, id);
  return id;
}

export async function icon(win, parent, texture, size, width = size, height = size) {
  const id = await UI.createElement(win, {
    renderable: { type: 'sprite', texture, frame: 0,
      frames: [{ size: { x: size, y: size }, aabb: { min: { x: 0, y: 0 }, max: { x: 160, y: 160 } }, colour: [1,1,1,1] }] },
    item: { size: { x: width, y: height } }, contentAlign: { x: 'center', y: 'center' }
  });
  if (parent != null) await UI.attach(win, parent, id);
  return id;
}

export async function button(win, parent, label, width, height, handler, options = {}) {
  let motion;
  let waiting = false;
  const id = await UI.createElement(win, {
    renderable: { ...(options.renderable || { type: 'box', colour: options.colour || [0,0,0,0], cornerRadius: options.radius ?? RADIUS.control, cornerResolution: 32 }),
      origin: { x: 0.5, y: 0.5 } },
    layout: { type: 'column', justifyContent: 'center', alignItems: 'center', gap: options.gap ?? 8 },
    item: { size: { x: width, y: height } }, contentAlign: 'fill', inheritAnimation: true,
    // These option hooks provide visual feedback only; actions use onActivate.
    onPress: pressFeedback({
      start: event => { haptic(); if (!waiting) motion?.play('press'); options.onPress?.(event); },
      end: event => { if (!waiting) motion?.play('release'); options.onRelease?.(event); },
      cancel: event => { if (!waiting) motion?.play('settle'); options.onRelease?.(event); }
    }),
    onActivate: handler, onHover: controlCursor(win, options.cursor || 'pointer')
  });
  const pose = scale => ({ scale: { x: scale, y: scale } });
  const bounce = options.feedbackMotion || { squash: 0.95, peak: 1.04, lift: 3 };
  const [feedback] = await Promise.all([
    clips(win, id, {
      press: [{ time: 0.07, ...pose(options.pressScale ?? 0.95), ease: 'outQuad' }],
      release: [{ time: 0.09, ...pose(options.releaseScale ?? 1.02), ease: 'outCubic' }, { time: 0.23, ...pose(1), ease: 'outCubic' }],
      settle: [{ time: 0.14, ...pose(1), position: { x: 0, y: 0 }, ease: 'outCubic' }],
      ...(options.onFeedback ? { waiting: [
        { time: 0, ...pose(1), position: { x: 0, y: 0 } },
        { time: 0.08, ...pose(bounce.squash), position: { x: 0, y: 2 }, ease: 'outQuad' },
        { time: 0.23, ...pose(bounce.peak), position: { x: 0, y: -bounce.lift }, ease: 'outCubic' },
        { time: 0.54, ...pose(1), position: { x: 0, y: 0 }, ease: 'outCubic' },
        { time: 0.68, ...pose(1), position: { x: 0, y: 0 }, looping: true }
      ] } : {})
    }),
    ...(parent != null ? [UI.attach(win, parent, id)] : []),
    children(win, id, [
      ...(options.icon ? [icon(win, null, options.icon, options.iconSize || 72, width, options.iconSize || 72)
        .then(glyph => { options.onIcon?.(glyph); return glyph; })] : []),
      ...(label ? [text(win, null, label, options.size || TYPE.body, width, options.labelHeight || 24,
        options.labelColour || options.accent || CREAM, options.font)
        .then(labelId => { options.onLabel?.(labelId); return labelId; })] : [])
    ])
  ]);
  motion = feedback;
  options.onFeedback?.({
    begin: () => { waiting = true; return motion.play('waiting'); },
    end: () => { waiting = false; return motion.play('settle'); }
  });
  return id;
}

// Every sheet starts with the same header: a title on the left and square
// icon actions on the right, so close buttons land in the same place.
// Custom action/accessory builders receive null and return a detached id.
export async function sheetHeader(win, parent, title, width, actions = [], accessory) {
  const row = await UI.createElement(win, {
    layout: { type: 'row', alignItems: 'center' }, item: { size: { x: 'auto', y: HEADER_HEIGHT } }
  });
  const [heading, ...extras] = await children(win, row, [
    label(win, null, title, TYPE.title, 0, HEADER_HEIGHT).then(async id => { await UI.setGrow(win, id, 1); return id; }),
    ...(accessory ? [accessory.build(null)] : []),
    ...actions.map(action => action.build ? action.build(null)
      : button(win, null, '', action.width || TOUCH, HEADER_HEIGHT, action.handler,
        { colour: CLEAR, icon: action.icon, iconSize: action.iconSize || 16 }))
  ]);
  if (parent != null) await UI.attach(win, parent, row);
  const buttons = accessory ? extras.slice(1) : extras;
  return { row, heading, buttons };
}

// A full-width tappable row (settings tiles, list entries) with the same
// press response as buttons. Children are laid out left to right.
// onPress/onRelease let callers add secondary motion (a chevron nudge).
export async function row(win, parent, width, height, handler, options = {}) {
  let motion;
  const id = await UI.createElement(win, {
    renderable: { type: 'box', colour: options.colour || CARD, cornerRadius: options.radius ?? RADIUS.surface, cornerResolution: 16, origin: { x: 0.5, y: 0.5 } },
    layout: { type: 'row', alignItems: 'center', gap: options.gap ?? 12, padding: { l: 12, r: options.right ?? 8, t: 0, b: 0 } },
    item: { size: { x: width, y: height } }, contentAlign: 'fill', inheritAnimation: true,
    onPress: pressFeedback({
      start: event => { haptic(); motion?.play('press'); options.onPress?.(event); },
      end: event => { motion?.play('release'); options.onRelease?.(event); },
      cancel: event => { motion?.play('settle'); options.onRelease?.(event); }
    }),
    onActivate: handler, onHover: controlCursor(win, options.cursor || 'pointer')
  });
  // Press frames also restore opacity and offset, so tapping a row during its
  // entrance cannot leave it half-faded or displaced.
  const rest = { opacity: 1, position: { x: 0, y: 0 } };
  [motion] = await Promise.all([clips(win, id, {
    press: [{ time: 0.07, ...rest, scale: { x: 0.97, y: 0.97 }, ease: 'outQuad' }],
    release: [{ time: 0.11, ...rest, scale: { x: 1.012, y: 1.012 }, ease: 'outCubic' }, { time: 0.26, ...rest, scale: { x: 1, y: 1 }, ease: 'inOutQuad' }],
    settle: [{ time: 0.14, ...rest, scale: { x: 1, y: 1 }, ease: 'outCubic' }]
  }), ...(parent != null ? [UI.attach(win, parent, id)] : [])]);
  return id;
}

// Secondary actions: a quiet filled pill that reads as tappable without
// competing with the content around it.
export function pill(win, parent, value, width, handler, options = {}) {
  const height = options.height || TOUCH;
  // Semibold labels hold up against the tonal fill at caption size.
  return button(win, parent, value, width, height, handler, {
    colour: options.colour || TONAL, radius: RADIUS.control, size: options.size || TYPE.caption + 1,
    labelHeight: height, labelColour: options.labelColour || CREAM, font: FONT_STRONG, ...options
  });
}

// On/off switch. Returns a setter so callers can reflect external state.
// The knob stretches as it leaves, overshoots its stop and settles; the whole
// switch squashes under the finger.
export async function toggle(win, parent, on, handler) {
  const width = 40, height = 24, knob = 16, inset = (height - knob) / 2;
  let pop;
  const target = await UI.createElement(win, {
    // Invisible box: a bare container ignores its pivot when scaled.
    renderable: { type: 'box', colour: CLEAR, origin: { x: 0.5, y: 0.5 } },
    layout: { type: 'none' },
    item: { size: { x: width + 16, y: TOUCH } }, contentAlign: 'fill', inheritAnimation: true,
    onPress: pressFeedback({ start: () => { haptic(); pop?.play('press'); },
      end: () => pop?.play('release'), cancel: () => pop?.play('settle') }),
    onActivate: handler, onHover: controlCursor(win)
  });
  const [feedback, track, thumb] = await Promise.all([
    clips(win, target, {
      press: [{ time: 0.06, scale: { x: 0.88, y: 0.88 }, ease: 'outQuad' }],
      release: [{ time: 0.16, scale: { x: 1.08, y: 1.08 }, ease: 'outCubic' }, { time: 0.3, scale: { x: 1, y: 1 }, ease: 'inOutQuad' }],
      settle: [{ time: 0.14, scale: { x: 1, y: 1 }, ease: 'outCubic' }]
    }),
    UI.createElement(win, {
      // The one fully round control: a switch reads as a switch by its shape.
      renderable: { type: 'box', colour: on ? ORANGE : TRACK, cornerRadius: height / 2, cornerResolution: 32 },
      layout: { type: 'none' },
      item: { position: { x: 8, y: (TOUCH - height) / 2 }, size: { x: width, y: height } }, contentAlign: 'fill'
    }),
    UI.createElement(win, {
      renderable: { type: 'box', colour: CREAM, cornerRadius: knob / 2, cornerResolution: 32, origin: { x: 0.5, y: 0.5 } },
      item: { position: { x: inset, y: inset }, size: { x: knob, y: knob } }, contentAlign: 'fill'
    })
  ]);
  pop = feedback;
  const travel = width - 2 * inset - knob;
  const stretch = { x: 1.3, y: 0.8 }, round = { x: 1, y: 1 };
  const [motion] = await Promise.all([clips(win, thumb, {
    on: [{ time: 0.1, position: { x: travel + 3, y: 0 }, scale: stretch, ease: 'outCubic' },
      { time: 0.26, position: { x: travel, y: 0 }, scale: round, ease: 'outQuad' }],
    off: [{ time: 0.1, position: { x: -3, y: 0 }, scale: stretch, ease: 'outCubic' },
      { time: 0.26, position: { x: 0, y: 0 }, scale: round, ease: 'outQuad' }]
  }), UI.attach(win, target, track), UI.attach(win, track, thumb),
    ...(parent != null ? [UI.attach(win, parent, target)] : [])
  ]);
  // Animation positions are additive to setPosition(). Keep the static offset
  // at zero and hold the initial state on the same channel used by transitions.
  await UI.setAnimationTime(win, thumb, motion.ids[on ? 'on' : 'off'], 0.26);
  let current = on;
  const set = async value => {
    if (value === current) return;
    current = value;
    await Promise.all([UI.setBoxColour(win, track, value ? ORANGE : TRACK), motion.play(value ? 'on' : 'off')]);
  };
  return { id: target, set };
}

// Busy indicator: a ring of fine dots lit in turn, brightest at the head
// with a tail fading behind it. Each dot runs its own looping opacity clip
// with a phase offset, so nothing has to rotate. The ring is centred in a
// box `height` tall, so it lines up with text of that line height without
// relying on cross-axis alignment. Hidden until started.
export async function throbber(win, parent, size = 14, colour = CREAM, height = size) {
  const count = 12, dot = size / 6, radius = size / 2 - dot / 2, period = 0.9, dim = 0.12, top = (height - size) / 2;
  const id = await UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: size, y: height } } });
  const dots = await children(win, id, Array.from({ length: count }, (_, i) => {
    const angle = Math.PI * 2 * i / count - Math.PI / 2;
    return UI.createElement(win, {
      renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: dot, y: dot } }, resolution: 16, colour },
      item: { position: { x: size / 2 + radius * Math.cos(angle) - dot / 2, y: top + size / 2 + radius * Math.sin(angle) - dot / 2 }, size: { x: dot, y: dot } }
    });
  }));
  // Dot i is lit when the head reaches it at period * i / count, then fades
  // linearly until the head comes round again.
  const lit = age => 1 - (1 - dim) * age;
  const motions = await Promise.all(dots.map((dotId, i) => {
    const arrive = period * i / count, start = lit(i ? 1 - i / count : 0);
    return clips(win, dotId, {
      spin: i ? [{ time: 0, opacity: start }, { time: arrive - 0.001, opacity: dim }, { time: arrive, opacity: 1 }, { time: period, opacity: start, looping: true }]
        : [{ time: 0, opacity: 1 }, { time: period, opacity: dim, looping: true }],
      hide: [{ time: 0.15, opacity: 0, ease: 'outCubic' }],
      hidden: [{ time: 0, opacity: 0 }]
    });
  }));
  await Promise.all([UI.setHitTarget(win, id, false), ...dots.map(dotId => UI.setHitTarget(win, dotId, false)),
    ...motions.map(motion => motion.play('hidden')), ...(parent != null ? [UI.attach(win, parent, id)] : [])]);
  let running = false;
  const set = on => {
    if (on === running) return Promise.resolve();
    running = on;
    return Promise.all(motions.map(motion => motion.play(on ? 'spin' : 'hide')));
  };
  return { id, start: () => set(true), stop: () => set(false) };
}
