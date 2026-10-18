import * as UI from './theme-ui.js';
import * as Compositor from 'Koya/Compositor';
import * as Log from 'Helix/Log';
import { animator, presets } from './motion.js';
import { text, icon, pill, throbber } from './touch-ui.js';
import { controlCursor } from './cursor.js';
import { FONT, FONT_STRONG, TEXT, HEALTH, ELEVATION, CLEAR, AUTO, TYPE, SPACE, SURFACE, BADGE } from './theme.js';

// Components shared by Koya's surfaces, built on layout rather than
// positions: every element states its size (AUTO where layout decides),
// 'none' containers place children by filling them less margins, and flows
// place the rest. Each builder returns its element id plus the height it
// occupies, so a parent can size itself to its content.
export const KIT_METRICS = {
  headerHeight: 28, detailRowHeight: 26, detailPadding: 8, badgeSize: 44, badgeSlotSize: 52,
  meterHeight: 34, meterSegments: 5, emptyStateHeight: 120
};

export function createKit(win) {
  const play = animator(win, 'Kit');
  const element = options => UI.createElement(win, options);
  const fill = (extra = {}) => ({ item: { size: AUTO, ...extra } });

  // A surface at an elevation: the fill, its hairline edge and a content
  // container with the given layout, all filling the outer element.
  // Resolves to { id, content }.
  const surface = async (level, { id, size = AUTO, margin, layout = { type: 'column' }, padding } = {}) => {
    const spec = ELEVATION[level];
    // Requested together; ids follow request order, so the edge (created
    // before the content) draws beneath it.
    const [outer, edge, content] = await Promise.all([
      element({ ...(id ? { id } : {}), renderable: { type: 'box', colour: spec.surface, cornerRadius: spec.radius, cornerResolution: 16, origin: { x: 0.5, y: 0 } },
        layout: { type: 'none' }, item: { size, ...(margin ? { margin } : {}) }, contentAlign: 'fill' }),
      spec.edge ? element({ renderable: { type: 'box', colour: spec.edge, inset: 1, cornerRadius: spec.radius, cornerResolution: 16 },
        ...fill(), contentAlign: 'fill' }) : undefined,
      element({ layout: { ...layout, ...(padding ? { padding } : {}) }, ...fill() })
    ]);
    await Promise.all([...(edge ? [UI.attach(win, outer, edge), UI.setHitTarget(win, edge, false)] : []), UI.attach(win, outer, content)]);
    return { id: outer, content };
  };

  // Muted caption, an optional throbber right after it, and an optional
  // trailing action. setBusy shows the throbber and quietens the action.
  const sectionHeader = async ({ caption, action, busy = false } = {}) => {
    const row = await element({ layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: 'auto', y: KIT_METRICS.headerHeight } } });
    const label = await text(win, row, caption, TYPE.caption, 'auto', KIT_METRICS.headerHeight, TEXT.secondary, FONT, 'left');
    // Size the caption to its text, so the throbber sits right after it
    // (an 'auto' text width measures zero in a flow).
    const measured = await UI.measureText(win, label).catch(() => undefined);
    if (measured?.size?.x) await UI.setLayoutSize(win, label, { x: Math.ceil(measured.size.x) + 2, y: KIT_METRICS.headerHeight });
    const spinner = await throbber(win, row, 14, TEXT.primary, KIT_METRICS.headerHeight);
    const spacer = await element({ item: { size: AUTO, flexGrow: 1 } });
    await UI.attach(win, row, spacer);
    let actionId, actionLabel;
    if (action) {
      actionId = await pill(win, row, action.label, action.width || 88, () => !busyNow && action.onActivate(),
        { labelColour: TEXT.accent, height: KIT_METRICS.headerHeight, onLabel: id => { actionLabel = id; } });
      if (action.id) await UI.setElementId(win, actionId, action.id);
    }
    let busyNow = false;
    const setBusy = async on => {
      busyNow = on;
      await Promise.all([on ? spinner.start() : spinner.stop(), ...(actionLabel ? [UI.setTextColour(win, actionLabel, on ? TEXT.secondary : TEXT.accent)] : [])]);
    };
    if (busy) await setBusy(true);
    return { id: row, height: KIT_METRICS.headerHeight, label, action: actionId, setBusy };
  };

  // Key on the left, value on the right, in an inset card. Rows marked
  // `copy` copy their value on click and flash "Copied".
  const keyValue = async (rows, { keyWidth = 78 } = {}) => {
    const height = rows.length * KIT_METRICS.detailRowHeight + KIT_METRICS.detailPadding * 2;
    const card = await surface('inset', { size: { x: 'auto', y: height }, padding: { t: KIT_METRICS.detailPadding, r: SPACE.m, b: KIT_METRICS.detailPadding, l: SPACE.m } });
    const built = await Promise.all(rows.map(async row => {
      const line = await element({ renderable: { type: 'box', colour: CLEAR, origin: { x: 0.5, y: 0.5 } }, layout: { type: 'row', alignItems: 'center' },
        item: { size: { x: 'auto', y: KIT_METRICS.detailRowHeight } }, contentAlign: 'fill',
        ...(row.copy ? { onActivate: () => copy(entry), onHover: controlCursor(win) } : {}) });
      // Full row height: cross-axis alignment would only centre within the line.
      const [key, value] = await Promise.all([
        text(win, null, row.key, TYPE.caption, keyWidth, KIT_METRICS.detailRowHeight, TEXT.secondary, FONT, 'left'),
        text(win, null, row.value, TYPE.detail, 'auto', KIT_METRICS.detailRowHeight, TEXT.primary, FONT, 'right')
      ]);
      await Promise.all([UI.attach(win, line, key), UI.attach(win, line, value), UI.setGrow(win, value, 1)]);
      const entry = { line, value, current: row.value, timer: undefined };
      return entry;
    }));
    await Promise.all(built.map(entry => UI.attach(win, card.content, entry.line)));
    const copy = async entry => {
      try { await Compositor.setClipboardText(entry.current); } catch (error) { Log.error('Copy: ' + error); return; }
      clearTimeout(entry.timer);
      await Promise.all([UI.setTextString(win, entry.value, 'Copied'), UI.setTextColour(win, entry.value, TEXT.accent)]);
      play(entry.line, presets.bump());
      entry.timer = setTimeout(() => Promise.all([UI.setTextString(win, entry.value, entry.current),
        UI.setTextColour(win, entry.value, TEXT.primary)]).catch(() => {}), 1200);
    };
    // Update values in place (a copy flash finishes first).
    const set = values => Promise.all(values.map((value, index) => {
      const entry = built[index];
      if (!entry) return undefined;
      entry.current = value;
      return entry.timer ? undefined : UI.setTextString(win, entry.value, value);
    }));
    return { id: card.id, height, set, rows: built.map(entry => entry.line), dispose: () => built.forEach(entry => clearTimeout(entry.timer)) };
  };

  // A round badge for a hero: a tinted disc holding a glyph, over a ring that
  // can pulse. Disc and ring fill the slot less margins.
  const badge = async ({ glyph, health = 'good' } = {}) => {
    const inset = (KIT_METRICS.badgeSlotSize - KIT_METRICS.badgeSize) / 2, margin = { t: inset, r: inset, b: inset, l: inset };
    const slot = await element({ layout: { type: 'none' }, item: { size: { x: KIT_METRICS.badgeSlotSize, y: KIT_METRICS.badgeSlotSize } } });
    const ring = await element({ renderable: { type: 'box', colour: BADGE[health + 'Ring'], cornerRadius: KIT_METRICS.badgeSize / 2, cornerResolution: 32, origin: { x: 0.5, y: 0.5 } },
      ...fill({ margin }), contentAlign: 'fill' });
    const disc = await element({ renderable: { type: 'box', colour: BADGE[health + 'Disc'], cornerRadius: KIT_METRICS.badgeSize / 2, cornerResolution: 32, origin: { x: 0.5, y: 0.5 } },
      layout: { type: 'none' }, ...fill({ margin }), contentAlign: 'fill' });
    const image = await icon(win, disc, glyph, 24, 'auto', 'auto');
    await Promise.all([UI.attach(win, slot, ring), UI.attach(win, slot, disc)]);
    play(ring, [{ time: 0, opacity: 0 }]);
    return { id: slot, height: KIT_METRICS.badgeSlotSize, glyph: image,
      pop: () => play(disc, presets.pop()), pulse: loop => play(ring, presets.pulse(loop)),
      setGlyph: path => UI.setTexture(win, image, path) };
  };

  // Label and reading over a row of segments that light up in turn (only those
  // newly lit: a rising level lights just its new segments). With
  // `charging`, the next segment to fill breathes until the level reaches it.
  // With `limit`, segments past it dim: the level will not go there.
  const meter = async ({ label, width, segments: count = KIT_METRICS.meterSegments }) => {
    const box = await element({ layout: { type: 'column', gap: 6 }, item: { size: { x: 'auto', y: KIT_METRICS.meterHeight } } });
    const labels = await element({ layout: { type: 'row', alignItems: 'center' }, item: { size: { x: 'auto', y: 22 } } });
    const bar = await element({ layout: { type: 'row', gap: 4 }, item: { size: { x: 'auto', y: 6 } } });
    await Promise.all([UI.attach(win, box, labels), UI.attach(win, box, bar)]);
    await text(win, labels, label, TYPE.caption, 'auto', 22, TEXT.secondary, FONT, 'left');
    const reading = await text(win, labels, '', TYPE.caption, 'auto', 22, TEXT.primary, FONT, 'right');
    await UI.setGrow(win, reading, 1);
    const segment = (width - 4 * (count - 1)) / count;
    const segments = [];
    for (let i = 0; i < count; i++) {
      const id = await element({ renderable: { type: 'box', colour: SURFACE.track, cornerRadius: 3, cornerResolution: 8, origin: { x: 0.5, y: 0.5 } },
        item: { size: { x: segment, y: 6 } }, contentAlign: 'fill' });
      await UI.attach(win, bar, id); segments.push(id);
    }
    const lit = percent => Math.max(1, Math.round(percent * count / 100));
    const CAPPED = 0.28;
    let breathing = -1, cap = count, shown = 0;
    const set = async (percent, readingText, animate = false, { charging = false, limit = null } = {}) => {
      const filled = lit(percent), nextCap = limit === null ? count : lit(limit);
      const next = charging && filled < nextCap ? filled : -1;
      const opacity = i => i >= nextCap ? CAPPED : 1;
      await Promise.all([UI.setTextString(win, reading, readingText),
        ...segments.map((id, i) => UI.setBoxColour(win, id, i < filled || i === next ? SURFACE.accent : SURFACE.track))]);
      if (animate) segments.forEach((id, i) => {
        if (i >= filled) play(id, presets.fade(opacity(i)));
        else if (i >= shown) play(id, presets.light(i - shown, opacity(i)));
      });
      // The cap moved: segments it crossed fade in turn, outward from it.
      else if (nextCap !== cap) segments.forEach((id, i) => {
        if (i === next || (i >= cap) === (i >= nextCap)) return;
        play(id, presets.fade(opacity(i), Math.abs(i - Math.min(cap, nextCap)) * 0.05));
      });
      cap = nextCap; shown = filled;
      if (next !== breathing) {
        if (breathing >= 0) play(segments[breathing], breathing >= cap ? presets.fade(CAPPED) : presets.steady());
        if (next >= 0) play(segments[next], presets.breathe());
        breathing = next;
      }
    };
    return { id: box, height: KIT_METRICS.meterHeight, set };
  };

  // A glyph and a quiet line, centred across `width`, for an empty list. Each sits in a
  // full-width row that centres it (cross-axis alignment would only centre
  // them against each other).
  const emptyState = async ({ glyph, message, width, height = KIT_METRICS.emptyStateHeight }) => {
    const box = await element({ layout: { type: 'column', justifyContent: 'center', gap: SPACE.s }, item: { size: { x: 'auto', y: height } } });
    const line = async h => { const id = await element({ layout: { type: 'row', justifyContent: 'center' }, item: { size: { x: 'auto', y: h } } }); await UI.attach(win, box, id); return id; };
    await icon(win, await line(28), glyph, 28, 28, 28);
    // Centred text needs an explicit width (the space it centres in): an
    // 'auto' text width does not give a box that centres reliably.
    await text(win, await line(20), message, TYPE.detail, width, 20, TEXT.secondary, FONT);
    return { id: box, height };
  };

  // A bold line over a quiet one, as a hero's text block.
  const titleBlock = async ({ title, subtitle, dot }) => {
    const box = await element({ layout: { type: 'column', justifyContent: 'center' }, item: { size: AUTO } });
    await UI.setGrow(win, box, 1);
    const heading = await text(win, box, title, TYPE.heading, 'auto', 24, TEXT.primary, FONT_STRONG, 'left');
    const line = await element({ layout: { type: 'row', gap: 6, alignItems: 'center' }, item: { size: { x: 'auto', y: 18 } } });
    await UI.attach(win, box, line);
    const marker = dot ? await element({ renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 7, y: 7 } }, resolution: 16, colour: HEALTH[dot] },
      item: { size: { x: 7, y: 7 } } }) : undefined;
    if (marker) await UI.attach(win, line, marker);
    const caption = await text(win, line, subtitle, TYPE.caption, 'auto', 18, TEXT.secondary, FONT, 'left');
    return { id: box, heading, caption, dot: marker, setDot: health => marker && UI.setCircleColour(win, marker, HEALTH[health]) };
  };

  // A native scroll viewport (the engine moves the content in layout, so
  // hit-testing and hover stay aligned; inertia included) holding a content
  // column. The content's explicit height sets the scroll range: call
  // setContentHeight after (re)building it. reveal() keeps a span in view.
  const scrollArea = async ({ height, width = 'auto', gap = 0, id } = {}) => {
    const [viewport, content] = await Promise.all([
      element({ ...(id ? { id } : {}), scroll: { axis: 'y' }, layout: { type: 'column' }, item: { size: { x: width, y: height } } }),
      element({ layout: { type: 'column', gap }, item: { size: { x: 'auto', y: height } } })
    ]);
    await UI.attach(win, viewport, content);
    return {
      id: viewport, content, height,
      setContentHeight: value => UI.setLayoutSize(win, content, { x: 'auto', y: Math.max(height, value) }),
      scrollTo: y => UI.scrollTo(win, viewport, { x: 0, y: Math.max(0, y) }),
      // Scroll the least needed for content span [top, bottom) to be visible.
      reveal: async (top, bottom) => {
        const offset = Number((await UI.getScrollOffset(win, viewport))?.y || 0);
        if (top < offset) return UI.scrollTo(win, viewport, { x: 0, y: top });
        if (bottom > offset + height) return UI.scrollTo(win, viewport, { x: 0, y: bottom - height });
        return true;
      }
    };
  };

  return { play, surface, sectionHeader, keyValue, badge, meter, emptyState, titleBlock, scrollArea };
}

