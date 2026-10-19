const NAME = 'org.freedesktop.login1', PATH = '/org/freedesktop/login1', MANAGER = NAME + '.Manager';
export const SESSION_ACTIONS = [
  { id: 'lock', label: 'Lock', icon: 'lock' },
  { id: 'logout', label: 'Log Out…', confirmLabel: 'Log Out', icon: 'logout', confirmation: 'Your applications will close and you will return to the login screen.' },
  { id: 'suspend', label: 'Suspend', icon: 'suspend', method: 'Suspend' },
  { id: 'hibernate', label: 'Hibernate', icon: 'hibernate', method: 'Hibernate' },
  { id: 'restart', label: 'Restart…', confirmLabel: 'Restart', icon: 'restart', method: 'Reboot', confirmation: 'Your applications will close and the computer will restart.' },
  { id: 'shutdown', label: 'Shut Down…', confirmLabel: 'Shut Down', icon: 'power-off', method: 'PowerOff', confirmation: 'Your applications will close and the computer will shut down.' }
];
const permitted = value => value === 'yes' || value === 'challenge';

// Lazy capability discovery: the bar's first presentation does not wait for
// logind. Power actions retain logind's normal inhibitors and polkit checks.
export function createSessionActions({ bus, lock, logout }) {
  let running = false;
  const capability = action => bus.call(NAME, PATH, MANAGER, 'Can' + action.method).catch(() => 'no');
  return {
    async list() {
      try { await bus.connect(); } catch (_) { return SESSION_ACTIONS.filter(action => !action.method); }
      const available = await Promise.all(SESSION_ACTIONS.map(async action => !action.method || permitted(await capability(action))));
      return SESSION_ACTIONS.filter((_, index) => available[index]);
    },
    async run(id) {
      const action = SESSION_ACTIONS.find(item => item.id === id);
      if (!action) throw new Error('Unknown session action');
      if (running) throw new Error('A session action is already in progress');
      running = true;
      try {
        if (id === 'lock') return await lock();
        if (id === 'logout') return await logout();
        await bus.connect();
        if (!permitted(await capability(action))) throw new Error(action.label.replace('…', '') + ' is unavailable');
        return await bus.call(NAME, PATH, MANAGER, action.method, 'b', true);
      } finally { running = false; }
    }
  };
}

export async function logoutHyprland(send) {
  let reply;
  try { reply = await send('dispatch hl.dsp.exit()'); } catch (_) {}
  if (!/^ok\b/i.test(String(reply || '').trim())) reply = await send('dispatch exit');
  if (!/^ok\b/i.test(String(reply || '').trim())) throw new Error('Hyprland could not end this session');
}
