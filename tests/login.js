import assert from './assert.js';
import * as Log from 'Helix/Log';
import { createLoginController } from '../apps/login-model.js';

export async function test() {
const session = { name: 'Hyprland', cmd: ['/usr/bin/Hyprland'], env: ['XDG_SESSION_TYPE=wayland'] };
const requests = [], states = [], handoff = [];
let replies = [
  { type: 'auth_message', auth_message_type: 'info', auth_message: 'Welcome' },
  { type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' },
  { type: 'auth_message', auth_message_type: 'visible', auth_message: 'Confirm account:' },
  { type: 'auth_message', auth_message_type: 'secret', auth_message: 'Verification code:' },
  { type: 'success' }, { type: 'success' }
];
const controller = createLoginController({ request: async text => {
  const request = JSON.parse(text); requests.push(request); return replies.shift();
}, onState: state => states.push(state), onStarted: async () => handoff.push('released and exited') });
await controller.begin('  alice  ', session);
assert.equal(requests[0].username, 'alice');
assert.deepEqual(requests[1], { type: 'post_auth_message_response', response: null });
assert.equal(controller.state.phase, 'prompt');
assert.equal(controller.state.secret, true);
await controller.respond('fixture-password');
assert.equal(controller.state.secret, false, 'Visible prompts can be answered without masking');
await controller.respond('alice');
assert.equal(controller.state.secret, true, 'A later secret prompt restores masking');
assert.equal(handoff.length, 0, 'Additional PAM prompts never start a session early');
await controller.respond('123456');
assert.deepEqual(requests.at(-1), { type: 'start_session', cmd: session.cmd, env: session.env });
assert.equal(controller.state.phase, 'started');
assert.deepEqual(handoff, ['released and exited']);
assert(!JSON.stringify(states).includes('fixture-password'), 'Credentials never enter display state');

const failures = [];
const failed = createLoginController({ request: async text => {
  const value = JSON.parse(text); failures.push(value);
  if (value.type === 'cancel_session') return { type: 'success' };
  return { type: 'error', error_type: 'auth_error' };
}, onStarted: () => assert.fail('Failed authentication must not hand off') });
await failed.begin('alice', session);
assert.equal(failed.state.phase, 'username');
assert.match(failed.state.message, /Authentication failed/);
assert.equal(failures.at(-1).type, 'cancel_session', 'Failed conversations are cancelled before retry');
await failed.begin('alice', session);
assert.equal(failures.filter(value => value.type === 'create_session').length, 2);

const noStart = createLoginController({ request: async text => JSON.parse(text).type === 'create_session' ? { type: 'success' }
  : JSON.parse(text).type === 'start_session' ? { type: 'error', description: 'Session unavailable' } : { type: 'success' },
onStarted: () => assert.fail('A rejected session start must keep the greeter alive') });
await noStart.begin('alice', session);
assert.equal(noStart.state.phase, 'username');
assert.equal(noStart.state.message, 'Session unavailable');

let release;
const pending = new Promise(resolve => { release = resolve; });
let count = 0;
const concurrent = createLoginController({ request: async () => { count++; return pending; }, onStarted: () => {} });
const first = concurrent.begin('alice', session);
assert.equal(await concurrent.begin('bob', session), false);
await Promise.resolve(); assert.equal(count, 1, 'Repeated submits cannot create simultaneous conversations');
release({ type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' }); await first;
assert.equal(concurrent.state.username, 'alice');
const other = { name: 'labwc', cmd: ['labwc'], env: [] }, chosen = [];
const switching = createLoginController({ request: async text => { const value = JSON.parse(text); chosen.push(value);
  return value.type === 'create_session' ? { type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' } : { type: 'success' }; },
onStarted: async () => {} });
await switching.begin('alice', session);
assert.equal(switching.chooseSession(other), true, 'The session can change while answering');
await switching.respond('secret');
assert.deepEqual(chosen.at(-1).cmd, ['labwc'], 'The session chosen last is started');
assert.equal(switching.chooseSession(session), false, 'A started session cannot change');

const cancelRequests = [];
const cancelled = createLoginController({ request: async text => {
  cancelRequests.push(JSON.parse(text)); return cancelRequests.length === 1
    ? { type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' } : { type: 'success' };
}, onStarted: () => assert.fail('Cancel must not start a session') });
await cancelled.begin('alice', session); await cancelled.cancel();
assert.equal(cancelRequests.at(-1).type, 'cancel_session');
assert.equal(cancelled.state.phase, 'username');
// Fingerprint PAM conversations can finish without ever asking for a secret.
const biometricStates = [], biometricRequests = [];
const biometricReplies = [
  { type: 'auth_message', auth_message_type: 'info', auth_message: 'Place your finger on the reader' },
  { type: 'success' }, { type: 'success' }
];
let biometricStarts = 0;
const biometric = createLoginController({ request: async text => {
  biometricRequests.push(JSON.parse(text)); return biometricReplies.shift();
}, onState: state => biometricStates.push(state), onStarted: async () => { biometricStarts++; } });
assert.equal(await biometric.begin('alice', session), true);
assert.equal(biometricStarts, 1);
assert(biometricStates.some(state => state.busy && state.notice === 'Place your finger on the reader'));
assert.deepEqual(biometricRequests[1], { type: 'post_auth_message_response', response: null });
const fallbackReplies = [
  { type: 'auth_message', auth_message_type: 'info', auth_message: 'Place your finger on the reader' },
  { type: 'auth_message', auth_message_type: 'error', auth_message: 'Verification timed out' },
  { type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' }
];
const fallback = createLoginController({ request: async () => fallbackReplies.shift(),
  onStarted: () => assert.fail('Fingerprint timeout must not start a session') });
assert.equal(await fallback.begin('alice', session), false);
assert.equal(fallback.state.phase, 'prompt'); assert.equal(fallback.state.secret, true);
Log.info('Login conversation, prompts, cancellation and session handoff: passed');

}
