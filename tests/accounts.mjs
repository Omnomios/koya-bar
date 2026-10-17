import assert from 'node:assert/strict';
import { createAccountsService } from '../apps/accounts-model.js';

const NAME = 'org.freedesktop.Accounts', USER = NAME + '.User';
const bare = username => ({ username, name: username, icon: '', email: '', administrator: null, lastLogin: 0, home: '', shell: '', session: '' });
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
let signal, unavailable = false, release, blocked, denied = false;
const matches = [], calls = [], writes = [];
const profiles = { alice: { RealName: 'Alice Example', IconFile: '/var/lib/AccountsService/icons/alice', Email: 'alice@example.org', AccountType: 1,
  LoginTime: 1792201021, HomeDirectory: '/home/alice', Shell: '/usr/bin/zsh', Session: 'hyprland' } };
const bus = {
  connect: async () => {}, onSignal: fn => { signal = fn; }, addMatch: async rule => matches.push(rule),
  call: async (...args) => {
    calls.push(args);
    if (unavailable) throw new Error('ServiceUnknown');
    if (args[3] === 'FindUserByName') {
      assert.equal(args[0], NAME); assert.equal(args[4], 's');
      if (!profiles[args[5]]) throw new Error('Unknown account');
      return '/accounts/' + args[5];
    }
    if (['SetIconFile', 'SetRealName', 'SetEmail', 'SetSession'].includes(args[3])) {
      if (denied) throw new Error('PermissionDenied');
      assert.equal(args[2], USER); assert.equal(args[4], 's');
      writes.push(args);
      const profile = profiles[args[1].slice('/accounts/'.length)];
      if (args[3] === 'SetIconFile') profile.IconFile = '/var/lib/AccountsService/icons/alice';
      else profile[{ SetRealName: 'RealName', SetEmail: 'Email', SetSession: 'Session' }[args[3]]] = args[5];
      return;
    }
    assert.equal(args[3], 'Get'); assert.equal(args[4], 'ss'); assert.equal(args[5], USER);
    const value = profiles[args[1].slice('/accounts/'.length)][args[6]];
    if (blocked) await blocked;
    return value;
  }
};
const accounts = createAccountsService(bus), values = [];
const stop = accounts.watch('alice', value => values.push(value));
assert.deepEqual(values, [bare('alice')], 'Fallback is synchronous while D-Bus connects');
await settle();
assert.equal(values.at(-1).name, 'Alice Example');
assert.equal(values.at(-1).icon, profiles.alice.IconFile);
assert.deepEqual(values.at(-1), { username: 'alice', name: 'Alice Example', icon: profiles.alice.IconFile, email: 'alice@example.org', administrator: true,
  lastLogin: 1792201021000, home: '/home/alice', shell: '/usr/bin/zsh', session: 'hyprland' }, 'Details are read with the profile');
assert.equal(matches.length, 3);
profiles.alice.RealName = 'Alice Changed';
signal({ path: '/accounts/alice', interface: USER, member: 'Changed' }); await settle();
assert.equal(values.at(-1).name, 'Alice Changed');
profiles.alice = { RealName: '  ', IconFile: 'relative/path' };
signal({ path: '/accounts/alice', interface: 'org.freedesktop.DBus.Properties', member: 'PropertiesChanged', args: [USER] }); await settle();
assert.deepEqual(values.at(-1), bare('alice'));
const before = calls.length;
signal({ path: '/accounts/someone-else', interface: USER, member: 'Changed' }); await settle();
assert.equal(calls.length, before, 'Unrelated users do not trigger lookups');

// Owner loss must win over an earlier in-flight property response.
profiles.alice = { RealName: 'Old daemon', IconFile: '/old.png' };
blocked = new Promise(resolve => { release = resolve; });
signal({ path: '/accounts/alice', interface: USER, member: 'Changed' }); await settle();
signal({ interface: 'org.freedesktop.DBus', member: 'NameOwnerChanged', args: [NAME, ':old', ''] });
release(); blocked = undefined; await settle();
assert.equal(values.at(-1).name, 'alice');
profiles.alice.RealName = 'New daemon';
signal({ interface: 'org.freedesktop.DBus', member: 'NameOwnerChanged', args: [NAME, '', ':new'] }); await settle();
assert.equal(values.at(-1).name, 'New daemon');

// Removing a listener while a read is pending prevents late publication.
blocked = new Promise(resolve => { release = resolve; });
signal({ path: '/accounts/alice', interface: USER, member: 'Changed' }); await settle();
const count = values.length; stop(); release(); blocked = undefined; await settle();
assert.equal(values.length, count);
unavailable = true;
const absent = []; accounts.watch('alice', value => absent.push(value)); await settle();
assert.deepEqual(absent.at(-1), bare('alice'));
unavailable = false;
const unknown = []; accounts.watch('missing-user', value => unknown.push(value)); await settle();
assert.equal(unknown.at(-1).name, 'missing-user');
await accounts.setIcon('alice', '/tmp/prepared-avatar.png');
assert.equal(writes.at(-1)[5], '/tmp/prepared-avatar.png');
assert.equal(absent.at(-1).icon, '/var/lib/AccountsService/icons/alice', 'Read back the service-owned image path after saving');
await accounts.setName('alice', '  Alice New Name  ');
assert.equal(absent.at(-1).name, 'Alice New Name');
await accounts.setEmail('alice', ' alice@koya.test ');
assert.equal(absent.at(-1).email, 'alice@koya.test');
await accounts.setEmail('alice', '');
assert.equal(absent.at(-1).email, '', 'An email can be cleared');
await assert.rejects(accounts.setEmail('alice', 'not an address'), /valid email/);
await accounts.setSession('alice', 'labwc');
assert.equal(absent.at(-1).session, 'labwc');
await assert.rejects(accounts.setSession('alice', '../x y'), /Invalid session/);
denied = true;
await assert.rejects(accounts.setName('alice', 'Denied name'), /PermissionDenied/);
await assert.rejects(accounts.setIcon('alice', '/tmp/denied.png'), /PermissionDenied/);
assert.equal(absent.at(-1).name, 'Alice New Name', 'Denied writes keep confirmed metadata');
const written = writes.length;
await assert.rejects(accounts.setIcon('alice', 'file:///tmp/image.png'), /local image/);
await assert.rejects(accounts.setName('alice', 'Bad\nName'), /valid display name/);
await assert.rejects(accounts.setName('', 'New name'), /Invalid account/);
assert.equal(writes.length, written);
console.log('AccountsService checks passed');
