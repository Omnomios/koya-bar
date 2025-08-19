import * as DBus from 'Module/dbus';
// Local DBus helpers; do not depend on external NetworkManager.js
let _connected = false;
let _connecting = null;
async function ensureConnected (bus = 'system')
{
    if(_connected) return;
    if(_connecting) { await _connecting; return; }
    _connecting = (async () => {
        await DBus.connect(bus);
        _connected = true;
    })();
    try { await _connecting; } finally { _connecting = null; }
}

const parseObject = (value) =>
{
    if(value && typeof value === 'object') return value;
    if(typeof value === 'string') { try { return JSON.parse(value); } catch(_) { return undefined; } }
    return undefined;
};

const getAllProps = async (path, iface) =>
{
    try
    {
        const raw = await DBus.call(
            'org.freedesktop.NetworkManager',
            path,
            'org.freedesktop.DBus.Properties',
            'GetAll',
            's',
            iface
        );
        return parseObject(raw) || {};
    }
    catch(_)
    {
        return {};
    }
};

const getRootProps = async () =>
{
    const raw = await DBus.call(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.DBus.Properties',
        'GetAll',
        's',
        'org.freedesktop.NetworkManager'
    );
    return parseObject(raw) || {};
};

const toNetmaskFromPrefix = (prefix) =>
{
    const p = typeof prefix === 'number' ? prefix : parseInt(prefix);
    if(!(p >= 0 && p <= 32)) return undefined;
    let mask = 0xffffffff << (32 - p);
    const oct = [
        (mask >>> 24) & 0xff,
        (mask >>> 16) & 0xff,
        (mask >>> 8) & 0xff,
        mask & 0xff
    ];
    return oct.join('.');
};

const decodeSsidBytes = (bytes) =>
{
    try
    {
        if(Array.isArray(bytes)) bytes = Uint8Array.from(bytes.map((n)=> (typeof n === 'number' ? (n & 0xff) : 0)));
        if(bytes instanceof Uint8Array)
        {
            // Trim trailing NULs
            let end = bytes.length; while(end > 0 && bytes[end-1] === 0) end--;
            const trimmed = bytes.subarray(0, end);
            try { return new TextDecoder('utf-8').decode(trimmed); } catch(_){ }
            try { return new TextDecoder('latin1').decode(trimmed); } catch(_){ }
            return '0x' + Array.from(trimmed).map((b) => b.toString(16).padStart(2,'0')).join('');
        }
        if(typeof bytes === 'string') return bytes;
    }
    catch(_){ }
    return undefined;
};

// DBus helpers adopted from the old NetworkManager.js (inlined)
async function listActiveConnectionPaths()
{
    await ensureConnected();
    try
    {
        const result = await DBus.call(
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager',
            'org.freedesktop.DBus.Properties',
            'GetAll',
            's',
            'org.freedesktop.NetworkManager'
        );
        let obj = null;
        if(typeof result === 'string') { try { obj = JSON.parse(result); } catch(_) { obj = null; } }
        else if(result && typeof result === 'object') obj = result;
        const active = obj && Array.isArray(obj.ActiveConnections) ? obj.ActiveConnections : [];
        return active.filter((p) => typeof p === 'string' && p.length > 0);
    }
    catch(_){ return []; }
}

// use top-level getAllProps (const) defined earlier

async function getConnectionDetails(identifier)
{
    try
    {
        await ensureConnected();
        if(typeof identifier !== 'string' || identifier.length === 0) return {};

        const parseVal = (v) => (v && typeof v === 'object') ? v : (typeof v === 'string' ? (()=>{try{return JSON.parse(v);}catch(_){return undefined;}})() : undefined);

        const getProps = async (path, iface) => {
            try
            {
                const raw = await DBus.call(
                    'org.freedesktop.NetworkManager',
                    path,
                    'org.freedesktop.DBus.Properties',
                    'GetAll',
                    's',
                    iface
                );
                return parseVal(raw) || {};
            }
            catch(_){ return {}; }
        };

        const active = await getProps(identifier, 'org.freedesktop.NetworkManager.Connection.Active');
        if(!active || Object.keys(active).length === 0) return {};

        const connectionPath = typeof active.Connection === 'string' ? active.Connection : undefined;
        let settings = {};
        if(connectionPath)
        {
            try
            {
                const rawSettings = await DBus.call(
                    'org.freedesktop.NetworkManager',
                    connectionPath,
                    'org.freedesktop.NetworkManager.Settings.Connection',
                    'GetSettings'
                );
                settings = parseVal(rawSettings) || {};
            }
            catch(_){ settings = {}; }
        }

        const devicePaths = Array.isArray(active.Devices) ? active.Devices : [];
        const devices = await Promise.all(devicePaths.map(async (devicePath) =>
        {
            const dev = await getProps(devicePath, 'org.freedesktop.NetworkManager.Device');
            return {
                path: devicePath,
                interface: typeof dev.Interface === 'string' ? dev.Interface : undefined,
                ipInterface: typeof dev.IpInterface === 'string' ? dev.IpInterface : undefined,
                driver: typeof dev.Driver === 'string' ? dev.Driver : undefined,
                hwAddress: typeof dev.HwAddress === 'string' ? dev.HwAddress : undefined,
                deviceType: typeof dev.DeviceType !== 'undefined' ? dev.DeviceType : undefined,
                state: typeof dev.State !== 'undefined' ? dev.State : undefined,
            };
        }));

        const ip4Path = typeof active.Ip4Config === 'string' ? active.Ip4Config : undefined;
        const ip6Path = typeof active.Ip6Config === 'string' ? active.Ip6Config : undefined;
        const dhcp4Path = typeof active.Dhcp4Config === 'string' ? active.Dhcp4Config : undefined;
        const dhcp6Path = typeof active.Dhcp6Config === 'string' ? active.Dhcp6Config : undefined;

        const [ip4, ip6, dhcp4, dhcp6] = await Promise.all([
            ip4Path ? getProps(ip4Path, 'org.freedesktop.NetworkManager.IP4Config') : Promise.resolve({}),
            ip6Path ? getProps(ip6Path, 'org.freedesktop.NetworkManager.IP6Config') : Promise.resolve({}),
            dhcp4Path ? getProps(dhcp4Path, 'org.freedesktop.NetworkManager.DHCP4Config') : Promise.resolve({}),
            dhcp6Path ? getProps(dhcp6Path, 'org.freedesktop.NetworkManager.DHCP6Config') : Promise.resolve({}),
        ]);

        return {
            id: typeof active.Id === 'string' ? active.Id : undefined,
            uuid: typeof active.Uuid === 'string' ? active.Uuid : undefined,
            type: typeof active.Type === 'string' ? active.Type : undefined,
            state: typeof active.State !== 'undefined' ? active.State : undefined,
            stateFlags: typeof active.StateFlags !== 'undefined' ? active.StateFlags : undefined,
            default: typeof active.Default !== 'undefined' ? active.Default : undefined,
            default6: typeof active.Default6 !== 'undefined' ? active.Default6 : undefined,
            vpn: typeof active.Vpn !== 'undefined' ? active.Vpn : undefined,
            metered: typeof active.Metered !== 'undefined' ? active.Metered : undefined,
            master: typeof active.Master === 'string' ? active.Master : undefined,
            connectionPath,
            specificObject: typeof active.SpecificObject === 'string' ? active.SpecificObject : undefined,
            ip4ConfigPath: ip4Path,
            ip6ConfigPath: ip6Path,
            dhcp4ConfigPath: dhcp4Path,
            dhcp6ConfigPath: dhcp6Path,
            devices,
            ip4: {
                addressData: Array.isArray(ip4.AddressData) ? ip4.AddressData : undefined,
                gateway: typeof ip4.Gateway === 'string' ? ip4.Gateway : undefined,
                routes: Array.isArray(ip4.Routes) ? ip4.Routes : undefined,
                nameservers: Array.isArray(ip4.Nameservers) ? ip4.Nameservers : undefined,
                nameserverData: Array.isArray(ip4.NameserverData) ? ip4.NameserverData : undefined,
                domains: Array.isArray(ip4.Domains) ? ip4.Domains : undefined,
                dnsOptions: Array.isArray(ip4.DnsOptions) ? ip4.DnsOptions : undefined,
                dnsPriority: typeof ip4.DnsPriority !== 'undefined' ? ip4.DnsPriority : undefined,
            },
            ip6: {
                addressData: Array.isArray(ip6.AddressData) ? ip6.AddressData : undefined,
                gateway: typeof ip6.Gateway === 'string' ? ip6.Gateway : undefined,
                routes: Array.isArray(ip6.Routes) ? ip6.Routes : undefined,
                nameservers: Array.isArray(ip6.Nameservers) ? ip6.Nameservers : undefined,
                nameserverData: Array.isArray(ip6.NameserverData) ? ip6.NameserverData : undefined,
                domains: Array.isArray(ip6.Domains) ? ip6.Domains : undefined,
                dnsOptions: Array.isArray(ip6.DnsOptions) ? ip6.DnsOptions : undefined,
                dnsPriority: typeof ip6.DnsPriority !== 'undefined' ? ip6.DnsPriority : undefined,
            },
            dhcp4: { options: dhcp4 && typeof dhcp4.Options === 'object' ? dhcp4.Options : undefined },
            dhcp6: { options: dhcp6 && typeof dhcp6.Options === 'object' ? dhcp6.Options : undefined },
            settings,
        };
    }
    catch(_){ return {}; }
}

async function listSavedConnectionPaths()
{
    await ensureConnected();
    try
    {
        const raw = await DBus.call(
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager/Settings',
            'org.freedesktop.NetworkManager.Settings',
            'ListConnections'
        );
        const parsed = parseObject(raw);
        return Array.isArray(raw) ? raw : (Array.isArray(parsed) ? parsed : []);
    }
    catch(_){ return []; }
}

async function getSavedConnectionDetails(connectionPath)
{
    await ensureConnected();
    try
    {
        if(typeof connectionPath !== 'string' || connectionPath.length === 0) return {};
        const rawSettings = await DBus.call(
            'org.freedesktop.NetworkManager',
            connectionPath,
            'org.freedesktop.NetworkManager.Settings.Connection',
            'GetSettings'
        );
        const settings = parseObject(rawSettings) || {};
        const conn = settings?.connection || {};
        const id = typeof conn.id === 'string' ? conn.id : undefined;
        const uuid = typeof conn.uuid === 'string' ? conn.uuid : undefined;
        const type = typeof conn.type === 'string' ? conn.type : undefined;
        return { path: connectionPath, id, uuid, type, settings };
    }
    catch(_){ return {}; }
}

async function getAllConnections(includeActiveDetails = false)
{
    await ensureConnected();
    try
    {
        const listRaw = await DBus.call(
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager/Settings',
            'org.freedesktop.NetworkManager.Settings',
            'ListConnections'
        );
        const listParsed = parseObject(listRaw);
        const connectionPaths = Array.isArray(listRaw) ? listRaw : (Array.isArray(listParsed) ? listParsed : []);
        if(!Array.isArray(connectionPaths) || connectionPaths.length === 0) return [];

        const activeMap = new Map();
        try
        {
            const activePaths = await listActiveConnectionPaths();
            const pairs = await Promise.all(activePaths.map(async (acPath) => {
                try
                {
                    const raw = await DBus.call(
                        'org.freedesktop.NetworkManager',
                        acPath,
                        'org.freedesktop.DBus.Properties',
                        'GetAll',
                        's',
                        'org.freedesktop.NetworkManager.Connection.Active'
                    );
                    const props = parseObject(raw) || {};
                    const connPath = typeof props.Connection === 'string' ? props.Connection : undefined;
                    return connPath ? [connPath, acPath] : null;
                }
                catch(_){ return null; }
            }));
            for(const pair of pairs)
            {
                if(!pair) continue;
                const [connPath, acPath] = pair;
                if(!activeMap.has(connPath)) activeMap.set(connPath, []);
                activeMap.get(connPath).push(acPath);
            }
        }
        catch(_){ }

        const results = await Promise.all(connectionPaths.map(async (connPath) =>
        {
            try
            {
                const rawSettings = await DBus.call(
                    'org.freedesktop.NetworkManager',
                    connPath,
                    'org.freedesktop.NetworkManager.Settings.Connection',
                    'GetSettings'
                );
                const settings = parseObject(rawSettings) || {};
                const conn = settings?.connection || {};
                const id = typeof conn.id === 'string' ? conn.id : undefined;
                const uuid = typeof conn.uuid === 'string' ? conn.uuid : undefined;
                const type = typeof conn.type === 'string' ? conn.type : undefined;
                const activePaths = activeMap.get(connPath) || [];
                let activeDetails = undefined;
                if(includeActiveDetails && activePaths.length > 0)
                {
                    activeDetails = await Promise.all(activePaths.map((p) => getConnectionDetails(p)));
                }
                return { path: connPath, id, uuid, type, settings, active: activePaths.length > 0, activePaths, activeDetails };
            }
            catch(_)
            {
                const activePaths = activeMap.get(connPath) || [];
                return { path: connPath, active: activePaths.length > 0, activePaths };
            }
        }));

        return results;
    }
    catch(_){ return []; }
}

async function devTypeName(num)
{
    const map = { 0:'unknown',1:'ethernet',2:'wifi',5:'bt',6:'olpc-mesh',7:'wimax',8:'modem',9:'infiniband',10:'bond',11:'vlan',12:'adsl',13:'bridge',14:'team',15:'tun',16:'ip-tunnel',17:'macvlan',18:'vxlan',19:'veth',20:'macsec',21:'dummy',22:'ppp',23:'wifi-p2p',24:'vrf',25:'loopback' };
    return typeof num === 'number' && num in map ? map[num] : undefined;
}

async function stateName(num)
{
    const map = { 10:'unmanaged',20:'unavailable',30:'disconnected',40:'prepare',50:'config',60:'need-auth',70:'ip-config',80:'ip-check',90:'secondaries',100:'connected',110:'deactivating',120:'failed' };
    return typeof num === 'number' && num in map ? map[num] : undefined;
}

async function getOverview()
{
    try
    {
        await ensureConnected();
        const rootRaw = await DBus.call(
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager',
            'org.freedesktop.DBus.Properties',
            'GetAll',
            's',
            'org.freedesktop.NetworkManager'
        );
        const root = parseObject(rootRaw) || {};
        const devicePaths = Array.isArray(root.Devices) ? root.Devices : [];

        const activePaths = await listActiveConnectionPaths();
        const activeDetails = await Promise.all(activePaths.map((p) => getConnectionDetails(p)));
        const deviceToActive = new Map();
        for(const ac of activeDetails)
        {
            if(!ac || !Array.isArray(ac.devices)) continue;
            for(const d of ac.devices)
            {
                if(!d?.path) continue;
                deviceToActive.set(d.path, ac);
            }
        }

        const deviceSummaries = await Promise.all(devicePaths.map(async (devPath) =>
        {
            const dev = await getAllProps(devPath, 'org.freedesktop.NetworkManager.Device');
            const iface = typeof dev.Interface === 'string' ? dev.Interface : undefined;
            const product = typeof dev.Product === 'string' ? dev.Product : (iface || undefined);
            const typeStr = await devTypeName(dev.DeviceType) || 'unknown';
            const driver = typeof dev.Driver === 'string' ? dev.Driver : undefined;
            const mac = typeof dev.HwAddress === 'string' ? dev.HwAddress : undefined;
            const mtu = typeof dev.Mtu !== 'undefined' ? dev.Mtu : undefined;
            const stateStr = await stateName(dev.State) || 'unknown';
            const hwOrSw = (typeStr === 'loopback' || typeStr === 'wifi-p2p' || typeStr === 'tun' || typeStr === 'ip-tunnel' || typeStr === 'bridge' || typeStr === 'bond' || typeStr === 'team' || typeStr === 'vlan' || typeStr === 'dummy') ? 'sw' : 'hw';

            const ac = deviceToActive.get(devPath);
            const connectedTo = ac?.id;
            const ip4Default = !!ac?.default;

            const inet4 = Array.isArray(ac?.ip4?.addressData) ? ac.ip4.addressData
                .map((a) => { const addr = a?.address ?? a?.Address ?? undefined; const prefix = a?.prefix ?? a?.Prefix ?? undefined; return (typeof addr === 'string' && typeof prefix !== 'undefined') ? `${addr}/${prefix}` : undefined; })
                .filter(Boolean) : [];

            const route4 = Array.isArray(ac?.ip4?.routes) ? ac.ip4.routes
                .map((r) => { const dest = r?.dest ?? r?.Dest ?? undefined; const prefix = r?.prefix ?? r?.Prefix ?? undefined; const gw = r?.gateway ?? r?.Gateway ?? r?.nextHop ?? r?.NextHop ?? undefined; const metric = r?.metric ?? r?.Metric ?? undefined; if((dest === '0.0.0.0' || prefix === 0) && gw){ return metric !== undefined ? `default via ${gw} metric ${metric}` : `default via ${gw}`; } if(typeof dest === 'string' && typeof prefix !== 'undefined'){ return metric !== undefined ? `${dest}/${prefix} metric ${metric}` : `${dest}/${prefix}`; } return undefined; })
                .filter(Boolean) : [];

            const inet6 = Array.isArray(ac?.ip6?.addressData) ? ac.ip6.addressData
                .map((a) => { const addr = a?.address ?? a?.Address ?? undefined; const prefix = a?.prefix ?? a?.Prefix ?? undefined; return (typeof addr === 'string' && typeof prefix !== 'undefined') ? `${addr}/${prefix}` : undefined; })
                .filter(Boolean) : [];

            const route6 = Array.isArray(ac?.ip6?.routes) ? ac.ip6.routes
                .map((r) => { const dest = r?.dest ?? r?.Dest ?? undefined; const prefix = r?.prefix ?? r?.Prefix ?? undefined; const gw = r?.gateway ?? r?.Gateway ?? r?.nextHop ?? r?.NextHop ?? undefined; const metric = r?.metric ?? r?.Metric ?? undefined; if((dest === '::' || prefix === 0) && gw){ return metric !== undefined ? `default via ${gw} metric ${metric}` : `default via ${gw}`; } if(typeof dest === 'string' && typeof prefix !== 'undefined'){ return metric !== undefined ? `${dest}/${prefix} metric ${metric}` : `${dest}/${prefix}`; } return undefined; })
                .filter(Boolean) : [];

            return {
                interface: iface,
                status: connectedTo ? (ac?.state === 100 ? 'connected' : stateStr) : stateStr,
                connectedTo: connectedTo,
                product: product,
                type: typeStr,
                driver: driver,
                mac: mac,
                mode: hwOrSw,
                mtu: mtu,
                ip4Default: ip4Default,
                inet4: inet4,
                route4: route4,
                inet6: inet6,
                route6: route6,
            };
        }));

        // DNS summary
        let dnsServers = [];
        let dnsInterface = undefined;
        const def = activeDetails.find((ac) => ac?.default);
        if(def)
        {
            const servers4 = Array.isArray(def?.ip4?.nameservers) ? def.ip4.nameservers : [];
            const servers6 = Array.isArray(def?.ip6?.nameservers) ? def.ip6.nameservers : [];
            dnsServers = (servers4.length > 0 ? servers4 : servers6).filter((s) => typeof s === 'string');
            const devPath = (def.devices && def.devices[0] && def.devices[0].path) ? def.devices[0].path : undefined;
            if(devPath)
            {
                const dev = await getAllProps(devPath, 'org.freedesktop.NetworkManager.Device');
                dnsInterface = typeof dev.Interface === 'string' ? dev.Interface : undefined;
            }
        }

        return { devices: deviceSummaries, dns: { servers: dnsServers, interface: dnsInterface } };
    }
    catch(_){ return { devices: [], dns: { servers: [], interface: undefined } }; }
}

async function listVisibleAccessPoints()
{
    try
    {
        await ensureConnected();
        const rootRaw = await DBus.call(
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager',
            'org.freedesktop.DBus.Properties',
            'GetAll',
            's',
            'org.freedesktop.NetworkManager'
        );
        const root = parseObject(rootRaw) || {};
        const devicePaths = Array.isArray(root.Devices) ? root.Devices : [];
        const all = [];
        for(const devPath of devicePaths)
        {
            const dev = await getAllProps(devPath, 'org.freedesktop.NetworkManager.Device');
            if(typeof dev.DeviceType !== 'number' || dev.DeviceType !== 2) continue; // wifi only
            const iface = typeof dev.Interface === 'string' ? dev.Interface : undefined;
            const wifi = await getAllProps(devPath, 'org.freedesktop.NetworkManager.Device.Wireless');
            const apPaths = Array.isArray(wifi.AccessPoints) ? wifi.AccessPoints : [];
            for(const apPath of apPaths)
            {
                const ap = await getAllProps(apPath, 'org.freedesktop.NetworkManager.AccessPoint');
                const ssidBytes = ap.Ssid instanceof Uint8Array ? Array.from(ap.Ssid) : (Array.isArray(ap.Ssid) ? ap.Ssid.map((n)=> (typeof n === 'number' ? (n & 0xFF) : 0)) : undefined);
                const ssidStr = decodeSsidBytes(ap.Ssid?._v || ap.Ssid || ssidBytes);
                const bssid = typeof ap.HwAddress === 'string' ? ap.HwAddress : undefined;
                const freq = typeof ap.Frequency === 'number' ? ap.Frequency : undefined;
                const rate = typeof ap.MaxBitrate === 'number' ? ap.MaxBitrate : undefined;
                const strength = typeof ap.Strength === 'number' ? ap.Strength : undefined;
                const privacy = !!ap.Privacy;
                const wpaFlags = typeof ap.WpaFlags === 'number' ? ap.WpaFlags : 0;
                const rsnFlags = typeof ap.RsnFlags === 'number' ? ap.RsnFlags : 0;
                let security = 'open';
                if(rsnFlags > 0) security = 'wpa2/3';
                else if(wpaFlags > 0) security = 'wpa';
                else if(privacy) security = 'wep';
                all.push({ device: iface, devicePath: devPath, apPath: apPath, ssid: ssidStr, ssidBytes, bssid, frequency: freq, maxBitrate: rate, strength, security, wpaFlags, rsnFlags });
            }
        }
        return all;
    }
    catch(_){ return []; }
}

async function _findDevicePath({ ifname, typeNum })
{
    await ensureConnected();
    try
    {
        const rootRaw = await DBus.call(
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager',
            'org.freedesktop.DBus.Properties',
            'GetAll',
            's',
            'org.freedesktop.NetworkManager'
        );
        const root = parseObject(rootRaw) || {};
        const devicePaths = Array.isArray(root.Devices) ? root.Devices : [];
        let best = undefined;
        for(const p of devicePaths)
        {
            const dev = await getAllProps(p, 'org.freedesktop.NetworkManager.Device');
            const iface = typeof dev.Interface === 'string' ? dev.Interface : undefined;
            const dType = dev.DeviceType;
            if(ifname && iface === ifname) return p;
            if(!ifname && typeof dType === 'number' && (typeof typeNum === 'number' ? dType === typeNum : true) && !best) best = p;
        }
        return best;
    }
    catch(_){ return undefined; }
}

async function createConnection(options)
{
    await ensureConnected();
    const type = options && typeof options.type === 'string' ? options.type.toLowerCase() : '';
    if(type === 'wifi') return await _createWifiConnectionDbus(options);
    if(type === 'gsm') return await _createGsmConnectionDbus(options);
    throw new Error('createConnection: options.type must be "wifi" or "gsm"');
}

async function _createWifiConnectionDbus(opts)
{
    const ssid = String(opts?.ssid ?? '');
    if(!ssid) throw new Error('createConnection(wifi): ssid is required');
    const password = (opts && typeof opts.password === 'string' && opts.password.length > 0) ? opts.password : undefined;
    const ifname = (opts && typeof opts.ifname === 'string' && opts.ifname.length > 0) ? opts.ifname : undefined;
    const name = (opts && typeof opts.name === 'string' && opts.name.length > 0) ? opts.name : `wifi-${ssid}`;
    const hidden = !!opts?.hidden;
    const autoconnect = opts?.autoconnect === undefined ? true : !!opts.autoconnect;
    const toUtf8Bytes = (s) => { const out = []; for (let i = 0; i < s.length; i++) { const code = s.charCodeAt(i); if (code < 0x80) out.push(code); else if (code < 0x800) { out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F)); } else if (code < 0xD800 || code >= 0xE000) { out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F)); } else { i++; const next = s.charCodeAt(i); const cp = 0x10000 + (((code & 0x3FF) << 10) | (next & 0x3FF)); out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F)); } } return out; };
    const settings = {
        'connection': { 'id': name, 'type': '802-11-wireless', 'autoconnect': autoconnect, ...(ifname ? { 'interface-name': ifname } : {}) },
        '802-11-wireless': { 'ssid': { _t: 'ay', _v: toUtf8Bytes(ssid) }, ...(hidden ? { 'hidden': true } : {}), 'mode': 'infrastructure' },
        ...(password ? { '802-11-wireless-security': { 'key-mgmt': 'wpa-psk', 'psk': password } } : { '802-11-wireless-security': { 'key-mgmt': 'none' } }),
        'ipv4': { 'method': 'auto' },
        'ipv6': { 'method': 'auto' }
    };
    const devicePath = await _findDevicePath({ ifname, typeNum: 2 });
    try
    {
        await DBus.callComplex(
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager',
            'org.freedesktop.NetworkManager',
            'AddAndActivateConnection',
            'a{sa{sv}}oo',
            settings,
            devicePath || '/',
            '/'
        );
        const all = await getAllConnections(false);
        const created = all.find((c) => c?.id === name);
        return { ok: true, uuid: created?.uuid, name, stdout: '', stderr: '' };
    }
    catch(_)
    {
        try
        {
            const connPath = await DBus.callComplex(
                'org.freedesktop.NetworkManager',
                '/org/freedesktop/NetworkManager/Settings',
                'org.freedesktop.NetworkManager.Settings',
                'AddConnection',
                'a{sa{sv}}',
                settings
            );
            const devPath = devicePath || await _findDevicePath({ ifname, typeNum: 2 });
            await DBus.callComplex(
                'org.freedesktop.NetworkManager',
                '/org/freedesktop/NetworkManager',
                'org.freedesktop.NetworkManager',
                'ActivateConnection',
                'ooo',
                connPath,
                devPath || '/',
                '/'
            );
            const all = await getAllConnections(false);
            const created = all.find((c) => c?.id === name);
            return { ok: true, uuid: created?.uuid, name, stdout: '', stderr: '' };
        }
        catch(err2){ return { ok: false, uuid: undefined, name, stdout: '', stderr: String(err2 || '') }; }
    }
}

async function _createGsmConnectionDbus(opts)
{
    const apn = String(opts?.apn ?? '');
    if(!apn) throw new Error('createConnection(gsm): apn is required');
    const ifname = (opts && typeof opts.ifname === 'string' && opts.ifname.length > 0) ? opts.ifname : undefined;
    const name = (opts && typeof opts.name === 'string' && opts.name.length > 0) ? opts.name : `gsm-${apn}`;
    const number = (opts && typeof opts.number === 'string' && opts.number.length > 0) ? opts.number : '*99#';
    const username = (opts && typeof opts.username === 'string' && opts.username.length > 0) ? opts.username : undefined;
    const password = (opts && typeof opts.password === 'string' && opts.password.length > 0) ? opts.password : undefined;
    const pin = (opts && typeof opts.pin === 'string' && opts.pin.length > 0) ? opts.pin : undefined;
    const autoconnect = opts?.autoconnect === undefined ? true : !!opts.autoconnect;
    const settings = {
        'connection': { 'id': name, 'type': 'gsm', 'autoconnect': autoconnect, ...(ifname ? { 'interface-name': ifname } : {}) },
        'gsm': { 'apn': apn, ...(number ? { 'number': number } : {}), ...(username ? { 'username': username } : {}), ...(password ? { 'password': password } : {}), ...(pin ? { 'pin': pin, 'pin-flags': 0 } : {}) },
        'ipv4': { 'method': 'auto' },
        'ipv6': { 'method': 'ignore' }
    };
    const devicePath = await _findDevicePath({ ifname, typeNum: 8 });
    try
    {
        await DBus.callComplex(
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager',
            'org.freedesktop.NetworkManager',
            'AddAndActivateConnection',
            'a{sa{sv}}oo',
            settings,
            devicePath || '/',
            '/'
        );
        const all = await getAllConnections(false);
        const created = all.find((c) => c?.id === name);
        return { ok: true, uuid: created?.uuid, name, stdout: '', stderr: '' };
    }
    catch(_)
    {
        try
        {
            const connPath = await DBus.callComplex(
                'org.freedesktop.NetworkManager',
                '/org/freedesktop/NetworkManager/Settings',
                'org.freedesktop.NetworkManager.Settings',
                'AddConnection',
                'a{sa{sv}}',
                settings
            );
            const devPath = devicePath || await _findDevicePath({ ifname, typeNum: 8 });
            await DBus.callComplex(
                'org.freedesktop.NetworkManager',
                '/org/freedesktop/NetworkManager',
                'org.freedesktop.NetworkManager',
                'ActivateConnection',
                'ooo',
                connPath,
                devPath || '/',
                '/'
            );
            const all = await getAllConnections(false);
            const created = all.find((c) => c?.id === name);
            return { ok: true, uuid: created?.uuid, name, stdout: '', stderr: '' };
        }
        catch(err2){ return { ok: false, uuid: undefined, name, stdout: '', stderr: String(err2 || '') }; }
    }
}

// collect ipv4 addresses using NetworkManager
export async function getIPv4 ()
{
    const overview = await getOverview();
    const items = [];
    for(const dev of overview.devices || [])
    {
        for(const cidr of dev.inet4 || [])
        {
            const [addr, prefixStr] = String(cidr).split('/');
            const prefix = parseInt(prefixStr);
            items.push({ address: addr, netmask: toNetmaskFromPrefix(prefix), mac: dev.mac });
        }
    }
    return items;
}

// activity monitor callback
export async function activityMonitor (callback)
{
    await ensureConnected();
    await DBus.addMatch("type='signal',sender='org.freedesktop.NetworkManager'");
    const handler = (sig) => { try { callback && callback(sig); } catch(_){ } };
    DBus.onSignal(handler);
    return () => { try { DBus.offSignal(handler); } catch(_) {} };
}

// hostname via systemd-hostnamed
export async function getHostName ()
{
    try
    {
        await ensureConnected();
        const raw = await DBus.call(
            'org.freedesktop.hostname1',
            '/org/freedesktop/hostname1',
            'org.freedesktop.DBus.Properties',
            'GetAll',
            's',
            'org.freedesktop.hostname1'
        );
        const obj = parseObject(raw) || {};
        return obj?.Hostname || obj?.StaticHostname || undefined;
    }
    catch(_)
    {
        return undefined;
    }
}

export async function setHostName (hostName)
{
    await ensureConnected();
    // org.freedesktop.hostname1 SetStaticHostname(s name, b interactive)
    await DBus.call(
        'org.freedesktop.hostname1',
        '/org/freedesktop/hostname1',
        'org.freedesktop.hostname1',
        'SetStaticHostname',
        'sb',
        String(hostName),
        false
    );
    return true;
}

// networking
export async function enable ()
{
    await ensureConnected();
    // org.freedesktop.NetworkManager Enable(b)
    await DBus.call(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.NetworkManager',
        'Enable',
        'b',
        true
    );
    return true;
}

export async function disable ()
{
    await ensureConnected();
    await DBus.call(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.NetworkManager',
        'Enable',
        'b',
        false
    );
    return true;
}

export async function getNetworkConnectivityState (reChecking = false)
{
    await ensureConnected();
    const map = { 0: 'unknown', 1: 'none', 2: 'portal', 3: 'limited', 4: 'full' };
    if(reChecking)
    {
        const v = await DBus.call(
            'org.freedesktop.NetworkManager',
            '/org/freedesktop/NetworkManager',
            'org.freedesktop.NetworkManager',
            'CheckConnectivity'
        );
        const n = typeof v === 'number' ? v : parseInt(v);
        return map[n] || 'unknown';
    }
    const root = await getRootProps();
    const n = typeof root.Connectivity === 'number' ? root.Connectivity : parseInt(root.Connectivity);
    return map[n] || 'unknown';
}

// connections (profiles)
export async function connectionUp (profile)
{
    await ensureConnected();
    const all = await getAllConnections(false);
    const name = String(profile);
    const found = all.find((c) => c?.id === name || c?.uuid === name);
    if(!found) throw new Error('connectionUp: profile not found');
    const devPath = await _findDevicePath({ ifname: found?.settings?.connection?.['interface-name'], typeNum: undefined });
    await DBus.callComplex(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.NetworkManager',
        'ActivateConnection',
        'ooo',
        found.path,
        devPath || '/',
        '/'
    );
    return true;
}

export async function connectionDown (profile)
{
    await ensureConnected();
    const actives = await listActiveConnectionPaths();
    const details = await Promise.all(actives.map((p) => getConnectionDetails(p)));
    const name = String(profile);
    const toDeactivate = details.find((d) => d?.id === name || d?.uuid === name);
    if(!toDeactivate) return false;
    await DBus.call(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.NetworkManager',
        'DeactivateConnection',
        'o',
        actives[details.indexOf(toDeactivate)]
    );
    return true;
}

export async function connectionAdd (profile)
{
    await ensureConnected();
    const type = String(profile?.type || '').toLowerCase();
    const ifname = profile?.ifname ? String(profile.ifname) : undefined;
    const name = profile?.name ? String(profile.name) : (type ? `${type}-conn` : 'connection');
    const priority = profile?.priority;
    const apn = profile?.apn ? String(profile.apn) : undefined;

    const settings = { 'connection': { 'id': name, 'autoconnect': true, ...(ifname ? { 'interface-name': ifname } : {}) } };
    if(typeof priority !== 'undefined') settings.connection['autoconnect-priority'] = priority;
    if(type === 'wifi' || type === '802-11-wireless')
    {
        settings.connection.type = '802-11-wireless';
        settings['802-11-wireless'] = { 'mode': 'infrastructure' };
    }
    else if(type === 'ethernet' || type === '802-3-ethernet')
    {
        settings.connection.type = '802-3-ethernet';
        settings['802-3-ethernet'] = {};
    }
    else if(type === 'gsm' || type === 'cellular')
    {
        settings.connection.type = 'gsm';
        settings['gsm'] = { ...(apn ? { 'apn': apn } : {}) };
    }
    settings['ipv4'] = { 'method': 'auto' };
    settings['ipv6'] = { 'method': 'auto' };

    const connPath = await DBus.callComplex(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager/Settings',
        'org.freedesktop.NetworkManager.Settings',
        'AddConnection',
        'a{sa{sv}}',
        settings
    );
    return { path: connPath, id: name, type: settings.connection.type };
}

export async function connectionModify (profile)
{
    await ensureConnected();
    const name = String(profile?.name || '');
    if(!name) throw new Error('connectionModify: name is required');
    const all = await getAllConnections(false);
    const found = all.find((c) => c?.id === name || c?.uuid === name);
    if(!found) throw new Error('connectionModify: profile not found');
    const settings = (found.settings ? JSON.parse(JSON.stringify(found.settings)) : {});
    if(typeof profile.priority !== 'undefined') settings.connection['autoconnect-priority'] = profile.priority;
    if(typeof profile.clonedMAC !== 'undefined')
    {
        settings['802-11-wireless'] = settings['802-11-wireless'] || {};
        settings['802-11-wireless']['cloned-mac-address'] = String(profile.clonedMAC);
    }
    await DBus.callComplex(
        'org.freedesktop.NetworkManager',
        found.path,
        'org.freedesktop.NetworkManager.Settings.Connection',
        'Update',
        'a{sa{sv}}',
        settings
    );
    return true;
}

export async function connectionDelete (profile)
{
    await ensureConnected();
    const name = String(profile?.name || '');
    if(!name) throw new Error('connectionDelete: name is required');
    const all = await getAllConnections(false);
    const found = all.find((c) => c?.id === name || c?.uuid === name);
    if(!found) return false;
    await DBus.call(
        'org.freedesktop.NetworkManager',
        found.path,
        'org.freedesktop.NetworkManager.Settings.Connection',
        'Delete'
    );
    return true;
}

export async function connectionShow (name)
{
    await ensureConnected();
    const all = await getAllConnections(false);
    const found = all.find((c) => c?.id === String(name) || c?.uuid === String(name));
    if(!found) return {};
    return found;
}

export async function getConnectionProfilesList (active = false)
{
    await ensureConnected();
    const all = await getAllConnections(active);
    if(active) return all.filter((c) => c.active);
    return all;
}

// devices
export async function deviceConnect (device)
{
    await ensureConnected();
    const ifname = String(device);
    const devPath = await _findDevicePath({ ifname, typeNum: undefined });
    if(!devPath) throw new Error('deviceConnect: device not found');
    const all = await getAllConnections(false);
    const candidates = all.filter((c) => !c.active && (!c?.settings?.connection?.['interface-name'] || c.settings.connection['interface-name'] === ifname));
    const prioritized = candidates.map((c) => ({ c, prio: (c?.settings?.connection?.['autoconnect-priority'] ?? 0) }))
        .sort((a,b)=> (b.prio - a.prio));
    const chosen = prioritized.length > 0 ? prioritized[0].c : candidates[0];
    if(!chosen) return false;
    await DBus.callComplex(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.NetworkManager',
        'ActivateConnection',
        'ooo',
        chosen.path,
        devPath,
        '/'
    );
    return true;
}

export async function deviceDisconnect (device)
{
    await ensureConnected();
    const ifname = String(device);
    const activePaths = await listActiveConnectionPaths();
    const details = await Promise.all(activePaths.map((p) => getConnectionDetails(p)));
    for(let i=0;i<details.length;i++)
    {
        const d = details[i];
        if(!d || !Array.isArray(d.devices)) continue;
        if(d.devices.some((x)=> x?.interface === ifname))
        {
            await DBus.call(
                'org.freedesktop.NetworkManager',
                '/org/freedesktop/NetworkManager',
                'org.freedesktop.NetworkManager',
                'DeactivateConnection',
                'o',
                activePaths[i]
            );
            return true;
        }
    }
    return false;
}

export async function deviceStatus ()
{
    const { devices } = await getOverview();
    return devices.map((d) => ({ device: d.interface, type: d.type, state: d.status, connection: d.connectedTo || '' }));
}

export async function getDeviceInfoIPDetail (deviceName)
{
    const name = String(deviceName);
    const { devices } = await getOverview();
    const d = devices.find((x)=> x.interface === name);
    if(!d) return undefined;
    const route4Default = (d.route4 || []).find((r)=> r && r.startsWith('default via '));
    const route6Default = (d.route6 || []).find((r)=> r && r.startsWith('default via '));
    const ip4 = Array.isArray(d.inet4) && d.inet4.length > 0 ? d.inet4[0] : undefined;
    const ip6 = Array.isArray(d.inet6) && d.inet6.length > 0 ? d.inet6[0] : undefined;
    return {
        device: d.interface,
        type: d.type,
        state: d.status,
        connection: d.connectedTo,
        mac: d.mac,
        ipV4: ip4 ? ip4.split('/')[0] : undefined,
        netV4: ip4,
        gatewayV4: route4Default ? route4Default.replace(/^default via\s+/, '').split(' ')[0] : undefined,
        ipV6: ip6 ? ip6.split('/')[0] : undefined,
        netV6: ip6,
        gatewayV6: route6Default ? route6Default.replace(/^default via\s+/, '').split(' ')[0] : undefined,
    };
}

export async function getAllDeviceInfoIPDetail ()
{
    const { devices } = await getOverview();
    return devices.map((d) => {
        const route4Default = (d.route4 || []).find((r)=> r && r.startsWith('default via '));
        const route6Default = (d.route6 || []).find((r)=> r && r.startsWith('default via '));
        const ip4 = Array.isArray(d.inet4) && d.inet4.length > 0 ? d.inet4[0] : undefined;
        const ip6 = Array.isArray(d.inet6) && d.inet6.length > 0 ? d.inet6[0] : undefined;
        return {
            device: d.interface,
            type: d.type,
            state: d.status,
            connection: d.connectedTo,
            mac: d.mac,
            ipV4: ip4 ? ip4.split('/')[0] : undefined,
            netV4: ip4,
            gatewayV4: route4Default ? route4Default.replace(/^default via\s+/, '').split(' ')[0] : undefined,
            ipV6: ip6 ? ip6.split('/')[0] : undefined,
            netV6: ip6,
            gatewayV6: route6Default ? route6Default.replace(/^default via\s+/, '').split(' ')[0] : undefined,
        };
    });
}

// wifi
export async function wifiEnable ()
{
    await ensureConnected();
    // Properties.Set("org.freedesktop.NetworkManager", "WirelessEnabled", <variant>)
    await DBus.call(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.DBus.Properties',
        'Set',
        'ssv',
        'org.freedesktop.NetworkManager',
        'WirelessEnabled',
        true
    );
    return true;
}

export async function wifiDisable ()
{
    await ensureConnected();
    await DBus.call(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.DBus.Properties',
        'Set',
        'ssv',
        'org.freedesktop.NetworkManager',
        'WirelessEnabled',
        false
    );
    return true;
}

export async function getWifiStatus ()
{
    await ensureConnected();
    const root = await getRootProps();
    return !!root.WirelessEnabled;
}

export async function wifiHotspot (ifname, ssid, password)
{
    await ensureConnected();
    const devPath = await _findDevicePath({ ifname: String(ifname), typeNum: 2 });
    const toUtf8Bytes = (s) => { const out = []; for (let i=0;i<s.length;i++){ const code = s.charCodeAt(i); if(code<0x80) out.push(code); else if(code<0x800){ out.push(0xC0 | (code>>6), 0x80 | (code & 0x3F)); } else if(code<0xD800 || code>=0xE000){ out.push(0xE0 | (code>>12), 0x80 | ((code>>6) & 0x3F), 0x80 | (code & 0x3F)); } else { i++; const next = s.charCodeAt(i); const cp = 0x10000 + (((code & 0x3FF) << 10) | (next & 0x3FF)); out.push(0xF0 | (cp>>18), 0x80 | ((cp>>12) & 0x3F), 0x80 | ((cp>>6) & 0x3F), 0x80 | (cp & 0x3F)); } } return out; };
    const settings = {
        'connection': { 'id': `hotspot-${ssid}`, 'type': '802-11-wireless', 'autoconnect': false, ...(ifname ? { 'interface-name': String(ifname) } : {}) },
        '802-11-wireless': { 'mode': 'ap', 'ssid': { _t: 'ay', _v: toUtf8Bytes(String(ssid)) } },
        '802-11-wireless-security': { 'key-mgmt': 'wpa-psk', 'psk': String(password) },
        'ipv4': { 'method': 'shared' },
        'ipv6': { 'method': 'ignore' }
    };
    const activePath = await DBus.callComplex(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.NetworkManager',
        'AddAndActivateConnection',
        'a{sa{sv}}oo',
        settings,
        devPath || '/',
        '/'
    );
    return { ok: true, activePath };
}

export async function wifiCredentials (ifname)
{
    if(!ifname) throw new Error('ifname required');
    await ensureConnected();
    const activePaths = await listActiveConnectionPaths();
    const details = await Promise.all(activePaths.map((p) => getConnectionDetails(p)));
    const entry = details.find((d) => d?.devices?.some((x)=> x?.interface === String(ifname)));
    if(!entry) return {};
    const settings = entry.settings || {};
    const sec = settings['802-11-wireless-security'] || {};
    const wifi = settings['802-11-wireless'] || {};
    const ssid = decodeSsidBytes(wifi.ssid?._v || wifi.ssid);
    return { SSID: ssid, PSK: sec.psk };
}

export async function getWifiList (reScan = false)
{
    await ensureConnected();
    if(reScan)
    {
        try
        {
            const root = await getRootProps();
            const devPaths = Array.isArray(root.Devices) ? root.Devices : [];
            for(const p of devPaths)
            {
                const dev = await getAllProps(p, 'org.freedesktop.NetworkManager.Device');
                if(typeof dev.DeviceType === 'number' && dev.DeviceType === 2)
                {
                    try
                    {
                        await DBus.call(
                            'org.freedesktop.NetworkManager',
                            p,
                            'org.freedesktop.NetworkManager.Device.Wireless',
                            'RequestScan',
                            'a{sv}',
                            {}
                        );
                    }
                    catch(_){ }
                }
            }
        }
        catch(_){ }
    }
    const aps = await listVisibleAccessPoints();
    return aps.map((a) => ({
        SSID: a.ssid,
        BSSID: a.bssid,
        FREQUENCY: a.frequency,
        RATE: a.maxBitrate,
        SIGNAL: a.strength,
        SECURITY: a.security,
        IN_USE: '',
        'IN-USE': a.inUse ? '*' : '',
        inUseBoolean: !!a.inUse,
        device: a.device,
    }));
}

export async function wifiConnect (ssid, password)
{
    const result = await createConnection({ type: 'wifi', ssid: String(ssid), password: password ? String(password) : undefined });
    return result;
}

// 4G / WWAN
export async function wwanEnable ()
{
    await ensureConnected();
    await DBus.call(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.DBus.Properties',
        'Set',
        'ssv',
        'org.freedesktop.NetworkManager',
        'WwanEnabled',
        true
    );
    return true;
}

export async function wwanDisable ()
{
    await ensureConnected();
    await DBus.call(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager',
        'org.freedesktop.DBus.Properties',
        'Set',
        'ssv',
        'org.freedesktop.NetworkManager',
        'WwanEnabled',
        false
    );
    return true;
}

export async function getWwanStatus ()
{
    await ensureConnected();
    const root = await getRootProps();
    return !!root.WwanEnabled;
}

export async function getModem (index)
{
    await ensureConnected();
    // Use ModemManager1 ObjectManager to enumerate modems
    const objectsRaw = await DBus.call(
        'org.freedesktop.ModemManager1',
        '/org/freedesktop/ModemManager1',
        'org.freedesktop.DBus.ObjectManager',
        'GetManagedObjects'
    );
    const objects = parseObject(objectsRaw) || {};
    const modemPaths = Object.keys(objects).filter((p) => {
        const ifaces = objects[p];
        return ifaces && typeof ifaces === 'object' && ('org.freedesktop.ModemManager1.Modem' in ifaces);
    });
    const idx = Math.max(0, parseInt(index) || 0);
    const path = modemPaths[idx];
    if(!path) return {};
    const modem = objects[path]['org.freedesktop.ModemManager1.Modem'] || {};
    const sim = objects[path]['org.freedesktop.ModemManager1.Sim'] || {};
    return {
        path,
        modem,
        sim,
    };
}

const exported = {
    getIPv4,
    activityMonitor,
    // hostname
    getHostName,
    setHostName,
    // network
    enable,
    disable,
    getNetworkConnectivityState,
    // connection (profile)
    connectionUp,
    connectionDown,
    connectionAdd,
    connectionDelete,
    connectionModify,
    connectionShow,
    getConnectionProfilesList,
    // device
    deviceStatus,
    deviceConnect,
    deviceDisconnect,
    getDeviceInfoIPDetail,
    getAllDeviceInfoIPDetail,
    // wifi
    wifiEnable,
    wifiDisable,
    getWifiStatus,
    wifiHotspot,
    wifiCredentials,
    getWifiList,
    wifiConnect,
    // 4G
    wwanEnable,
    wwanDisable,
    getWwanStatus,
    getModem,
};

export default exported;
