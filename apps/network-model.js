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
