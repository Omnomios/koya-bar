import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';
import * as Hypr from 'Module/hypr';

const FONT = '/rom/font/Inter_18pt-Regular.ttf';
const FONT_B = '/rom/font/Inter_18pt-Medium.ttf';
//const FONT = '/rom/font/DroidSansMNerdFont-Regular.otf';

export class TopBar
{
    constructor ()
    {
        const win = Compositor.createWindow({
            role: 'bar',
            edge: 'top',
            thickness: 30,
            msaaSamples: 4,
            keyboardInteractivity: 'none',
            acceptPointerEvents: false
        });

        // Root
        const root = UI.createElement(win, {
            layout: { type: 'row', wrap: false, justifyContent: 'start', alignItems: 'start', size: { h: 30 } }
        });
        UI.attachRoot(win, root);

        const left = UI.createElement(win, {
            renderable: {
                type: 'box',
                aabb: { min: { x:0, y:0 }, max: { x:140, y:30 } },
                colour: "#1793D122",
                cornerRadius: 2
            },
            item: {
                size: {x:150, y:30}
            }
        });
        UI.attach(win, root, left);

        const leftContent = UI.createElement(win, {
            renderable: {
                type: 'box',
                aabb: { min: { x:0, y:0 }, max: { x:140, y:30 } },
                colour: "#1793D1",
                cornerRadius: 4,
                cornerResolution: 5,
                inset: 1,
            },
            layout: {
                type: 'row',
                wrap: false,
                justifyContent: 'start',
                gap: {x:3},
                padding: { t: 1, r: 2, b: 0, l: 2 },
            },
            item:{
                size: {x:150, y:30}
            }
        });
        UI.attach(win, left, leftContent);

        const distroBadge = UI.createElement(win, {
            renderable: {
                type: 'sprite',
                texture: '/rom/image/arch.png',
                frames: [
                    {
                        size:{x:20,y:20},
                        origin:{x:0,y:0},
                        aabb:{ min:{x:0, y:0}, max:{x:128,y:128} }
                    }
                ]
            },
            item: {
                size:{w: 27, h: 29}
            },
            contentAlign: { x:'center', y: 'center' }
        });
        UI.attach(win, leftContent, distroBadge);

        const clockStack = UI.createElement(win, {
            layout: {
                type: 'column',
                wrap: false,
                justifyContent: 'start',
                gap: {x: 4},
                padding: { t: 2, r: 0, b: 2, l: 0 },
            },
            item: {
                size:{w: 90, h: 29}
            },
        });
        UI.attach(win, leftContent, clockStack);

        function formatTimeHHMM(d)
        {
            const h = String(d.getHours()).padStart(2, '0');
            const m = String(d.getMinutes()).padStart(2, '0');
            return `${h}:${m}`;
        }
        const timeText = UI.createElement(win, {
            renderable: {
                type: 'text',
                string: formatTimeHHMM(new Date()),
                size: 11,
                font: FONT_B,
                vAlign: 'start',
                colour: '#fff',
                letterSpacing: 2
            },
            contentAlign: { x: 'start', y: 'start' },
            item: {
                size: {w: 30}
            }
        });
        UI.attach(win, clockStack, timeText);


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

        const dateText = UI.createElement(win, {
            renderable: {
                type: 'text',
                string: formatDateHuman(new Date()),
                size: 9,
                font: FONT_B,
                vAlign: 'start',
                colour: '#fff',
                letterSpacing: 3
            },
            contentAlign: { x: 'start', y: 'start' },
            item: {
                size: {w: 30}
            }
        });
        UI.attach(win, clockStack, dateText);

        setInterval(async () => {
            UI.setTextString(win, timeText, formatTimeHHMM(new Date()));
            UI.setTextString(win, dateText, formatDateHuman(new Date()));
        }, 1000);

        // Spacer L
        const spacerL = UI.createElement(win, { item: { flexGrow: 1 } });
        UI.attach(win, root, spacerL);

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
        UI.attach(win, root, middle);

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


        // Spacer R
        const spacerR = UI.createElement(win, { item: { flexGrow: 1 } });
        UI.attach(win, root, spacerR);

        // Right (fixed)
        const right = UI.createElement(win, { layout: { type: 'row', wrap: false, alignItems: 'center' }, item: { preferredSize: { w: 80 } } });
        UI.attach(win, root, right);

        //globalThis.nm = new NetworkManager();

    }
}