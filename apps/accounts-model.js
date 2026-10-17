// AccountsService supplies presentation metadata; greetd/PAM still identify
// and authenticate the account by its login name.
const NAME = 'org.freedesktop.Accounts', ROOT = '/org/freedesktop/Accounts';
const USER = NAME + '.User', PROPERTIES = 'org.freedesktop.DBus.Properties';
// email, home and shell are '' when unknown; administrator is null when
// unknown; lastLogin is milliseconds since the epoch (0 when never or unknown);
// session is a desktop session name as display managers store it
// ("hyprland" for hyprland.desktop).
const fallback = username => ({ username, name: username, icon: '', email: '', administrator: null, lastLogin: 0, home: '', shell: '', session: '' });
const text = value => typeof value === 'string' && !value.includes('\0') ? value.trim() : '';
const path = value => typeof value === 'string' && value.startsWith('/') && !value.includes('\0') ? value : '';
const PROPERTIES_READ = ['RealName', 'IconFile', 'Email', 'AccountType', 'LoginTime', 'HomeDirectory', 'Shell', 'Session'];
export function createAccountsService(bus) {
  const accounts = new Map();
  let starting, listening = false;
  const publish = (account, value) => {
    account.value = value;
    for (const listener of account.listeners) listener(value);
  };
  const refresh = account => {
    account.dirty = true;
    if (account.flight) return account.flight;
    account.flight = (async () => {
      while (account.dirty && accounts.get(account.username) === account) {
        account.dirty = false;
        const generation = account.generation;
        let value = fallback(account.username);
        try {
          account.path = await bus.call(NAME, ROOT, NAME, 'FindUserByName', 's', account.username);
          const [name, icon, email, type, login, home, shell, session] = await Promise.all(PROPERTIES_READ.map(property =>
            bus.call(NAME, account.path, PROPERTIES, 'Get', 'ss', USER, property)));
          const seconds = Number(login);
          value = { username: account.username, name: text(name) || account.username, icon: path(icon), email: text(email),
            administrator: type === 1 ? true : type === 0 ? false : null,
            lastLogin: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
            home: path(home), shell: path(shell), session: /^[\w.+@-]{1,255}$/.test(text(session)) ? text(session) : '' };
        } catch (_) {}
        if (!account.dirty && generation === account.generation && accounts.get(account.username) === account) publish(account, value);
      }
    })().finally(() => { account.flight = undefined; });
    return account.flight;
  };
  const signal = event => {
    const owner = event.interface === 'org.freedesktop.DBus' && event.member === 'NameOwnerChanged' && event.args?.[0] === NAME;
    const disconnected = event.interface === 'org.freedesktop.DBus.Local' && event.member === 'Disconnected';
    for (const account of accounts.values()) {
      if (disconnected || owner && !event.args[2]) {
        account.generation++;
        account.dirty = false; publish(account, fallback(account.username));
      } else if (owner || event.path === account.path && (event.interface === USER && event.member === 'Changed'
        || event.interface === PROPERTIES && event.member === 'PropertiesChanged' && event.args?.[0] === USER)) refresh(account);
    }
  };
  const start = () => starting ||= (async () => {
    await bus.connect();
    if (!listening) { bus.onSignal(signal); listening = true; }
    await Promise.all([
      bus.addMatch("type='signal',sender='org.freedesktop.Accounts',interface='org.freedesktop.Accounts.User',member='Changed'"),
      bus.addMatch("type='signal',sender='org.freedesktop.Accounts',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged'"),
      bus.addMatch("type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.freedesktop.Accounts'")
    ]);
  })().catch(error => { starting = undefined; throw error; });
  const change = async (username, method, value) => {
    if (typeof username !== 'string' || !username.trim() || username.length > 256 || /[\x00-\x1f\x7f]/.test(username)) throw new Error('Invalid account name');
    await start();
    const path = await bus.call(NAME, ROOT, NAME, 'FindUserByName', 's', username);
    await bus.call(NAME, path, USER, method, 's', value);
    const account = accounts.get(username);
    if (account) await refresh(account);
  };
  return {
    setIcon(username, path) {
      if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) return Promise.reject(new Error('Choose a local image'));
      return change(username, 'SetIconFile', path);
    },
    setEmail(username, email) {
      if (typeof email !== 'string' || email.length > 256 || /[\x00-\x1f\x7f\s]/.test(email.trim()) || (email.trim() && !/^[^@]+@[^@]+$/.test(email.trim())))
        return Promise.reject(new Error('Enter a valid email address'));
      return change(username, 'SetEmail', email.trim());
    },
    // The account's last desktop session ('' when unknown), read once.
    async session(username) {
      if (typeof username !== 'string' || !username.trim() || username.length > 256 || /[\x00-\x1f\x7f]/.test(username)) return '';
      try {
        await start();
        const path = await bus.call(NAME, ROOT, NAME, 'FindUserByName', 's', username);
        const value = text(await bus.call(NAME, path, PROPERTIES, 'Get', 'ss', USER, 'Session'));
        return /^[\w.+@-]{1,255}$/.test(value) ? value : '';
      } catch (_) { return ''; }
    },
    // The greeter (root) records the session an account started.
    setSession(username, session) {
      if (typeof session !== 'string' || !/^[\w.+@-]{1,255}$/.test(session)) return Promise.reject(new Error('Invalid session'));
      return change(username, 'SetSession', session);
    },
    setName(username, name) {
      if (typeof name !== 'string' || name.length > 256 || /[\x00-\x1f\x7f]/.test(name)) return Promise.reject(new Error('Enter a valid display name'));
      return change(username, 'SetRealName', name.trim());
    },
    watch(username, listener) {
      username = String(username || '').trim();
      if (!username || username.length > 256 || /[\x00-\x1f\x7f]/.test(username)) {
        listener(fallback(username)); return () => {};
      }
      let account = accounts.get(username);
      if (!account) {
        account = { username, generation: 0, listeners: new Set(), value: fallback(username) };
        accounts.set(username, account);
      }
      account.listeners.add(listener); listener(account.value);
      start().then(() => refresh(account)).catch(() => {});
      return () => {
        account.listeners.delete(listener);
        if (!account.listeners.size) accounts.delete(username);
      };
    }
  };
}
