import assert from './assert.js';
import * as Log from 'Helix/Log';
import { parseMode, monitorConfig, logicalSize, layoutView, snapPosition, arrangeDisplays,
  validateLayout, monitorRules, layoutKey, matchesLayout, validScale, validScales, nearestScale } from '../apps/displays-model.js';
import { createDisplays } from '../apps/displays-service.js';
import { createShellService } from '../apps/shell-service.js';

export async function test() {
const clone = x => JSON.parse(JSON.stringify(x));
const monitors = [
  { id: 0, name: 'eDP-1', description: 'Laptop', serial: 'a', width: 2560, height: 1440, refreshRate: 60, scale: 1.6, x: 0, y: 0,
    transform: 0, disabled: false, mirrorOf: 'none', vrr: true, availableModes: ['2560x1440@60.00Hz', '1920x1080@60.00Hz'], currentFormat: 'XRGB8888' },
  { id: 1, name: 'DP-1', description: 'External', serial: 'b', width: 3840, height: 2160, refreshRate: 144, scale: 2, x: 1600, y: 0,
    transform: 0, disabled: false, mirrorOf: 'none', availableModes: ['3840x2160@144.00Hz', '3840x2160@60.00Hz', '1920x1080@120.00Hz'] }
];
const baseline = monitors.map(m => monitorConfig(m));
assert.deepEqual(parseMode('3840x2160@143.98Hz'), { width: 3840, height: 2160, refresh: 143.98 });
assert.equal(parseMode('auto;os.execute("bad")'), null);
assert(!Object.hasOwn(baseline[0], 'vrr'), 'Active VRR is not its configured policy');
assert(!Object.hasOwn(baseline[0], 'icc'), 'Do not replace unreported compositor settings');
assert.deepEqual(logicalSize(baseline[0]), { width: 1600, height: 900 });
assert.deepEqual(logicalSize({ ...baseline[0], transform: 1 }), { width: 900, height: 1600 });
// 150% cannot divide a 2560px-wide panel into whole logical pixels. It is
// valid at 1920x1080 and 3840x2160; scale options must follow the chosen mode.
assert(!validScale({ ...baseline[0], scale: 1.5 }, monitors[0]));
assert(validScale({ ...baseline[0], scale: 1.6 }, monitors[0]));
assert(!validScales(baseline[0], monitors[0]).includes(1.5));
assert(validScales(baseline[0], monitors[0]).includes(1.6));
assert(validScales(baseline[1], monitors[1]).includes(1.5));
const fullHD = { ...baseline[0], mode: '1920x1080@60', scale: 1.5 };
assert(validScale(fullHD, monitors[0])); assert(validScales(fullHD, monitors[0]).includes(1.5));
assert.equal(nearestScale({ ...baseline[0], scale: 1.5 }, monitors[0]), 1.6);
assert.equal(nearestScale(fullHD, monitors[0]), 1.5);
const fractional = { ...baseline[0], scale: 4 / 3 };
assert(validScales(baseline[0], monitors[0]).includes(4 / 3));
assert(validScale(fractional, monitors[0]), 'Allow exact 1/120 steps despite float32 storage');
assert.deepEqual(logicalSize(fractional), { width: 1920, height: 1080 });
assert(!validScale({ ...baseline[0], scale: 1.28 }, monitors[0]), 'A mathematical divisor outside the float32/1/120 checks is not enough');
assert.deepEqual(validScales({ ...baseline[0], transform: 1 }, monitors[0]), validScales(baseline[0], monitors[0]));
assert.throws(() => validateLayout([{ ...baseline[0], scale: 1.5 }, baseline[1]], monitors), /whole logical pixels/);
const small = { ...baseline[0], mode: '1366x768@60', scale: 1 };
assert.deepEqual(validScales(small), [0.5, 2 / 3, 1, 2]);
// An existing working override remains editable when the compositor's scale
// checks were deliberately disabled. Changing its resolution checks afresh.
assert(validScale({ ...baseline[0], scale: 1.5 }, { ...monitors[0], scale: 1.5 }));
assert(!validScale({ ...baseline[0], mode: '3440x1440@60', scale: 1.5 }, { ...monitors[0], scale: 1.5 }));
assert.equal(validateLayout(baseline, monitors), baseline);
const view = layoutView(baseline, monitors, 800, 240);
assert.equal(view.rectangles[0].left + view.rectangles[0].w, view.rectangles[1].left);
assert.deepEqual(snapPosition(baseline[1], { x: 1591, y: 9 }, baseline, monitors), { x: 1600, y: 0 });
assert.deepEqual(arrangeDisplays([{ ...baseline[0], scale: 2 }, baseline[1]], monitors).map(c => c.x), [0, 1280]);
assert.equal(layoutKey(monitors), layoutKey([...monitors].reverse()));
assert.notEqual(layoutKey(monitors), layoutKey([{ ...monitors[0], serial: 'different' }, monitors[1]]));
assert.throws(() => validateLayout(baseline.map(c => ({ ...c, enabled: false })), monitors), /at least one/);
assert.throws(() => validateLayout([baseline[0], { ...baseline[1], x: 1500 }], monitors), /overlap/);
assert.throws(() => validateLayout([baseline[0], { ...baseline[1], mode: '4000x3000@120' }], monitors), /available resolution/);
assert.throws(() => validateLayout([baseline[0], { ...baseline[1], scale: NaN }], monitors), /geometry/);
assert.throws(() => validateLayout([baseline[0], { ...baseline[1], mirror: 'absent' }], monitors), /Mirror/);
assert.throws(() => validateLayout(baseline.map((c, i) => ({ ...c, mirror: baseline[1 - i].name })), monitors), /Mirror/);
assert.throws(() => validateLayout([baseline[0], { ...baseline[1], arbitrary: 'field' }], monitors), /Unknown/);
assert.throws(() => validateLayout([baseline[0], { ...baseline[1], sdr_max_luminance: 80.5 }], monitors), /Invalid/);
assert.throws(() => validateLayout([baseline[0], { ...baseline[1], icc: '/tmp/a\nfile' }], monitors), /profile/);
validateLayout([baseline[0], { ...baseline[1], mirror: 'eDP-1', x: 0 }], monitors);
validateLayout([baseline[0], { ...baseline[1], enabled: false }], monitors);
const quoted = monitorRules([{ ...baseline[0], name: 'DP-";malicious()--', icc: '/home/a "quoted" \\name.icc' }]);
assert(quoted.includes('output="DP-\\";malicious()--"'));
assert(quoted.includes('icc="/home/a \\"quoted\\" \\\\name.icc"'));
assert(!monitorRules(baseline).includes('vrr='));
assert(matchesLayout(baseline, monitors));
assert(!matchesLayout(baseline, [{ ...monitors[0], scale: 1 }, monitors[1]]));
const mirrored = [monitors[0], { ...monitors[1], mirrorOf: '0' }];
assert.equal(monitorConfig(mirrored[1], {}, mirrored).mirror, 'eDP-1');
assert(matchesLayout([baseline[0], { ...baseline[1], mirror: 'eDP-1' }], mirrored));
assert(!matchesLayout(baseline, mirrored), 'Turning mirroring off must actually stop mirroring');

let live, desired, failApply, saveFailure, errors, afterErrors, clock, timerId, timerFns, stored, writes, commands, reports, events;
const reset = () => {
  live = clone(monitors); desired = clone(monitors); failApply = false; saveFailure = false;
  errors = ''; afterErrors = ''; clock = 10000; timerId = 0; timerFns = new Map(); stored = {};
  writes = []; commands = []; reports = []; events = 0;
};
const make = () => createDisplays({
  query: async () => clone(live),
  send: async command => {
    commands.push(command);
    if (command === 'configerrors') return errors;
    if (command === 'reload') { live = clone(monitors.filter(m => live.some(c => c.name === m.name))); errors = ''; return 'ok'; }
    if (failApply) { failApply = false; return 'Invalid monitor'; }
    live = clone(desired.filter(m => live.some(c => c.name === m.name))); errors = afterErrors; return 'ok';
  }, load: () => stored,
  save: async text => { if (saveFailure) throw new Error('Disk full'); writes.push(JSON.parse(text)); },
  changed: () => events++, report: error => reports.push(error), delay: async () => {}, now: () => clock,
  schedule: fn => { timerFns.set(++timerId, fn); return timerId; }, cancel: id => timerFns.delete(id)
});
const newLayout = () => [{ ...baseline[0], scale: 2 }, { ...baseline[1], x: 1280, vrr: 2 }];
const setDesired = () => { desired[0].scale = 2; desired[1].x = 1280; };
reset(); let service = make();
assert.equal(commands.length, 0, 'Do not query displays before the shell is presented');
await assert.rejects(service.apply([{ ...baseline[0], scale: 1.5 }, baseline[1]]), /whole logical pixels/);
assert.equal(commands.length, 0, 'Reject an invalid scale before sending any compositor command');
setDesired(); let preview = await service.apply(newLayout());
assert(preview.pending); assert.equal(writes.length, 0); assert.equal(timerFns.size, 1);
assert.equal(commands.filter(c => c.startsWith('eval ')).length, 1, 'Update all monitor rules in one evaluation');
await service.topologyChanged();
assert((await service.read()).pending, 'Disabling a display generates a monitor event without changing the connected setup');
await assert.rejects(service.apply(newLayout()), /preview first/);
await assert.rejects(service.confirm('wrong'), /ended/);
await service.confirm(preview.pending.token);
assert.equal(writes.length, 1); assert.equal(timerFns.size, 0); assert.equal((await service.read()).pending, null);
assert.equal(writes[0].layouts[layoutKey(monitors)][1].vrr, 2);

reset(); service = make(); setDesired(); preview = await service.apply(newLayout());
clock += 20001; [...timerFns.values()][0](); await service.read();
assert(commands.includes('reload')); assert.equal(writes.length, 0); assert.equal((await service.read()).pending, null);
assert(commands.includes('eval ' + monitorRules(baseline)), 'Rollback must restore the previous geometry');
const afterRollback = commands.length; await service.configReloaded();
assert.equal(commands.length, afterRollback, 'Ignore a delayed notification of our own rollback reload');
reset(); service = make(); setDesired();
const applying = service.apply(newLayout()), closing = service.cancelPreview();
await Promise.all([applying, closing]);
assert.equal((await service.read()).pending, null, 'Closing during an in-flight apply must cancel the eventual preview');
assert.equal(writes.length, 0);
reset(); service = make(); setDesired(); preview = await service.apply(newLayout()); clock += 20001;
await assert.rejects(service.confirm(preview.pending.token), /expired/); assert.equal(writes.length, 0);
reset(); service = make(); failApply = true;
await assert.rejects(service.apply(newLayout()), /Invalid monitor/);
assert(commands.includes('reload')); assert.equal((await service.read()).pending, null);
reset(); service = make();
await assert.rejects(service.apply(newLayout()), /did not accept/);
assert(commands.includes('reload')); assert.equal(writes.length, 0);
reset(); service = make(); setDesired(); afterErrors = 'bad ICC profile';
await assert.rejects(service.apply(newLayout()), /bad ICC/); assert(commands.includes('reload'));
reset(); service = make(); setDesired(); preview = await service.apply(newLayout()); saveFailure = true;
await assert.rejects(service.confirm(preview.pending.token), /Disk full/); assert(commands.includes('reload'));
reset(); service = make(); setDesired(); preview = await service.apply(newLayout()); live.pop();
await assert.rejects(service.confirm(preview.pending.token), /Connected displays changed/); assert.equal(writes.length, 0);
reset(); stored = { version: 1, layouts: { [layoutKey(monitors)]: newLayout() } }; service = make();
await service.restore(); assert(commands[0].startsWith('eval '));
commands = []; live = [monitors[0]]; await service.restore();
assert.deepEqual(commands, ['reload'], 'Undocking must remove the previous dock rules without applying its profile');

// A monitor's disabled rule survives physical undocking. A missing profile
// must restore the compositor configuration and leave an enabled display.
let docked = true, panelDisabled = true, resetEnablesPanel = true;
const dockingCommands = [];
const dockMonitors = () => [{ ...monitors[0], disabled: panelDisabled }, ...(docked ? [monitors[1]] : [])];
const dockConfigs = [{ ...baseline[0], enabled: false }, baseline[1]];
const docking = createDisplays({ query: async () => dockMonitors(),
  send: async command => {
    dockingCommands.push(command);
    if (command === 'reload' && resetEnablesPanel) panelDisabled = false;
    if (!docked && command.startsWith('eval ') && command.includes('disabled=false')) panelDisabled = false;
    return 'ok';
  }, load: () => ({ version: 1, layouts: { [layoutKey(monitors)]: dockConfigs } }), save: async () => {}
});
await docking.restore(); docked = false; await docking.topologyChanged();
assert.equal(panelDisabled, false); assert(dockingCommands.includes('reload'));
assert.equal(dockingCommands.filter(c => c.startsWith('eval ')).length, 1, 'Do not apply the docked profile after unplugging it');
// If the fallback config also disables everything, enable the built-in panel.
docked = true; panelDisabled = true; await docking.topologyChanged();
docked = false; panelDisabled = true; resetEnablesPanel = false; await docking.topologyChanged();
assert.equal(panelDisabled, false);
assert(dockingCommands.at(-1).includes('mode="preferred"'));

let active = true;
const gated = createDisplays({ query: async () => { active = false; return monitors; }, send: async () => 'ok',
  load: () => ({}), save: () => assert.fail('Cannot save while inactive'), allowed: () => active });
await assert.rejects(gated.apply(newLayout()), /active unlocked/, 'Recheck session state after asynchronous queries');

reset(); service = make();
const shell = createShellService({ displays: service });
shell.update({ Active: false });
await assert.rejects(shell.request('ApplyDisplays', [JSON.stringify(newLayout())]), /active unlocked/);
assert.equal(commands.length, 0);
shell.update({ Active: true, ScreenState: 'unlocked' }); setDesired();
const reply = JSON.parse(await shell.request('ApplyDisplays', [JSON.stringify(newLayout())]));
await shell.request('RevertDisplays', [reply.pending.token]);
assert(commands.includes('reload'));
Log.info('Display geometry, monitor validation, Lua quoting, preview rollback, persistence and session gating: passed');

}
