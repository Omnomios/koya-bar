import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { createLoginController, METHOD_PROMPT } from '../apps/login-model.js';

// Load the production greeter with its Koya/Helix imports replaced at the
// module boundary. The UI is inert; button callbacks and greetd requests are
// observable so this covers createGreeter's startup and submit wiring.
let nextId = 0;
const id = () => `element-${++nextId}`;
const controls = new Map(), names = new Map(), labels = new Map(), inputs = new Map(), requests = [], sessionsSeen = [], wallpapersSeen = [];
let remembered = 'alice';
let optIn = true;
let refuseAnswer = false;
let fingerprintTimeout = false, finishFingerprint, fingerprintAnswered = false;
let rightScan = false;
let holdStartSession = false, finishStartSession, closeCount = 0;
let journalAvailable = true;
let keyDown;
const focused = [];
const input = options => {
  let value = '';
  const field = {
    master: { id: id() }, getValue: () => value, submit: () => options.onSubmit(),
    setValue: async next => { value = next; options.onInput?.(next); },
    setDisabled: async next => { field.disabled = next; }, setPlaceholder: async () => {},
    setRevealed: async () => {}, focus: async () => { focused.push(options.id); }, destroy: async () => {}
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
    sessions: () => sessions, lastUser: () => remembered, close: () => { closeCount++; },
    userPreferences: name => name === 'alice' ? JSON.stringify({ GreeterWallpaper: true, Wallpaper: 'account' }) : null,
    request: async text => {
      const request = JSON.parse(text); requests.push(request);
      if (request.type === 'start_session' && holdStartSession) return new Promise(resolve => { finishStartSession = resolve; });
      if (rightScan) {
        if (request.type === 'create_session') return { type: 'auth_message', auth_message_type: 'secret', auth_message: METHOD_PROMPT };
        if (request.type === 'post_auth_message_response' && request.response === 'password')
          return { type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' };
        if (request.type === 'post_auth_message_response' && request.response === 'fingerprint')
          return { type: 'auth_message', auth_message_type: 'info', auth_message: 'Place your finger on the reader' };
        if (request.type === 'post_auth_message_response' && request.response === null)
          return new Promise(resolve => { finishFingerprint = resolve; });
        if (request.type === 'post_auth_message_response') return { type: 'error', error_type: 'auth_error' };
      }
      return request.type === 'create_session'
        ? optIn ? { type: 'auth_message', auth_message_type: 'secret', auth_message: METHOD_PROMPT } : fingerprintTimeout
          ? { type: 'auth_message', auth_message_type: 'info', auth_message: 'Place your finger on the reader' }
          : { type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' }
        : request.type === 'post_auth_message_response' && request.response === 'password'
          ? { type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' }
        : request.type === 'post_auth_message_response' && fingerprintTimeout
          ? fingerprintAnswered ? { type: 'success' }
            : new Promise(resolve => { fingerprintAnswered = true; finishFingerprint = resolve; })
        : request.type === 'post_auth_message_response' && refuseAnswer
          ? { type: 'error', error_type: 'auth_error' }
          : { type: 'success' };
    }
  },
  'Helix/Engine': { quit: () => {} }, 'Helix/Event': { on: (name, callback) => { if (name === 'keyDown') keyDown = callback; }, off: () => {} },
  'Helix/Log': { warn: () => {}, error: () => {} },
  'Module/process': { getEnv: name => name === 'KOYA_GREETER_FINGERPRINT' ? '1' : '',
    exists: path => path === '/usr/bin/systemd-cat' && journalAvailable },
  'Koya/Assets': { mount: async () => {} },
  './theme-ui.js': ui,
  './login-model.js': { createLoginController, METHOD_PROMPT },
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
const right = () => keyDown({ id: 'window', key: 65363 });
const defaultPassword = await greeter.namespace.createGreeter();
await controls.get(names.get('greeter-submit'))();
assert.equal(inputs.get('greeter-answer').disabled, false, 'Password is immediately editable after selecting a user');
assert.equal(requests.some(value => value.response === 'fingerprint'), false, 'No fingerprint scan starts on selection');
await inputs.get('greeter-answer').setValue('in-progress');
await right();
assert.equal(requests.some(value => value.response === 'fingerprint'), false, 'Right preserves caret navigation in a nonempty password');
await inputs.get('greeter-answer').setValue('');
await right();
assert(requests.some(value => value.type === 'post_auth_message_response' && value.response === 'fingerprint'));
await defaultPassword.dispose();
requests.length = 0; sessionsSeen.length = 0;
optIn = false;
const stock = await greeter.namespace.createGreeter();
await controls.get(names.get('greeter-submit'))();
await right();
assert.equal(requests.some(value => value.response === 'fingerprint'), false, 'Stock greetd never receives the marker');
assert.equal(labels.get(names.get('greeter-status')), '', 'Stock service shows no fingerprint hint');
await stock.dispose();
requests.length = 0; sessionsSeen.length = 0; optIn = true;
rightScan = true;
const wrong = await greeter.namespace.createGreeter();
await controls.get(names.get('greeter-submit'))();
await inputs.get('greeter-answer').setValue('wrong-password');
await inputs.get('greeter-answer').submit();
assert.equal(requests.some(value => value.response === 'fingerprint'), false, 'Wrong password never starts fingerprint');
assert.equal(requests.some(value => value.response === null), false, 'Wrong password never reaches scan');
await wrong.dispose();
requests.length = 0;
const literal = await greeter.namespace.createGreeter();
await controls.get(names.get('greeter-submit'))();
await inputs.get('greeter-answer').setValue('KOYA_GREETER_FINGERPRINT_V1:4dce7a6f-16d6-4299-b7e2-975addde31b8');
await inputs.get('greeter-answer').submit();
assert.equal(requests.some(value => value.response === 'fingerprint'), false, 'Typed legacy marker selects no scan');
assert.deepEqual(requests.slice(1, 3).map(value => value.response),
  ['password', 'KOYA_GREETER_FINGERPRINT_V1:4dce7a6f-16d6-4299-b7e2-975addde31b8']);
await literal.dispose();
requests.length = 0; finishFingerprint = null;
const scan = await greeter.namespace.createGreeter();
await controls.get(names.get('greeter-submit'))();
const pendingScan = right();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
assert.equal(typeof finishFingerprint, 'function', 'Right starts the real scan after the marker');
assert.equal(requests.filter(value => value.response === 'fingerprint').length, 1);
const pendingBackFromScan = controls.get(names.get('greeter-back'))();
finishFingerprint({ type: 'success' });
await pendingScan; await pendingBackFromScan;
assert.equal(requests.some(value => value.type === 'start_session'), false, 'Back during scan cancels before session start');
assert.equal(requests.at(-1).type, 'cancel_session');
await scan.dispose();
requests.length = 0; finishFingerprint = null; rightScan = false; optIn = false; sessionsSeen.length = 0;

// A slow field clear must not let a later key choose the method first.
const pauseNextClear = field => {
  const originalSetValue = field.setValue;
  let releaseClear, clearStarted;
  const entered = new Promise(resolve => { clearStarted = resolve; });
  field.setValue = async next => {
    await originalSetValue(next);
    if (next === '' && !releaseClear) await new Promise(resolve => { releaseClear = resolve; clearStarted(); });
  };
  return { entered, release: () => releaseClear() };
};
optIn = true;
const firstChoice = await greeter.namespace.createGreeter();
await controls.get(names.get('greeter-submit'))();
const choiceAnswer = inputs.get('greeter-answer'), choiceClear = pauseNextClear(choiceAnswer);
await choiceAnswer.setValue('first-password');
const pendingFirstChoice = choiceAnswer.submit();
await choiceClear.entered;
await right();
const pendingSecondChoice = choiceAnswer.submit();
choiceClear.release();
await pendingFirstChoice; await pendingSecondChoice;
assert.deepEqual(requests.filter(value => value.type === 'post_auth_message_response').map(value => value.response),
  ['password', 'first-password'], 'the first Enter wins over Right and a second Enter during field clear');
await firstChoice.dispose();
requests.length = 0;

const cancelledChoice = await greeter.namespace.createGreeter();
await controls.get(names.get('greeter-submit'))();
const backChoiceAnswer = inputs.get('greeter-answer'), backChoiceClear = pauseNextClear(backChoiceAnswer);
await backChoiceAnswer.setValue('cancelled-password');
const pendingBackChoice = backChoiceAnswer.submit();
await backChoiceClear.entered;
await controls.get(names.get('greeter-back'))();
backChoiceClear.release(); await pendingBackChoice;
assert.equal(requests.some(value => value.type === 'post_auth_message_response'), false,
  'Back cancels a method choice still waiting for field clear');
await controls.get(names.get('greeter-submit'))();
assert.equal(requests.filter(value => value.type === 'post_auth_message_response').length, 0,
  'the cancelled password does not carry into a new conversation');
await cancelledChoice.dispose();
requests.length = 0;

const disposedChoice = await greeter.namespace.createGreeter();
await controls.get(names.get('greeter-submit'))();
const disposeChoiceAnswer = inputs.get('greeter-answer'), disposeChoiceClear = pauseNextClear(disposeChoiceAnswer);
await disposeChoiceAnswer.setValue('disposed-password');
const pendingDisposedChoice = disposeChoiceAnswer.submit();
await disposeChoiceClear.entered;
const pendingChoiceDispose = disposedChoice.dispose();
disposeChoiceClear.release(); await pendingDisposedChoice; await pendingChoiceDispose;
assert.equal(requests.some(value => value.type === 'post_auth_message_response'), false,
  'Disposal cancels a method choice still waiting for field clear');
requests.length = 0; sessionsSeen.length = 0; optIn = false;

journalAvailable = false; // Alpine miniroot has no systemd-cat.
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
  cmd: ['labwc'], env: [] },
  'Alpine password login starts the desktop directly');
await instance.dispose();
journalAvailable = true;

const alpineRequests = [];
const alpineFingerprint = createLoginController({
  request: async text => {
    const request = JSON.parse(text); alpineRequests.push(request);
    return request.type === 'create_session'
      ? { type: 'auth_message', auth_message_type: 'info', auth_message: 'Place your finger on the reader' }
      : { type: 'success' };
  },
  journalAvailable: false, onStarted: async () => {}
});
assert.equal(await alpineFingerprint.begin('alice', sessions[1]), true);
assert.deepEqual(alpineRequests.at(-1), { type: 'start_session', cmd: ['labwc'], env: [] },
  'Alpine fingerprint login starts the desktop directly');

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
requests.length = 0; refuseAnswer = false; fingerprintTimeout = true; fingerprintAnswered = false;
const fingerprint = await greeter.namespace.createGreeter();
const pendingFingerprint = controls.get(names.get('greeter-submit'))();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
assert.equal(typeof finishFingerprint, 'function', 'fingerprint information waits for PAM response');
assert.equal(inputs.get('greeter-answer').disabled, false, 'password field is editable while fingerprint PAM waits');
assert.equal(focused.at(-1), 'greeter-answer', 'password field receives keyboard focus while fingerprint PAM waits');
await inputs.get('greeter-answer').setValue('early-password');
await inputs.get('greeter-answer').submit();
assert.equal(requests.length, 2, 'Enter queues the password without sending it during fingerprint PAM');
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

// A password fallback consumes the queued answer only at a matching secret prompt.
requests.length = 0; fingerprintTimeout = true; fingerprintAnswered = false;
const fallback = await greeter.namespace.createGreeter();
const pendingFallback = controls.get(names.get('greeter-submit'))();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
await inputs.get('greeter-answer').setValue('early-password');
await inputs.get('greeter-answer').submit();
assert.equal(requests.length, 2);
finishFingerprint({ type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' });
await pendingFallback;
assert.deepEqual(requests[2], { type: 'post_auth_message_response', response: 'early-password' });
assert.equal(requests.filter(request => request.type === 'start_session').length, 1);
await fallback.dispose();

requests.length = 0; fingerprintAnswered = false; finishFingerprint = null;
const typing = await greeter.namespace.createGreeter();
const pendingTyping = controls.get(names.get('greeter-submit'))();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
await inputs.get('greeter-answer').setValue('still-typing');
finishFingerprint({ type: 'auth_message', auth_message_type: 'secret', auth_message: 'Password:' });
await pendingTyping;
assert.equal(inputs.get('greeter-answer').getValue(), 'still-typing',
  'a password prompt does not erase text typed during the fingerprint wait');
assert.equal(requests.length, 2, 'typing without Enter does not submit a password');
await inputs.get('greeter-answer').submit();
assert.deepEqual(requests[2], { type: 'post_auth_message_response', response: 'still-typing' });
await typing.dispose();

requests.length = 0; fingerprintAnswered = false; finishFingerprint = null;
const code = await greeter.namespace.createGreeter();
const pendingCode = controls.get(names.get('greeter-submit'))();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
await inputs.get('greeter-answer').setValue('early-password');
await inputs.get('greeter-answer').submit();
finishFingerprint({ type: 'auth_message', auth_message_type: 'secret', auth_message: 'Verification code:' });
await pendingCode;
assert.equal(requests.length, 2, 'queued password is never sent to a verification code prompt');
assert.equal(inputs.get('greeter-answer').getValue(), '', 'unrelated prompt clears the queued answer field');
await code.dispose();

requests.length = 0; fingerprintAnswered = false; finishFingerprint = null;
const biometric = await greeter.namespace.createGreeter();
const pendingBiometric = controls.get(names.get('greeter-submit'))();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
await inputs.get('greeter-answer').setValue('early-password');
await inputs.get('greeter-answer').submit();
finishFingerprint({ type: 'success' });
await pendingBiometric;
assert.equal(requests.filter(request => request.type === 'post_auth_message_response').length, 1,
  'biometric success never sends the queued password');
assert.equal(requests.filter(request => request.type === 'start_session').length, 1);
await biometric.dispose();

requests.length = 0; fingerprintAnswered = false; finishFingerprint = null;
const backed = await greeter.namespace.createGreeter();
const pendingBack = controls.get(names.get('greeter-submit'))();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
await inputs.get('greeter-answer').setValue('early-password');
await inputs.get('greeter-answer').submit();
await controls.get(names.get('greeter-back'))();
finishFingerprint({ type: 'success' });
await pendingBack;
assert.equal(requests.filter(request => request.type === 'start_session').length, 0,
  'back while greetd is in flight cancels after its reply, before session start');
assert.equal(requests.at(-1).type, 'cancel_session');
await backed.dispose();

requests.length = 0; fingerprintAnswered = false; finishFingerprint = null;
const slowBack = await greeter.namespace.createGreeter();
const pendingSlowBack = controls.get(names.get('greeter-submit'))();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
const backAnswer = inputs.get('greeter-answer'), originalSetValue = backAnswer.setValue;
let releaseBackClear, backClearStarted;
const backClearEntered = new Promise(resolve => { backClearStarted = resolve; });
backAnswer.setValue = async next => {
  if (next === '' && !releaseBackClear) {
    await new Promise(resolve => { releaseBackClear = resolve; backClearStarted(); });
  }
  return originalSetValue(next);
};
const pendingSlowClear = controls.get(names.get('greeter-back'))();
await backClearEntered;
finishFingerprint({ type: 'success' });
await pendingSlowBack;
assert.equal(requests.filter(request => request.type === 'start_session').length, 0,
  'Back requests cancellation before waiting for the answer field to clear');
releaseBackClear(); await pendingSlowClear; await slowBack.dispose();

requests.length = 0; fingerprintAnswered = false; finishFingerprint = null;
const startingDispose = await greeter.namespace.createGreeter();
const pendingStartingDispose = controls.get(names.get('greeter-submit'))();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
const startingAnswer = inputs.get('greeter-answer'), startingSetValue = startingAnswer.setValue;
let releaseStartingClear, startingClearStarted;
const startingClearEntered = new Promise(resolve => { startingClearStarted = resolve; });
startingAnswer.setValue = async next => {
  if (next === '' && !releaseStartingClear) await new Promise(resolve => { releaseStartingClear = resolve; startingClearStarted(); });
  return startingSetValue(next);
};
finishFingerprint({ type: 'success' });
await startingClearEntered;
const closedBeforeStartingClear = closeCount;
const pendingStartingClear = startingDispose.dispose();
assert.equal(closeCount, closedBeforeStartingClear, 'Disposal keeps the transport open until starting cancellation completes');
releaseStartingClear(); await pendingStartingClear; await pendingStartingDispose;
assert.equal(requests.filter(request => request.type === 'start_session').length, 0,
  'Disposal during the starting UI update cancels before start_session');
assert.equal(requests.at(-1).type, 'cancel_session');
assert.equal(closeCount, closedBeforeStartingClear + 1);

requests.length = 0; fingerprintAnswered = false; finishFingerprint = null; finishStartSession = null; holdStartSession = true;
const sentDispose = await greeter.namespace.createGreeter();
const pendingSentDispose = controls.get(names.get('greeter-submit'))();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
finishFingerprint({ type: 'success' });
for (let attempts = 0; !finishStartSession && attempts < 20; attempts++) await delay(0);
assert.equal(typeof finishStartSession, 'function');
const closedBeforeStartReply = closeCount;
await sentDispose.dispose();
assert.equal(closeCount, closedBeforeStartReply, 'Disposal leaves the transport open during an in-flight start_session');
assert.equal(requests.filter(request => request.type === 'cancel_session').length, 0);
finishStartSession({ type: 'success' }); await pendingSentDispose;
assert.equal(closeCount, closedBeforeStartReply + 1, 'The successful handoff disposes after start_session replies');
holdStartSession = false;

requests.length = 0; fingerprintAnswered = false; finishFingerprint = null;
const removed = await greeter.namespace.createGreeter();
const pendingRemoved = controls.get(names.get('greeter-submit'))();
for (let attempts = 0; !finishFingerprint && attempts < 20; attempts++) await delay(0);
await inputs.get('greeter-answer').setValue('early-password');
await inputs.get('greeter-answer').submit();
await removed.dispose();
finishFingerprint({ type: 'success' });
await pendingRemoved;
assert.equal(requests.filter(request => request.type === 'start_session').length, 0,
  'a stale fingerprint reply after disposal cannot start a session');
assert.equal(requests.at(-1).type, 'cancel_session');
fingerprintTimeout = false; finishFingerprint = null;

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
