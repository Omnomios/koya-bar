import * as UI from './theme-ui.js';
import * as Log from 'Helix/Log';
import { MOTION } from './theme.js';

// Positive-time first keys let Koya capture the current value at t=0. A new
// gesture can interrupt a clip without jumping back to an authored start pose.
export async function clips(win, element, definitions) {
  const entries = Object.entries(definitions);
  const animations = await Promise.all(entries.map(([, frames]) => UI.addAnimation(win, element, frames)));
  const ids = Object.fromEntries(entries.map(([name], index) => [name, animations[index]]));
  return {
    ids,
    play: name => UI.startAnimation(win, element, ids[name]),
    onEnd: (name, callback) => UI.onAnimationEnd(win, element, ids[name], callback)
  };
}

export async function buttonMotion(win, element, side, index) {
  // `side` is a square's edge or a { x, y } size. Centre the visual scale;
  // layout and its hit-test bounds remain unchanged.
  const size = typeof side === 'number' ? { x: side, y: side } : side;
  const pose = (scale = 1, y = 0, x = 0) => ({
    scale: { x: scale, y: scale },
    position: { x: size.x * (1 - scale) / 2 + x, y: size.y * (1 - scale) / 2 + y }
  });
  const delay = index * 0.055;
  const start = { opacity: 0, ...pose(0.98, Math.min(size.x, size.y) * 0.1125) };
  return clips(win, element, {
    enter: [
      { time: 0, ...start },
      ...(delay ? [{ time: delay, ...start }] : []),
      { time: delay + 0.32, opacity: 1, ...pose(), ease: 'outCubic' }
    ],
    press: [{ time: 0.075, opacity: 1, ...pose(0.95, 3), ease: 'outQuad' }],
    release: [
      { time: 0.105, opacity: 1, ...pose(1.018, -2), ease: 'outCubic' },
      { time: 0.26, opacity: 1, ...pose(), ease: 'outCubic' }
    ],
    settle: [{ time: 0.14, opacity: 1, ...pose(), ease: 'outCubic' }],
    focus: [{ time: 0.14, opacity: 1, ...pose(1.018), ease: 'outCubic' }],
    notice: [
      { time: 0.055, opacity: 1, ...pose(1, 0, -6), ease: 'outQuad' },
      { time: 0.12, opacity: 1, ...pose(1, 0, 5), ease: 'inOutQuad' },
      { time: 0.19, opacity: 1, ...pose(1, 0, -2), ease: 'inOutQuad' },
      { time: 0.27, opacity: 1, ...pose(), ease: 'outCubic' }
    ]
  });
}

// One reusable clip per element. Koya runs one animation per element at a
// time; a clip without a t:0 key starts from the element's current pose, so
// a new effect hands off from the last without snapping. Returns a play
// function that never rejects (motion is decoration; failures are logged).
export function animator(win, name = 'Motion') {
  const clipsOf = new Map();
  return (id, frames) => {
    const previous = clipsOf.get(id);
    const job = (async () => {
      const clip = previous && await previous;
      if (clip !== undefined && await UI.updateAnimation(win, id, clip, frames)) { await UI.startAnimation(win, id, clip); return clip; }
      const created = await UI.addAnimation(win, id, frames);
      await UI.startAnimation(win, id, created);
      return created;
    })();
    clipsOf.set(id, job.catch(() => undefined));
    return job.catch(error => Log.error(name + ': ' + error));
  };
}

// Standard frames. Positions are visual offsets that come to rest at zero, so
// layout always owns where things finally sit.
export const presets = {
  // A popover arriving from the bar above it: falls a little, fades and grows.
  dropIn: () => [{ time: 0, opacity: 0, position: { x: 0, y: -MOTION.drop }, scale: { x: 0.97, y: 0.97 } },
    { time: MOTION.base, opacity: 1, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, ease: MOTION.enter }],
  // A row arriving in a staggered list.
  rise: (index = 0, delay = 0.1) => {
    const start = delay + index * MOTION.stagger;
    return [{ time: 0, opacity: 0, position: { x: 0, y: MOTION.rise } }, { time: start, opacity: 0, position: { x: 0, y: MOTION.rise } },
      { time: start + MOTION.base, opacity: 1, position: { x: 0, y: 0 }, ease: MOTION.enter }];
  },
  // Leaving towards `x` (a dismissed card slides aside).
  leave: (x = 28) => [{ time: MOTION.fast + 0.04, opacity: 0, position: { x, y: 0 }, ease: MOTION.exit }],
  // A small grow-and-settle for something that just appeared or changed.
  pop: (delay = 0.05, from = 0.4) => [{ time: 0, scale: { x: from, y: from } }, { time: delay, scale: { x: from, y: from } },
    { time: delay + 0.17, scale: { x: 1.14, y: 1.14 }, ease: MOTION.enter }, { time: delay + 0.31, scale: { x: 1, y: 1 }, ease: MOTION.settle }],
  // A brief nudge when something is acknowledged (a copied value).
  bump: () => [{ time: 0.07, scale: { x: 1.03, y: 1.03 }, ease: 'outQuad' }, { time: MOTION.base, scale: { x: 1, y: 1 }, ease: MOTION.enter }],
  // A ring that swells out and fades; loops while something is in progress.
  pulse: (loop = false) => {
    const frames = [{ time: 0, scale: { x: 1, y: 1 }, opacity: 0 }, { time: 0.12, scale: { x: 1, y: 1 }, opacity: 0.9 },
      { time: 0.9, scale: { x: 1.7, y: 1.7 }, opacity: 0, ease: MOTION.enter }];
    return loop ? [...frames, { time: 1.3, scale: { x: 1.7, y: 1.7 }, opacity: 0, looping: true }] : frames;
  },
  // A meter segment lighting in turn.
  light: (index, opacity = 1) => [{ time: 0, scale: { x: 1, y: 0.2 }, opacity: 0.3 }, { time: 0.16 + index * 0.06, scale: { x: 1, y: 0.2 }, opacity: 0.3 },
    { time: 0.28 + index * 0.06, scale: { x: 1, y: 1.6 }, opacity, ease: MOTION.enter }, { time: 0.4 + index * 0.06, scale: { x: 1, y: 1 }, opacity, ease: MOTION.settle }],
  // Fade from the current pose to `opacity`, later by `delay` (a staggered run).
  fade: (opacity, delay = 0) => [{ time: delay + MOTION.base, opacity, ease: MOTION.enter }],
  // A slow looping breath for something in progress (a segment charging).
  breathe: () => [{ time: 0, opacity: 0.25 }, { time: 0.7, opacity: 1, ease: MOTION.settle }, { time: 1.4, opacity: 0.25, ease: MOTION.settle, looping: true }],
  // Back to steady after a breath.
  steady: () => [{ time: MOTION.fast, opacity: 1, ease: MOTION.enter }],
  // A refusal (a wrong password): a short side-to-side shake to rest.
  shake: () => [-9, 8, -5, 3, 0].map((x, i) => ({ time: 0.05 * (i + 1), position: { x, y: 0 }, ease: MOTION.settle })),
  // Glide in from a measured offset to rest.
  glide: from => [{ time: 0, position: { x: from.x || 0, y: from.y || 0 } }, { time: MOTION.base + 0.02, position: { x: 0, y: 0 }, ease: MOTION.enter }]
};
