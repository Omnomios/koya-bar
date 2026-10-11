import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the real builders through a queued native boundary. Operations execute
// FIFO, while replies arrive in reverse order to expose attachment races.
const nodes = new Map(), windows = new Map(), events = new Map(), errors = [], animationEnds = new Map(), stateHandlers = new Map();
let nextNode = 1, nextWindow = 1, nextClip = 1, scheduled = false, rounds = 0, pending = [];
function request(operation) {
  return new Promise((resolve, reject) => {
    pending.push({ operation, resolve, reject });
    if (!scheduled) {
      scheduled = true;
      setImmediate(() => {
        scheduled = false; rounds++;
        const jobs = pending; pending = [];
        const replies = jobs.map(job => {
          try { return { ...job, value: job.operation() }; }
          catch (error) { return { ...job, error }; }
        });
        for (const job of replies.reverse()) job.error ? job.reject(job.error) : job.resolve(job.value);
      });
    }
  });
}
const node = id => { assert(nodes.has(id), 'An element must exist before it is used'); return nodes.get(id); };
const UI = {
  createElement: (win, options) => request(() => {
    assert(windows.has(win));
    const id = nextNode++; nodes.set(id, { win, options, children: [], name: options.id, enabled: true, animations: new Map() }); return id;
  }),
  attach: (win, parent, child) => request(() => {
    assert.equal(node(parent).win, win); assert.equal(node(child).win, win);
    node(parent).children.push(child);
  }),
  attachRoot: (win, root) => request(() => { assert.equal(node(root).win, win); windows.get(win).root = root; }),
  addAnimation: (win, id, frames) => request(() => {
    assert.equal(node(id).win, win); const clip = nextClip++; node(id).animations.set(clip, frames); return clip;
  }),
  updateAnimation: (win, id) => request(() => { node(id); return true; }),
  startAnimation: (win, id, clip) => request(() => {
    node(id).animatedPose = node(id).animations.get(clip)?.at(-1);
    const end = animationEnds.get(id + ":" + clip); if (end) queueMicrotask(end);
  }),
  stopAnimation: (win, id) => request(() => { node(id); }),
  onAnimationEnd: (win, id, clip, callback) => request(() => { node(id); animationEnds.set(id + ":" + clip, callback); }),
  setAnimationTime: (win, id, clip, time) => request(() => {
    node(id).animatedPose = node(id).animations.get(clip).filter(frame => frame.time <= time).at(-1);
  }),
  setPosition: (win, id, position) => request(() => { node(id).staticPosition = position; }),
  setElementId: (win, id, name) => request(() => { node(id).name = name; }),
  setEnabled: (win, id, enabled) => request(() => { node(id).enabled = enabled; }),
  setGrow: (win, id, flexGrow) => request(() => { node(id).options.item.flexGrow = flexGrow; }),
  setTextString: (win, id, string) => request(() => { node(id).options.renderable.string = string; }),
  setTextColour: (win, id, colour) => request(() => { node(id).options.renderable.colour = colour; }),
  setTexture: (win, id, texture) => request(() => { node(id).options.renderable.texture = texture; }),
  getTextCaretPosition: (win, id) => request(() => { node(id); return { x: 0, y: 0 }; }),
  getElementById: (win, name) => request(() => [...nodes].find(([, value]) => value.win === win && value.name === name)?.[0]),
  destroyElement: (win, id) => request(() => {
    node(id);
    function remove(id) { for (const child of node(id).children) remove(child); nodes.delete(id); }
    for (const value of nodes.values()) value.children = value.children.filter(child => child !== id);
    remove(id);
  })
};
for (const name of ['setHitTarget', 'setScale', 'setBoxColour', 'setSpriteFrame', 'setCircleColour', 'setLayoutSize', 'setLayoutPosition', 'setTextSize']) {
  UI[name] = (win, id) => request(() => { assert.equal(node(id).win, win); });
}
const display = { display: 'test-output', width: 1280, height: 800, focused: true };
const state = { Active: true, ScreenState: 'unlocked', PowerMenuState: 'closed', Wallpaper: 'waypaper-current', BatteryPresent: false };
const Compositor = {
  listDisplays: () => request(() => [display]),
  createWindow: options => request(() => { const win = nextWindow++; windows.set(win, { options }); return win; }),
  getWindowInfo: win => request(() => {
    const options = windows.get(win).options;
    return { role: options.role, width: options.size?.x || display.width, height: options.size?.y || display.height };
  })
};
for (const name of ['setClearColor', 'setWindowRenderingEnabled', 'setTextInput', 'setPointerEvents', 'setKeyboardInteractivity', 'setCursor', 'destroyWindow']) {
  Compositor[name] = win => request(() => { assert(windows.has(win)); return true; });
}
Compositor.sessionLockState = () => request(() => 'locked');
const context = vm.createContext({
  setTimeout: (fn, delay) => { if (!delay) queueMicrotask(fn); return 1; }, clearTimeout: () => {},
  setInterval: () => 1, clearInterval: () => {}
});
const modules = new Map();
const emptyAudio = { subscribe: listener => { listener({ available: false }); return () => {}; }, close: async () => {}, resize: async () => {} };
const wifiState = { networks: [
  { key: 'first', path: '/ap/first', name: 'First network', Strength: 80, security: 'wpa-psk', supported: true, saved: true },
  { key: 'second', path: '/ap/second', name: 'Second network', Strength: 50, security: 'open', supported: true }
], loading: false, enabled: true };
const stubs = {
  'Helix/UserInterface': UI, 'Koya/Compositor': Compositor,
  'Helix/Log': { error: value => errors.push(value) },
  'Helix/Engine': { quit: () => {} },
  'Helix/Event': { on: (name, handler) => { const handlers = events.get(name) || []; handlers.push(handler); events.set(name, handlers); }, off: () => {} },
  'Koya/Assets': { mount: async () => {} },
  'Module/process': { getEnv: (name, fallback) => fallback },
  'Module/hypr': { connect: () => {}, monitors: async () => [] },
  'Module/pam': { authenticate: () => { throw new Error('Authentication must not be used in UI tests'); } },
  'Module/desktop': { userName: () => 'Test user', loadPreferences: () => ({ Wallpaper: 'waypaper-current' }), applications: async () => [
    { id: 'a.desktop', name: 'Alpha', executable: 'alpha', icon: '/rom/alpha.png' },
    { id: 'b.desktop', name: 'Beta', executable: 'beta', icon: '/rom/beta.png' }
  ], start: () => {}, launch: async () => {} },
  'apps/session.js': { connect: (name, handler) => {
    if (handler) { stateHandlers.set(name, handler); queueMicrotask(() => Promise.resolve(handler(state)).catch(error => errors.push(String(error)))); }
    return () => stateHandlers.delete(name);
  }, call: async (method, signature, key, value) => {
    if (method === 'SetSetting') {
      state[key] = value === 'true' ? true : value === 'false' ? false : value;
      await Promise.all([...stateHandlers.values()].map(handler => handler(state)));
    }
    return state;
  } },
  'apps/wifi-network.js': { wifiNetwork: changed => ({ start: async () => { changed(wifiState); }, dispose: () => {} }) },
  'apps/pulse-audio.js': { pulseAudio: () => ({ refresh: () => {}, start: () => {} }) },
  'Module/dbus': { session: { emitSignalTo: () => {} } }
};
async function load(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = stubs[name];
  const module = exports ? new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context, identifier: name }) : new vm.SourceTextModule(readFileSync(new URL('../' + name, import.meta.url), 'utf8'), { context, identifier: name });
  modules.set(name, module);
  await module.link((specifier, referencing) => load(specifier.startsWith('.')
    ? new URL(specifier, 'file:///' + referencing.identifier).pathname.slice(1) : specifier));
  return module;
}
async function use(name) { const module = await load(name); if (module.status !== 'evaluated') await module.evaluate(); return module.namespace; }
async function settle() { for (let i = 0; i < 100; i++) await new Promise(resolve => setImmediate(resolve)); }
const strings = id => [node(id).options.renderable?.string, ...node(id).children.flatMap(strings)].filter(value => value !== undefined);
const find = (name, win) => [...nodes].find(([, value]) => value.name === name && (win === undefined || value.win === win))?.[0];

const controls = await use('apps/touch-ui.js');
const win = await Compositor.createWindow({});
const root = await UI.createElement(win, {});
const beforeButton = rounds;
const button = await controls.button(win, root, 'Action', 100, 40, () => {}, { icon: '/rom/icon.png' });
assert.equal(rounds - beforeButton, 3, 'A complex button should build in three dependency batches');
assert.deepEqual(strings(button), ['Action']);
assert.equal(node(node(button).children[0]).options.renderable.type, 'sprite', 'Icon precedes label even when label replies arrive first');
const switchStart = rounds;
const toggle = await controls.toggle(win, root, true, () => {});
assert.equal(rounds - switchStart, 4, 'Switch parts and clips share batches; holding the initial pose depends on clip ids');
assert.equal(node(node(toggle.id).children[0]).children.length, 1);
function checkSwitch(control, on) {
  const target = node(control.id), track = node(target.children[0]), thumb = node(track.children[0]);
  const position = thumb.options.item.position;
  // Koya adds animation offsets to the static transform. Test initial state
  // and settled transitions so a duplicated offset cannot pass unnoticed.
  const left = position.x + (thumb.staticPosition?.x || 0) + (thumb.animatedPose?.position?.x || 0);
  const right = left + thumb.options.item.size.x;
  const inset = (track.options.item.size.y - thumb.options.item.size.y) / 2;
  assert.equal(on ? track.options.item.size.x - right : left, inset, 'Thumb keeps its inset at either end');
  assert.equal(position.y, inset);
  assert.equal(track.options.item.position.x, (target.options.item.size.x - track.options.item.size.x) / 2, 'Track is centered horizontally');
  assert.equal(track.options.item.position.y, (target.options.item.size.y - track.options.item.size.y) / 2, 'Track is centered vertically');
}
checkSwitch(toggle, true);
await toggle.set(false); checkSwitch(toggle, false);
await toggle.set(true); checkSwitch(toggle, true);
await toggle.set(false); checkSwitch(toggle, false);
const initiallyOff = await controls.toggle(win, root, false, () => {});
checkSwitch(initiallyOff, false);
await initiallyOff.set(true); checkSwitch(initiallyOff, true);
await initiallyOff.set(false); checkSwitch(initiallyOff, false);

const { appFrame } = await use('apps/app-frame.js');
const frameStart = rounds;
const frame = await appFrame({ title: 'Frame', namespace: 'koya-test-frame' });
assert(rounds - frameStart < 20, 'Window chrome should not wait separately for every element and animation');
const chrome = node(frame.root).children;
assert.equal(chrome.length, 3, 'Surface, shell and pager retain their draw order');
const header = node(chrome[1]).children[0];
assert.equal(node(header).children[0], find('app-back'));
assert.equal(node(node(header).children[1]).options.renderable.string, 'Frame');

const launcher = await use('apps/launcher.js'); launcher.default(); await settle();
assert(context.koyaLauncher, 'Launcher completed');
assert.deepEqual(strings(find('launcher-list')), ['Alpha', 'alpha', 'Beta', 'beta']);
const launcherRoot = node(find('launcher-root')).children;
assert.equal(node(launcherRoot[0]).children[0], find('launcher-query'), 'Search text precedes caret');

const settings = await use('apps/settings.js'); const settingsFrame = await settings.default(); await settle();
assert(strings(settingsFrame.current.el).includes('Wallpaper'));
await node(find('settings-wallpaper')).options.onActivate(); await settle();
const wallpaperLabels = strings(settingsFrame.current.el);
assert.equal(wallpaperLabels[0], 'Nocturne of Steel and Glass');
assert.equal(wallpaperLabels.filter(value => value === 'Selected').length, 1);

const wifi = await use('apps/wifi.js'); await wifi.default(); await settle();
assert(context.koyaWifi);
assert(find('wifi-network-first')); assert(find('wifi-network-second'));
const networkRow = node(find('wifi-network-first'));
assert.equal(node(networkRow.children[0]).options.renderable.type, 'sprite', 'Network icon is before the detail column');
assert.deepEqual(strings(networkRow.children[1]), ['First network', 'Saved']);
assert.equal(node(networkRow.children[2]).children.length, 2, 'Lock and chevron keep separate ordered slots');
await context.koyaWifi.openForm(wifiState.networks[0]); await settle();
assert.deepEqual(strings(find('wifi-password')), ['Password']);
assert.deepEqual(strings(context.koyaWifi.window ? windows.get(context.koyaWifi.window).root : 0).filter(value => ['Paste', 'Show', 'Connect'].includes(value)), ['Paste', 'Show', 'Connect']);
const topBar = await use('apps/top-bar.js');
await topBar.default({ display, volume: emptyAudio, notifications: {
  display, subscribe: listener => { listener(0); return () => {}; }, close: async () => {}, resize: async () => {}
} }); await settle();
const barWindow = [...windows.values()].find(value => value.options.namespace === 'koya-top-bar');
assert.deepEqual(node(barWindow.root).children.map(id => node(id).name), [
  'top-bar-brand', 'top-bar-datetime', undefined, 'top-bar-volume', undefined, 'top-bar-notifications'
]);
assert.match(node(find('top-bar-date')).options.renderable.string, /^\d{4}-\d{2}-\d{2}$/);
await node(find('app-back', settingsFrame.win)).options.onActivate(); await settle();
await node(find('settings-clock')).options.onActivate(); await settle();
assert(strings(settingsFrame.current.el).includes('24-hour time'));
await node(find('settings-ClockShowDate')).options.onActivate(); await settle();
assert.equal(node(find('top-bar-date')).enabled, false, 'Settings immediately hides the bar date');
assert(strings(settingsFrame.current.el).includes('Hidden'));
await node(find('settings-ClockTimeFormat')).options.onActivate(); await settle();
assert.match(node(find('top-bar-clock')).options.renderable.string, / (AM|PM)$/);
await node(find('settings-ClockShowSeconds')).options.onActivate(); await settle();
assert.match(node(find('top-bar-clock')).options.renderable.string, /^\d{1,2}:\d{2}:\d{2} (AM|PM)$/);

const { createVolume } = await use('apps/volume.js');
const volume = createVolume(display); await volume.toggle(display, { x: 100, y: 0, width: 36, height: 34 });
const volumeParts = node(find('volume-popup')).children;
assert.equal(volumeParts[0], find('volume-mute')); assert.equal(volumeParts[1], find('volume-slider'));
assert.equal(volumeParts[2], find('volume-percent'));
assert.equal(node(volumeParts[1]).children.length, 2, 'Rail and thumb remain ordered');

const { createNetworkPopup } = await use('apps/network-popup.js');
const network = createNetworkPopup(); await network.onState(state);
await network.toggle(display, { x: 200, y: 0, width: 48, height: 34 });
const networkParts = node(find('network-popup')).children;
assert.equal(networkParts[1], find('network-connection-status'));
assert.equal(networkParts.at(-1), find('network-configure-wifi'));

const { createNotifications } = await use('apps/notifications.js');
const notifications = createNotifications(display); await notifications.onState(state);
notifications.model.request(':1.test', 'Notify', ['Test app', 0, '', 'Test summary', 'Test body', ['open', 'Open', 'dismiss', 'Dismiss'], {}, 0]);
await settle();
assert(notifications.bannerWindow, 'Banner builder completed');
assert.deepEqual(strings(find('notification-1')), ['Test app', 'Test summary', 'Test body']);
await notifications.open(display); await settle();
assert(notifications.centerWindow, 'History builder completed');
assert.deepEqual(strings(find('notification-1', notifications.centerWindow)), ['Test app', 'Test summary', 'Test body', 'Open', 'Dismiss']);
const lock = await use('apps/lock.js'); lock.default(); await settle();
assert(find('lock-password'), 'Lock form completed');
const lockWindow = [...windows.values()].find(value => value.options.role === 'lock');
assert.equal(node(lockWindow.root).children.length, 2, 'Wallpaper precedes the centered form');
const lockForm = node(lockWindow.root).children[1];
assert.deepEqual(strings(lockForm).slice(-4), ['Test user', 'Password', 'Enter your password to unlock', 'Unlock']);
const { showSshPrompt } = await use('apps/ssh-prompt.js');
const answers = [];
const ssh = await showSshPrompt("Enter passphrase for key '/fixture/id_ed25519':", secret => answers.push(secret));
const sshRoot = windows.get(ssh.win).root;
assert.deepEqual(strings(sshRoot).filter(value => ['Unlock SSH key', 'Passphrase', 'Cancel', 'Unlock'].includes(value)), ['Unlock SSH key', 'Passphrase', 'Cancel', 'Unlock']);
assert.equal(windows.get(ssh.win).options.anchor, 'center');
for (const listener of events.get('textInput')) listener({ id: ssh.win, text: 'fixture秘密' });
await settle();
assert.equal(node(find('ssh-passphrase', ssh.win)).options.renderable.string, '•'.repeat(9));
assert(!strings(sshRoot).some(value => value.includes('fixture秘密')), 'Password never enters the render tree');
for (const listener of events.get('keyDown')) listener({ id: ssh.win, key: 65293 });
await settle();
assert.deepEqual(answers, ['fixture秘密']);
assert.equal(node(find('ssh-passphrase', ssh.win)).options.renderable.string, 'Passphrase');
await ssh.dispose();
for (const listener of events.get('textInput')) listener({ id: ssh.win, text: 'after closing' });
await settle(); assert.equal(answers.length, 1);
assert.deepEqual(errors, []);
console.log('UI batches and sibling order: passed');
