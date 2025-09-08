import * as Log        from 'Koya/Log';
import * as Compositor from 'Koya/Compositor';
import * as UI         from 'Koya/UserInterface';

import dayjs          from '../../lib/dayjs/index.js';
import advancedFormat from '../../lib/dayjs/plugin/advancedFormat/index.js'
import isoWeek        from '../../lib/dayjs/plugin/isoWeek/index.js'
import weekOfYear     from '../../lib/dayjs/plugin/weekOfYear/index.js'
dayjs.extend(advancedFormat);
dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

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
            size: {x: 250, y: 270+(this.config.clock.calendar.showISOWeek?60:0)},
            offset:{ y: 2 },
            display: this.config.monitor,
            keyboardInteractivity: 'none',
            acceptPointerEvents: true,
            msaaSamples: 4
        });

        this.calendarId = this.buildCalendar();

        this.root = UI.createElement(this.win, {
            renderable: {
                type: 'box',
                colour: this.config.background,
                cornerRadius: {tr: 10,br: 10},
                cornerResolution: {tr: 8,br: 8},
            },
            contentAlign: 'fill',
            layout:{
                type: 'column',
                gap:10,
                padding:{l:32, r: 32, t: 16}
            },
            onMouseExit: ()=>{
                this.hide();
            },
            child:[
                {
                    id: 'fullTimeText',
                    renderable: {
                        type: 'text',
                        string: dayjs().format(this.config.clock.longTime),
                        size: 40,
                        font: this.config.font,
                        vAlign: 'start',
                        colour: this.config.colour,
                        letterSpacing: 2
                    },
                    contentAlign: { x: 'start', y: 'center' },
                    item:{
                        size:{x:"auto", y:48}
                    }
                },
                {
                    id: 'fullDateText',
                    renderable: {
                        type: 'text',
                        string: dayjs().format(this.config.clock.longDate),
                        size: 13,
                        font: this.config.font,
                        vAlign: 'start',
                        colour: this.config.colour,
                        letterSpacing: 3,
                    },
                    item:{
                        size:{x: "auto", y:20}
                    }
                },
                this.calendarId
            ]
        });
        UI.attachRoot(this.win, this.root);

        this.timeText = UI.getElementById(this.win, 'fullTimeText');
        this.dateText = UI.getElementById(this.win, 'fullDateText');

        this.rootAnim = {
            show: UI.addAnimation(this.win, this.root , [
                { time: 0.0,  position:{x:-250, y:0}, opacity: 0, ease: 'outQuad' },
                { time: 0.2,  position:{x:0,    y:0}, opacity: 1 }
            ]),
            hide: UI.addAnimation(this.win, this.root , [
                { time: 0.0,  position:{x:0,    y:0}, opacity: 1, ease: 'outQuad' },
                { time: 0.1,  position:{x:-250, y:0}, opacity: 0 }
            ]),
            hidden: UI.addAnimation(this.win, this.root , [
                { time: 0.0,  position:{x:-250, y:0} },
            ]),
        };

        // When closed, stop rendering
        UI.onAnimationEnd(this.win, this.root, this.rootAnim.hide, ()=>{
            setTimeout(() => {
                Compositor.setWindowRenderingEnabled(this.win, false);
            }, 100);
        });

        // Start hidden
        UI.startAnimation(this.win, this.root, this.rootAnim.hidden);

        for(const {element, hidden} of this.cellAnimation)
        {
            UI.startAnimation(this.win, element, hidden);
        }

        Compositor.setWindowRenderingEnabled(this.win, false);
    }

    /* Make sure current calendar is valid */
    checkCalendar ()
    {
        const currentDay = dayjs().date();
        if(this.calandarFor == currentDay) return;
        UI.detach(this.win, this.root, this.calendarId);
        UI.destroyElement(this.win, this.calandarId);
        this.calandarId = this.buildCalendar();
        UI.attach(this.win, this.root, this.calandarId);
    }

    buildCalendar ()
    {
        // First day of month
        const firstDay = dayjs().startOf("month");
        // ISO week number (Monday start)
        const isoWeekNumber = firstDay.isoWeek();
        const firstDayNumber = firstDay.day();
        const daysInMonth = dayjs().daysInMonth();
        const currentDay = dayjs().date();

        this.calandarFor = currentDay;

        // Build the calendar
        const cellSize = 24;
        const calendarRows = [];
        const dayLetter = ['S','M','T','W','T','F','S'];

        // Top Row
        const dayLegend = [];
        for(let d=0; d < 7; d++)
        {
            dayLegend.push({
                renderable: {
                    type: 'text',
                    colour: "#fff",
                    string: dayLetter[d],
                    font: this.config.font,
                    size: 8
                },
                contentAlign: { x: 'centre', y: 'centre' },
                item: {
                    size: {x: cellSize, y: 'auto'}
                },
            });
        }

        calendarRows.push({
            layout:{
                type: 'row',
                gap: 2
            },
            item: {
                size: {h:12}
            },
            child: dayLegend
        });

        let dayCount = -1;

        // Week Rows
        let w = 0;
        let t = 0;
        this.cellAnimation = [];
        while(dayCount <= daysInMonth)
        {
            const days = [];
            for(let d=0; d<7; d++)
            {
                t += 0.02;

                if(dayCount == -1 && d == firstDayNumber) dayCount = 0;
                if(dayCount >-1 ) dayCount++;

                let cellColour = this.config.clock.calendar.emptyCell;
                let textColour = this.config.clock.calendar.normalDay;
                if(dayCount > -1)
                {
                    cellColour = this.config.clock.calendar.normalCell;
                }
                if(currentDay == dayCount)
                {
                    cellColour = this.config.clock.calendar.todayCell;
                    textColour = this.config.clock.calendar.todayDay;
                }

                if(dayCount > daysInMonth)
                {
                    cellColour = this.config.clock.calendar.emptyCell;
                }

                const cellId = UI.createElement(this.win, {
                    renderable: {
                        type: 'box',
                        colour: cellColour,
                        aabb:{centre:{x:cellSize*0.5,y:cellSize*0.5}, size:{x:cellSize,y:cellSize*0.9}}
                    },
                    item:{ size: {x: cellSize, y: 'auto'}},
                    child:[{
                        renderable: {
                            type: 'text',
                            colour: textColour,
                            string: dayCount==-1||dayCount>daysInMonth?'':dayCount,
                            font: this.config.font,
                            size: 10
                        },
                        contentAlign: { x: 'centre', y: 'centre' },
                    }]
                });

                this.cellAnimation.push(
                    {
                        element: cellId,
                        show: UI.addAnimation(this.win, cellId , [
                            { time: 0.0,  position:{x:-250, y:0}, rotation: 45, ease: 'outQuad' },
                            { time: t+0.0,  position:{x:-250, y:0}, rotation: 45, ease: 'outQuad' },
                            { time: t+0.2,  position:{x:0,    y:0}, rotation: 0 }
                        ]),
                        hide: UI.addAnimation(this.win, cellId , [
                            { time: t+0.0,  position:{x:0,    y:0}, rotation: 0, ease: 'outQuad' },
                            { time: t+0.2,  position:{x:-250, y:0}, rotation: 45 }
                        ]),
                        hidden: UI.addAnimation(this.win, cellId , [
                            { time: 0.0,  position:{x:-250, y:0}, rotation: 45},
                        ]),
                    }
                );

                days.push(cellId);
            }

            calendarRows.push({
                layout:{
                    type: 'row',
                    gap: 2
                },
                item: {
                    size: {h:cellSize*0.9}
                },
                child: days
            });

            if(this.config.clock.calendar.showISOWeek)
            {
                calendarRows.push({
                    renderable: {
                        type: 'text',
                        colour: this.config.clock.calendar.weekText,
                        string: `Wk ${isoWeekNumber+w}`,
                        font: this.config.font,
                        size: 8,
                    },
                    contentAlign: { x: 'start', y: 'start' },
                    item: {
                        size: {h:9}
                    }
                });
            }

            w++;
        }

        return UI.createElement(this.win, {
            id: 'calendar',
            layout: {
                type:'column',
                gap: 2
            },
            item: {
                flexGrow: 1,
                order: 100
            },
            child: calendarRows
        });
    }

    startClock ()
    {
        const updateText = ()=>{
            UI.setTextString(this.win, this.timeText, dayjs().format(this.config.clock.longTime));
            UI.setTextString(this.win, this.dateText, dayjs().format(this.config.clock.longDate));
        }
        updateText();
        this.clock = setInterval(updateText, 1000);
    }

    stopClock ()
    {
        clearInterval(this.clock);
    }

    preWarm ()
    {
        Compositor.setWindowRenderingEnabled(this.win, true);
        this.checkCalendar();
    }

    show (cb=()=>{})
    {
        Compositor.setPointerEvents(this.win, true);
        this.hideCallback = cb;
        this.visible = true;
        UI.startAnimation(this.win, this.root, this.rootAnim.show);
        this.startClock();
        this.cellAnimation.forEach(({element, show}) => {
            UI.startAnimation(this.win, element, show);
        });
    }

    hide ()
    {
        Compositor.setPointerEvents(this.win, false);
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
                order: this.config.clock.order
            },
            onMouseEnter: (e) => {
                if(!this.calandar.visible) UI.startAnimation(this.win, this.element, this.anim.focus);
            },
            onMouseExit: (e) => {
                if(!this.calandar.visible) UI.startAnimation(this.win, this.element, this.anim.blur);
            },
            onMouseClick: (e) => {
                UI.startAnimation(this.win, this.element, this.anim.hide);
                this.calandar.preWarm();
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
                        string: dayjs().format(this.config.clock.shortTime),
                        size: 20,
                        font: this.config.font,
                        vAlign: 'start',
                        colour: this.config.colour,
                        letterSpacing: 2,
                        rotation: -90,
                    },
                    contentAlign: { x: 'end', y: 'end' },
                    item: {
                        size: {x: 25, y: 90}
                    }
                },
                {
                    id: 'dateText',
                    renderable: {
                        type: 'text',
                        string: dayjs().format(this.config.clock.shortDate),
                        size: 9,
                        font: this.config.font,
                        vAlign: 'start',
                        colour: this.config.colour,
                        letterSpacing: 3,
                        rotation: -90,
                    },
                    contentAlign: { x: 'end', y: 'end' },
                    item: {
                        size: {x: 15, y: 90}
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
                { time: 0.0,  position:{x:2, y:0}, scale:{x:1, y:1}, ease: 'outQuad' },
                { time: 0.05,  position:{x:0, y:0}, scale:{x:1, y:1}, }
            ]),
            hide: UI.addAnimation(this.win, this.element , [
                { time: 0.0,  position:{x:2,  y:0}, colour:[1,1,1,1],  ease: 'outQuad' },
                { time: 0.1,  position:{x:-4,  y:0}, colour:[1,1,1,1], ease: 'inQuad' },
                { time: 0.2, position:{x:40, y:0}, colour:[1,1,1,0], }
            ]),
            show: UI.addAnimation(this.win, this.element , [
                { time: 0.0,  position:{x:40,  y:0}, ease: 'outQuad' },
                { time: 0.1,  position:{x:-4,  y:0}, ease: 'inQuad' },
                { time: 0.2, position:{x:0, y:0}, }
            ])
        };
    }

    init ()
    {
        this.timeText = UI.getElementById(this.win, 'timeText');
        this.dateText = UI.getElementById(this.win, 'dateText');

        setInterval(async () => {
            UI.setTextString(this.win, this.timeText, dayjs().format(this.config.clock.shortTime));
            UI.setTextString(this.win, this.dateText, dayjs().format(this.config.clock.shortDate));
        }, 1000);
    }
}