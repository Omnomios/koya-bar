import * as UI  from 'Koya/UserInterface';
import * as Log from 'Koya/Log';
import * as DBus from 'Module/dbus';

export class Battery
{
    constructor (win, config)
    {
        this.win = win;
        this.config = config;

        this.element = UI.createElement(this.win, {
            layout: {
                type:'row',
                wrap: false,
                justifyContent: 'center',
                alignItems: 'center',
                gap: 5
            },
            item: {
                size: { h: 12 },
                order: this.config.battery.order
            },
            child: [
                {
                    id: 'batteryText',
                    renderable: {
                        type: 'text',
                        colour: this.config.colour,
                        font: this.config.font,
                        string: '76%',
                        size: 9,
                    },
                    contentAlign: { x: 'end', y: 'center' }
                },
                {
                    id: 'batteryIcon',
                    renderable: {
                        type: 'text',
                        colour: this.config.colour,
                        font: this.config.iconFont,
                        string: '\udb80\udc83',
                        size: 14,
                    },
                    contentAlign: { x: 'start', y: 'center' }
                }
            ]
        });
        this.batteryText = UI.getElementById(this.win, 'batteryText');
        this.batteryIcon = UI.getElementById(this.win, 'batteryIcon');

        this.batteryStatus = UI.createElement(this.win, {
            renderable: {
                type: 'text',
                colour: "#0f0",
                font: this.config.iconFont,
                string: '\udb85\udc0b',
                size: 12,
                position: {x: 3, y:3}
            },
        });
        UI.attach(this.win, this.batteryIcon, this.batteryStatus);

    }

    async init ()
    {
        this.iconSet = {
            'statusCharge':'\udb85\udc0b',
            'battery100':'\udb80\udc79',
            'battery10':'\udb80\udc7a',
            'battery20':'\udb80\udc7b',
            'battery30':'\udb80\udc7c',
            'battery40':'\udb80\udc7d',
            'battery50':'\udb80\udc7e',
            'battery60':'\udb80\udc7f',
            'battery70':'\udb80\udc80',
            'battery80':'\udb80\udc81',
            'battery90':'\udb80\udc82',
        };

        // Set up DBus listeners for UPower battery events
        const parseObject = (value) =>
        {
            if(value && typeof value === 'object') return value;
            if(typeof value === 'string') { try { return JSON.parse(value); } catch(_) { return undefined; } }
            return undefined;
        };

        const getDisplayDevicePath = async () =>
        {
            try
            {
                const p = await DBus.call(
                    'org.freedesktop.UPower',
                    '/org/freedesktop/UPower',
                    'org.freedesktop.UPower',
                    'GetDisplayDevice'
                );
                return (typeof p === 'string' && p.length > 0) ? p : '/org/freedesktop/UPower/devices/DisplayDevice';
            }
            catch(_)
            {
                return '/org/freedesktop/UPower/devices/DisplayDevice';
            }
        };

        await DBus.connect('system');
        this._upowerDevicePath = await getDisplayDevicePath();

        const refresh = async () =>
        {
            try
            {
                const raw = await DBus.call(
                    'org.freedesktop.UPower',
                    this._upowerDevicePath,
                    'org.freedesktop.DBus.Properties',
                    'GetAll',
                    's',
                    'org.freedesktop.UPower.Device'
                );
                const props = parseObject(raw) || {};

                // Determine if a battery is present; hide if not
                const typeVal = (typeof props.Kind !== 'undefined') ? props.Kind : props.Type;
                const isBatteryKind = (typeVal === 2) || (typeVal === 'battery');
                const isPresent = (props.IsPresent === true) || (props.IsPresent === 1) || (props.IsPresent === 'true');
                const hasBattery = !!isPresent && (isBatteryKind || (typeof props.Percentage !== 'undefined') || (props.PowerSupply === true));
                this._hasBattery = hasBattery;
                if(!hasBattery)
                {
                    UI.setEnabled(this.win, this.element, false);
                    return;
                }
                UI.setEnabled(this.win, this.element, true);

                // Battery percentage
                let pct = props?.Percentage;
                if(typeof pct !== 'number') pct = parseFloat(pct);
                if(!Number.isFinite(pct)) pct = 0;
                const percent = Math.max(0, Math.min(100, Math.round(pct)));
                UI.setTextString(this.win, this.batteryText, `${percent}%`);
                const bucket = (percent === 100) ? 100 : Math.max(10, Math.floor(percent / 10) * 10);
                const key = `battery${bucket}`;
                UI.setTextString(this.win, this.batteryIcon, this.iconSet[key] || this.iconSet['battery100']);
                
                // charging status overlay
                let stateVal = props?.State;
                if(typeof stateVal !== 'number') stateVal = parseInt(stateVal);
                const isCharging = stateVal === 1 || stateVal === 5; // Charging or PendingCharge
                UI.setTextString(this.win, this.batteryStatus, isCharging ? this.iconSet['statusCharge'] : '');
            }
            catch(_)
            {
                // Ignore errors; keep existing UI
            }
        };

        await refresh();

        if(this._hasBattery)
        {
            await DBus.addMatch("type='signal',sender='org.freedesktop.UPower'");
            this._dbusBatteryHandler = (sig) =>
            {
                try
                {
                    if(sig && sig.path && (sig.path === this._upowerDevicePath || sig.path.startsWith('/org/freedesktop/UPower/devices/')))
                    {
                        refresh();
                    }
                }
                catch(_){ }
            };
            DBus.onSignal(this._dbusBatteryHandler);
        }
    }
}