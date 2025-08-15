import * as DBus from 'Module/dbus';
import * as Log from 'Koya/Log';

export class NetworkManager
{
    constructor ()
    {
        this._connected = false;
        this._connecting = null;
        this._listeners = new Map(); // event -> Set<fn>
        this._signalHooked = false;
        this._signalHandler = (sig) => this._handleSignal(sig);
    }

    async connect (bus = 'system')
    {
        if(this._connected) return;
        if(this._connecting) return this._connecting;
        this._connecting = (async () => {
            await DBus.connect(bus);
            await DBus.addMatch("type='signal',sender='org.freedesktop.NetworkManager'");
            if(!this._signalHooked)
            {
                DBus.onSignal(this._signalHandler);
                this._signalHooked = true;
            }
            this._connected = true;
        })();
        try {await this._connecting;} finally {this._connecting = null;}
    }

    // Returns the unique bus name that currently owns the NM well-known name
    async getNameOwner ()
    {
        await this.connect();
        return await DBus.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'GetNameOwner',
            's',
            'org.freedesktop.NetworkManager'
        );
    }

    async isRunning ()
    {
        try
        {
            const owner = await this.getNameOwner();
            return typeof owner === 'string' && owner.length > 0;
        }
        catch(_)
        {
            return false;
        }
    }

    // org.freedesktop.NetworkManager Version property via Properties.Get
    async getVersion ()
    {
        try
        {
            await this.connect();
            const json = await DBus.call(
                'org.freedesktop.NetworkManager',
                '/org/freedesktop/NetworkManager',
                'org.freedesktop.DBus.Properties',
                'GetAll',
                's',
                'org.freedesktop.NetworkManager'
            );
            const obj = JSON.parse(String(json || '{}'));
            return obj && typeof obj.Version !== 'undefined' ? obj.Version : undefined;
        }
        catch(_)
        {
            return undefined;
        }
    }

    on (event, callback)
    {
        if(!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(callback);
    }

    off (event, callback)
    {
        if(!this._listeners.has(event)) return;
        if(callback)
        {
            this._listeners.get(event).delete(callback);
            if(this._listeners.get(event).size === 0) this._listeners.delete(event);
        }
        else
        {
            this._listeners.delete(event);
        }
    }

    _emit (event, payload)
    {
        const set = this._listeners.get(event);
        if(!set) return;
        for(const cb of set)
        {
            try {cb(payload);} catch (e) { /* ignore */}
        }
    }

    dispose ()
    {
        if(this._signalHooked)
        {
            try {DBus.offSignal(this._signalHandler);} catch (_) {}
            this._signalHooked = false;
        }
        this._connecting = null;
        this._listeners.clear();
    }

    _handleSignal(sig)
    {
        // sig: { sender, path, interface, member, signature, body }
        if(sig.interface === 'org.freedesktop.NetworkManager')
        {
            this._emit(sig.member || 'signal', sig);
        }
    }

    async getActiveConnections()
    {
        try
        {
            await this.connect();
            const result = await DBus.call(
                'org.freedesktop.NetworkManager',
                '/org/freedesktop/NetworkManager',
                'org.freedesktop.DBus.Properties',
                'GetAll',
                's',
                'org.freedesktop.NetworkManager'
            );
            let obj = null;
            if(typeof result === 'string')
            {
                try { obj = JSON.parse(result); } catch(_) { return []; }
            }
            else if(result && typeof result === 'object')
            {
                obj = result;
            }
            else
            {
                return [];
            }
            const active = obj && Array.isArray(obj.ActiveConnections) ? obj.ActiveConnections : [];
            return active.filter((p) => typeof p === 'string' && p.length > 0);
        }
        catch(_)
        {
            return [];
        }
    }

    async getConnectionDetails(identifier)
    {
        try
        {
            await this.connect();
            if(typeof identifier !== 'string' || identifier.length === 0) return {};

            const parseObject = (value) =>
            {
                if(value && typeof value === 'object') return value;
                if(typeof value === 'string')
                {
                    try { return JSON.parse(value); } catch(_) { return undefined; }
                }
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

            const active = await getAllProps(identifier, 'org.freedesktop.NetworkManager.Connection.Active');
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
                    settings = parseObject(rawSettings) || {};
                }
                catch(_)
                {
                    settings = {};
                }
            }

            const devicePaths = Array.isArray(active.Devices) ? active.Devices : [];
            const devices = await Promise.all(devicePaths.map(async (devicePath) =>
            {
                const dev = await getAllProps(devicePath, 'org.freedesktop.NetworkManager.Device');
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
                ip4Path ? getAllProps(ip4Path, 'org.freedesktop.NetworkManager.IP4Config') : Promise.resolve({}),
                ip6Path ? getAllProps(ip6Path, 'org.freedesktop.NetworkManager.IP6Config') : Promise.resolve({}),
                dhcp4Path ? getAllProps(dhcp4Path, 'org.freedesktop.NetworkManager.DHCP4Config') : Promise.resolve({}),
                dhcp6Path ? getAllProps(dhcp6Path, 'org.freedesktop.NetworkManager.DHCP6Config') : Promise.resolve({}),
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
                dhcp4: {
                    options: dhcp4 && typeof dhcp4.Options === 'object' ? dhcp4.Options : undefined,
                },
                dhcp6: {
                    options: dhcp6 && typeof dhcp6.Options === 'object' ? dhcp6.Options : undefined,
                },
                settings,
            };
        }
        catch(_)
        {
            return {};
        }
    }

    async getAllConnections(includeActiveDetails = false)
    {
        try
        {
            await this.connect();

            const parseObject = (value) =>
            {
                if(value && typeof value === 'object') return value;
                if(typeof value === 'string')
                {
                    try { return JSON.parse(value); } catch(_) { return undefined; }
                }
                return undefined;
            };

            const listRaw = await DBus.call(
                'org.freedesktop.NetworkManager',
                '/org/freedesktop/NetworkManager/Settings',
                'org.freedesktop.NetworkManager.Settings',
                'ListConnections'
            );
            const listParsed = parseObject(listRaw);
            const connectionPaths = Array.isArray(listRaw) ? listRaw : (Array.isArray(listParsed) ? listParsed : []);
            if(!Array.isArray(connectionPaths) || connectionPaths.length === 0) return [];

            // Build map from saved connection path -> array of active connection paths
            const activeMap = new Map();
            try
            {
                const activePaths = await this.getActiveConnections();
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
                    catch(_)
                    {
                        return null;
                    }
                }));
                for(const pair of pairs)
                {
                    if(!pair) continue;
                    const [connPath, acPath] = pair;
                    if(!activeMap.has(connPath)) activeMap.set(connPath, []);
                    activeMap.get(connPath).push(acPath);
                }
            }
            catch(_)
            {
                // ignore
            }

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
                        activeDetails = await Promise.all(activePaths.map((p) => this.getConnectionDetails(p)));
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
        catch(_)
        {
            return [];
        }
    }

    async listActiveConnectionPaths()
    {
        try { return await this.getActiveConnections(); } catch(_) { return []; }
    }

    async listSavedConnectionPaths()
    {
        try
        {
            await this.connect();
            const parseObject = (value) =>
            {
                if(value && typeof value === 'object') return value;
                if(typeof value === 'string') { try { return JSON.parse(value); } catch(_) { return undefined; } }
                return undefined;
            };
            const raw = await DBus.call(
                'org.freedesktop.NetworkManager',
                '/org/freedesktop/NetworkManager/Settings',
                'org.freedesktop.NetworkManager.Settings',
                'ListConnections'
            );
            const parsed = parseObject(raw);
            return Array.isArray(raw) ? raw : (Array.isArray(parsed) ? parsed : []);
        }
        catch(_)
        {
            return [];
        }
    }

    async getSavedConnectionDetails(connectionPath)
    {
        try
        {
            await this.connect();
            if(typeof connectionPath !== 'string' || connectionPath.length === 0) return {};
            const parseObject = (value) =>
            {
                if(value && typeof value === 'object') return value;
                if(typeof value === 'string') { try { return JSON.parse(value); } catch(_) { return undefined; } }
                return undefined;
            };
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
        catch(_)
        {
            return {};
        }
    }

    async getOverview()
    {
        try
        {
            await this.connect();

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

            const devTypeName = (num) =>
            {
                const map = {
                    0: 'unknown',
                    1: 'ethernet',
                    2: 'wifi',
                    5: 'bt',
                    6: 'olpc-mesh',
                    7: 'wimax',
                    8: 'modem',
                    9: 'infiniband',
                    10: 'bond',
                    11: 'vlan',
                    12: 'adsl',
                    13: 'bridge',
                    14: 'team',
                    15: 'tun',
                    16: 'ip-tunnel',
                    17: 'macvlan',
                    18: 'vxlan',
                    19: 'veth',
                    20: 'macsec',
                    21: 'dummy',
                    22: 'ppp',
                    23: 'wifi-p2p',
                    24: 'vrf',
                    25: 'loopback',
                };
                return typeof num === 'number' && num in map ? map[num] : undefined;
            };

            const stateName = (num) =>
            {
                const map = {
                    10: 'unmanaged',
                    20: 'unavailable',
                    30: 'disconnected',
                    40: 'prepare',
                    50: 'config',
                    60: 'need-auth',
                    70: 'ip-config',
                    80: 'ip-check',
                    90: 'secondaries',
                    100: 'connected',
                    110: 'deactivating',
                    120: 'failed'
                };
                return typeof num === 'number' && num in map ? map[num] : undefined;
            };

            // Root props for device listing
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

            // Active connections indexed by device path
            const activePaths = await this.getActiveConnections();
            const activeDetails = await Promise.all(activePaths.map((p) => this.getConnectionDetails(p)));
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
                const typeStr = devTypeName(dev.DeviceType) || 'unknown';
                const driver = typeof dev.Driver === 'string' ? dev.Driver : undefined;
                const mac = typeof dev.HwAddress === 'string' ? dev.HwAddress : undefined;
                const mtu = typeof dev.Mtu !== 'undefined' ? dev.Mtu : undefined;
                const stateStr = stateName(dev.State) || 'unknown';
                const hwOrSw = (typeStr === 'loopback' || typeStr === 'wifi-p2p' || typeStr === 'tun' || typeStr === 'ip-tunnel' || typeStr === 'bridge' || typeStr === 'bond' || typeStr === 'team' || typeStr === 'vlan' || typeStr === 'dummy') ? 'sw' : 'hw';

                const ac = deviceToActive.get(devPath);
                const connectedTo = ac?.id;
                const ip4Default = !!ac?.default;

                const inet4 = Array.isArray(ac?.ip4?.addressData) ? ac.ip4.addressData
                    .map((a) =>
                    {
                        const addr = a?.address ?? a?.Address ?? undefined;
                        const prefix = a?.prefix ?? a?.Prefix ?? undefined;
                        return (typeof addr === 'string' && typeof prefix !== 'undefined') ? `${addr}/${prefix}` : undefined;
                    })
                    .filter(Boolean) : [];

                const route4 = Array.isArray(ac?.ip4?.routes) ? ac.ip4.routes
                    .map((r) =>
                    {
                        const dest = r?.dest ?? r?.Dest ?? undefined;
                        const prefix = r?.prefix ?? r?.Prefix ?? undefined;
                        const gw = r?.gateway ?? r?.Gateway ?? r?.nextHop ?? r?.NextHop ?? undefined;
                        const metric = r?.metric ?? r?.Metric ?? undefined;
                        if((dest === '0.0.0.0' || prefix === 0) && gw)
                        {
                            return metric !== undefined ? `default via ${gw} metric ${metric}` : `default via ${gw}`;
                        }
                        if(typeof dest === 'string' && typeof prefix !== 'undefined')
                        {
                            return metric !== undefined ? `${dest}/${prefix} metric ${metric}` : `${dest}/${prefix}`;
                        }
                        return undefined;
                    })
                    .filter(Boolean) : [];

                const inet6 = Array.isArray(ac?.ip6?.addressData) ? ac.ip6.addressData
                    .map((a) =>
                    {
                        const addr = a?.address ?? a?.Address ?? undefined;
                        const prefix = a?.prefix ?? a?.Prefix ?? undefined;
                        return (typeof addr === 'string' && typeof prefix !== 'undefined') ? `${addr}/${prefix}` : undefined;
                    })
                    .filter(Boolean) : [];

                const route6 = Array.isArray(ac?.ip6?.routes) ? ac.ip6.routes
                    .map((r) =>
                    {
                        const dest = r?.dest ?? r?.Dest ?? undefined;
                        const prefix = r?.prefix ?? r?.Prefix ?? undefined;
                        const gw = r?.gateway ?? r?.Gateway ?? r?.nextHop ?? r?.NextHop ?? undefined;
                        const metric = r?.metric ?? r?.Metric ?? undefined;
                        if((dest === '::' || prefix === 0) && gw)
                        {
                            return metric !== undefined ? `default via ${gw} metric ${metric}` : `default via ${gw}`;
                        }
                        if(typeof dest === 'string' && typeof prefix !== 'undefined')
                        {
                            return metric !== undefined ? `${dest}/${prefix} metric ${metric}` : `${dest}/${prefix}`;
                        }
                        return undefined;
                    })
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

            // DNS summary: prefer default IPv4 nameservers of the default active connection
            let dnsServers = [];
            let dnsInterface = undefined;
            const defaultAc = activeDetails.find((ac) => ac?.default);
            if(defaultAc)
            {
                const servers4 = Array.isArray(defaultAc?.ip4?.nameservers) ? defaultAc.ip4.nameservers : [];
                const servers6 = Array.isArray(defaultAc?.ip6?.nameservers) ? defaultAc.ip6.nameservers : [];
                dnsServers = (servers4.length > 0 ? servers4 : servers6).filter((s) => typeof s === 'string');
                const devPath = (defaultAc.devices && defaultAc.devices[0] && defaultAc.devices[0].path) ? defaultAc.devices[0].path : undefined;
                if(devPath)
                {
                    const dev = await getAllProps(devPath, 'org.freedesktop.NetworkManager.Device');
                    dnsInterface = typeof dev.Interface === 'string' ? dev.Interface : undefined;
                }
            }

            return {
                devices: deviceSummaries,
                dns: {
                    servers: dnsServers,
                    interface: dnsInterface,
                }
            };
        }
        catch(_)
        {
            return { devices: [], dns: { servers: [], interface: undefined } };
        }
    }

    async listVisibleAccessPoints()
    {
        try
        {
            await this.connect();

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

            const decodeSsid = (ssid) =>
            {
                // Normalize to bytes if possible
                let bytes = null;
                if(ssid instanceof Uint8Array)
                {
                    bytes = ssid;
                }
                else if(Array.isArray(ssid))
                {
                    // In case plugin returns 32-bit numbers, clamp to 0..255
                    const arr = ssid.map((n) => (typeof n === 'number' ? (n & 0xFF) : 0));
                    bytes = Uint8Array.from(arr);
                }
                else if(typeof ssid === 'string')
                {
                    // Hex string "0x..."
                    if(/^0x([0-9a-fA-F]{2})+$/.test(ssid))
                    {
                        const hex = ssid.slice(2);
                        const out = new Uint8Array(hex.length / 2);
                        for(let i=0;i<hex.length;i+=2) out[i/2] = parseInt(hex.slice(i, i+2), 16);
                        bytes = out;
                    }
                    else
                    {
                        // Base64 fallback
                        const base64Like = /^[A-Za-z0-9+/]+={0,2}$/.test(ssid) && (ssid.length % 4 === 0);
                        if(base64Like && typeof Buffer !== 'undefined')
                        {
                            try { bytes = Uint8Array.from(Buffer.from(ssid, 'base64')); } catch(_) { /* ignore */ }
                        }
                        // Already human string
                        if(!bytes) return ssid;
                    }
                }
                else
                {
                    return undefined;
                }

                // Trim trailing NULs
                let end = bytes.length;
                while(end > 0 && bytes[end - 1] === 0) end--;
                const trimmed = bytes.subarray(0, end);

                // Try UTF-8 first (non-fatal)
                try
                {
                    if(typeof TextDecoder !== 'undefined')
                    {
                        return new TextDecoder('utf-8').decode(trimmed);
                    }
                }
                catch(_){ }

                // Fallback to latin1
                try
                {
                    if(typeof TextDecoder !== 'undefined')
                    {
                        return new TextDecoder('latin1').decode(trimmed);
                    }
                }
                catch(_){ }

                // Last resort: hex representation
                return '0x' + Array.from(trimmed).map((b) => b.toString(16).padStart(2, '0')).join('');
            };

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
                    const ssidStr = decodeSsid(ap.Ssid);
                    let ssidBytes = undefined;
                    if(ap.Ssid instanceof Uint8Array) ssidBytes = Array.from(ap.Ssid);
                    else if(Array.isArray(ap.Ssid)) ssidBytes = ap.Ssid.map((n)=> (typeof n === 'number' ? (n & 0xFF) : 0));
                    else if(typeof ap.Ssid === 'string' && /^0x([0-9a-fA-F]{2})+$/.test(ap.Ssid))
                    {
                        const hex = ap.Ssid.slice(2);
                        const out = new Array(hex.length / 2);
                        for(let i=0;i<hex.length;i+=2) out[i/2] = parseInt(hex.slice(i, i+2), 16);
                        ssidBytes = out;
                    }
                    const bssid = typeof ap.HwAddress === 'string' ? ap.HwAddress : undefined;
                    const freq = typeof ap.Frequency === 'number' ? ap.Frequency : undefined;
                    const rate = typeof ap.MaxBitrate === 'number' ? ap.MaxBitrate : undefined;
                    const strength = typeof ap.Strength === 'number' ? ap.Strength : undefined;
                    const lastSeen = typeof ap.LastSeen === 'number' ? ap.LastSeen : undefined;
                    const privacy = !!ap.Privacy;
                    const wpaFlags = typeof ap.WpaFlags === 'number' ? ap.WpaFlags : 0;
                    const rsnFlags = typeof ap.RsnFlags === 'number' ? ap.RsnFlags : 0;

                    let security = 'open';
                    if(rsnFlags > 0) security = 'wpa2/3';
                    else if(wpaFlags > 0) security = 'wpa';
                    else if(privacy) security = 'wep';

                    all.push({
                        device: iface,
                        devicePath: devPath,
                        apPath: apPath,
                        ssid: ssidStr,
                        ssidBytes: ssidBytes,
                        bssid: bssid,
                        frequency: freq,
                        maxBitrate: rate,
                        strength: strength,
                        lastSeen: lastSeen,
                        security: security,
                        wpaFlags: wpaFlags,
                        rsnFlags: rsnFlags,
                    });
                }
            }

            return all;
        }
        catch(_)
        {
            return [];
        }
    }
}