import { PROFILE_LABELS } from './power-profiles.js';

const array = value => { try { const items = JSON.parse(value || '[]'); return Array.isArray(items) ? items : []; } catch (_) { return []; } };
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const percent = value => valid(value) && value <= 100;
const duration = seconds => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? Math.floor(minutes / 60) + ' h' + (minutes % 60 ? ' ' + minutes % 60 + ' min' : '') : minutes + ' min';
};

export function powerView(state = {}) {
  const known = percent(state.BatteryPercent);
  const status = ({ charging: 'Charging', discharging: 'Discharging', full: 'Fully charged', empty: 'Empty',
    'pending-charge': 'Not charging', 'pending-discharge': 'Not discharging' })[state.BatteryState] || 'Battery status unavailable';
  const plugged = !!state.ExternalPower;
  const details = [{ key: 'Source', value: plugged ? 'AC power' : 'Battery' }];
  if (state.BatteryState === 'discharging' && state.BatteryTimeToEmpty > 0)
    details.push({ key: 'Remaining', value: 'About ' + duration(state.BatteryTimeToEmpty) });
  if (state.BatteryState === 'charging' && state.BatteryTimeToFull > 0)
    details.push({ key: 'Until full', value: 'About ' + duration(state.BatteryTimeToFull) });
  if (valid(state.BatteryRate)) details.push({ key: 'Rate', value: state.BatteryRate.toFixed(1) + ' W' });
  if (valid(state.BatteryEnergy) && state.BatteryEnergyFull > 0)
    details.push({ key: 'Energy', value: state.BatteryEnergy.toFixed(1) + ' / ' + state.BatteryEnergyFull.toFixed(1) + ' Wh' });
  const devices = array(state.BatteryDevices).filter(item => item && typeof item === 'object');
  const chargeControls = [];
  for (const item of devices) {
    const prefix = devices.length > 1 ? item.name + ' ' : '';
    if (percent(item.health) && item.health > 0) details.push({ key: prefix + 'Health', value: item.health.toFixed(1) + '%' });
    if (valid(item.cycles)) details.push({ key: prefix + 'Cycles', value: String(Math.round(item.cycles)) });
    if (item.full > 0 && item.design > 0) details.push({ key: prefix + 'Capacity', value: item.full.toFixed(1) + ' / ' + item.design.toFixed(1) + ' Wh' });
    if (item.thresholdSupported) {
      const limits = [item.start, item.end].every(percent) && item.start < item.end;
      if (typeof item.path === 'string' && item.path.startsWith('/')) {
        chargeControls.push({ path: item.path, title: prefix + 'Charge limit', enabled: !!item.thresholdEnabled,
          end: percent(item.end) ? item.end : null, adjustable: !!item.adjustable, minimum: item.minimum ?? 25, maximum: item.maximum ?? 100,
          range: limits ? item.start + '–' + item.end + '%' : percent(item.end) ? item.end + '%' : percent(item.start) ? 'From ' + item.start + '%' : '' });
      } else details.push({ key: prefix + 'Limits', value: !item.thresholdEnabled ? 'Off' : limits ? item.start + '–' + item.end + '%' : 'Enabled' });
    } else if (item.chargeIssue) details.push({ key: prefix + 'Charge limit', value: item.chargeIssue === 'conflict' ? 'Set by another tool' : 'Unavailable' });
  }
  const profiles = Object.keys(PROFILE_LABELS).filter(profile => array(state.PowerProfiles).includes(profile));
  const degraded = ({ 'lap-detected': 'Performance limited while on your lap', 'high-operating-temperature': 'Performance limited by temperature' })[state.PowerProfileDegraded]
    || (state.PowerProfileDegraded ? 'Performance is currently limited' : '');
  // The level charging stops at, when a limit is on: the meter caps there.
  const limit = chargeControls.find(control => control.enabled && control.end !== null)?.end ?? null;
  return { title: known ? Math.round(state.BatteryPercent) + '% battery' : 'Battery',
    // For the charge meter: the level (null when unknown) and whether it is rising.
    percent: known ? state.BatteryPercent : null, charging: state.BatteryState === 'charging', limit,
    status: status + (plugged ? ' · AC' : ''), details, chargeControls, profiles, active: state.PowerProfile || '', degraded,
    icon: known ? 'battery-' + Math.ceil(state.BatteryPercent / 10) : 'battery-unknown',
    health: state.BatteryState === 'discharging' && known && state.BatteryPercent <= 15 ? 'warn' : 'good' };
}
