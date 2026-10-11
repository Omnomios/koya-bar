export function networkSummary(state = {}) {
  const online = state.NetworkState === 'connected';
  const wifi = state.NetworkType === 'wifi';
  const title = ({ wifi: 'Wi-Fi', ethernet: 'Ethernet', cellular: 'Mobile network', other: 'Network' })[state.NetworkType] || 'Network';
  const status = !state.NetworkAvailable ? 'NetworkManager unavailable'
    : ({ disabled: 'Networking disabled', connecting: 'Connecting…', offline: 'Not connected' })[state.NetworkState]
      || (online ? ({ full: 'Connected · Internet available', portal: 'Connected · Sign-in required', limited: 'Connected · Limited connectivity', none: 'Connected · No Internet' })[state.NetworkConnectivity] || 'Connected' : 'Not connected');
  const rows = [];
  const add = (name, value) => { if (value) rows.push([name, String(value)]); };
  if (online || state.NetworkState === 'connecting') {
    add(wifi ? 'Network' : 'Connection', wifi ? state.WifiSsid || state.NetworkName : state.NetworkName);
    add('Interface', state.NetworkInterface);
    add('IPv4', state.NetworkIPv4); add('IPv6', state.NetworkIPv6);
    if (wifi && state.WifiState === 'connected') {
      const strength = Number(state.WifiStrength);
      if (Number.isFinite(strength) && strength >= 0 && strength <= 100) add('Signal', Math.round(strength) + '%');
      add('Security', ({ open: 'Open', 'wpa-psk': 'WPA / WPA2', sae: 'WPA3', owe: 'Enhanced open', enterprise: 'Enterprise', wep: 'WEP' })[state.WifiSecurity]);
    }
  }
  if (!wifi) add('Wi-Fi', state.WifiState === 'connected' ? state.WifiSsid || 'Connected'
    : ({ disabled: 'Off', disconnected: 'Not connected', connecting: 'Connecting…', unavailable: 'Unavailable' })[state.WifiState]);
  return { title, status, rows };
}

// Presentation for the network popup: a hero (icon, name, health), an
// optional signal meter, detail rows and one action.
const SECURITY = { open: 'Open', 'wpa-psk': 'WPA / WPA2', sae: 'WPA3', owe: 'Enhanced open', enterprise: 'Enterprise', wep: 'WEP' };
export const signalQuality = percent => percent >= 75 ? 'Excellent' : percent >= 50 ? 'Good' : percent >= 25 ? 'Fair' : 'Weak';
export function networkView(state = {}) {
  const summary = networkSummary(state);
  const online = state.NetworkState === 'connected', connecting = state.NetworkState === 'connecting';
  const kind = !state.NetworkAvailable ? 'unavailable' : !(online || connecting) ? 'offline'
    : ({ wifi: 'wifi', ethernet: 'ethernet', cellular: 'cellular' })[state.NetworkType] || 'other';
  const strength = Number(state.WifiStrength);
  const signal = kind === 'wifi' && state.WifiState === 'connected' && Number.isFinite(strength) && strength >= 0 && strength <= 100
    ? { percent: Math.round(strength), label: signalQuality(strength) } : null;
  const bars = signal ? Math.max(0, Math.min(3, Math.ceil(signal.percent * 3 / 100))) : 0;
  const icon = ({ wifi: 'wifi-' + (signal ? bars : 3), ethernet: 'ethernet', cellular: 'cell-4', other: 'ethernet' })[kind] || 'wifi-off';
  const name = kind === 'wifi' ? state.WifiSsid || state.NetworkName || 'Wi-Fi'
    : kind === 'offline' ? 'Not connected' : kind === 'unavailable' ? 'Network unavailable' : state.NetworkName || summary.title;
  const health = online && state.NetworkConnectivity === 'full' ? 'good' : online || connecting ? 'warn' : 'off';
  const status = summary.status.replace(/^Connected · /, '');
  const details = [];
  const add = (key, value, copy = false) => { if (value) details.push({ key, value: String(value), copy }); };
  if (online || connecting) {
    add('Interface', state.NetworkInterface);
    add('IPv4', state.NetworkIPv4, true);
    // Prefer a global IPv6 address over link-local ones.
    const v6 = String(state.NetworkIPv6 || '').split(',').map(item => item.trim()).filter(Boolean);
    add('IPv6', v6.find(item => !/^fe80:/i.test(item)) || v6[0], true);
    if (kind === 'wifi') add('Security', SECURITY[state.WifiSecurity]);
  }
  if (kind !== 'wifi') add('Wi-Fi', state.WifiState === 'connected' ? state.WifiSsid || 'Connected'
    : ({ disabled: 'Off', disconnected: 'Not connected', connecting: 'Connecting…', unavailable: 'Unavailable' })[state.WifiState]);
  const action = kind === 'offline' || kind === 'unavailable' ? { label: 'Choose a network', primary: true } : { label: 'Wi-Fi settings', primary: false };
  return { kind, icon, name, health, status, connecting, signal, details, action };
}
