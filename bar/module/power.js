import * as UI  from 'Koya/UserInterface';
import * as Log from 'Koya/Log';
import * as DBus from 'Module/dbus';

export class Power
{
    constructor (win, config)
    {
        this.win = win;
        this.config = config;

        this.iconSet = {
            'power-saver': '\udb80\udf2a',
            'balanced':    '\udb81\udf54',
            'performance': '\udb80\ude38'
        };

        // Pre-create icon elements to obtain stable handles
        this.iconElements = {
            'power-saver': this.createProfileIcon('power-saver'),
            'balanced':    this.createProfileIcon('balanced'),
            'performance': this.createProfileIcon('performance'),
        };

        this.element = UI.createElement(this.win, {
            layout: {
                type:'row',
                wrap: false,
                justifyContent: 'center',
                alignItems: 'center',
                gap: 5
            },
            item: {
                size: { y: 12 },
                order: this.config?.power?.order
            },
            child: [
                this.iconElements['power-saver'],
                this.iconElements['balanced'],
                this.iconElements['performance'],
            ]
        });
    }

    createProfileIcon (profile)
    {
        const id = `pp:${profile}`;
        return UI.createElement(this.win, {
            id,
            renderable: {
                type: 'text',
                colour: this.config.disabledColour,
                font: this.config.iconFont,
                string: this.iconSet[profile] || '?',
                size: 14,
            },
            contentAlign: { x: 'center', y: 'center' },
            onMouseClick: () => { this.activateProfile(profile); }
        });
    }

    async ensureConnected ()
    {
        if(this.connected) return;
        if(this.connecting) { await this.connecting; return; }
        this.connecting = (async () => { await DBus.connect('system'); this.connected = true; })();
        try { await this.connecting; } finally { this.connecting = null; }
    }

    async refresh ()
    {
        try
        {
            await this.ensureConnected();
            const raw = await DBus.call(
                'net.hadess.PowerProfiles',
                '/net/hadess/PowerProfiles',
                'org.freedesktop.DBus.Properties',
                'GetAll',
                's',
                'net.hadess.PowerProfiles'
            );
            const props = (typeof raw === 'string' ? (()=>{try{return JSON.parse(raw);}catch(_){return {};}})() : (raw || {}));
            const active = typeof props.ActiveProfile === 'string' ? props.ActiveProfile : undefined;

            // Service available; ensure visible
            this.hasPowerProfiles = true;
            UI.setEnabled(this.win, this.element, true);

            // Update colours: active = this.config.colour; inactive = this.config.disabledColour
            for (const p of ['power-saver','balanced','performance'])
            {
                let el = this.iconElements?.[p];
                if(!el) el = UI.getElementById(this.win, `pp:${p}`);
                if(!el) { Log.warn(`[PPD] icon not found: ${p}`); continue; }
                const colour = (p === active) ? this.config.colour : this.config.disabledColour;
                UI.setTextColour(this.win, el, colour);
            }
        }
        catch(e)
        {
            // Service not available; hide element and mark unavailable
            this.hasPowerProfiles = false;
            UI.setEnabled(this.win, this.element, false);
        }
    }

    async activateProfile (profile)
    {
        try
        {
            if(!this.hasPowerProfiles) return;
            await this.ensureConnected();
            await DBus.callComplex(
                'net.hadess.PowerProfiles',
                '/net/hadess/PowerProfiles',
                'org.freedesktop.DBus.Properties',
                'Set',
                'ssv',
                'net.hadess.PowerProfiles',
                'ActiveProfile',
                { _t: 's', _v: profile }
            );
            // UI will refresh upon PropertiesChanged signal
        }
        catch(e)
        {
            Log.error(`Failed to set profile: ${e?.message || e}`);
        }
    }

    async init ()
    {
        await this.refresh();
        if(!this.hasPowerProfiles) return;
        try
        {
            await this.ensureConnected();
            // Broad PropertiesChanged subscription; filter in handler
            await DBus.addMatch("type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged'");
            // Also subscribe to any signals from the service for visibility while debugging
            await DBus.addMatch("type='signal',sender='net.hadess.PowerProfiles'");
            this.signalHandler = (sig) => {
                try {
                    if(!sig) return;
                    const isProps = sig.member === 'PropertiesChanged' && sig.interface === 'org.freedesktop.DBus.Properties';
                    const onPath = (sig.path === '/net/hadess/PowerProfiles');
                    if(isProps && (onPath || (sig.body === 'net.hadess.PowerProfiles')))
                    {
                        this.refresh();
                    }
                } catch(_) { }
            };
            DBus.onSignal(this.signalHandler);
        }
        catch(_){ }
    }
}


