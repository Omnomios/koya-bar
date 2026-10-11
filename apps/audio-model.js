export const clampVolume = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
export function speakerStatus(value) {
  if (!value?.available) return { icon: 'volume-unavailable', label: '—', muted: false };
  const muted = !!value.muted, percent = Math.max(0, Math.round(value.percent));
  return { icon: muted ? 'volume-muted' : percent === 0 ? 'volume-zero' : percent <= 33 ? 'volume-low' : percent <= 66 ? 'volume-medium' : 'volume',
    label: percent + '%', muted };
}
// Preserve the output's channel balance, including when restoring from zero.
export function channelVolumes(channels, percent, previous = []) {
  const highest = Math.max(...channels);
  return channels.map((value, index) => ((highest ? value / highest : previous[index] ?? 1) * clampVolume(percent)).toFixed(3) + '%');
}
import { popupPosition } from './popup-layout.js';
export const volumePopupPosition = (size, anchor, width = 280, height = 64) => popupPosition(size, anchor, width, height);
