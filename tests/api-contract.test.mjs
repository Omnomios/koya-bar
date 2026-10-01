import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = {
    monitor: '', thickness: 48, font: '/rom/font/Inter_18pt-Regular.ttf',
    iconFont: '/rom/font/DroidSansMNerdFont-Regular.otf',
    background: '#00000033', colour: '#dddddd', disabledColour: '#444444', alertColour: '#ff5511',
    highlight: ['#663399ff', '#66339933'], urgent: ['#fa5f5fff', '#00000000'],
    clock: {
        order: 100, shortTime: 'HH:mm', longTime: 'HH:mm:ss', shortDate: 'ddd Do MMM', longDate: 'dddd Do MMMM',
        calendar: { emptyCell: '#ffffff0a', normalCell: '#ffffff22', todayCell: '#663399ff',
            normalDay: '#fff', todayDay: '#dcbdfaff', weekText: '#aaa', showISOWeek: false }
    },
    network: { order: 0, showUnavailable: ['wifi'] }, battery: { order: 1 }
};

// Only documented exports are provided. Loading the application fails if it
// imports a removed module or calls an export outside the current contract.
function runtime(displays = [{ display: 'DP-1', logical_width: '1920', logical_height: '1080' }]) {
    const elements = new Map();
    const animations = new Map();
    const animationEnds = new Map();
    const signals = [];
    const videos = [];
    const calls = [];
    let nextWindow = 0;
    let nextElement = 0;
    let nextAnimation = 0;
    const context = vm.createContext({
        console, TextEncoder, TextDecoder,
        setTimeout: () => 1, clearTimeout: () => {},
        setInterval: () => 1, clearInterval: () => {}
    });
    const element = (win, id) => {
        assert.ok(Number.isInteger(id) && id >= 0, `Invalid element ID: ${id}`);
        const value = elements.get(id);
        assert.equal(value?.win, win);
        return value;
    };
    const geometry = value => {
        if (!value) return;
        for (const axis of ['x', 'y']) {
            if (value[axis] !== undefined) {
                assert.ok(typeof value[axis] === 'number' || value[axis] === 'auto', 'Geometry must be numeric or auto');
            }
        }
    };
    const UI = {
        async createElement(win, options) {
            geometry(options.item?.size);
            geometry(options.renderable?.aabb?.min);
            geometry(options.renderable?.aabb?.max);
            const id = nextElement++;
            elements.set(id, { win, options });
            for (const child of options.child || []) {
                if (typeof child === 'number') element(win, child);
                else await UI.createElement(win, child);
            }
            return id;
        },
        async getElementById(win, name) {
            return [...elements].find(([, e]) => e.win === win && e.options.id === name)?.[0] ?? -1;
        },
        async attachRoot(win, id) { element(win, id); return true; },
        async attach(win, parent, id) { element(win, parent); element(win, id); return true; },
        async detach(win, parent, id) { element(win, parent); element(win, id); return true; },
        async destroyElement(win, id) { element(win, id); elements.delete(id); return true; },
        async setEnabled(win, id, enabled) { element(win, id).enabled = enabled; return true; },
        async setTextString(win, id, text) { element(win, id).text = text; return true; },
        async setTextColour(win, id, colour) { element(win, id).colour = colour; return true; },
        async setTexture(win, id, texture) { element(win, id).texture = texture; return true; },
        async addAnimation(win, id, frames) {
            element(win, id);
            assert.ok(frames.every(frame => Number.isFinite(frame.time)));
            const animation = nextAnimation++;
            animations.set(animation, { win, id });
            return animation;
        },
        async onAnimationEnd(win, id, animation, callback) {
            assert.deepEqual(animations.get(animation), { win, id });
            animationEnds.set(animation, callback);
            return true;
        },
        async startAnimation(win, id, animation) {
            assert.deepEqual(animations.get(animation), { win, id });
            return true;
        },
        async stopAnimation(win, id) { element(win, id); return true; }
    };
    const dbusCall = async (...args) => {
        calls.push(args);
        const [dest, path, , method] = args;
        if (method === 'GetDisplayDevice') return '/org/freedesktop/UPower/devices/DisplayDevice';
        if (method === 'GetManagedObjects') return {};
        if (dest === 'org.freedesktop.UPower') return { Type: 2, IsPresent: true, Percentage: 63, State: 1 };
        if (dest === 'net.hadess.PowerProfiles') return { ActiveProfile: 'balanced' };
        if (path === '/org/freedesktop/NetworkManager') return { Devices: ['/device/wifi'] };
        if (path === '/device/wifi') return { DeviceType: 2, Interface: 'wlan0', State: 30, ActiveAccessPoint: '/', AccessPoints: [] };
        return {};
    };
    const modules = {
        'Helix/UserInterface': UI,
        'Helix/Log': { debug() {}, info() {}, warn() {}, error() {} },
        'Koya/Compositor': {
            async createWindow() { return nextWindow++; },
            async getWindowInfo() { return { width: 960, height: 540 }; },
            async listDisplays() { return displays; },
            async destroyWindow() { return true; },
            async setWindowRenderingEnabled() { return true; },
            async setPointerEvents() { return true; },
            async setCursor() { return true; }
        },
        'Module/dbus': {
            async connect(bus) { assert.equal(bus, 'system'); },
            async call(...args) {
                assert.ok(!/[av({]/.test(args[4] || ''), 'Containers and variants require callComplex');
                return dbusCall(...args);
            },
            callComplex: dbusCall,
            addMatch(rule) { assert.equal(typeof rule, 'string'); },
            onSignal(callback) { signals.push(callback); },
            offSignal(callback) { signals.splice(signals.indexOf(callback), 1); }
        },
        'Module/hypr': {
            connect() {}, on() {},
            async workspaces() { return [{ id: 1, name: '1', monitor: 'DP-1' }]; },
            async json() { return []; }
        },
        'Module/ffmpeg': Object.fromEntries(['load', 'stop'].map(name => [name, (...args) => {
            assert.equal(args.length, name === 'load' ? 3 : 2);
            assert.ok(Number.isInteger(args[0]));
            videos.push([name, ...args]);
        }]))
    };
    const cache = new Map();
    async function moduleFor(id) {
        // Koya's asset loader tries an appended .js for extensionless imports.
        if (id.startsWith(project + '/') && !extname(id)) id += '.js';
        if (cache.has(id)) return cache.get(id);
        let mod;
        if (modules[id]) {
            const exports = modules[id];
            mod = new vm.SyntheticModule(Object.keys(exports), function () {
                for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
            }, { context, identifier: id });
        } else {
            assert.ok(id.startsWith(project + '/'), `Unsupported runtime module: ${id}`);
            mod = new vm.SourceTextModule(await readFile(id, 'utf8'), { context, identifier: id });
        }
        cache.set(id, mod);
        return mod;
    }
    async function load(path) {
        const mod = await moduleFor(resolve(project, path));
        await mod.link((specifier, parent) => moduleFor(specifier.startsWith('.')
            ? resolve(dirname(parent.identifier), specifier) : specifier));
        await mod.evaluate();
        return mod.namespace;
    }
    return { load, elements, animationEnds, signals, calls, videos };
}

test('bootstrap module graph uses current module names', async () => {
    const { load } = runtime();
    assert.equal(typeof (await load('index.js')).default, 'function');
});

test('bar and calendar build with promise-based UI and typed DBus replies', async () => {
    const r = runtime();
    const { Bar } = await r.load('bar/index.js');
    const bar = await Bar.create(config);
    assert.equal(bar.win, 0);
    assert.equal(r.elements.get(bar.battery.batteryText).text, '63%');
    assert.equal(bar.power.hasPowerProfiles, true);
    await r.elements.get(bar.dateTime.element).options.onMouseClick();
    assert.ok(bar.dateTime.calendar);
    await r.animationEnds.get(bar.dateTime.anim.hide)();
    await new Promise(setImmediate);
    assert.equal(bar.dateTime.calendar.visible, true);
    await bar.dateTime.calendar.hide();
    assert.equal(bar.dateTime.calendar.visible, false);

    // A valid element may have ID zero. A failed lookup returns -1.
    bar.power.iconElements.balanced = 0;
    await bar.power.refresh();
    assert.equal(r.elements.get(0).colour, config.colour);
    bar.power.iconElements.balanced = -1;
    await bar.power.refresh();
    assert.equal(bar.power.hasPowerProfiles, true);
    const balanced = [...r.elements.values()].find(e => e.options.id === 'pp:balanced');
    balanced.options.id = 'removed-profile';
    await bar.power.refresh();
    assert.equal(bar.power.hasPowerProfiles, true, 'A missing icon must be skipped without disabling the module');
    await bar.power.activateProfile('power-saver');
    const set = r.calls.find(call => call[3] === 'Set');
    assert.equal(set[4], 'ssv');
    assert.equal(set[7]._v, 'power-saver');

    const handler = r.signals.at(-1);
    const before = r.calls.length;
    handler({ path: '/net/hadess/PowerProfiles', interface: 'org.freedesktop.DBus.Properties',
        member: 'PropertiesChanged', body: '', args: ['net.hadess.PowerProfiles', {}, []] });
    await new Promise(setImmediate);
    assert.ok(r.calls.length > before, 'Typed PropertiesChanged signal must trigger refresh');

    const networkHandler = r.signals[0];
    const connection = bar.network.connections[0];
    let updates = 0;
    connection.update = async () => { updates++; };
    networkHandler({ path: connection.status.devPath, interface: 'org.freedesktop.DBus.Properties',
        member: 'PropertiesChanged', args: ['org.freedesktop.NetworkManager.Device', {}, []] });
    assert.equal(updates, 1);
});

test('NetworkManager uses complex marshalling for variants and scan dictionaries', async () => {
    const r = runtime();
    const nm = await r.load('lib/NetworkManager.js');
    await nm.wifiEnable();
    await nm.wifiDisable();
    await nm.wwanEnable();
    await nm.wwanDisable();
    await nm.getWifiList(true);
    assert.equal(r.calls.filter(call => call[3] === 'Set').length, 4);
    assert.equal(r.calls.find(call => call[3] === 'RequestScan')[4], 'a{sv}');
});

test('wallpaper uses configured numeric geometry and releases replaced video streams', async () => {
    // Logical dimensions can be absent from display descriptors.
    const r = runtime([{ display: 'DP-1' }]);
    const { Wallpaper } = await r.load('bar/wallpaper.js');
    const wallpaper = await Wallpaper.create();
    const bg = wallpaper.backgrounds['DP-1'];
    assert.equal(r.elements.get(bg.root).options.item.size.x, 960);
    assert.equal(r.elements.get(bg.canvasA).options.renderable.aabb.max.y, 540);
    await wallpaper.changeTo('/rom/movie.mp4');
    await r.animationEnds.get(bg.animB.show)();
    await wallpaper.changeTo('/rom/movie.mp4');
    await r.animationEnds.get(bg.animB.show)();
    assert.equal(r.videos.filter(call => call[0] === 'stop').length, 0);
    await wallpaper.changeTo('/rom/image/wallhaven-yxrkm7.png');
    await r.animationEnds.get(bg.animB.show)();
    assert.deepEqual(r.videos.at(-1), ['stop', bg.win, '/ram/video/DP-1:/rom/movie.mp4']);
});

test('workspace strip builds with current UI and Hyprland exports', async () => {
    const r = runtime();
    const { HyprWorkspaces } = await r.load('hypr/workspaces.js');
    const workspaces = await HyprWorkspaces.create(config);
    await workspaces.switchTo('1');
    assert.equal(workspaces.workspaceCell[1].isFocussed, true);
    await workspaces.removeWorkspace('1');
    assert.equal(workspaces.workspaceCell[1], undefined);
});
