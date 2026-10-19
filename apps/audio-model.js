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

const entries = value => Array.isArray(value) ? value : Object.entries(value || {}).map(([name, item]) => ({ ...item, name }));
const connected = port => !['not available', 'no', 'unavailable'].includes(port.availability);
export const realOutput = sink => sink.name !== 'auto_null' && sink.properties?.['device.class'] !== 'abstract';
const onCard = (sink, card) => (sink.card != null && String(sink.card) === String(card.index))
  || sink.properties?.['device.name'] === card.name
  || (sink.properties?.['device.id'] != null && String(sink.properties['device.id']) === String(card.index));
const inputProfile = name => String(name || '').split('+').filter(part => part.startsWith('input:')).join('+');
function outputProfile(card, port) {
  const profiles = entries(card.profiles).filter(profile => Number(profile.sinks) > 0 && profile.available !== false
    && profile.available !== 'no' && (port.profiles || []).includes(profile.name));
  profiles.sort((a, b) => Number(b.name === card.active_profile) - Number(a.name === card.active_profile)
    || Number(inputProfile(b.name) === inputProfile(card.active_profile)) - Number(inputProfile(a.name) === inputProfile(card.active_profile))
    || Number(b.priority || 0) - Number(a.priority || 0));
  return profiles[0]?.name;
}
const outputIcon = (sink, port) => {
  const type = String(port?.type || port?.properties?.['port.type'] || '').toLowerCase();
  if (/hdmi|display/.test(type + ' ' + port?.name)) return 'audio-display';
  if (/headphone|headset/.test(type)) return 'audio-headphones';
  if (/bluez|bluetooth/.test(sink?.name + ' ' + sink?.properties?.['device.bus'])) return 'audio-bluetooth';
  return type === 'speaker' || sink?.properties?.['device.form_factor'] === 'internal' ? 'audio-speakers' : 'audio-card';
};

// A device can expose several physical ports, including outputs in an inactive
// card profile (for example USB analogue versus S/PDIF).
export function audioOutputs(sinks, cards, defaultName) {
  const outputs = [], seen = new Set();
  const add = (sink, card, port, profile) => {
    const selected = sink?.name === defaultName && (!port || sink.active_port === port.name);
    if (port && !connected(port) && !selected) return;
    const id = JSON.stringify([card?.name || sink.name, port?.name || sink?.name]);
    if (seen.has(id)) return;
    seen.add(id);
    const device = card?.properties?.['device.description'] || sink?.properties?.['device.description'] || sink?.description || card?.name;
    const label = port ? port.description || port.name : sink.description || device;
    outputs.push({ id, sink: sink?.name || '', card: card?.name, cardIndex: card?.index, port: port?.name || '', profile,
      label: port && device && device !== label ? label + ' – ' + device : label,
      name: label, device: port && device !== label ? device || '' : '',
      icon: outputIcon(sink || card, port), selected });
  };
  for (const sink of sinks.filter(realOutput)) {
    const card = cards.find(item => onCard(sink, item));
    const ports = entries(sink.ports);
    if (ports.length) for (const port of ports) add(sink, card, port);
    else add(sink, card);
  }
  for (const card of cards) {
    for (const port of entries(card.ports)) {
      // Input ports can share duplex profiles with outputs. Never infer a
      // port's direction just because its profile contains a playback sink.
      if (!/(?:^|[-_])output(?:[-_]|$)/.test(port.name) && port.direction !== 'output') continue;
      const profile = outputProfile(card, port);
      if (profile) add(undefined, card, port, profile);
    }
  }
  return outputs;
}

export async function routeOutput(run, output, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let sinks = JSON.parse(await run(['--format=json', 'list', 'sinks']));
  let sink = sinks.find(item => item.name === output.sink && realOutput(item));
  if (!sink && output.card && output.profile) {
    await run(['set-card-profile', output.card, output.profile]);
    // Profile activation creates a new sink asynchronously in PipeWire.
    for (let attempt = 0; attempt < 12; attempt++) {
      sinks = JSON.parse(await run(['--format=json', 'list', 'sinks']));
      sink = sinks.find(item => onCard(item, { index: output.cardIndex, name: output.card }) && realOutput(item)
        && entries(item.ports).some(port => port.name === output.port));
      if (sink) break;
      await wait(50);
    }
  }
  if (!sink) throw new Error('This sound output is no longer available');
  if (output.port && sink.active_port !== output.port) await run(['set-sink-port', sink.name, output.port]);
  await run(['set-default-sink', sink.name]);
  const streams = JSON.parse(await run(['--format=json', 'list', 'sink-inputs']));
  for (const stream of streams) {
    if (stream.sink === sink.index) continue;
    try { await run(['move-sink-input', String(stream.index), sink.name]); }
    catch (error) {
      const remaining = JSON.parse(await run(['--format=json', 'list', 'sink-inputs']));
      if (remaining.some(item => item.index === stream.index)) throw error;
    }
  }
  return sink.name;
}
import { popupPosition } from './popup-layout.js';
export const volumePopupPosition = (size, anchor, width = 280, height = 64) => popupPosition(size, anchor, width, height);
