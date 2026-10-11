import * as Process from 'Module/process';
import * as Log from 'Helix/Log';
import { promptEvents, createPromptQueue } from './ssh-agent-model.js';
import { showSshPrompt } from './ssh-prompt.js';

export function startSshAgent() {
  const runtime = Process.getEnv('XDG_RUNTIME_DIR', ''), home = Process.getEnv('HOME', '');
  if (!runtime || !home) { Log.error('SSH integration requires XDG_RUNTIME_DIR and HOME'); return; }
  const root = Process.getEnv('KOYA_DESKTOP_ROOT', '.'), socket = runtime + '/koya-ssh/agent.sock';
  const inherited = Process.getEnv('SSH_AUTH_SOCK', '');
  const upstream = Process.getEnv('KOYA_SSH_UPSTREAM', '') || (inherited && inherited !== socket ? inherited : runtime + '/ssh-agent.socket');
  let child;
  const failed = () => Log.error('Koya SSH prompt could not be displayed');
  const queue = createPromptQueue({ show: showSshPrompt, reply: value => child.write(value), onError: failed });
  const stop = () => {
    queue.clear();
    try { child.closeStdin(); child.kill(); } catch (_) {}
  };
  try {
    child = Process.spawn({ cmd: root + '/build/native/modules/koya-ssh-agent', args: [
      '--agent-socket', socket, '--prompt-socket', runtime + '/koya-ssh/prompt.sock', '--upstream', upstream, '--key-dir', home + '/.ssh'
    ] });
    const receive = promptEvents(event => queue.receive(event));
    child.stdout.on('data', chunk => { try { receive(chunk); } catch (_) { Log.error('Koya SSH prompt transport failed'); stop(); } });
    child.stderr.on('data', () => Log.error('Koya SSH agent startup failed'));
    child.on('exit', () => { queue.clear(); Log.error('Koya SSH agent stopped'); });
    return { stop, socket, upstream };
  } catch (_) { Log.error('Koya SSH agent could not start'); stop(); }
}
