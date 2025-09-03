import * as Compositor from 'Koya/Compositor';
import * as UI         from 'Koya/UserInterface';
import * as Image      from 'Koya/Image';
import * as Hypr       from 'Module/hypr';
import * as Log        from 'Koya/Log';

import { DateTime } from './module/datetime.js'
import { Network }  from './module/network.js'
import { Battery }  from './module/battery.js'

const FONT_B = '/rom/font/Inter_18pt-Medium.ttf';

export class Bar
{
    constructor (config)
    {
        this.config = config;
        this.win = Compositor.createWindow({
            namespace: 'koya-blur',
            role: 'bar',
            edge: 'left',
            thickness: config.thickness,
            msaaSamples: 4,
            display: this.config.monitor,
            keyboardInteractivity: 'none',
            acceptPointerEvents: true
        });

        this.dateTime = new DateTime(this.win, config);
        this.network  = new Network(this.win, config);
        this.battery  = new Battery(this.win, config);

        // Root
        const root = UI.createElement(this.win, {
            id: 'root',
            renderable: {
                type: 'box',
                colour: this.config.background,
                cornerRadius: {tr: 4,br: 4},
                cornerResolution: {tr: 2,br: 2},
            },
            contentAlign: 'fill',
            layout: {
                type: 'column',
                wrap: false,
                justifyContent: 'start',
                alignItems: 'start',
            },
            child: [
                { // Icon holder
                    id: 'top_modules',
                    layout: {
                        type: 'column',
                        wrap: false,
                        justifyContent: 'start',
                        alignItems: 'center',
                    },
                    item: {
                        size: { w: 'auto', h: 200 }
                    },
                    child: [
                        {
                            renderable: {
                                type: 'sprite',
                                texture: '/rom/image/arch.png',
                                frames: [
                                    {
                                        size:{x:32,y:32},
                                        origin:{x:16,y:16},
                                        aabb:{ min:{x:0, y:0}, max:{x:128,y:128} }
                                    }
                                ],
                            },
                            item: {
                                size: { w:48, h:48 }
                            },
                            contentAlign: { x: 'center', y: 'center' },
                        },
                    ]
                },
                { id: 'spacer_1', item: { flexGrow: 1 } },
                {
                    id: 'centre_modules',
                    item: {
                        size:{ h: 48 }
                    }
                },
                { id: 'spacer_2', item: { flexGrow: 1 } },
                {
                    id: 'bottom_modules',
                    layout: {
                        type: 'column',
                        justifyContent: 'end',
                        alignItems: 'center',
                        gap: 8
                    },
                    item: {
                        size:{ h: 200 }
                    },
                    child: [
                        this.dateTime.element,
                        this.network.element,
                        this.battery.element
                    ]
                },
            ]
        });
        UI.attachRoot(this.win, root);

        this.dateTime.init();
        this.network.init();
        this.battery.init();

        const archBlur = UI.getElementById(this.win, 'archBlur');

        // Middle (true centered, no grow)
        const middle = UI.createElement(this.win, {
            layout: {
                type: 'row',
                wrap: false,
                justifyContent: 'center',
                alignItems: 'center',
                padding: { t: 7, r: 0, b: 0, l: 0 },
            }
        });

        const titleText = UI.createElement(this.win, {
            renderable: {
                type: 'text',
                string: '',
                size: 14,
                colour: '#eee',
                font: FONT_B,
                justify: 'center',
                vAlign: 'start',
                letterSpacing: 1.6
            },
            contentAlign: { x: 'start', y: 'start' },
            item: {
                size:{h: 20}
            }
        });
        UI.attach(this.win, middle, titleText);

        const archAnim = UI.addAnimation(this.win, archBlur, [
            { time: 0.0,  scale:{x:1.2, y:1.2} },

            { time: 2.5, scale:{x:1.5, y:1.5},
                noise: {
                    type: 'simplex',
                    seed: 7,
                    timeScale: { x: 2, y: 2 },
                    position: { x: 0.01, y: 0.01 },
                    scale:    { x: 0.06, y: 0.03 },
                }  },
            { time: 5,  scale:{x:1.2, y:1.2},   looping: true	  }
        ]);
        UI.startAnimation(this.win, archBlur, archAnim);

        const titleBounce = UI.addAnimation(this.win, titleText, [
            { time: 0.0,  position:{x:0, y:0}, scale:{x:0.95, y:1}, ease: 'outQuad' },
            { time: 0.08, position:{x:0, y:3}, scale:{x:1.05, y:1}, ease: 'outQuad'  },
            { time: 1,    position:{x:0, y:0}, scale:{x:1, y:1}	  }
        ]);

        Hypr.on('activewindow',({payload})=>{
            const [windowClass, windowTitle] = payload.split(',');
            UI.setTextString(this.win, titleText, windowTitle);
            UI.startAnimation(this.win, titleText, titleBounce);
        });

        // Right (fixed)
        const right = UI.createElement(this.win, { layout: { type: 'row', wrap: false, alignItems: 'center' }, item: { preferredSize: { w: 80 } } });
        UI.attach(this.win, root, right);
    }
}