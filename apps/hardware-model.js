import { FRAMEWORK_NAME } from './framework-client.js';

// What the Cooling and Keyboard & lighting pages say about the hardware.
// Pure functions of the Framework snapshot, so the wording runs in tests.
export const WARM = 70, HOT = 85;
const KINDS = [
  [/^(cpu|apu|soc|package|tctl|tdie|core)/i, 'CPU'], [/^(ddr|mem|dimm)/i, 'Memory'], [/^(gpu|dgpu)/i, 'Graphics'],
  [/^(bat)/i, 'Battery'], [/^(ssd|nvme)/i, 'Storage'], [/^(charger|vr)/i, 'Power'],
  [/^(skin|surface)/i, 'Surface'], [/^(local|board|ambient|sys)/i, 'Board']
];
export const isType = (device, type) => device?.type === FRAMEWORK_NAME + '.' + type + '1';
export const ofType = (snapshot, type) => (snapshot?.devices || []).filter(device => isType(device, type));

// Kernel names ("cpu_f75303@4d") become what they measure; a second sensor of
// the same kind is numbered. Unknown names lose their chip and bus address.
export function sensorLabels(sensors) {
  const counts = new Map(), labels = new Map();
  for (const sensor of sensors) {
    const raw = String(sensor.Name || '');
    const known = KINDS.find(([pattern]) => pattern.test(raw))?.[1];
    const base = known || raw.replace(/@.*$/, '').replace(/_[a-z]*\d+[a-z0-9]*$/i, '').replace(/[_-]+/g, ' ').trim()
      .replace(/^./, letter => letter.toUpperCase()) || 'Sensor';
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count); labels.set(sensor.path, count > 1 ? base + ' ' + count : base);
  }
  return labels;
}

// QuickJS has no locale grouping: 4200 → "4,200".
export const rpm = value => String(Math.round(value)).replace(/\B(?=(\d{3})+$)/g, ',');
export const celsius = value => Math.round(value) + '°';
export const heat = value => value >= HOT ? 'hot' : value >= WARM ? 'warm' : 'cool';

export function fanReading(fan) {
  if (!fan?.Available) return 'Unavailable';
  if (fan.Mode === 'duty') return 'Manual · ' + fan.Target + '%';
  if (fan.Mode === 'rpm') return 'Manual · ' + rpm(fan.Target) + ' RPM';
  return fan.RPM > 0 ? rpm(fan.RPM) + ' RPM' : 'Idle';
}

// The hero: the hottest reading and what the fans are doing about it.
export function coolingSummary(snapshot) {
  const readings = ofType(snapshot, 'Temperature').filter(item => item.Available && Number.isFinite(item.Celsius));
  const fans = ofType(snapshot, 'Fan').filter(item => item.Available);
  const peak = readings.length ? Math.max(...readings.map(item => item.Celsius)) : null;
  const manual = fans.some(item => item.Mode !== 'auto');
  const spinning = fans.filter(item => item.RPM > 0);
  const fan = !fans.length ? '' : manual ? 'Fan manual' : spinning.length
    ? 'Fan ' + rpm(Math.max(...spinning.map(item => item.RPM))) + ' RPM' : 'Fan idle';
  const mood = peak === null ? 'No readings' : ({ hot: 'Running hot', warm: 'Warm', cool: 'Cool' })[heat(peak)];
  return { title: peak === null ? 'Cooling' : mood + ' · ' + celsius(peak), subtitle: fan || 'No fan control',
    health: peak !== null && peak >= WARM ? 'warn' : 'good', spinning: spinning.length > 0 || manual };
}

// The Settings row under Cooling and Keyboard & lighting.
export function coolingDetail(snapshot) {
  const summary = coolingSummary(snapshot);
  const readings = ofType(snapshot, 'Temperature').filter(item => item.Available);
  return readings.length ? celsius(Math.max(...readings.map(item => item.Celsius))) + (summary.subtitle.startsWith('Fan') ? ' · ' + summary.subtitle : '')
    : summary.subtitle;
}
export function lightingDetail(snapshot) {
  const keyboard = ofType(snapshot, 'Lighting').find(item => /keyboard/i.test(item.Name || item.path));
  if (keyboard?.Available) return keyboard.Brightness > 0 ? 'Keyboard ' + keyboard.Brightness + '%' : 'Keyboard off';
  return ofType(snapshot, 'Lighting').length ? 'Brightness' : 'Unavailable';
}

// Firmware levels, dimmest first, then Auto.
const LEVEL_ORDER = ['ultra-low', 'low', 'medium', 'high', 'auto'];
const LEVEL_TITLES = { 'ultra-low': 'Dim', low: 'Low', medium: 'Medium', high: 'High', auto: 'Auto' };
export const lightLevels = levels => [...(levels || [])].sort((a, b) => (LEVEL_ORDER.indexOf(a) + 1 || 99) - (LEVEL_ORDER.indexOf(b) + 1 || 99))
  .map(value => ({ value, title: LEVEL_TITLES[value] || value.replace(/^./, letter => letter.toUpperCase()) }));
export const lightReading = light => !light?.Available ? 'Unavailable' : light.Level === 'auto' ? 'Auto'
  : light.Levels?.length && LEVEL_TITLES[light.Level] ? LEVEL_TITLES[light.Level] : light.Brightness > 0 ? light.Brightness + '%' : 'Off';
