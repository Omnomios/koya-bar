import * as UI from 'Koya/UserInterface';

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

export class DateTime
{
    constructor (win, config)
    {
        this.win = win;
        this.config = config;

        this.element = UI.createElement(this.win, {
            layout:{
                type: 'row',
                justifyContent: 'center',
                alignItems: 'start'
            },
            item: {
                size: {w: 48, h: 100},
                order: 100
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