import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';
import * as Image from 'Koya/Image';
import * as Hypr from 'Module/hypr';
import * as Log from 'Koya/Log';

const FONT = '/rom/font/Inter_18pt-Regular.ttf';
const FONT_B = '/rom/font/Inter_18pt-Medium.ttf';
//const FONT = '/rom/font/DroidSansMNerdFont-Regular.otf';

function formatTimeHHMM(d)
{
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

function getOrdinalSuffix(day)
{
    if(day >= 11 && day <= 13) return "th";
    switch(day % 10)
    {
        case 1: return "st";
        case 2: return "nd";
        case 3: return "rd";
        default: return "th";
    }
}

function formatDateHuman(date)
{
    const weekdays = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const months   = ["Jan","Feb","Mar","Apr","May","Jun",
                    "Jul","Aug","Sep","Oct","Nov","Dec"];

    const dayNum  = date.getDate();
    const suffix  = getOrdinalSuffix(dayNum);
    const weekday = weekdays[date.getDay()];
    const month   = months[date.getMonth()];

    return `${weekday} ${dayNum}${suffix} ${month}`;
}


export class TopBar
{
    constructor ()
    {
        const win = Compositor.createWindow({
            namespace: 'koya-blur',
            role: 'bar',
            edge: 'left',
            thickness: 48,
            msaaSamples: 4,
            keyboardInteractivity: 'none',
            acceptPointerEvents: false
        });

        const blurred = Image.blur(win, { src: Image.load(win, {path: '/rom/image/arch.png', id: 'icon/arch'}), radius: 6, passes: 2 });

        // Root
        const root = UI.createElement(win, {
            renderable: {
                type: 'box',
                colour: [0,0,0,0.5],
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
                    child: [
                        {
                            id: 'archBlur',
                            renderable: {
                                type: 'sprite',
                                texture: blurred,
                                frames: [
                                    {
                                        size:{x:32,y:32},
                                        origin:{x:16,y:16},
                                        aabb:{ min:{x:0, y:0}, max:{x:128,y:128} },
                                        color: [1,1,1,0.75]
                                    }
                                ],
                                position: {x:24,y:22},
                                scale:{x:1.3,y:1.3}                                
                            },
                        },
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
                                position: {x:24,y:24}
                            },
                        },
                    ]
                },
                { item: { flexGrow: 1 } },
                {
                    item: {
                        size:{w: 48, h: 48}
                    }
                },
                { item: { flexGrow: 1 } },
                {
                    item: {
                        size:{ w:48, h:90 }
                    },
                    child:[
                        {
                            layout:{
                                type:'row',
                                justifyContent: 'space-between',
                                alignItems: 'start',
                                padding: {l:7, r:7}
                            },
                            child:[
                                {
                                    id: 'timeText',
                                    renderable: {
                                        type: 'text',
                                        string: formatTimeHHMM(new Date()),
                                        size: 20,
                                        font: FONT_B,
                                        vAlign: 'start',
                                        colour: '#fff',
                                        letterSpacing: 2,
                                        rotation: -90,

                                    },
                                    contentAlign: { x: 'start', y: 'end' },
                                    item: {
                                        size: {w: 10, h: 90}
                                    }
                                },
                                {
                                    id: 'dateText',
                                    renderable: {
                                        type: 'text',
                                        string: formatDateHuman(new Date()),
                                        size: 9,
                                        font: FONT_B,
                                        vAlign: 'start',
                                        colour: '#fff',
                                        letterSpacing: 3,
                                        rotation: -90,
                                    },
                                    contentAlign: { x: 'center', y: 'end' },
                                    item: {
                                        size: {w: 10, h: 90}
                                    }
                                }
                            ]
                        }
                    ]
                },
            ]
        });
        UI.attachRoot(win, root);

        const archBlur = UI.getElementById(win, 'archBlur');
        const timeText = UI.getElementById(win, 'timeText');
        const dateText = UI.getElementById(win, 'dateText');

        setInterval(async () => {
            UI.setTextString(win, timeText, formatTimeHHMM(new Date()));
            UI.setTextString(win, dateText, formatDateHuman(new Date()));
        }, 1000);

        // Middle (true centered, no grow)
        const middle = UI.createElement(win, {
            layout: {
                type: 'row',
                wrap: false,
                justifyContent: 'center',
                alignItems: 'center',
                padding: { t: 7, r: 0, b: 0, l: 0 },
            }
        });

        const titleText = UI.createElement(win, {
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
        UI.attach(win, middle, titleText);

        const archAnim = UI.addAnimation(win, archBlur, [
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
        UI.startAnimation(win, archBlur, archAnim);


        const titleBounce = UI.addAnimation(win, titleText, [
            { time: 0.0,  position:{x:0, y:0}, scale:{x:0.95, y:1}, ease: 'outQuad' },
            { time: 0.08, position:{x:0, y:3}, scale:{x:1.05, y:1}, ease: 'outQuad'  },
            { time: 1,    position:{x:0, y:0}, scale:{x:1, y:1}	  }
        ]);

        Hypr.on('activewindow',({payload})=>{
            const [windowClass, windowTitle] = payload.split(',');
            UI.setTextString(win, titleText, windowTitle);
            UI.startAnimation(win, titleText, titleBounce);
        });


        // Right (fixed)
        const right = UI.createElement(win, { layout: { type: 'row', wrap: false, alignItems: 'center' }, item: { preferredSize: { w: 80 } } });
        UI.attach(win, root, right);

        //globalThis.nm = new NetworkManager();

    }
}