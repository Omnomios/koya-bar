import * as Log from 'Koya/Log';
import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';

function formatTimeHHMM(d)
{
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

function formatTimeHHMMSS(d)
{
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
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

function formatDateHumanFull(date)
{
    const weekdays = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const months   = ["January","Febuary","March","April","May","June",
                    "July","August","September","October","November","December"];

    const dayNum  = date.getDate();
    const suffix  = getOrdinalSuffix(dayNum);
    const weekday = weekdays[date.getDay()];
    const month   = months[date.getMonth()];

    return `${weekday}, ${dayNum}${suffix} ${month}`;
}


class Calandar
{
    constructor (win, config)
    {
        this.config = config;
        this.visible = false;
        this.hideCallback = ()=>{};

        this.win = Compositor.createWindow({
            namespace: 'koya-blur',
            role: 'overlay',
            anchor: 'bottom-left',
            size: {w: 250, h: 350},
            offset:{ y: 2 },
            display: this.monitor,
            keyboardInteractivity: 'none',
            acceptPointerEvents: true,
            msaaSamples: 4
        });

        this.root = UI.createElement(this.win, {
            renderable: {
                type: 'box',
                colour: [0,0,0,0.5],
                cornerRadius: {tr: 10,br: 10},
                cornerResolution: {tr: 8,br: 8},
            },
            contentAlign: 'fill',
            layout:{
                type: 'column',
                gap:10,
                padding:{l:12, r: 12}
            },
            onMouseExit: ()=>{
                this.hide();
            },
            child:[
                {
                    id: 'fullTimeText',
                    renderable: {
                        type: 'text',
                        string: formatTimeHHMMSS(new Date()),
                        size: 40,
                        font: this.config.font,
                        vAlign: 'start',
                        colour: this.config.colour,
                        letterSpacing: 2
                    },
                    contentAlign: { x: 'start', y: 'center' },
                    item:{
                        size:{h:48, w: "auto"}
                    }
                },
                {
                    id: 'fullDateText',
                    renderable: {
                        type: 'text',
                        string: formatDateHumanFull(new Date()),
                        size: 13,
                        font: this.config.font,
                        vAlign: 'start',
                        colour: '#fff',
                        letterSpacing: 3,
                    },
                    item:{
                        size:{h:20, w: "auto"}
                    }
                },
                {
                    id: 'calendar',
                    item:{ flexGrow: 1 }
                },
            ]
        });
        UI.attachRoot(this.win, this.root);

        this.timeText = UI.getElementById(this.win, 'fullTimeText');
        this.dateText = UI.getElementById(this.win, 'fullDateText');

        this.rootAnim = {
            show: UI.addAnimation(this.win, this.root , [
                { time: 0.0,  position:{x:-250, y:0}, colour: [0,0,0,0], ease: 'outQuad' },
                { time: 0.2,  position:{x:0,    y:0}, colour: [0,0,0,0.5]  }
            ]),
            hide: UI.addAnimation(this.win, this.root , [
                { time: 0.0,  position:{x:0,    y:0}, colour: [0,0,0,0.5], ease: 'outQuad' },
                { time: 0.1,  position:{x:-250, y:0}, colour: [0,0,0,0]  }
            ]),
            hidden: UI.addAnimation(this.win, this.root , [
                { time: 0.0,  position:{x:-250, y:0} },
            ]),
        };

        UI.startAnimation(this.win, this.root, this.rootAnim.hidden);
        //Compositor.setWindowRenderingEnabled(this.win, false);
    }

    startClock ()
    {
        const updateText = ()=>{
            UI.setTextString(this.win, this.timeText, formatTimeHHMMSS(new Date()));
            UI.setTextString(this.win, this.dateText, formatDateHumanFull(new Date()));
        }
        updateText();
        this.clock = setInterval(updateText, 1000);
    }

    stopClock ()
    {
        clearInterval(this.clock);
    }

    show (cb=()=>{})
    {
        this.hideCallback = cb;
        this.visible = true;
        Compositor.setWindowRenderingEnabled(this.win, true);
        UI.startAnimation(this.win, this.root, this.rootAnim.show);
        this.startClock();
    }

    hide ()
    {
        this.visible = false;
        UI.startAnimation(this.win, this.root, this.rootAnim.hide);
        this.hideCallback();
        this.stopClock();
    }
}

export class DateTime
{
    constructor (win, config)
    {
        this.win = win;
        this.config = config;

        this.calandar = new Calandar(this.win, this.config);

        this.element = UI.createElement(this.win, {
            layout:{
                type: 'row',
                justifyContent: 'center',
                alignItems: 'start'
            },
            item: {
                size: {h: 100},
                order: 100
            },
            onMouseEnter: (e) => {
                if(!this.calandar.visible) UI.startAnimation(this.win, this.element, this.anim.focus);
            },
            onMouseExit: (e) => {
                if(!this.calandar.visible) UI.startAnimation(this.win, this.element, this.anim.blur);
            },
            onMouseClick: (e) => {
                UI.startAnimation(this.win, this.element, this.anim.hide);
                UI.onAnimationEnd(this.win, this.element, this.anim.hide, ()=>{
                    this.calandar.show(()=>{
                        UI.startAnimation(this.win, this.element, this.anim.show);
                    });
                });
            },
            child:[
                {
                    id: 'timeText',
                    renderable: {
                        type: 'text',
                        string: formatTimeHHMM(new Date()),
                        size: 20,
                        font: this.config.font,
                        vAlign: 'start',
                        colour: this.config.colour,
                        letterSpacing: 2,
                        rotation: -90,
                    },
                    contentAlign: { x: 'end', y: 'end' },
                    item: {
                        size: {w: 25, h: 90}
                    }
                },
                {
                    id: 'dateText',
                    renderable: {
                        type: 'text',
                        string: formatDateHuman(new Date()),
                        size: 9,
                        font: this.config.font,
                        vAlign: 'start',
                        colour: '#fff',
                        letterSpacing: 3,
                        rotation: -90,
                    },
                    contentAlign: { x: 'end', y: 'end' },
                    item: {
                        size: {w: 15, h: 90}
                    }
                }
            ]
        });

        this.anim = {
            focus: UI.addAnimation(this.win, this.element , [
                { time: 0.0,  position:{x:0, y:0}, scale:{x:1, y:1}, ease: 'inQuad' },
                { time: 0.2,  position:{x:2, y:0}, scale:{x:1, y:1},  }
            ]),
            blur: UI.addAnimation(this.win, this.element , [
                { time: 0.0,  position:{x:2, y:0}, scale:{x:1, y:1}, ease: 'outQuad'  },
                { time: 0.05,  position:{x:0, y:0}, scale:{x:1, y:1}, }
            ]),
            hide: UI.addAnimation(this.win, this.element , [
                { time: 0.0,  position:{x:2,  y:0}, colour:[1,1,1,1], ease: 'outQuad'  },
                { time: 0.1,  position:{x:-4,  y:0}, colour:[1,1,1,1], ease: 'inQuad'  },
                { time: 0.2, position:{x:40, y:0}, colour:[1,1,1,0], }
            ]),
            show: UI.addAnimation(this.win, this.element , [
                { time: 0.0,  position:{x:40,  y:0}, ease: 'outQuad'  },
                { time: 0.1,  position:{x:-4,  y:0}, ease: 'inQuad'  },
                { time: 0.2, position:{x:0, y:0}, }
            ])
        };
    }

    init ()
    {
        this.timeText = UI.getElementById(this.win, 'timeText');
        this.dateText = UI.getElementById(this.win, 'dateText');

        setInterval(async () => {
            UI.setTextString(this.win, this.timeText, formatTimeHHMM(new Date()));
            UI.setTextString(this.win, this.dateText, formatDateHuman(new Date()));
        }, 1000);
    }
}