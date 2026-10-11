import * as Process from 'Module/process';
import * as Log from 'Helix/Log';
import { clampVolume, channelVolumes } from './audio-model.js';

// Existing Koya APIs cover this platform integration. PulseAudio owns the real
// audio state; this cache and all button policy belong to the Koya frontend.
export function pulseAudio({ changed = () => {}, command = '/usr/bin/pactl' } = {}) {
  let snapshot = { available: false, percent: 0, muted: false, error: '' };
  let subscription, retry, retries = 0, buffer = '';
  let dirty = false, running = false, closed = false;
  const actions = [];
  const balances = new Map();
  const run = args => new Promise((resolve, reject) => {
    let child, stdout = '', stderr = '', settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(stdout);
    };
    const timer = setTimeout(() => { try { child?.kill(); } catch (_) {} finish(new Error('Audio server timed out')); }, 1800);
    try {
      child = Process.spawn({ cmd: '/usr/bin/env', args: ['LC_ALL=C', command, ...args] });
      child.stdout.on('data', chunk => {
        stdout += String(chunk);
        if (stdout.length > 4 * 1024 * 1024) {
          try { child.kill(); } catch (_) {}
          finish(new Error('Audio response too large'));
        }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
      child.on('exit', code => finish(code ? new Error(stderr.trim() || 'Audio command failed') : undefined));
    } catch (error) { finish(error); }
  });
  const publish = next => {
    const different = JSON.stringify(next) !== JSON.stringify(snapshot);
    snapshot = next;
    if (!closed && different) changed(snapshot);
  };
  const read = async () => {
    const [name, data] = await Promise.all([
      run(['get-default-sink']),
      run(['--format=json', 'list', 'sinks'])
    ]);
    const sink = JSON.parse(data).find(item => item.name === name.trim());
    if (!sink || sink.properties?.['device.class'] === 'abstract' || sink.name === 'auto_null')
      throw new Error('No audio output');
    const channels = Object.values(sink.volume).map(channel => Number(channel.value));
    if (!channels.length || channels.some(value => !Number.isFinite(value))) throw new Error('Invalid audio volume');
    const highest = Math.max(...channels);
    if (highest > 0) balances.set(sink.name, channels.map(value => value / highest));
    return { available: true, name: sink.name, index: sink.index, description: sink.description,
      channels, percent: Math.round(Math.max(...channels) * 100 / 65536), muted: !!sink.mute, error: '' };
  };
  const pump = async () => {
    if (running || closed) return;
    running = true;
    try {
      while (!closed && (dirty || actions.length)) {
        dirty = false;
        // Read the real default output before each transaction. A route change
        // during a write cannot send its channel values to another device.
        let next = await read();
        const pending = actions.splice(0);
        let percent, muted = next.muted;
        for (const action of pending) {
          if (action.kind === 'volume') { percent = action.value; if (percent > 0) muted = false; }
          else muted = !muted;
        }
        if (percent !== undefined) await run(['set-sink-volume', next.name, ...channelVolumes(next.channels, percent, balances.get(next.name))]);
        if (muted !== next.muted) await run(['set-sink-mute', next.name, muted ? '1' : '0']);
        if (pending.length) next = await read();
        publish(next);
      }
    } catch (error) {
      actions.length = 0; dirty = false;
      publish({ available: false, percent: 0, muted: false, error: String(error.message || error) });
      Log.error('Audio: ' + error);
    } finally { running = false; }
  };
  const refresh = () => {
    if (closed) return;
    if (!subscription) { retries = 0; listen(); }
    dirty = true; pump();
  };
  const listen = () => {
    if (closed || subscription) return;
    clearTimeout(retry); buffer = '';
    try {
      // A persistent event stream sleeps between changes. Parent death also
      // cleans it up if Koya exits unexpectedly.
      subscription = Process.spawn({ cmd: '/bin/setpriv', args: ['--pdeathsig', 'TERM', '/usr/bin/env', 'LC_ALL=C', command, 'subscribe'] });
      subscription.stdout.on('data', chunk => {
        buffer += String(chunk);
        const lines = buffer.split('\n'); buffer = lines.pop().slice(-4096);
        for (const line of lines) {
          const event = /^Event '(new|change|remove)' on (sink|server|card) #(\d+)/.exec(line);
          if (event && (event[2] !== 'sink' || event[1] !== 'change' || Number(event[3]) === snapshot.index)) refresh();
        }
      });
      subscription.on('exit', () => {
        subscription = undefined;
        if (closed) return;
        publish({ available: false, percent: 0, muted: false, error: 'Audio server disconnected' });
        // Bounded recovery, not an idle retry/polling loop. A button can retry.
        if (++retries <= 3) retry = setTimeout(() => { listen(); refresh(); }, 3000);
      });
    } catch (error) {
      subscription = undefined;
      Log.error('Audio subscription: ' + error);
    }
  };
  return {
    start: () => { listen(); refresh(); },
    setPercent: value => {
      if (closed) return;
      if (!subscription) { retries = 0; listen(); }
      const action = { kind: 'volume', value: clampVolume(value) };
      if (actions.at(-1)?.kind === 'volume') actions[actions.length - 1] = action; else actions.push(action);
      dirty = true; pump();
    },
    toggleMute: () => { if (closed) return; if (!subscription) { retries = 0; listen(); } actions.push({ kind: 'mute' }); dirty = true; pump(); },
    refresh,
    get snapshot() { return snapshot; },
    get busy() { return running; },
    dispose: () => { closed = true; clearTimeout(retry); try { subscription?.kill(); } catch (_) {} }
  };
}
