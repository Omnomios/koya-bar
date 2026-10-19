export const UPDATE_INTERVALS = [0, 15, 30, 60, 180, 360, 720, 1440];
export const updateDefaults = { UpdatesCheckInterval: 60, UpdatesIncludeAUR: true };
export const intervalLabel = minutes => minutes === 0 ? 'Manual only' : minutes < 60 || minutes % 60 ? `Every ${minutes} minutes`
  : minutes === 60 ? 'Every hour' : minutes === 1440 ? 'Every day' : `Every ${minutes / 60} hours`;
export const cleanOutput = text => String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');

export function parseUpdates(output, source) {
  const packages = new Map();
  for (const line of cleanOutput(output).split('\n')) {
    if (!line.trim()) continue;
    const match = /^([a-zA-Z0-9@_+][a-zA-Z0-9@._+\-]*)\s+(\S+)\s+->\s+(\S+)(?:\s+\[[^\]]+\])?\s*$/.exec(line);
    if (!match) throw new Error('Unexpected update list from ' + source);
    packages.set(match[1], { name: match[1], current: match[2], next: match[3], source });
  }
  return [...packages.values()];
}

// The bar chip: the glyph, the count when there is one, a throbber while
// busy and a warning dot when the last check failed.
export function updatesIndicator(state) {
  const busy = !!(state.UpdatesInstalling || state.UpdatesChecking);
  return { visible: !!state.UpdatesAvailable, busy, warning: !busy && !!state.UpdatesError,
    text: busy || !(state.UpdatesCount > 0) ? '' : String(state.UpdatesCount) };
}

// "Checked 5 min ago": when, relative to now.
export const sinceLabel = (ms, now = Date.now()) => {
  const minutes = Math.floor((now - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' min ago';
  if (minutes < 24 * 60) return Math.floor(minutes / 60) + ' h ago';
  const days = Math.floor(minutes / (24 * 60));
  return days === 1 ? 'yesterday' : days + ' days ago';
};

// Packages whose new version only takes effect after a restart.
export const needsRestart = name => /^(linux(-lts|-zen|-hardened|-rt|-rt-lts)?|linux-firmware(-.+)?|(amd|intel)-ucode|systemd|glibc|nvidia(-.+)?)$/.test(name);
// A change of epoch or leading version number, as opposed to a patch release.
const lead = version => { const match = /^(?:(\d+):)?(\d+)/.exec(String(version)); return match ? (match[1] || '0') + ':' + match[2] : String(version); };
export const majorChange = (current, next) => lead(current) !== lead(next);

// Installation progress, read from pacman and yay output a line at a time
// (the log is trimmed, so this keeps its own account). Without a terminal
// pacman prints its steps as plain lines: "(2/5) upgrading linux".
export const PHASES = { approval: 'Waiting for approval', refresh: 'Refreshing', download: 'Downloading', verify: 'Checking packages',
  build: 'Building', install: 'Installing', hooks: 'Finishing', done: 'Done' };
export const startProgress = packages => ({ phase: 'approval', current: '', done: [], packages: packages.map(item => ({ ...item })), rest: '' });
const VERIFY = /^(?:\(\s*\d+\/\d+\)\s+)?(checking keys in keyring|checking keyring|checking package integrity|loading package files|checking for file conflicts|checking available disk space)/;
const CHANGE = /^(?:\(\s*\d+\/\d+\)\s+)?(?:upgrading|installing|reinstalling|downgrading) (\S+?)(?:\.\.\.)?$/;
export function advanceProgress(progress, chunk) {
  const next = { ...progress, done: [...progress.done] };
  const finish = () => { if (next.current && !next.done.includes(next.current)) next.done.push(next.current); next.current = ''; };
  const lines = (progress.rest + cleanOutput(chunk)).split('\n');
  next.rest = lines.pop().slice(-1024);
  for (const raw of lines) {
    const line = raw.trim();
    let match;
    if (/^:: Synchronizing package databases/.test(line)) next.phase = 'refresh';
    // Databases also print "core downloading..." while refreshing.
    else if (/^:: Retrieving packages/.test(line)) next.phase = 'download';
    else if (VERIFY.test(line)) { finish(); next.phase = 'verify'; }
    else if ((match = /^==> Making package: (\S+)/.exec(line))) { finish(); next.phase = 'build'; next.current = match[1]; }
    else if (/^==> Finished making: /.test(line)) next.current = '';
    else if ((match = CHANGE.exec(line))) { finish(); next.phase = 'install'; next.current = match[1]; }
    else if (/^:: Running post-transaction hooks/.test(line)) { finish(); next.phase = 'hooks'; }
  }
  return next;
}
// Done: everything that was to be updated, plus whatever the output named.
export const completeProgress = progress => ({ ...progress, phase: 'done', current: '', rest: '',
  done: [...new Set([...progress.done, ...(progress.current ? [progress.current] : []), ...progress.packages.map(item => item.name)])] });
// How far along: packages from the list finished, of those to do.
export const progressStep = progress => {
  const names = new Set(progress.packages.map(item => item.name));
  return { done: progress.done.filter(name => names.has(name)).length, total: names.size };
};

// One scheduler and operation owner for every bar and updates window.
// Commands are injected so checks never need a real package transaction in tests.
export function createUpdates({ run, exists, changed = () => {}, now = () => Date.now(),
  schedule = setTimeout, cancel = clearTimeout, settings = {} }) {
  let options = { ...updateDefaults, ...settings }, timer, running, disposed = false, revision = 0;
  let state = { available: exists('/usr/bin/pacman'), checking: false, installing: false, authenticating: false,
    checkedAt: 0, packages: [], error: '', log: '', message: '', progress: null };
  const snapshot = () => ({ ...state, packages: state.packages.map(item => ({ ...item })),
    progress: state.progress && { ...state.progress, done: [...state.progress.done], packages: state.progress.packages.map(item => ({ ...item })) } });
  const summary = () => ({ UpdatesAvailable: state.available, UpdatesChecking: state.checking, UpdatesInstalling: state.installing,
    UpdatesAuthenticating: state.authenticating, UpdatesCheckedAt: state.checkedAt, UpdatesCount: state.packages.length,
    UpdatesError: state.error, UpdatesRevision: revision });
  const publish = values => { state = { ...state, ...values }; revision++; if (!disposed) changed(summary()); };
  const arm = () => {
    cancel(timer); timer = undefined;
    if (!disposed && state.available && options.UpdatesCheckInterval > 0)
      timer = schedule(() => check(), options.UpdatesCheckInterval * 60000);
  };
  const read = async () => {
    const packages = [], errors = [];
    const sources = [{ name: 'Repository', command: '/usr/bin/checkupdates', args: ['--nocolor'], empty: 2,
      missing: 'Install pacman-contrib to check repository updates.' }];
    if (options.UpdatesIncludeAUR) sources.push({ name: 'AUR', command: '/usr/bin/yay', args: ['-Qua', '--color', 'never'], empty: 1,
      missing: 'Install yay to check and install AUR updates.' });
    for (const source of sources) {
      try {
        if (!exists(source.command)) throw new Error(source.missing);
        const result = await run(source.command, source.args, { timeout: 120000 });
        // yay uses 1 both for an empty query and for errors. Only a completely
        // empty response is an empty list; network failures must stay errors.
        if (result.code !== 0 && !(result.code === source.empty && !result.stdout.trim() && !result.stderr.trim()))
          throw new Error(cleanOutput(result.stderr).trim() || source.name + ' update check failed');
        packages.push(...parseUpdates(result.stdout, source.name));
      } catch (error) {
        errors.push(String(error.message || error));
        packages.push(...state.packages.filter(item => item.source === source.name));
      }
    }
    const unique = [...new Map(packages.map(item => [item.name, item])).values()].sort((a, b) => a.name.localeCompare(b.name));
    publish({ packages: unique, error: errors.join('\n'), ...(errors.length ? {} : { checkedAt: now() }) });
  };
  const check = () => {
    if (disposed || running || !state.available) return running || Promise.resolve();
    cancel(timer);
    // A new check starts afresh: the last installation's progress goes.
    publish({ checking: true, message: 'Checking for updates…', progress: null });
    running = Promise.resolve().then(read).finally(() => {
      running = undefined; publish({ checking: false, message: '' }); arm();
    });
    return running;
  };
  const install = () => {
    if (disposed || running || !state.available) throw new Error('Updates are busy or unavailable');
    if (options.UpdatesIncludeAUR && !exists('/usr/bin/yay')) throw new Error('Install yay to update AUR packages.');
    cancel(timer);
    publish({ installing: true, authenticating: true, error: '', log: '', message: 'Waiting for administrator approval…', progress: startProgress(state.packages) });
    running = Promise.resolve().then(async () => {
      try {
        const approval = await run('/usr/bin/sudo', ['-A', '-v'], { timeout: 120000 });
        if (approval.code !== 0) throw new Error(cleanOutput(approval.stderr).trim() || 'Administrator approval was cancelled.');
        publish({ authenticating: false, message: 'Installing updates…', progress: { ...state.progress, phase: 'refresh' } });
        const onOutput = chunk => publish({ log: (state.log + cleanOutput(chunk)).slice(-32768), progress: advanceProgress(state.progress, chunk) });
        const result = options.UpdatesIncludeAUR
          ? await run('/usr/bin/yay', ['-Syu', '--noconfirm', '--color', 'never', '--sudo', '/usr/bin/sudo', '--sudoflags', '-A'], { onOutput })
          : await run('/usr/bin/sudo', ['-A', '/usr/bin/pacman', '-Syu', '--noconfirm', '--color', 'never'], { onOutput });
        if (result.code !== 0) throw new Error(cleanOutput(result.stderr).trim() || 'Installation failed. See the installation log.');
        publish({ message: 'Updates installed. Checking again…', progress: completeProgress(state.progress) });
        await read();
        publish({ message: 'Updates installed' });
      } catch (error) { publish({ error: String(error.message || error), message: 'Updates were not completed' }); }
      finally { running = undefined; publish({ installing: false, authenticating: false }); arm(); }
    });
    return running;
  };
  return { snapshot, summary, check, install,
    start: () => { publish({}); if (options.UpdatesCheckInterval > 0) check(); },
    configure: value => {
      const next = { UpdatesCheckInterval: value.UpdatesCheckInterval, UpdatesIncludeAUR: value.UpdatesIncludeAUR };
      const sourceChanged = options.UpdatesIncludeAUR !== next.UpdatesIncludeAUR;
      if (options.UpdatesCheckInterval === next.UpdatesCheckInterval && !sourceChanged) return;
      options = next;
      if (sourceChanged) publish({ checkedAt: 0, packages: [], error: '' });
      if (!running) arm();
    },
    dispose: () => { disposed = true; cancel(timer); }
  };
}
