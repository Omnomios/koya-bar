import * as Compositor from 'Koya/Compositor';
import * as Log from 'Koya/Log';
import * as UI from 'Koya/UserInterface';
import * as ff from 'Module/ffmpeg';


function getExtension (filename)
{
    const lastDot = filename.lastIndexOf(".");
    if(lastDot === -1)
    {
        return ""; // no extension
    }
    return filename.slice(lastDot + 1);
}

export class Wallpaper
{
    constructor (config = {})
    {
        this.config = config;

        this.backgrounds = {};
        for(const display of Compositor.listDisplays())
        {
            this.backgrounds[display.display] = {};

            const win = Compositor.createWindow({
                role: 'background',
                namespace: 'koya-background',
                display: display.display,
                exclusiveZone: -1
            });

            const root = UI.createElement(win, {
                child: [
                    {
                        id: 'canvasA',
                        renderable: {
                            type: 'box',
                            aabb: {
                                min: { x: 0, y: 0 },
                                max: { x: display.logical_width, y: display.logical_height }
                            }
                        },
                        item:{ order: 1 }
                    },
                    {
                        id: 'canvasB',
                        renderable: {
                            type: 'box',
                            aabb: {
                                min: { x: 0, y: 0 },
                                max: { x: display.logical_width, y: display.logical_height }
                            }
                        },
                        item:{ order: 2 }
                    }
                ]
            });


            // You can customise the animation. This is simple crossfade but you could do anything.
            // card slide, zoomfade, rotate, or even use a custom shader to do something even more detailed
            // https://www.koya-ui.com/ui-animation/index.html

            const canvasA = UI.getElementById(win, 'canvasA');
            const animA = {
                hidden: UI.addAnimation(win, canvasA, [{time:0, opacity:0}]),
                shown: UI.addAnimation(win, canvasA, [{time:0, opacity:1}]),
                show: UI.addAnimation(win, canvasA, [{time:0, opacity:0}, {time:this.config.fadeTime, opacity:1}])
            };

            const canvasB = UI.getElementById(win, 'canvasB');
            const animB = {
                hidden: UI.addAnimation(win, canvasB, [{time:0, opacity:0}]),
                shown: UI.addAnimation(win, canvasB, [{time:0, opacity:1}]),
                show: UI.addAnimation(win, canvasB, [{time:0, opacity:0}, {time:this.config.fadeTime, opacity:1}])
            };


            this.backgrounds[display.display].win = win;
            this.backgrounds[display.display].active = '';
            this.backgrounds[display.display].root = root;
            this.backgrounds[display.display].canvasA = canvasA;
            this.backgrounds[display.display].canvasB = canvasB;
            this.backgrounds[display.display].animA = animA;
            this.backgrounds[display.display].animB = animB;

            UI.startAnimation(win, canvasA, animA.hidden);
            UI.startAnimation(win, canvasB, animB.hidden);
            UI.attachRoot(win, root);
        }
    }

    changeTo (path, display = '*')
    {
        // Ugh. wildcard
        if(display == '*')
        {
            for(const d of Compositor.listDisplays())
            {
                this.changeTo(path, d.display);
            }
            return;
        }

        const {win, canvasA, canvasB, animA, animB, active} = this.backgrounds[display];

        let assetKey = false;
        switch(getExtension(path).toLowerCase())
        {
            // Really need to "ffmpeg -formats" on your system to make sure.
            case "mp4":
            case "mov":
            case "3gp":
            case "3g2":
            case "mkv":
            case "webm":
            case "avi":
            case "gif":
            case "apng":
                assetKey = `/ram/video/${display.display}:${path}`;
                // Need to ask ffmpeg to help us out.
                ff.load(win, assetKey, path);
                break;

            case "jpg":
            case "jpeg":
            case "png":
            default:
                // Images are loaded by the renderer automatically.
                assetKey = path;
                break;
        }

        if(!assetKey) return;

        UI.onAnimationEnd(win, canvasB, animB.show, () => {
            if(this.backgrounds[display].current?.includes('/ram/video'))
            {
                //ff.stop(this.backgrounds[display].current);
            }
            this.backgrounds[display].current = assetKey;
            UI.setTexture(win, canvasA, assetKey);
            UI.startAnimation(win, canvasB, animB.hide);
            UI.startAnimation(win, canvasA, animA.shown);
        });

        UI.setTexture(win, canvasB, assetKey);
        UI.startAnimation(win, canvasB, animB.show);
    }
}