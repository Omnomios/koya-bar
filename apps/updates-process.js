import * as Process from 'Module/process';
import { createUpdates } from './updates-model.js';

export function runUpdateCommand(command, args, { timeout = 0, onOutput } = {}) {
  return new Promise((resolve, reject) => {
    let child, timer, stdout = '', stderr = '', settled = false, pending = '', outputTimer;
    const flush = () => { clearTimeout(outputTimer); outputTimer = undefined; if (pending) { onOutput?.(pending); pending = ''; } };
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); flush();
      if (error) reject(error); else resolve({ code: 0, stdout, stderr });
    };
    try {
      child = Process.spawn({ cmd: '/usr/bin/env', args: ['LC_ALL=C', command, ...args] });
      // No terminal reads: sudo uses askpass; the GUI approves the full upgrade.
      child.closeStdin();
      const receive = (chunk, error) => {
        const value = String(chunk);
        if (error) stderr = (stderr + value).slice(-16384); else stdout += value;
        if (onOutput) {
          stdout = stdout.slice(-32768); pending = (pending + value).slice(-32768);
          if (!outputTimer) outputTimer = setTimeout(flush, 200);
        } else if (stdout.length > 4 * 1024 * 1024) {
          child.kill(); finish(new Error('Update list is too large'));
        }
      };
      child.stdout.on('data', chunk => receive(chunk, false));
      child.stderr.on('data', chunk => receive(chunk, true));
      child.on('exit', code => {
        if (settled) return;
        settled = true; clearTimeout(timer); flush(); resolve({ code: Number(code), stdout, stderr });
      });
      if (timeout) timer = setTimeout(() => { child.kill(); finish(new Error('Update command timed out')); }, timeout);
    } catch (error) { finish(error); }
  });
}

export function updatesService(options) {
  return createUpdates({ ...options, run: runUpdateCommand, exists: path => Process.exists(path) });
}
