import * as Process from 'Module/process';
import * as Log from 'Helix/Log';
import { promptEvents, createPromptQueue } from './ssh-agent-model.js';
import { showSshPrompt } from './authentication-prompt.js';

export function startSshAgent(authentication) {
  const runtime = Process.getEnv('XDG_RUNTIME_DIR', ''), home = Process.getEnv('HOME', '');
  if (!runtime || !home) { Log.error('SSH integration requires XDG_RUNTIME_DIR and HOME'); return; }
  const root = Process.getEnv('KOYA_DESKTOP_ROOT', '.'), socket = runtime + '/koya-ssh/agent.sock';
  const inherited = Process.getEnv('SSH_AUTH_SOCK', '');
  const upstream = Process.getEnv('KOYA_SSH_UPSTREAM', '') || (inherited && inherited !== socket ? inherited : runtime + '/ssh-agent.socket');
  let child, stopping = false, ready = false;
  const failed = () => Log.error('Koya SSH prompt could not be displayed');
  const queue = authentication ? { receive: event => authentication.ssh(event, value => child.write(value)), clear: authentication.clearSsh }
    : createPromptQueue({ show: showSshPrompt, reply: value => child.write(value), onError: failed });
  const stop = () => {
    stopping = true;
    queue.clear();
    try { child.closeStdin(); child.kill(); } catch (_) {}
  };
  try {
    child = Process.spawn({ cmd: root + '/build/native/modules/koya-ssh-agent', args: [
      '--agent-socket', socket, '--prompt-socket', runtime + '/koya-ssh/prompt.sock', '--upstream', upstream, '--key-dir', home + '/.ssh'
    ] });
    const receive = promptEvents(event => {
      if (event.type === 'ready') ready = true;
      return queue.receive(event);
    });
    child.stdout.on('data', chunk => { try { receive(chunk); } catch (_) { Log.error('Koya SSH prompt transport failed'); stop(); } });
    child.stderr.on('data', () => Log.error('Koya SSH proxy startup failed'));
    child.on('exit', code => {
      queue.clear();
      if (stopping || (ready && code === 0)) Log.info('Koya SSH proxy stopped');
      else Log.error('Koya SSH proxy ' + (ready ? 'exited unexpectedly' : 'failed to start')
        + ' (exit code ' + code + '); agent socket unavailable: ' + socket);
    });
    return { stop, socket, upstream };
  } catch (_) { Log.error('Koya SSH proxy could not start'); stop(); }
}
