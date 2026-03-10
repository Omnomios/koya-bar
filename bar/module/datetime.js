import * as Compositor from 'Koya/Compositor';
import * as UI         from 'Koya/UserInterface';

import dayjs          from '../../lib/dayjs/index.js';
import advancedFormat from '../../lib/dayjs/plugin/advancedFormat/index.js'
import isoWeek        from '../../lib/dayjs/plugin/isoWeek/index.js'
import weekOfYear     from '../../lib/dayjs/plugin/weekOfYear/index.js'
dayjs.extend(advancedFormat);
dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

class CalendarPopover
{
    constructor (config)
    {
        this.config = config;
        this.visible = false;
        this.hideCallback = () => {};
        this.builtForDay = -1;
    }

    static async create (config)
    {
        const popover = new CalendarPopover(config);
        await popover.setup();
        return popover;
    }

    async setup ()
    {
        const cal = this.config.clock.calendar;
        this.win = await Compositor.createWindow({
            key: 'calendar',
            namespace: 'koya-blur',
            role: 'overlay',
            anchor: 'bottom-left',
            size: { x: 220, y: cal.showISOWeek ? 300 : 280 },
            offset: { y: 2 },
            display: this.config.monitor,
            keyboardInteractivity: 'none',
            acceptPointerEvents: true,
            msaaSamples: 4
        });

        this.gridElement = await this.buildGrid();

        this.root = await UI.createElement(this.win, {
            renderable: {
                type: 'box',
                colour: this.config.background,
                cornerRadius: { tr: 10, br: 10 },
                cornerResolution: { tr: 8, br: 8 },
            },
            contentAlign: 'fill',
            layout: {
                type: 'column',
                gap: 8,
                padding: { l: 16, r: 16, t: 16, b: 12 }
            },
            onMouseExit: () => {
                this.hide().catch(() => {});
            },
            child: [
                {
                    id: 'calTimeText',
                    renderable: {
                        type: 'text',
                        string: dayjs().format(this.config.clock.longTime),
                        size: 36,
                        font: this.config.font,
                        vAlign: 'start',
                        colour: this.config.colour,
                        letterSpacing: 2
                    },
                    item: { size: { x: 'auto', y: 44 } }
                },
                {
                    id: 'calDateText',
                    renderable: {
                        type: 'text',
                        string: dayjs().format(this.config.clock.longDate),
                        size: 12,
                        font: this.config.fontLight || this.config.font,
                        vAlign: 'start',
                        colour: this.config.colour,
                        letterSpacing: 2
                    },
                    item: { size: { x: 'auto', y: 16 } }
                },
                this.gridElement
            ]
        });

        await UI.attachRoot(this.win, this.root);

        this.timeText = await UI.getElementById(this.win, 'calTimeText');
        this.dateText = await UI.getElementById(this.win, 'calDateText');

        const slideX = -220;
        this.showAnim = await UI.addAnimation(this.win, this.root, [
            { time: 0.0, position: { x: slideX, y: 0 }, opacity: 0, ease: 'outQuad' },
            { time: 0.2, position: { x: 0, y: 0 }, opacity: 1 }
        ]);
        this.hideAnim = await UI.addAnimation(this.win, this.root, [
            { time: 0.0, position: { x: 0, y: 0 }, opacity: 1, ease: 'outQuad' },
            { time: 0.12, position: { x: slideX, y: 0 }, opacity: 0 }
        ]);
        this.hiddenAnim = await UI.addAnimation(this.win, this.root, [
            { time: 0.0, position: { x: slideX, y: 0 } }
        ]);

        await UI.onAnimationEnd(this.win, this.root, this.hideAnim, () => {
            setTimeout(() => {
                Compositor.setWindowRenderingEnabled(this.win, false).catch(() => {});
            }, 100);
        });

        await UI.startAnimation(this.win, this.root, this.hiddenAnim);
        await Compositor.setWindowRenderingEnabled(this.win, false);
    }

    async buildGrid ()
    {
        const now = dayjs();
        const firstDay = now.startOf('month');
        const startDayOfWeek = firstDay.day();
        const daysInMonth = now.daysInMonth();
        const today = now.date();
        this.builtForDay = today;

        const cellSize = 24;
        const cal = this.config.clock.calendar;
        const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
        const children = [];

        for (const letter of dayLetters)
        {
            children.push({
                renderable: {
                    type: 'text',
                    colour: '#fff',
                    string: letter,
                    font: this.config.font,
                    size: 8
                },
                contentAlign: { x: 'center', y: 'center' },
                item: { size: { x: cellSize, y: 14 } }
            });
        }

        const totalSlots = startDayOfWeek + daysInMonth;
        const weekRows = Math.ceil(totalSlots / 7);

        for (let row = 0; row < weekRows; row++)
        {
            for (let col = 0; col < 7; col++)
            {
                const slotIndex = row * 7 + col;
                const dayNum = slotIndex - startDayOfWeek + 1;
                const isValid = dayNum >= 1 && dayNum <= daysInMonth;
                const isToday = isValid && dayNum === today;

                const cellColour = isToday ? cal.todayCell
                    : isValid ? cal.normalCell
                    : cal.emptyCell;
                const textColour = isToday ? cal.todayDay : cal.normalDay;

                children.push({
                    renderable: {
                        type: 'box',
                        colour: cellColour,
                        aabb: {
                            centre: { x: cellSize * 0.5, y: cellSize * 0.5 },
                            size: { x: cellSize, y: cellSize * 0.9 }
                        }
                    },
                    item: { size: { x: cellSize, y: cellSize } },
                    child: [{
                        renderable: {
                            type: 'text',
                            colour: textColour,
                            string: isValid ? String(dayNum) : '',
                            font: this.config.font,
                            size: 10
                        },
                        contentAlign: { x: 'center', y: 'center' },
                        item: { size: { x: 'auto', y: 'auto' } }
                    }]
                });
            }
        }

        const gridWidth = 7 * cellSize + 6 * 2;
        const gridHeight = 14 + weekRows * cellSize + weekRows * 2;

        const gridElement = await UI.createElement(this.win, {
            id: 'calGrid',
            layout: {
                type: 'grid',
                gridColumns: 7,
                columnGap: 2,
                rowGap: 2
            },
            item: { size: { x: gridWidth, y: gridHeight } },
            child: children
        });

        if (cal.showISOWeek)
        {
            const weekLabels = [];
            for (let row = 0; row < weekRows; row++)
            {
                const firstDayInRow = row * 7 - startDayOfWeek + 1;
                const representativeDay = Math.max(1, Math.min(daysInMonth, firstDayInRow));
                const weekNum = firstDay.date(representativeDay).isoWeek();
                weekLabels.push(String(weekNum));
            }

            return await UI.createElement(this.win, {
                layout: { type: 'column', gap: 6 },
                item: { flexGrow: 1, size: { x: gridWidth, y: gridHeight + 6 + 10 } },
                child: [
                    gridElement,
                    {
                        renderable: {
                            type: 'text',
                            colour: cal.weekText,
                            string: `Wk ${weekLabels.join(' \u00b7 ')}`,
                            font: this.config.font,
                            size: 8,
                            letterSpacing: 1
                        },
                        item: { size: { x: gridWidth, y: 10 } }
                    }
                ]
            });
        }

        return gridElement;
    }

    async checkCalendar ()
    {
        const today = dayjs().date();
        if (this.builtForDay === today) return;

        await UI.detach(this.win, this.root, this.gridElement);
        await UI.destroyElement(this.win, this.gridElement);
        this.gridElement = await this.buildGrid();
        await UI.attach(this.win, this.root, this.gridElement);
    }

    startClock ()
    {
        const update = async () => {
            await UI.setTextString(this.win, this.timeText, dayjs().format(this.config.clock.longTime));
            await UI.setTextString(this.win, this.dateText, dayjs().format(this.config.clock.longDate));
        };
        update().catch(() => {});
        this.clockInterval = setInterval(() => update().catch(() => {}), 1000);
    }

    stopClock ()
    {
        clearInterval(this.clockInterval);
    }

    async preWarm ()
    {
        await Compositor.setWindowRenderingEnabled(this.win, true);
        await this.checkCalendar();
    }

    async show (onHide = () => {})
    {
        await Compositor.setPointerEvents(this.win, true);
        this.hideCallback = onHide;
        this.visible = true;
        await UI.startAnimation(this.win, this.root, this.showAnim);
        this.startClock();
    }

    async hide ()
    {
        await Compositor.setPointerEvents(this.win, false);
        this.visible = false;
        await UI.startAnimation(this.win, this.root, this.hideAnim);
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
    }

    static async create (win, config)
    {
        const dateTime = new DateTime(win, config);
        await dateTime.setup();
        return dateTime;
    }

    async setup ()
    {
        this.calendar = null;
        this.calendarReady = null;
        this.pendingHideAction = null;

        this.element = await UI.createElement(this.win, {
            layout: {
                type: 'row',
                justifyContent: 'center',
                alignItems: 'start'
            },
            item: {
                size: { y: 100 },
                order: this.config.clock.order
            },
            onMouseEnter: () => {
                Compositor.setCursor(this.win, 'pointer').catch(() => {});
                if (!this.calendar || !this.calendar.visible)
                {
                    UI.startAnimation(this.win, this.element, this.anim.focus).catch(() => {});
                }
            },
            onMouseExit: () => {
                Compositor.setCursor(this.win, 'default').catch(() => {});
                if (!this.calendar || !this.calendar.visible)
                {
                    UI.startAnimation(this.win, this.element, this.anim.blur).catch(() => {});
                }
            },
            onMouseClick: async () => {
                if (!this.calendar)
                {
                    if (!this.calendarReady)
                    {
                        this.calendarReady = CalendarPopover.create(this.config)
                            .then(cal => { this.calendar = cal; return cal; });
                    }
                    this.calendar = await this.calendarReady;
                }
                Compositor.setCursor(this.win, 'default').catch(() => {});
                await this.calendar.preWarm();
                this.pendingHideAction = () => {
                    this.calendar.show(() => {
                        UI.startAnimation(this.win, this.element, this.anim.show).catch(() => {});
                    }).catch(() => {});
                };
                await UI.startAnimation(this.win, this.element, this.anim.hide);
            },
            child: [
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
                        size: { x: 25, y: 90 }
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
                        size: { x: 15, y: 90 }
                    }
                }
            ]
        });

        this.anim = {
            focus: await UI.addAnimation(this.win, this.element, [
                { time: 0.0, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, ease: 'inQuad' },
                { time: 0.2, position: { x: 2, y: 0 }, scale: { x: 1, y: 1 } }
            ]),
            blur: await UI.addAnimation(this.win, this.element, [
                { time: 0.0, position: { x: 2, y: 0 }, scale: { x: 1, y: 1 }, ease: 'outQuad' },
                { time: 0.05, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 } }
            ]),
            hide: await UI.addAnimation(this.win, this.element, [
                { time: 0.0, position: { x: 2, y: 0 }, opacity: 1, ease: 'outQuad' },
                { time: 0.1, position: { x: -4, y: 0 }, opacity: 1, ease: 'inQuad' },
                { time: 0.2, position: { x: 40, y: 0 }, opacity: 0 }
            ]),
            show: await UI.addAnimation(this.win, this.element, [
                { time: 0.0, position: { x: 40, y: 0 }, opacity: 0, ease: 'outQuad' },
                { time: 0.1, position: { x: -4, y: 0 }, opacity: 0.8, ease: 'inQuad' },
                { time: 0.2, position: { x: 0, y: 0 }, opacity: 1 }
            ])
        };

        await UI.onAnimationEnd(this.win, this.element, this.anim.hide, () => {
            if (this.pendingHideAction)
            {
                const action = this.pendingHideAction;
                this.pendingHideAction = null;
                action();
            }
        });
    }

    async init ()
    {
        this.timeText = await UI.getElementById(this.win, 'timeText');
        this.dateText = await UI.getElementById(this.win, 'dateText');

        setInterval(async () => {
            await UI.setTextString(this.win, this.timeText, dayjs().format(this.config.clock.shortTime));
            await UI.setTextString(this.win, this.dateText, dayjs().format(this.config.clock.shortDate));
        }, 1000);
    }
}
