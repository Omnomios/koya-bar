import assert from './assert.js';
import * as Log from 'Helix/Log';
import { audioOutputs, routeOutput, channelVolumes } from '../apps/audio-model.js';

export async function test() {
// Representative pactl JSON: PipeWire identifies the card through device.id,
// while PulseAudio can supply a top-level card index. Ports differ from sinks.
const card = { index: 7, name: 'alsa_card.usb', properties: { 'device.description': 'Creative Stage SE' },
  active_profile: 'output:analog-stereo+input:analog-stereo', profiles: {
    'output:analog-stereo+input:analog-stereo': { sinks: 1, priority: 100, available: true },
    'output:iec958-stereo': { sinks: 1, priority: 100, available: true },
    'output:iec958-stereo+input:analog-stereo': { sinks: 1, priority: 90, available: true }
  }, ports: {
    'analog-output': { description: 'Analog Output', type: 'Line', availability: 'availability unknown', profiles: ['output:analog-stereo+input:analog-stereo'] },
    'iec958-output': { description: 'Digital Output (S/PDIF)', type: 'SPDIF', availability: 'availability unknown',
      profiles: ['output:iec958-stereo', 'output:iec958-stereo+input:analog-stereo'] },
    'analog-input-mic': { description: 'Microphone', type: 'Mic', profiles: ['output:analog-stereo+input:analog-stereo'] },
    'hdmi-output-0': { description: 'HDMI / DisplayPort', type: 'HDMI', availability: 'not available', profiles: ['output:iec958-stereo'] }
  } };
const usb = { index: 12, name: 'alsa_output.usb.analog-stereo', description: 'Creative Stage SE Analog Stereo',
  properties: { 'device.id': '7' }, active_port: 'analog-output', ports: [{ name: 'analog-output', ...card.ports['analog-output'] }] };
const bluetooth = { index: 20, name: 'bluez_output.headset', description: 'Wireless headphones', properties: { 'device.bus': 'bluetooth' }, ports: [] };
const sinks = [usb, bluetooth, { name: 'auto_null' }, { name: 'virtual-filter', properties: { 'device.class': 'abstract' } }];
let outputs = audioOutputs(sinks, [card], usb.name);
assert.equal(outputs.length, 3, 'Hide recording ports, disconnected HDMI and dummy outputs');
assert.equal(outputs.filter(item => item.selected).length, 1);
assert.equal(outputs.find(item => item.selected).label, 'Analog Output – Creative Stage SE');
assert.equal(outputs.find(item => item.sink === bluetooth.name).icon, 'audio-bluetooth');
const digital = outputs.find(item => item.port === 'iec958-output');
assert.equal(digital.profile, 'output:iec958-stereo+input:analog-stereo', 'Preserve the microphone profile when changing outputs');
assert.equal(digital.sink, '');
assert.deepEqual(audioOutputs([{ ...usb, card: 7, properties: {} }], [card], usb.name).map(item => item.id),
  audioOutputs([usb], [card], usb.name).map(item => item.id), 'Both server card formats identify the same ports');
const headphones = { ...usb, ports: [...usb.ports, { name: 'analog-output-headphones', description: 'Headphones', type: 'Headphones' }] };
assert.equal(audioOutputs([headphones], [card], usb.name).find(item => item.port === 'analog-output-headphones').icon, 'audio-headphones');
const hdmi = { ...usb, name: 'hdmi', active_port: 'hdmi-output-0', ports: [{ name: 'hdmi-output-0', description: 'HDMI', type: 'HDMI' }] };
assert.equal(audioOutputs([hdmi], [], hdmi.name)[0].icon, 'audio-display');

// Switching an existing device also moves playback, leaving streams already
// on the destination alone. Device names stay argv values, never shell code.
let commands = [];
await routeOutput(async args => {
  commands.push(args);
  if (args[2] === 'sinks') return JSON.stringify(sinks);
  if (args[2] === 'sink-inputs') return JSON.stringify([{ index: 80, sink: usb.index }, { index: 81, sink: bluetooth.index }]);
  return '';
}, outputs.find(item => item.sink === bluetooth.name));
assert.deepEqual(commands.filter(args => args[0] !== '--format=json'), [
  ['set-default-sink', bluetooth.name], ['move-sink-input', '80', bluetooth.name]
]);

// Profile changes create a sink asynchronously. Wait for that sink, select
// its physical port, then set the default; never write the old sink's volume.
commands = []; let profileChanged = false, reads = 0;
const spdif = { ...usb, name: 'alsa_output.usb.iec958-stereo', index: 30, active_port: 'other', ports: [{ name: 'iec958-output' }] };
await routeOutput(async args => {
  commands.push(args);
  if (args[0] === 'set-card-profile') profileChanged = true;
  if (args[2] === 'sinks') return JSON.stringify(profileChanged && ++reads > 1 ? [spdif] : []);
  if (args[2] === 'sink-inputs') return '[]';
  return '';
}, digital, async () => {});
assert.deepEqual(commands.filter(args => args[0] !== '--format=json'), [
  ['set-card-profile', card.name, digital.profile], ['set-sink-port', spdif.name, digital.port], ['set-default-sink', spdif.name]
]);
assert.deepEqual(channelVolumes([65536, 32768], 60), ['60.000%', '30.000%']);
await assert.rejects(routeOutput(async () => '[]', { sink: 'unplugged' }), /no longer available/);
await assert.rejects(routeOutput(async args => {
  if (args[2] === 'sinks') return JSON.stringify([usb]);
  throw new Error('Permission denied');
}, outputs.find(item => item.sink === usb.name)), /Permission denied/);

// A player can exit between listing and moving its stream.
let listed = false;
await routeOutput(async args => {
  if (args[2] === 'sinks') return JSON.stringify([bluetooth]);
  if (args[2] === 'sink-inputs') { const result = listed ? [] : [{ index: 80, sink: 12 }]; listed = true; return JSON.stringify(result); }
  if (args[0] === 'move-sink-input') throw new Error('No such entity');
  return '';
}, outputs.find(item => item.sink === bluetooth.name));
Log.info('Audio devices, physical ports, profile selection and playback routing: passed');

}
