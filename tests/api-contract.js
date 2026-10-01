import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import * as UI from 'Helix/UserInterface';
import * as Compositor from 'Koya/Compositor';
import * as Image from 'Koya/Image';
import * as DBus from 'Module/dbus';
import { session as Fixture } from 'Module/dbus';
import * as Hypr from 'Module/hypr';
import * as ff from 'Module/ffmpeg';
import main from '../index.js';
import { Bar } from '../bar/index.js';
import { Wallpaper } from '../bar/wallpaper.js';
import { HyprWorkspaces } from '../hypr/workspaces.js';
import * as NetworkManager from '../lib/NetworkManager.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, message) {
    const end = Date.now() + 5000;
    while (Date.now() < end) { if (await check()) return; await sleep(25); }
    throw new Error(message);
}
const variant = (type, value) => ({ _t: type, _v: value });
const propsInterface = 'org.freedesktop.DBus.Properties';
const nm = 'org.freedesktop.NetworkManager';
const nmPath = '/org/freedesktop/NetworkManager';
const devicePath = nmPath + '/Devices/1';
const upowerPath = '/org/freedesktop/UPower/devices/DisplayDevice';
const powerPath = '/net/hadess/PowerProfiles';
const fixture = { deviceState: 30, battery: 63, profile: 'balanced', scans: 0, sets: [] };

async function installServices() {
    await Fixture.connect();
    for (const name of [nm, 'org.freedesktop.UPower', 'net.hadess.PowerProfiles']) {
        const result = await Fixture.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'RequestName', 'su', name, 4);
        assert(result === '1', 'Could not own fixture service ' + name);
    }
    const properties = new Map([
        [nmPath, () => ({ Devices: variant('ao', [devicePath]), ActiveConnections: variant('ao', []),
            WirelessEnabled: true, WwanEnabled: false })],
        [devicePath, iface => iface === nm + '.Device.Wireless'
            ? { AccessPoints: variant('ao', []), ActiveAccessPoint: variant('o', '/') }
            : { DeviceType: variant('u', 2), Interface: 'wlan0', State: variant('u', fixture.deviceState) }],
        [upowerPath, () => ({ Type: variant('u', 2), IsPresent: true, Percentage: variant('d', fixture.battery),
            State: variant('u', 1) })],
        [powerPath, () => ({ ActiveProfile: fixture.profile })]
    ]);
    for (const [path, get] of properties) {
        Fixture.exportObject(path, propsInterface, call => {
            if (call.member === 'GetAll') call.reply('a{sv}', get(call.args[0]));
            else if (call.member === 'Set') {
                fixture.sets.push(call.args);
                if (path === powerPath) fixture.profile = call.args[2];
                call.reply('');
                Fixture.emitSignal(path, propsInterface, 'PropertiesChanged', 'sa{sv}as',
                    call.args[0], { [call.args[1]]: call.args[2] }, []);
            } else call.error('org.freedesktop.DBus.Error.UnknownMethod', call.member);
        });
    }
    Fixture.exportObject('/org/freedesktop/UPower', 'org.freedesktop.UPower', call => call.reply('o', upowerPath));
    Fixture.exportObject('/org/freedesktop/ModemManager1', 'org.freedesktop.DBus.ObjectManager',
        call => call.reply('a{oa{sa{sv}}}', {}));
    // Network's optional modem probe must reach our private service too.
    await Fixture.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
        'RequestName', 'su', 'org.freedesktop.ModemManager1', 4);
    Fixture.exportObject(devicePath, nm + '.Device.Wireless', call => {
        assert(call.member === 'RequestScan' && call.signature === 'a{sv}', 'Scan dictionary was not marshalled');
        fixture.scans++;
        call.reply('');
    });
}

const config = {
    monitor: 'headless', thickness: 48, font: '/rom/font/Inter_18pt-Regular.ttf',
    iconFont: '/rom/font/DroidSansMNerdFont-Regular.otf',
    background: '#00000033', colour: '#dddddd', disabledColour: '#444444', alertColour: '#ff5511',
    highlight: ['#663399ff', '#66339933'], urgent: ['#fa5f5fff', '#00000000'],
    clock: { order: 100, shortTime: 'HH:mm', longTime: 'HH:mm:ss', shortDate: 'ddd Do MMM', longDate: 'dddd Do MMMM',
        calendar: { emptyCell: '#ffffff0a', normalCell: '#ffffff22', todayCell: '#663399ff',
            normalDay: '#fff', todayDay: '#dcbdfaff', weekText: '#aaa', showISOWeek: false } },
    network: { order: 0, showUnavailable: ['wifi'] }, battery: { order: 1 }
};

async function check(nativeOnly) {
    const version = await Engine.getVersion();
    Log.info('Native runtime: ' + JSON.stringify(version));
    assert(typeof main === 'function', 'Application bootstrap did not load');
    await installServices();
    await DBus.connect('system');
    Hypr.connect();
    const devices = await NetworkManager.getAllDeviceInfoIPDetail();
    assert(devices.length === 1 && devices[0].device === 'wlan0', 'Typed NetworkManager properties were not decoded');
    await NetworkManager.wifiEnable();
    await NetworkManager.wifiDisable();
    await NetworkManager.wwanEnable();
    await NetworkManager.wwanDisable();
    await NetworkManager.getWifiList(true);
    assert(fixture.sets.length === 4 && fixture.sets.every(args => typeof args[2] === 'boolean'),
        'Boolean variants did not arrive at the native DBus service');
    assert(fixture.scans === 1, 'RequestScan did not arrive at the native DBus service');
    let signal;
    const recordSignal = value => { if (value.path === powerPath) signal = value; };
    DBus.onSignal(recordSignal);
    DBus.addMatch("type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged'");
    Fixture.emitSignal(powerPath, propsInterface, 'PropertiesChanged', 'sa{sv}as',
        'net.hadess.PowerProfiles', { ActiveProfile: 'balanced' }, []);
    await waitFor(() => signal, 'Typed profile signal was not delivered');
    assert(signal.args[0] === 'net.hadess.PowerProfiles' && signal.args[1].ActiveProfile === 'balanced',
        'PropertiesChanged args were not decoded');
    DBus.offSignal(recordSignal);
    const queriedWorkspaces = await Hypr.workspaces();
    assert(queriedWorkspaces.length === 1 && queriedWorkspaces[0].monitor === 'headless', 'Native Hyprland query failed');
    Log.info('PASS: application module loading, native DBus variants, dictionaries, typed signals and Hyprland queries');
    if (nativeOnly) return;

    const bar = await Bar.create(config);
    assert(bar.power.hasPowerProfiles, 'Power profile service did not initialize');
    assert(bar.battery._hasBattery, 'Typed UPower properties did not initialize the battery');
    assert(bar.network.connections.length === 1, 'Typed NetworkManager properties did not initialize Wi-Fi');
    assert(await UI.getElementById(bar.win, 'not-an-element') === -1, 'Missing element must return -1');
    assert((await UI.getRenderableSize(bar.win, bar.battery.batteryText)).x > 0, 'Battery text did not render');
    await bar.power.activateProfile('power-saver');
    assert(fixture.profile === 'power-saver', 'Profile variant did not reach the DBus service');
    const connection = bar.network.connections[0];
    fixture.deviceState = 20;
    Fixture.emitSignal(devicePath, propsInterface, 'PropertiesChanged', 'sa{sv}as',
        nm + '.Device', { State: variant('u', fixture.deviceState) }, []);
    await waitFor(() => connection.status.state === 'unavailable', 'Typed device signal did not refresh Wi-Fi');
    Log.info('PASS: native bar UI, battery, power profiles and Wi-Fi updates');

    const wallpaper = await Wallpaper.create({ fadeTime: 0.1 });
    const background = wallpaper.backgrounds.headless;
    assert(background, 'Headless background was not created');
    const info = await Compositor.getWindowInfo(background.win);
    const bounds = await UI.getRenderableSize(background.win, background.canvasA);
    assert(bounds.x === info.width && bounds.y === info.height && bounds.x > 0, 'Wallpaper has invalid native geometry');
    await wallpaper.changeTo('/rom/test-video.mp4');
    await waitFor(() => background.current === '/ram/video/headless:/rom/test-video.mp4', 'Video fade did not complete');
    assert(ff.details(background.win, background.current)?.width === 32, 'Native video decoder did not load the fixture');
    const videoKey = background.current;
    await wallpaper.changeTo('/rom/image/wallhaven-yxrkm7.png');
    await waitFor(() => background.current === '/rom/image/wallhaven-yxrkm7.png', 'Image fade did not complete');
    assert(ff.details(background.win, videoKey)?.width === undefined, 'Replaced video stream was not stopped');
    const image = await Image.render(bar.win, await UI.getElementById(bar.win, 'root'), { includeTree: true });
    const png = await Image.encode(bar.win, { src: image, format: 'png' });
    assert(png.length > 100 && png[0] === 137 && png[1] === 80, 'Bar did not produce a rendered PNG');
    Log.info('PASS: native wallpaper geometry, animation callbacks, video cleanup and bar rendering');

    const workspaces = await HyprWorkspaces.create(config);
    await workspaces.switchTo('1');
    assert(workspaces.workspaceCell[1].isFocussed, 'Native workspace strip did not focus');
    await workspaces.workspaceCell[1].setUrgent();
    await workspaces.removeWorkspace('1');
    assert(!workspaces.workspaceCell[1], 'Workspace teardown failed');
    Log.info('PASS: native Hyprland queries and workspace UI');
}

export default function (args) {
    // Run after bootstrap so the engine drives promises and callback delivery.
    setTimeout(async () => {
        try { await check(args.includes('ipc')); Log.info('KOYA_BAR_TEST_PASS'); }
        catch (error) { Log.error('KOYA_BAR_TEST_FAIL: ' + error + '\n' + (error.stack || '')); }
        finally { await Engine.quit(); }
    }, 0);
}
