import assert from './assert.js';
import * as Log from 'Helix/Log';
import { createUpdates, parseUpdates, updatesIndicator, updateDefaults, advanceProgress, startProgress, completeProgress, progressStep, needsRestart, majorChange } from '../apps/updates-model.js';
import { settingValue, readSettings } from '../apps/settings-model.js';
import { createShellService } from '../apps/shell-service.js';

export async function test() {
const repo = 'linux 6.18-1 -> 6.19-1\n';
// Includes output captured from the installed yay, which appends package age.
const aur = 'visual-studio-code-bin 1.139.1-1 -> 1.142.0-1 [3d22h]\ngoogle-chrome 154.0.8037.92-1 -> 155.0.8059.84-1 [1d19h]\n';
assert.equal(parseUpdates(aur, 'AUR').length, 2);
assert.equal(parseUpdates('\x1b[32m' + repo + '\x1b[0m', 'Repository')[0].name, 'linux');
assert.throws(() => parseUpdates('connection failed', 'AUR'), /Unexpected/);
assert.equal(parseUpdates(repo + repo, 'Repository').length, 1);
assert.equal(settingValue('UpdatesCheckInterval', '0'), 0);
assert.equal(settingValue('UpdatesCheckInterval', '73'), 73);
for (const value of ['', null, false, true, 'NaN', Infinity, '14', '-1', '10081', '60.5'])
  assert.throws(() => settingValue('UpdatesCheckInterval', value), /Invalid/);
assert.equal(settingValue('UpdatesIncludeAUR', 'false'), false);
assert.equal(settingValue('UpdatesHideWhenEmpty', 'true'), true);
assert.equal(settingValue('UpdatesHideWhenEmpty', 'false'), false);
assert.throws(() => settingValue('UpdatesHideWhenEmpty', 'yes'), /Invalid/);
assert.deepEqual(Object.fromEntries(Object.keys(updateDefaults).map(key => [key, readSettings({})[key]])), updateDefaults);

const emptyBar = { UpdatesAvailable: true, UpdatesCount: 0 };
assert.equal(updatesIndicator({ ...readSettings({}), ...emptyBar }).visible, true, 'Keep the icon visible by default');
const hideEmpty = { ...readSettings({ UpdatesHideWhenEmpty: true }), ...emptyBar };
assert.equal(updatesIndicator(hideEmpty).visible, false);
for (const activity of [{ UpdatesCount: 2 }, { UpdatesChecking: true }, { UpdatesInstalling: true }, { UpdatesError: 'Offline' }])
  assert.equal(updatesIndicator({ ...hideEmpty, ...activity }).visible, true, 'Updates, activity and errors stay visible');
assert.equal(updatesIndicator({ ...hideEmpty, UpdatesAvailable: false, UpdatesCount: 2 }).visible, false);

let time = 100000, nextTimer = 0, hold, release, repoResult, aurResult, approval = 0, upgrade = 0;
const timers = new Map(), calls = [], summaries = [], missing = new Set();
const result = (stdout = '', code = 0, stderr = '') => ({ code, stdout, stderr });
repoResult = result(repo); aurResult = result(aur);
const backend = createUpdates({ settings: readSettings({}), exists: path => !missing.has(path), now: () => time,
  schedule: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, cancel: id => timers.delete(id),
  changed: value => summaries.push(value), run: async (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (cmd.endsWith('/checkupdates')) { if (hold) await hold; return repoResult; }
    if (args[0] === '-Qua') return aurResult;
    if (args[0] === '-A' && args[1] === '-v') return result('', approval, approval ? 'Approval cancelled' : '');
    options.onOutput('Downloading…\n'); options.onOutput('\x1b[32mUpgrade output\x1b[0m\n');
    repoResult = result('', 2); aurResult = result('', 1);
    return result('', upgrade, upgrade ? 'Package database is locked' : '');
  } });
backend.start();
await backend.check();
assert.equal(backend.snapshot().packages.length, 3);
assert.equal(backend.summary().UpdatesCount, 3);
assert.equal(backend.summary().UpdatesCheckedAt, time);
assert.equal(timers.size, 1);
assert.equal([...timers.values()][0].delay, 3600000);
assert.deepEqual(calls[0].args, ['--nocolor']);
assert.deepEqual(calls[1].args, ['-Qua', '--color', 'never']);
assert.equal(updatesIndicator(backend.summary()).text, '3');

// Serialize checks and prevent any upgrade while a check is in flight.
hold = new Promise(resolve => { release = resolve; });
const check = backend.check();
assert.equal(backend.check(), check);
assert.throws(() => backend.install(), /busy/);
assert.deepEqual(updatesIndicator(backend.summary()), { visible: true, busy: true, warning: false, text: '' });
release(); await check; hold = undefined;

// Offline and malformed sources preserve previous counts, marked stale.
time += 1000; aurResult = result('', 1, 'DNS lookup failed');
await backend.check();
assert.match(backend.snapshot().error, /DNS/);
assert.equal(backend.summary().UpdatesCount, 3);
assert.equal(backend.summary().UpdatesCheckedAt, time - 1000);
assert.deepEqual(updatesIndicator(backend.summary()), { visible: true, busy: false, warning: true, text: '3' });
aurResult = result('unexpected protocol response');
await backend.check();
assert.match(backend.snapshot().error, /Unexpected/);
assert.equal(backend.summary().UpdatesCount, 3);
missing.add('/usr/bin/checkupdates');
await backend.check();
assert.match(backend.snapshot().error, /pacman-contrib/);
missing.clear(); aurResult = result(aur);

// Disable checks immediately; manual checks do not re-enable the timer.
backend.configure({ UpdatesCheckInterval: 0, UpdatesIncludeAUR: true });
assert.equal(timers.size, 0);
await backend.check(); assert.equal(timers.size, 0);
backend.configure({ UpdatesCheckInterval: 30, UpdatesIncludeAUR: true });
assert.equal([...timers.values()][0].delay, 1800000);
backend.configure({ UpdatesCheckInterval: 0, UpdatesIncludeAUR: false });
const before = calls.length;
await backend.check();
assert.equal(calls.length, before + 1, 'Disabling AUR excludes AUR queries');
assert.equal(backend.snapshot().packages.length, 1);
backend.configure({ UpdatesCheckInterval: 0, UpdatesIncludeAUR: true });

// Authentication refusal never invokes an installer.
approval = 1;
const attempts = calls.length;
await backend.install();
assert.equal(calls.length, attempts + 1);
assert.match(backend.snapshot().error, /cancelled/);
assert(!backend.snapshot().authenticating && !backend.snapshot().installing);
approval = 0;
await backend.install();
assert.equal(backend.snapshot().packages.length, 0);
assert.equal(backend.snapshot().error, '');
assert.equal(backend.snapshot().message, 'Updates installed');
assert.match(backend.snapshot().log, /Upgrade output/);
assert.equal(backend.snapshot().progress.phase, 'done', 'A finished installation keeps its progress');
assert(!backend.snapshot().log.includes('\x1b'));
const installer = calls.find(call => call.args[0] === '-Syu');
assert.equal(installer.cmd, '/usr/bin/yay', 'AUR builds must run as the session user');
assert.deepEqual(installer.args, ['-Syu', '--noconfirm', '--color', 'never', '--sudo', '/usr/bin/sudo', '--sudoflags', '-A']);
assert(!installer.options.timeout, 'Never time out a package installation');
assert(summaries.some(value => value.UpdatesAuthenticating));
upgrade = 1;
await backend.install();
assert.match(backend.snapshot().error, /database is locked/);
assert(!backend.snapshot().installing);
missing.add('/usr/bin/yay');
repoResult = result(repo);
const withoutYay = calls.length;
await backend.check();
assert.equal(backend.summary().UpdatesAURAvailable, false);
assert.equal(backend.snapshot().error, '');
assert.deepEqual(backend.snapshot().packages, parseUpdates(repo, 'Repository'));
assert.equal(calls.length, withoutYay + 1, 'Missing yay silently skips AUR checks');
upgrade = 0;
const fallback = calls.length;
await backend.install();
assert.equal(backend.snapshot().error, '');
assert.deepEqual(calls[fallback + 1].args, ['-A', '/usr/bin/pacman', '-Syu', '--noconfirm', '--color', 'never']);
assert(!calls.slice(fallback).some(call => call.cmd === '/usr/bin/yay'));
missing.clear();
assert.equal(backend.summary().UpdatesAURAvailable, true);
backend.configure({ UpdatesCheckInterval: 60, UpdatesIncludeAUR: true });
backend.dispose(); assert.equal(timers.size, 0);
const last = calls.length; await backend.check(); assert.equal(calls.length, last);

let ran = 0, saved, opened;
const service = createShellService({ stored: {}, updates: { snapshot: () => ({ packages: [] }), check: () => { ran++; }, install: () => { ran++; } },
  persist: async value => { saved = JSON.parse(value); }, openBuiltin: name => { opened = name; } });
service.update({ ScreenState: 'locked' });
await assert.rejects(service.request('InstallUpdates'), /unlocked/); assert.equal(ran, 0);
service.update({ ScreenState: 'unlocked', Active: false });
await assert.rejects(service.request('InstallUpdates'), /active/); assert.equal(ran, 0);
service.update({ Active: true });
await service.request('InstallUpdates'); assert.equal(ran, 1);
await service.request('CheckUpdates'); assert.equal(ran, 2);
assert.deepEqual(JSON.parse(await service.request('GetUpdates')), { packages: [] });
await service.request('OpenUpdates'); assert.equal(opened, 'updates');
await service.request('SetSetting', ['UpdatesCheckInterval', '180']);
assert.equal(saved.UpdatesCheckInterval, 180);
service.update({ UpdatesAvailable: true, UpdatesCount: 0 });
await service.request('SetSetting', ['UpdatesHideWhenEmpty', 'true']);
assert.equal(saved.UpdatesHideWhenEmpty, true);
assert.equal(updatesIndicator(service.snapshot()).visible, false, 'Saved preference immediately reaches the bar');
await service.request('SetSetting', ['UpdatesHideWhenEmpty', 'false']);
assert.equal(updatesIndicator(service.snapshot()).visible, true);
service.update({ UpdatesInstalling: true });
await assert.rejects(service.request('SetSetting', ['UpdatesIncludeAUR', 'false']), /finish/);
assert.equal(saved.UpdatesIncludeAUR, true);
Log.info('OS update parsing, scheduling, failures, authentication and shell integration: passed');

// Installation progress from pacman's and yay's plain (non-terminal) output,
// arriving in arbitrary chunks.
const list = [{ name: 'linux', current: '6.18-1', next: '6.19-1' }, { name: 'mesa', current: '1:25.2-1', next: '1:25.2.1-1' },
  { name: 'google-chrome', current: '154-1', next: '155-1' }];
let progress = startProgress(list);
const feed = text => { progress = advanceProgress(progress, text); return progress; };
assert.equal(progress.phase, 'approval');
feed(':: Synchronizing package databases...\n core downloading...\n'); assert.equal(progress.phase, 'refresh');
feed(':: Starting full system upgrade...\n:: Retrieving packages...\n linux-6.19-1-x86_64 downloading...\n'); assert.equal(progress.phase, 'download');
feed('(2/2) checking keys in keyring\n(2/2) checking package integrity\n'); assert.equal(progress.phase, 'verify');
feed(':: Processing package changes...\n(1/2) upgra'); assert.equal(progress.current, '', 'A partial line waits for the rest');
feed('ding linux\n'); assert.deepEqual([progress.phase, progress.current, progress.done], ['install', 'linux', []]);
feed('(2/2) upgrading mesa\n'); assert.deepEqual([progress.current, progress.done], ['mesa', ['linux']]);
feed(':: Running post-transaction hooks...\n(1/3) Arming ConditionNeedsUpdate...\n');
assert.deepEqual([progress.phase, progress.current, progress.done], ['hooks', '', ['linux', 'mesa']]);
feed('==> Making package: google-chrome 155-1 (Sun 19 Oct 2026)\n'); assert.deepEqual([progress.phase, progress.current], ['build', 'google-chrome']);
feed('==> Finished making: google-chrome 155-1\nloading packages...\nupgrading google-chrome...\n'); assert.deepEqual([progress.phase, progress.current], ['install', 'google-chrome']);
assert.deepEqual(progressStep(progress), { done: 2, total: 3 });
feed('(1/1) installing chrome-dependency\n'); assert.deepEqual(progressStep(progress), { done: 3, total: 3 }, 'Dependencies are not counted');
assert.equal(completeProgress(progress).phase, 'done');
assert.deepEqual(progressStep(completeProgress(startProgress(list))), { done: 3, total: 3 });
assert(needsRestart('linux') && needsRestart('linux-zen') && needsRestart('nvidia-open') && needsRestart('systemd'));
assert(!needsRestart('linux-headers') && !needsRestart('linux-api-headers') && !needsRestart('systemd-libs') && !needsRestart('firefox'));
assert(majorChange('154.0.1-1', '155.0.1-1') && majorChange('1:2.0-1', '2:1.0-1') && majorChange('9-1', '10-1'));
assert(!majorChange('6.18-1', '6.18.2-1') && !majorChange('1:25.2-1', '1:25.2.1-1'));
Log.info('OS update installation progress: passed');

}
