export const clockDefaults = { ClockTimeFormat: '24h', ClockShowDate: true, ClockShowSeconds: false };

export function clockPreferences(state = {}) {
  return {
    ClockTimeFormat: state.ClockTimeFormat === '12h' ? '12h' : '24h',
    ClockShowDate: state.ClockShowDate !== false,
    ClockShowSeconds: state.ClockShowSeconds === true
  };
}

const pad = (value, width = 2) => String(value).padStart(width, '0');
export function clockPresentation(now, state = {}) {
  const options = clockPreferences(state), twelve = options.ClockTimeFormat === '12h';
  const hour = now.getHours();
  const time = (twelve ? String(hour % 12 || 12) : pad(hour)) + ':' + pad(now.getMinutes())
    + (options.ClockShowSeconds ? ':' + pad(now.getSeconds()) : '')
    + (twelve ? hour >= 12 ? ' PM' : ' AM' : '');
  // Use the same local calendar as the clock; toISOString() would use UTC.
  const date = pad(now.getFullYear(), 4) + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  return { time, date, showDate: options.ClockShowDate,
    timeWidth: (twelve ? 72 : 44) + (options.ClockShowSeconds ? 20 : 0) };
}

export function clockRefreshDelay(now, state = {}) {
  const interval = clockPreferences(state).ClockShowSeconds ? 1000 : 60000;
  return interval - now % interval;
}
