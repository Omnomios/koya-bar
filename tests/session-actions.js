import assert from './assert.js';
import * as Log from 'Helix/Log';
import { createSessionActions, logoutHyprland } from '../apps/session-actions.js';
import { createShellService } from '../apps/shell-service.js';

export async function test() {
let locks = 0, logouts = 0, hold, release;
const calls = [], capabilities = { CanSuspend: 'challenge', CanHibernate: 'no', CanReboot: 'yes', CanPowerOff: 'yes' };
const actions = createSessionActions({
  lock: async () => { locks++; }, logout: async () => { logouts++; },
  bus: { connect: async () => {}, call: async (...args) => {
    calls.push(args);
    if (args[3].startsWith('Can')) return capabilities[args[3]];
    if (args[3] === 'Reboot' && hold) await hold;
  } }
});
assert.equal(calls.length, 0, 'Capability checks must not delay first presentation');
const list = await actions.list();
assert.deepEqual(list.map(item => item.id), ['lock', 'logout', 'suspend', 'restart', 'shutdown']);
assert(list.filter(item => ['logout', 'restart', 'shutdown'].includes(item.id)).every(item => item.confirmation && item.confirmLabel));
await actions.run('lock'); await actions.run('logout');
assert.equal(locks, 1); assert.equal(logouts, 1);
await actions.run('restart');
assert.deepEqual(calls.at(-1), ['org.freedesktop.login1', '/org/freedesktop/login1', 'org.freedesktop.login1.Manager', 'Reboot', 'b', true]);
await assert.rejects(actions.run('arbitrary-command'), /Unknown/);
capabilities.CanPowerOff = 'no';
await assert.rejects(actions.run('shutdown'), /unavailable/);
assert(!calls.some(call => call[3] === 'PowerOff'), 'Do not issue unavailable power actions');
hold = new Promise(resolve => { release = resolve; });
const reboot = actions.run('restart');
await assert.rejects(actions.run('suspend'), /already in progress/);
release(); await reboot; hold = undefined;
const unavailable = createSessionActions({ bus: { connect: async () => { throw new Error('No logind'); } } });
assert.deepEqual((await unavailable.list()).map(item => item.id), ['lock', 'logout']);

// Session state gates actions centrally, including calls from another window.
const service = createShellService({ sessionActions: actions });
assert.equal(JSON.parse(await service.request('GetSessionActions')).length, 4);
service.update({ Active: false });
await assert.rejects(service.request('RunSessionAction', ['lock']), /active unlocked/);
service.update({ Active: true, ScreenState: 'locked' });
await assert.rejects(service.request('RunSessionAction', ['logout']), /active unlocked/);
assert.equal(locks, 1); assert.equal(logouts, 1);
service.update({ ScreenState: 'unlocked' });
await service.request('RunSessionAction', ['lock']); assert.equal(locks, 2);

// Use the compositor's exit dispatcher, with compatibility for older Hyprland.
const commands = [];
await logoutHyprland(async command => { commands.push(command); return 'ok'; });
assert.deepEqual(commands, ['dispatch hl.dsp.exit()']);
commands.length = 0;
await logoutHyprland(async command => { commands.push(command); return commands.length === 1 ? 'Invalid dispatcher' : 'ok'; });
assert.deepEqual(commands, ['dispatch hl.dsp.exit()', 'dispatch exit']);
await assert.rejects(logoutHyprland(async () => 'Failed'), /could not end/);
Log.info('Session actions, logind capabilities, state gating and compositor logout: passed');

}
