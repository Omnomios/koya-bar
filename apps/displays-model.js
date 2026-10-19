// Hyprland uses logical coordinates: rotation is applied before scaling.
export const TRANSFORMS = ['Landscape', 'Portrait (90°)', 'Landscape (180°)', 'Portrait (270°)',
  'Flipped', 'Flipped (90°)', 'Flipped (180°)', 'Flipped (270°)'];
export const COLOUR_MODES = ['auto', 'srgb', 'wide', 'edid', 'hdr', 'hdredid', 'dcip3', 'dp3', 'adobe'];
export const VRR_MODES = [[-1, 'Compositor default'], [0, 'Off'], [1, 'Always'], [2, 'Fullscreen only'], [3, 'Fullscreen games & video']];
export const ADVANCED_NUMBERS = {
  sdrbrightness: [0.1, 5, 'SDR brightness', 1], sdrsaturation: [0, 3, 'SDR saturation', 1],
  sdr_min_luminance: [0, 10, 'SDR minimum luminance', 0.2], sdr_max_luminance: [1, 2000, 'SDR maximum luminance', 80],
  min_luminance: [-1, 100, 'Minimum luminance override', -1], max_luminance: [-1, 10000, 'Peak luminance override', -1],
  max_avg_luminance: [-1, 10000, 'Average luminance override', -1]
};
const finite = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const numeric = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function parseMode(value) {
  const match = /^(\d+)x(\d+)(?:@([\d.]+)(?:Hz)?)?$/.exec(String(value));
  return match ? { width: +match[1], height: +match[2], refresh: +(match[3] || 60) } : null;
}
export function monitorConfig(monitor, saved = {}, monitors = []) {
  const current = `${monitor.width}x${monitor.height}@${Number(monitor.refreshRate || 60).toFixed(3)}`;
  const modes = (monitor.availableModes || []).map(parseMode).filter(Boolean);
  const matched = modes.find(mode => mode.width === monitor.width && mode.height === monitor.height
    && Math.abs(mode.refresh - monitor.refreshRate) < 0.1);
  const mirrored = monitor.mirrorOf !== undefined && monitor.mirrorOf !== null && !['', 'none'].includes(String(monitor.mirrorOf));
  // hyprctl reports a mirrored monitor's numeric ID as a string. Lua rules
  // take its connector name; IDs can change between sessions.
  const mirrorTarget = mirrored ? monitors.find(m => m.name === monitor.mirrorOf || String(m.id) === String(monitor.mirrorOf))?.name
    || (/^\d+$/.test(String(monitor.mirrorOf)) ? saved.mirror || '' : String(monitor.mirrorOf)) : '';
  const config = { name: monitor.name, enabled: !monitor.disabled,
    mode: monitor.disabled ? (saved.mode || 'preferred') : matched ? `${matched.width}x${matched.height}@${matched.refresh}` : parseMode(current) ? current : 'preferred',
    x: Math.round(numeric(monitor.x, 0)), y: Math.round(numeric(monitor.y, 0)), scale: numeric(monitor.scale, 1) || 1,
    transform: numeric(monitor.transform, 0), mirror: mirrorTarget };
  // These properties describe the effective output. VRR in monitor JSON is
  // activity, not the configured policy; do not guess that policy from it.
  for (const key of Object.keys(ADVANCED_NUMBERS).concat(['vrr', 'bitdepth', 'cm', 'icc', 'sdr_eotf', 'supports_hdr', 'supports_wide_color'])) {
    if (Object.hasOwn(saved, key)) config[key] = saved[key];
  }
  config.cm = monitor.colorManagementPreset || config.cm || 'srgb';
  if (!COLOUR_MODES.includes(config.cm)) delete config.cm;
  if (monitor.currentFormat) config.bitdepth = /2101010|1010102/.test(monitor.currentFormat) ? 10 : 8;
  const fields = { sdrBrightness: 'sdrbrightness', sdrSaturation: 'sdrsaturation', sdrMinLuminance: 'sdr_min_luminance', sdrMaxLuminance: 'sdr_max_luminance' };
  for (const [source, target] of Object.entries(fields)) if (Number.isFinite(monitor[source])) config[target] = monitor[source];
  return config;
}
export const layoutKey = monitors => JSON.stringify(monitors.map(m => [m.name, m.description || '', m.serial || '']).sort((a, b) => a[0].localeCompare(b[0])));
const displayMode = (config, monitor) => parseMode(config.mode) || parseMode(monitor.availableModes?.[0])
  || { width: monitor.width || 1920, height: monitor.height || 1080 };
const cleanScale = (mode, scale) => scale > 0 && Number.isInteger(mode.width / scale) && Number.isInteger(mode.height / scale);
export function validScale(config, monitor = {}) {
  if (!finite(config.scale, 0.5, 4)) return false;
  const mode = displayMode(config, monitor);
  // Hyprland stores the requested scale as float32. It first checks that
  // division produces integral logical pixels, then retries at the nearest
  // 1/120 step before searching for a replacement (and showing a warning).
  // See Hyprland v0.56.2 src/output/Monitor.cpp, CMonitor::applyMonitorRule.
  const scale = Math.fround(config.scale);
  if (cleanScale(mode, scale) || cleanScale(mode, Math.round(scale * 120) / 120)) return true;
  // Preserve a proven running scale, including a compositor configured with
  // debug:disable_scale_checks. A new mode must satisfy the checks above.
  return !monitor.disabled && mode.width === monitor.width && mode.height === monitor.height && config.scale === monitor.scale;
}
export function validScales(config, monitor = {}) {
  const mode = displayMode(config, monitor), scales = [];
  for (let step = 60; step <= 480; step++) {
    const scale = step / 120;
    if (cleanScale(mode, scale)) scales.push(scale);
  }
  if (validScale(config, monitor) && !scales.some(scale => Math.abs(scale - config.scale) < 0.00001)) scales.push(config.scale);
  return scales.sort((a, b) => a - b);
}
export function nearestScale(config, monitor = {}) {
  if (validScale(config, monitor)) return config.scale;
  return validScales(config, monitor).reduce((best, scale) => Math.abs(scale - config.scale) < Math.abs(best - config.scale) ? scale : best, 1);
}
export function logicalSize(config, monitor = {}) {
  const mode = displayMode(config, monitor);
  const rotated = config.transform % 2;
  return { width: Math.round((rotated ? mode.height : mode.width) / config.scale),
    height: Math.round((rotated ? mode.width : mode.height) / config.scale) };
}
export function layoutView(configs, monitors, width, height, padding = 20) {
  const rectangles = configs.filter(c => c.enabled && !c.mirror).map(c => ({ ...c, ...logicalSize(c, monitors.find(m => m.name === c.name)) }));
  if (!rectangles.length) return { scale: 1, rectangles: [] };
  const left = Math.min(...rectangles.map(c => c.x)), top = Math.min(...rectangles.map(c => c.y));
  const right = Math.max(...rectangles.map(c => c.x + c.width)), bottom = Math.max(...rectangles.map(c => c.y + c.height));
  const scale = Math.min((width - 2 * padding) / (right - left), (height - 2 * padding) / (bottom - top));
  const ox = (width - (right - left) * scale) / 2 - left * scale, oy = (height - (bottom - top) * scale) / 2 - top * scale;
  return { scale, ox, oy, rectangles: rectangles.map(c => ({ ...c, left: ox + c.x * scale, top: oy + c.y * scale,
    w: c.width * scale, h: c.height * scale })) };
}
export function snapPosition(config, point, configs, monitors, distance = 32) {
  const size = logicalSize(config, monitors.find(m => m.name === config.name));
  const xs = [0], ys = [0];
  for (const other of configs.filter(c => c.name !== config.name && c.enabled && !c.mirror)) {
    const rect = logicalSize(other, monitors.find(m => m.name === other.name));
    xs.push(other.x, other.x + rect.width, other.x - size.width, other.x + rect.width - size.width);
    ys.push(other.y, other.y + rect.height, other.y - size.height, other.y + rect.height - size.height);
  }
  const snap = (n, values) => { const nearest = values.reduce((a, b) => Math.abs(n - a) < Math.abs(n - b) ? a : b); return Math.round(Math.abs(nearest - n) <= distance ? nearest : n); };
  return { x: snap(point.x, xs), y: snap(point.y, ys) };
}
export function arrangeDisplays(configs, monitors) {
  let x = 0;
  return configs.map(config => {
    if (!config.enabled || config.mirror) return { ...config };
    const placed = { ...config, x, y: 0 }; x += logicalSize(config, monitors.find(m => m.name === config.name)).width;
    return placed;
  });
}
export function validateLayout(configs, monitors) {
  if (!Array.isArray(configs) || configs.length !== monitors.length || configs.length > 32) throw new Error('The connected displays changed. Reload the layout.');
  const names = new Set();
  for (const c of configs) {
    const monitor = monitors.find(m => m.name === c.name);
    if (!monitor || names.has(c.name)) throw new Error('Unknown or duplicate display');
    names.add(c.name);
    if (typeof c.enabled !== 'boolean' || !finite(c.scale, 0.5, 4) || !Number.isInteger(c.transform) || !finite(c.transform, 0, 7)
      || !Number.isInteger(c.x) || !Number.isInteger(c.y) || !finite(c.x, -100000, 100000) || !finite(c.y, -100000, 100000)) throw new Error('Invalid display geometry');
    const mode = parseMode(c.mode);
    if (c.mode !== 'preferred' && (!mode || !(monitor.availableModes || []).some(value => {
      const candidate = parseMode(value); return candidate && candidate.width === mode.width && candidate.height === mode.height && Math.abs(candidate.refresh - mode.refresh) < 0.1;
    }))) throw new Error('Choose an available resolution and refresh rate');
    if (c.enabled && !validScale(c, monitor)) throw new Error('Choose a scale that produces whole logical pixels for this resolution');
    if (typeof c.mirror !== 'string') throw new Error('Invalid mirror target');
    if (c.mirror && !configs.some(other => other.name === c.mirror && other.name !== c.name && other.enabled && !other.mirror)) throw new Error('Mirror an enabled display that is not itself mirrored');
    const choices = { vrr: [-1, 0, 1, 2, 3], bitdepth: [8, 10], cm: COLOUR_MODES, sdr_eotf: ['default', 'auto', 'srgb', 'gamma22', 'gamma22force'], supports_hdr: [-1, 0, 1], supports_wide_color: [-1, 0, 1] };
    for (const [key, values] of Object.entries(choices)) if (Object.hasOwn(c, key) && !values.includes(c[key])) throw new Error('Invalid ' + key + ' setting');
    for (const [key, [min, max]] of Object.entries(ADVANCED_NUMBERS)) if (Object.hasOwn(c, key) && (!finite(c[key], min, max)
      || (['sdr_max_luminance', 'max_luminance', 'max_avg_luminance'].includes(key) && !Number.isInteger(c[key])))) throw new Error('Invalid ' + key + ' value');
    if (Object.hasOwn(c, 'icc') && (typeof c.icc !== 'string' || c.icc.length > 4096 || /[\x00-\x1f]/.test(c.icc))) throw new Error('Invalid colour profile path');
    const keys = new Set(['name', 'enabled', 'mode', 'x', 'y', 'scale', 'transform', 'mirror', 'icc', ...Object.keys(choices), ...Object.keys(ADVANCED_NUMBERS)]);
    if (Object.keys(c).some(key => !keys.has(key))) throw new Error('Unknown display setting');
  }
  const active = configs.filter(c => c.enabled && !c.mirror);
  if (!active.length) throw new Error('Keep at least one display enabled');
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j], as = logicalSize(a, monitors.find(m => m.name === a.name)), bs = logicalSize(b, monitors.find(m => m.name === b.name));
    if (a.x < b.x + bs.width && a.x + as.width > b.x && a.y < b.y + bs.height && a.y + as.height > b.y) throw new Error('Displays overlap. Move them edge to edge or use Mirror.');
  }
  return configs;
}
// Lua strings are quoted independently of both shell and hyprctl batch syntax.
const luaString = text => '"' + String(text).replace(/[\\"\x00-\x1f\x7f]/g, char => /[\\"]/.test(char) ? '\\' + char : '\\' + char.charCodeAt(0).toString().padStart(3, '0')) + '"';
export function monitorRules(configs) {
  return configs.map(c => {
    const fields = { output: c.name, disabled: !c.enabled, mode: c.mode, position: c.x + 'x' + c.y,
      scale: c.scale, transform: c.transform, mirror: c.mirror };
    for (const key of ['vrr', 'bitdepth', 'cm', 'icc', 'sdr_eotf', 'supports_hdr', 'supports_wide_color', ...Object.keys(ADVANCED_NUMBERS)]) if (Object.hasOwn(c, key)) fields[key] = c[key];
    return 'hl.monitor({' + Object.entries(fields).map(([k, v]) => k + '=' + (typeof v === 'string' ? luaString(v) : String(v))).join(',') + '})';
  }).join(';');
}
export function matchesLayout(configs, monitors) {
  return configs.every(c => {
    const m = monitors.find(m => m.name === c.name);
    if (!m || !!m.disabled !== !c.enabled) return false;
    if (!c.enabled) return true;
    const mode = parseMode(c.mode);
    return (!mode || m.width === mode.width && m.height === mode.height && Math.abs(m.refreshRate - mode.refresh) < 1)
      && Math.abs(m.scale - c.scale) < 0.02 && m.transform === c.transform
      && (c.mirror ? m.mirrorOf === c.mirror || String(m.mirrorOf) === String(monitors.find(target => target.name === c.mirror)?.id)
        : ['none', '', 'undefined', 'null'].includes(String(m.mirrorOf)) && Math.abs(m.x - c.x) <= 1 && Math.abs(m.y - c.y) <= 1);
  });
}
