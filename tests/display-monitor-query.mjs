import assert from 'node:assert/strict';
import { createDisplays, queryDisplayMonitors } from '../apps/displays-service.js';
import { createShellService } from '../apps/shell-service.js';

const panel = { id: 0, name: 'eDP-1', description: 'Panel', width: 1920, height: 1080,
  refreshRate: 60, scale: 1, x: 0, y: 0, transform: 0, disabled: false,
  mirrorOf: 'none', availableModes: ['1920x1080@60.00Hz'] };
const disabled = { ...panel, id: 1, name: 'DP-1', disabled: true };
const external = { ...panel, id: 1, name: 'DP-1', x: 1920 };

function setup(replies, onCommand = () => {}) {
  const requests = [];
  const send = async command => {
    requests.push(command);
    onCommand(command, replies);
    const reply = replies[command];
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const displays = createDisplays({ query: () => queryDisplayMonitors(send), send,
    load: () => ({}), save: async () => {}, delay: async () => {}, schedule: () => 0, cancel: () => {} });
  return { requests, displays, shell: createShellService({ displays }) };
}

let sample = setup({ 'j/monitors all': 'too many args', 'j/monitors': JSON.stringify([panel]) });
let result = JSON.parse(await sample.shell.request('GetDisplays'));
assert.deepEqual(result.monitors, [panel]);
assert.equal(result.canDisable, false, 'The UI can explain why Off is unavailable');
assert.equal(result.configs[0].name, 'eDP-1');
assert.deepEqual(sample.requests, ['j/monitors all', 'j/monitors']);
await sample.displays.restore();
await sample.displays.topologyChanged();
assert.deepEqual(sample.requests, Array(3).fill(['j/monitors all', 'j/monitors']).flat(),
  'Initial read, restore and topology queries use the same fallback');

sample = setup({ 'j/monitors all': 'too many args', 'j/monitors': JSON.stringify([panel, external]) }, (command, replies) => {
  if (command.startsWith('eval ')) {
    replies[command] = 'ok';
    replies['j/monitors'] = JSON.stringify([panel]);
  }
});
result = JSON.parse(await sample.shell.request('GetDisplays'));
const off = result.configs.map(config => config.name === external.name ? { ...config, enabled: false } : config);
await assert.rejects(sample.shell.request('ApplyDisplays', [JSON.stringify(off)]), /Off.*unavailable|cannot disable/i);
assert.deepEqual(sample.requests, ['j/monitors all', 'j/monitors', 'j/monitors all', 'j/monitors'],
  'Reject fallback Off before configerrors or eval can make the monitor list shrink');

sample = setup({ 'j/monitors all': JSON.stringify([panel, disabled]), 'j/monitors': 'unexpected query' });
result = JSON.parse(await sample.shell.request('GetDisplays'));
assert.deepEqual(result.monitors, [panel, disabled]);
assert.equal(result.canDisable, true, 'Full monitor queries keep Off available');
assert.deepEqual(sample.requests, ['j/monitors all'], 'Compatible servers retain disabled displays');

sample = setup({ 'j/monitors all': JSON.stringify([panel, external]), configerrors: '', reload: 'ok' }, (command, replies) => {
  if (command.startsWith('eval ')) {
    replies[command] = 'ok';
    replies['j/monitors all'] = JSON.stringify([panel, { ...external, disabled: true }]);
  }
});
result = JSON.parse(await sample.shell.request('GetDisplays'));
const fullOff = result.configs.map(config => config.name === external.name ? { ...config, enabled: false } : config);
const preview = JSON.parse(await sample.shell.request('ApplyDisplays', [JSON.stringify(fullOff)]));
assert(preview.pending, 'Full-query systems can preview Off');
assert.equal(preview.canDisable, true);
assert(sample.requests.some(command => command.startsWith('eval ')));

for (const reply of ['unknown request', '{bad json']) {
  sample = setup({ 'j/monitors all': reply, 'j/monitors': JSON.stringify([panel]) });
  await assert.rejects(sample.shell.request('GetDisplays'), /Hyprland j\/monitors all returned invalid JSON/);
  assert.deepEqual(sample.requests, ['j/monitors all'], 'Only the specific server reply triggers fallback');
}
sample = setup({ 'j/monitors all': 'too many args', 'j/monitors': 'not json' });
await assert.rejects(sample.shell.request('GetDisplays'), /Hyprland j\/monitors returned invalid JSON/);
assert.deepEqual(sample.requests, ['j/monitors all', 'j/monitors']);

sample = setup({ 'j/monitors all': '{}', 'j/monitors': JSON.stringify([panel]) });
await assert.rejects(sample.shell.request('GetDisplays'), /invalid monitor data/);
assert.deepEqual(sample.requests, ['j/monitors all']);

const unavailable = new Error('Hyprland unavailable');
sample = setup({ 'j/monitors all': unavailable, 'j/monitors': JSON.stringify([panel]) });
await assert.rejects(sample.shell.request('GetDisplays'), error => error === unavailable);
assert.deepEqual(sample.requests, ['j/monitors all']);
