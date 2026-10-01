import * as Compositor from 'Koya/Compositor';
import * as UI         from 'Helix/UserInterface';

import { DateTime } from './module/datetime.js'
import { Network }  from './module/network.js'
import { Battery }  from './module/battery.js'
import { Power }    from './module/power.js'

export class Bar
{
    constructor (config)
    {
        this.config = config;
        this.win = -1;
    }

    static async create (config)
    {
        const bar = new Bar(config);
        await bar.setup();
        return bar;
    }

    async setup ()
    {
        this.win = await Compositor.createWindow({
            key: 'leftBar',
            namespace: 'koya-blur',
            role: 'bar',
            edge: 'left',
            thickness: this.config.thickness,
            msaaSamples: 4,
            display: this.config.monitor,
            keyboardInteractivity: 'none',
            acceptPointerEvents: true
        });

        this.dateTime = await DateTime.create(this.win, this.config);
        this.network  = await Network.create(this.win, this.config);
        this.battery  = await Battery.create(this.win, this.config);
        this.power    = await Power.create(this.win, this.config);

        const root = await UI.createElement(this.win, {
            id: 'root',
            renderable: {
                type: 'box',
                colour: this.config.background,
                cornerRadius: { tr: 4, br: 4 },
                cornerResolution: { tr: 2, br: 2 },
            },
            contentAlign: 'fill',
            layout: {
                type: 'column',
                wrap: false,
                justifyContent: 'start',
                alignItems: 'center',
            },
            child: [
                {
                    id: 'top_modules',
                    layout: {
                        type: 'column',
                        wrap: false,
                        justifyContent: 'start',
                        alignItems: 'center',
                    },
                    item: {
                        size: { y: 48 }
                    },
                    child: [
                        {
                            renderable: {
                                type: 'sprite',
                                texture: '/rom/image/arch.png',
                                frames: [
                                    {
                                        size: { x: 32, y: 32 },
                                        origin: { x: 16, y: 16 },
                                        aabb: { min: { x: 0, y: 0 }, max: { x: 128, y: 128 } }
                                    }
                                ],
                            },
                            item: {
                                size: { x: 48, y: 48 }
                            },
                            contentAlign: { x: 'center', y: 'center' },
                        },
                    ]
                },
                { item: { flexGrow: 1, size: { y: 0 } } },
                {
                    id: 'bottom_modules',
                    layout: {
                        type: 'column',
                        justifyContent: 'end',
                        alignItems: 'center',
                        gap: 10
                    },
                    item: {
                        size: { y: 200 }
                    },
                    child: [
                        this.dateTime.element,
                        this.network.element,
                        this.battery.element,
                        this.power.element
                    ]
                },
            ]
        });
        await UI.attachRoot(this.win, root);

        await this.dateTime.init();
        await this.network.init();
        await this.battery.init();
        await this.power.init();
    }
}
