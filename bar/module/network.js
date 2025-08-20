import * as UI from 'Koya/UserInterface';
import * as Log from 'Koya/Log';

import * as NetworkManager from '../../lib/NetworkManager.js';

export class Network
{
    constructor (win, config)
    {
        this.win = win;
        this.config = config;

        this.element = UI.createElement(this.win, {
            layout: {
                type:'row',
                wrap: true,
                justifyContent: 'center',
                alignItems: 'end',
                gap:4
            },
            item: { size:{w: this.config.thickness, h: 20} },
        });
    }

    async init ()
    {
		this.connections = [];
		const modem = [
			await NetworkManager.getModem(0).catch((e)=>{return false;}),
			await NetworkManager.getModem(1).catch((e)=>{return false;})
		];

        NetworkManager.activityMonitor((event) => {

            if(event.interface == 'org.freedesktop.NetworkManager.Device')
            {
                const connection = this.connections.find(i=>i.status.devPath == event.path)
                if(!connection) return;
                connection.update();
                return;
            }

            Log.debug(event.interface);
            //Log.debug(JSON.stringify(event, null, 2));
		});

        const connectionIcon = {
            'ethernet':'\udb80\ude00',
            'wifi':'\uf1eb'
        };

        const stateColour = {
            'connected': this.config.colour,
            'disconnected':'#444',
            'unavailable':'#444'
        };

		try
		{
			const allConnections = await NetworkManager.getAllDeviceInfoIPDetail(false);

            const relevantConnections = allConnections.filter(i=>['ethernet','wifi'].includes(i.type));

            Log.debug(JSON.stringify(relevantConnections, null, 2));
			for(const connection of relevantConnections)
			{
                this.connections.push({
                    status: connection,
                    win: this.win,
                    parent: this.element,
                    crossIcon: -1,
                    element: UI.createElement(this.win, {
                        renderable: {
                            type: 'text',
                            colour: this.config.colour,
                            font: this.config.iconFont,
                            string: '?',
                            size: 16,
                        },
                        item:{size:{w:18,h:18}},
                        contentAlign: { x: 'center', y: 'center' },
                        child:[
                            {
                                id: `${connection.device}:cross`,
                                renderable: {
                                    type: 'text',
                                    colour: this.config.alertColour,
                                    font: this.config.iconFont,
                                    string: '\uf00d',
                                    size: 15,
                                    position: {x:8, y:8}
                                }
                            }
                        ]
                    }),
                    update: async function()
                    {
                        if(this.crossIcon == -1) this.crossIcon = UI.getElementById(this.win, `${this.status.device}:cross`);
                        this.status = await NetworkManager.getDeviceInfoIPDetail(this.status.device);
                        UI.setEnabled(this.win, this.crossIcon, this.status.state == 'unavailable');
                        UI.setTextString(this.win, this.element, connectionIcon[this.status.type]);
                        UI.setTextColour(this.win, this.element, stateColour[this.status.state]);
                    }
                });
			}

            this.connections.forEach((i) => {
                i.update();
                UI.attach(this.win, this.element, i.element);
            });
		}
		catch (e)
		{
			Log.error(e.message);
		}
    }
}