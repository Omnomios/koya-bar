import * as UI from './theme-ui.js';
import * as Image from 'Koya/Image';
import * as Log from 'Helix/Log';
import { SHADOW, RADIUS, SHADOW_COLOUR } from './theme.js';

// Drop shadows are authored, not an engine effect: one rounded box is
// rendered to a texture and blurred once per window and level, then drawn as
// a nine-slice panel behind a surface at any size.
//
// The source is a single detached element whose geometry is its renderable's
// own aabb (raw positioning), so no layout is involved. It renders unscaled,
// keeping slice values (texture pixels) equal to logical pixels; a shadow is
// soft anyway. Textures belong to one window's renderer, so the cache is per
// window.
// Render a white alpha mask so a skin can recolour its panel tint in place.
const textures = new Map();
// Two blur passes reach about 2 × radius, so the padding holds the falloff
// and the slices sit where alpha has settled: corners and edges carry the
// gradient, the 2px centre is solid and stretches.
const geometry = (level, radius) => {
  const spec = SHADOW[level], reach = spec.blur * 2, pad = reach + 2;
  const core = (radius + reach) * 2 + 2, size = core + pad * 2;
  return { spec, pad, core, size, slice: pad + radius + reach };
};
function texture(win, level, radius) {
  const key = win + ':' + level + ':' + radius;
  if (!textures.has(key)) textures.set(key, (async () => {
    const { spec, pad, core, size } = geometry(level, radius);
    const shape = await UI.createElement(win, { renderable: { type: 'box', colour: [1, 1, 1, 1], cornerRadius: radius, cornerResolution: 16,
      aabb: { min: { x: pad, y: pad }, max: { x: pad + core, y: pad + core } } },
      item: { size: { x: size, y: size } }, contentPositioning: 'raw' });
    try {
      const name = '/ram/koya-shadow-' + win + '-' + level + '-' + radius;
      const source = await Image.render(win, shape, { dst: name + '-source', size: { x: size, y: size }, includeTree: false, scaling: false, mipmaps: false });
      if (!source) throw new Error('Could not render the shadow shape');
      const blurred = await Image.blur(win, { src: source, dst: name, radius: spec.blur, passes: 2, mipmaps: false });
      if (!blurred) throw new Error('Could not blur the shadow shape');
      return blurred;
    } finally { await UI.destroyElement(win, shape); }
  })().catch(error => { textures.delete(key); throw error; }));
  return textures.get(key);
}
// A shadow for a surface of `size` at `position` in a layout-less parent.
// Resolves to the panel element, or undefined when the texture is unavailable.
export async function shadow(win, parent, size, position, level = 'popover', radius = RADIUS.surface) {
  try {
    const { spec, pad, size: extent, slice } = geometry(level, radius);
    const drawn = { x: size.x + pad * 2, y: size.y + pad * 2 };
    const id = await UI.createElement(win, {
      renderable: { type: 'panel', mode: 'sliced', texture: await texture(win, level, radius),
        frame: { size: drawn, origin: { x: 0, y: 0 }, aabb: { min: { x: 0, y: 0 }, max: { x: extent, y: extent } }, colour: SHADOW_COLOUR[level] },
        slice: { top: slice, right: slice, bottom: slice, left: slice }, origin: { x: 0.5, y: 0 } },
      // Siblings draw in (order, creation) order, not attach order: sort first.
      item: { position: { x: position.x - pad, y: position.y - pad + spec.offset }, size: drawn, order: -1 }, contentAlign: 'fill'
    });
    await Promise.all([UI.setHitTarget(win, id, false), ...(parent != null ? [UI.attach(win, parent, id)] : [])]);
    return id;
  } catch (error) { Log.error('Shadow: ' + error); return undefined; }
}

// How far a level's shadow reaches past its surface (and so the margin a
// wrapper or window needs around it).
export const shadowReach = (level, radius = RADIUS.surface) => geometry(level, radius).pad;

// Wrap `inner` (a surface of `size`) with its shadow using layout alone: the
// wrapper is the surface plus the reach on every side; the shadow fills it,
// dropped by a visual offset; the surface fills it less the reach.
// Resolves to the wrapper id (or `inner` itself if the shadow is unavailable).
export async function withShadow(win, inner, size, level = 'card', radius = RADIUS.surface) {
  try {
    const { spec, pad, size: extent, slice } = geometry(level, radius);
    const drawn = { x: size.x + pad * 2, y: size.y + pad * 2 };
    const wrapper = await UI.createElement(win, { layout: { type: 'none' }, item: { size: drawn } });
    const shade = await UI.createElement(win, {
      renderable: { type: 'panel', mode: 'sliced', texture: await texture(win, level, radius), position: { x: 0, y: spec.offset },
        frame: { size: drawn, origin: { x: 0, y: 0 }, aabb: { min: { x: 0, y: 0 }, max: { x: extent, y: extent } }, colour: SHADOW_COLOUR[level] },
        slice: { top: slice, right: slice, bottom: slice, left: slice } },
      // The surface usually exists before its wrapper: sort the shadow first.
      item: { size: { x: 'auto', y: 'auto' }, order: -1 }
    });
    await UI.attach(win, wrapper, shade);
    // The wrapper has no renderable to resolve a normalised pivot from, so it
    // would scale from its top-left corner: pivot on its centre, in pixels.
    await Promise.all([UI.setHitTarget(win, shade, false), UI.setHitTarget(win, wrapper, false), UI.setMargin(win, inner, { t: pad, r: pad, b: pad, l: pad }),
      UI.setOrigin(win, wrapper, { x: drawn.x / 2, y: drawn.y / 2 })]);
    await UI.attach(win, wrapper, inner);
    return wrapper;
  } catch (error) { Log.error('Shadow: ' + error); return inner; }
}
