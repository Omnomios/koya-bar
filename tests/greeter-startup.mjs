import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { createLoginController } from '../apps/login-model.js';

// Load the production greeter with its Koya/Helix imports replaced at the
// module boundary. The UI is inert; button callbacks and greetd requests are
// observable so this covers createGreeter's startup and submit wiring.
let nextId = 0;
const id = () => `element-${++nextId}`;
const controls = new Map(), names = new Map(), labels = new Map(), inputs = new Map(), requests = [], sessionsSeen = [], wallpapersSeen = [];
let remembered = 'alice';
let refuseAnswer = false;
let fingerprintTimeout = false, finishFingerprint;
const input = options => {
  let value = '';
  const field = {
    master: { id: id() }, getValue: () => value,
    setValue: async next => { value = next; options.onInput?.(next); },
    setDisabled: async () => {}, setPlaceholder: async () => {},
    setRevealed: async () => {}, focus: async () => {}, destroy: async () => {}
  };
  inputs.set(options.id, field);
  return field;
};
const ui = {
  createElement: async () => ({ id: id() }),
  setElementId: async (win, element, name) => { names.set(name, element); },
  setTextString: async (win, element, value) => { labels.set(element, value); }, setTextColour: async () => {},
  setEnabled: async () => {}, setHitTarget: async () => {},
  setLayoutOrder: async () => {}, attach: async () => {},
  setMargin: async () => {}, setLayoutAABB: async () => {},
  setOnActivate: async () => {},
  getElementFrame: async () => ({ min: { x: 0, y: 0 }, max: { x: 100, y: 30 } })
};
const sessions = [
  { id: 'hyprland.desktop', name: 'Hyprland', cmd: ['Hyprland'], env: [] },
  { id: 'labwc.desktop', name: 'Labwc', cmd: ['labwc'], env: [] }
];
const modules = {
  'Koya/Compositor': {
    createWindow: async () => 'window', getWindowInfo: async () => ({ role: 'raw', width: 1920, height: 1080 }),
    setUiScaling: async () => ({ width: 1600, height: 900 }), focusWindow: async () => {}
  },
  'Module/login': {
    sessions: () => sessions, lastUser: () => remembered, close: () => {},
    userPreferences: name => name === 'alice' ? JSON.stringify({ GreeterWallpaper: true, Wallpaper: 'account' }) : null,
    request: async text => {
      const request = JSON.parse(text); requests.push(request);
      return request.type === 'create_session'
        ? fingerprintTimeout
          ? { type: 'auth_message', auth_message_type: 'info', auth_message: 'Place your finger on the reader' }
          : { type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' }
        : request.type === 'post_auth_message_response' && fingerprintTimeout
          ? new Promise(resolve => { finishFingerprint = resolve; })
        : request.type === 'post_auth_message_response' && refuseAnswer
          ? { type: 'error', error_type: 'auth_error' }
          : { type: 'success' };
    }
  },
  'Helix/Engine': { quit: () => {} }, 'Helix/Event': { on: () => {}, off: () => {} },
  'Helix/Log': { warn: () => {}, error: () => {} },
  'Module/process': { getEnv: () => '' },
  'Koya/Assets': { mount: async () => {} },
  './theme-ui.js': ui,
  './login-model.js': { createLoginController },
  './clock-model.js': { clockDefaults: {} },
  './wallpapers.js': { WALLPAPERS: [{ id: 'default' }, { id: 'account' }], isUserWallpaper: () => false, setUserWallpapers: () => {} },
  './wallpaper-surface.js': { configureWallpaper: async options => { wallpapersSeen.push(options.Wallpaper); } },
  './auth-screen.js': {
    AUTH_CARD_WIDTH: 400, AUTH_CARD_PADDING: 20,
    authScreen: async (win, options) => {
      await options.build({ content: id() });
      return {
        wall: id(), card: id(), content: id(), root: id(),
        play: async () => {}, stop: () => {}, paintClock: async () => {},
        kit: { surface: async () => ({ id: id(), content: id() }) }
      };
    }
  },
  './user-avatar.js': { userAvatar: async () => ({ id: id(), setUser: () => {}, dispose: async () => {} }) },
  './accounts.js': { accounts: { session: async name => { sessionsSeen.push(name); return 'labwc'; }, setSession: async () => {} } },
  './text-input.js': { textInput: async (win, options) => input(options) },
  './password-input.js': { passwordInput: async (win, options) => input(options) },
  './touch-ui.js': {
    button: async (win, parent, label, width, height, callback, options = {}) => {
      const element = id(); controls.set(element, callback);
      options.onLabel?.(id()); options.onFeedback?.({ begin: () => {}, end: () => {} });
      return element;
    },
    text: async () => id(), icon: async () => id()
  },
  './app-frame.js': { glyph: () => '' }, './cursor.js': { destroySurface: async () => {} },
  './motion.js': { presets: { shake: () => [], glide: () => [], pop: () => [], bump: () => [], rise: () => [] } },
  './theme.js': {
    TYPE: { heading: 1, body: 1, caption: 1, detail: 1 }, SPACE: { xs: 2, s: 4, m: 8, l: 16 },
    TEXT: { primary: '', secondary: '', accent: '', onAccent: '' }, SURFACE: { accent: '' },
    FONT: '', FONT_STRONG: '', RADIUS: { control: 1 }, CLEAR: '', AUTO: '', HIGHLIGHT: { hover: '' }
  }
};
const source = await readFile(new URL('../apps/greeter.js', import.meta.url), 'utf8');
const greeter = new SourceTextModule(source, { identifier: 'apps/greeter.js' });
await greeter.link(specifier => {
  const exports = modules[specifier];
  assert(exports, `Unexpected greeter import: ${specifier}`);
  return new SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  });
});
await greeter.evaluate();
const instance = await greeter.namespace.createGreeter();
assert.deepEqual(sessionsSeen, ['alice'], 'startup recalls the returning account session');
assert.equal(wallpapersSeen[0], 'account', 'startup shows the returning account wallpaper');
assert.equal(inputs.get('greeter-user').getValue(), 'alice', 'startup prefills the returning account');
assert.deepEqual(requests, [], 'idle startup must not create a PAM session');
await controls.get(names.get('greeter-submit'))();
assert.deepEqual(requests, [{ type: 'create_session', username: 'alice' }], 'Continue starts authentication for the prefilled account');
await inputs.get('greeter-answer').setValue('fixture-password');
await controls.get(names.get('greeter-submit'))();
assert.deepEqual(requests.at(-2), { type: 'post_auth_message_response', response: 'fixture-password' });
assert.deepEqual(requests.at(-1), { type: 'start_session',
  cmd: ['/usr/bin/systemd-cat', '--identifier=koya-session', '--', 'labwc'], env: [] },
  'recalled session starts through systemd-cat after the password prompt');
await instance.dispose();

// A refused prompted conversation must wait for another deliberate Continue.
requests.length = 0; refuseAnswer = true;
const refused = await greeter.namespace.createGreeter();
await controls.get(names.get('greeter-submit'))();
await inputs.get('greeter-answer').setValue('timed-out-fingerprint');
await controls.get(names.get('greeter-submit'))();
await delay(0); // Let a scheduled retry run before checking for another session.
assert.equal(requests.filter(request => request.type === 'create_session').length, 1,
  'auth_error must not start another PAM session until Continue');
assert.equal(labels.get(names.get('greeter-status')), 'Authentication failed. Try again.',
  'auth_error remains visible while waiting for Continue');
assert.equal(inputs.get('greeter-user').getValue(), 'alice', 'refusal keeps the account populated');
await controls.get(names.get('greeter-submit'))();
assert.deepEqual(requests.at(-1), { type: 'create_session', username: 'alice' },
  'Continue starts a fresh conversation for the prefilled account');
await refused.dispose();

// Fingerprint PAM can show information, then time out without a password prompt.
requests.length = 0; refuseAnswer = false; fingerprintTimeout = true;
const fingerprint = await greeter.namespace.createGreeter();
const pendingFingerprint = controls.get(names.get('greeter-submit'))();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
assert.equal(typeof finishFingerprint, 'function', 'fingerprint information waits for PAM response');
assert.deepEqual(requests.slice(0, 2), [
  { type: 'create_session', username: 'alice' },
  { type: 'post_auth_message_response', response: null }
], 'fingerprint information is acknowledged without a secret');
assert.equal(labels.get(names.get('greeter-status')), 'Place your finger on the reader',
  'fingerprint information stays visible during authentication');
finishFingerprint({ type: 'error', error_type: 'auth_error' });
await pendingFingerprint;
await delay(0);
assert.equal(requests.filter(request => request.type === 'create_session').length, 1,
  'fingerprint timeout must not re-arm authentication');
assert.equal(labels.get(names.get('greeter-status')), 'Authentication failed. Try again.');
assert.equal(inputs.get('greeter-user').getValue(), 'alice');
fingerprintTimeout = false; finishFingerprint = null;
await controls.get(names.get('greeter-submit'))();
assert.deepEqual(requests.at(-1), { type: 'create_session', username: 'alice' },
  'Continue restarts authentication after a fingerprint timeout');
await fingerprint.dispose();

// Without a remembered account, the same Continue path accepts a typed name.
remembered = ''; requests.length = 0; sessionsSeen.length = 0; refuseAnswer = false;
const manual = await greeter.namespace.createGreeter();
assert.deepEqual(requests, [], 'manual sign-in also starts idle');
assert.equal(wallpapersSeen.at(-1), 'default', 'manual sign-in starts with the system wallpaper');
await inputs.get('greeter-user').setValue('bob');
await controls.get(names.get('greeter-submit'))();
assert.deepEqual(requests, [{ type: 'create_session', username: 'bob' }]);
assert.deepEqual(sessionsSeen, ['bob']);
await manual.dispose();
console.log('Greeter startup, refusal, fingerprint timeout, recalled session, password and manual sign-in: passed');
