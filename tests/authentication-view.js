import assert from './assert.js';
import * as Log from 'Helix/Log';
import { authenticationView } from '../apps/authentication-view.js';

export async function test() {
const home = '/home/alice';
const view = (options, extra = {}) => authenticationView({ text: options.question, options, ...extra }, home);

let v = view({ source: 'polkit', message: "Authentication is required to run `/usr/bin/true' as the super user", user: 'alice', question: 'Password: ' });
assert.equal(v.title, 'Run ‘/usr/bin/true’ as the super user'); assert.equal(v.body, '');
assert.equal(v.user, 'alice'); assert.equal(v.placeholder, 'Password'); assert.equal(v.glyph, 'lock'); assert(v.input);
v = view({ source: 'polkit', message: 'Authentication is required to switch power profile.', user: 'alice', question: 'Password: ' });
assert.equal(v.title, 'Switch power profile');
v = view({ source: 'polkit', message: 'System policy prevents this.', user: 'root', question: 'Passwort: ' });
assert.equal(v.title, 'Administrator access'); assert.equal(v.body, 'System policy prevents this.'); assert.equal(v.placeholder, 'Passwort');

v = view({ source: 'askpass', mode: 'entry', question: '[sudo] password for alice: ' });
assert.equal(v.title, 'Administrator access'); assert.equal(v.user, 'alice'); assert(!v.retry);
v = view({ source: 'askpass', mode: 'entry', question: '[sudo] password for alice: ', retry: true, status: 'Incorrect password', error: true });
assert(v.retry); assert.equal(v.status, 'Incorrect password'); assert(v.error);

v = view({ source: 'ssh', mode: 'entry', question: 'Enter passphrase for /home/alice/.ssh/id_ed25519:' });
assert.equal(v.title, 'Unlock SSH key'); assert.equal(v.body, '~/.ssh/id_ed25519'); assert.equal(v.glyph, 'key');
assert.equal(v.confirm, 'Unlock'); assert(!v.retry); assert.equal(v.user, '');
v = view({ source: 'askpass', mode: 'entry', question: "Bad passphrase, try again for key '/home/alice/.ssh/id_rsa':" });
assert.equal(v.body, '~/.ssh/id_rsa'); assert(v.retry); assert.equal(v.status, 'Wrong passphrase'); assert(v.error);

v = view({ source: 'askpass', mode: 'confirm', question: 'Allow use of key /home/alice/.ssh/id_ed25519?\nKey fingerprint SHA256:abc123.' });
assert.equal(v.title, 'Use SSH key?'); assert.equal(v.detail, 'SHA256:abc123'); assert.equal(v.cancel, 'Deny'); assert(!v.input);
v = view({ source: 'askpass', mode: 'none', question: 'Key added.' });
assert.equal(v.cancel, ''); assert.equal(v.confirm, 'OK'); assert(!v.input);
v = view({ source: 'askpass', mode: 'entry', question: 'Vault password:' });
assert.equal(v.title, 'Password required'); assert.equal(v.body, 'Vault password');
// The requester names what is asking: sudo's own command line, ssh for a key.
v = view({ source: 'askpass', mode: 'entry', question: '[sudo] password for alice: ', requester: 'sudo -A -k true' });
assert.equal(v.body, 'sudo -A -k true');
v = view({ source: 'askpass', mode: 'entry', question: 'Enter passphrase for /home/alice/.ssh/id_ed25519:', requester: 'ssh git@example.com' });
assert.equal(v.detail, 'ssh git@example.com');
v = view({ source: 'askpass', mode: 'confirm', question: 'Allow use of key /home/alice/.ssh/id_ed25519?\nKey fingerprint SHA256:abc123.', requester: 'ssh host' });
assert.equal(v.detail, 'SHA256:abc123\nssh host');
Log.info('Authentication prompt presentation: passed');

}
