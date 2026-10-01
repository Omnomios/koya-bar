import * as Compositor from 'Koya/Compositor';
import * as UI from 'Helix/UserInterface';
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
        this.config = { fadeTime: 1, ...config };
        this.backgrounds = {};
    }

    static async create (config = {})
    {
        const wallpaper = new Wallpaper(config);
        await wallpaper.init();
        return wallpaper;
    }

    async init ()
    {
        const displays = await Compositor.listDisplays();
        for(const display of displays)
        {
            this.backgrounds[display.display] = {};

            const win = await Compositor.createWindow({
                key: `background:${display.display}`,
                role: 'background',
                namespace: 'koya-background',
                display: display.display,
                exclusiveZone: -1
            });

            // Display descriptors contain strings and may omit logical dimensions.
            // The configured window reports numeric dimensions in logical pixels.
            const { width, height } = await Compositor.getWindowInfo(win);

            const root = await UI.createElement(win, {
                item: { size: { x: width, y: height } },
                child: [
                    {
                        id: 'canvasA',
                        renderable: {
                            type: 'box',
                            aabb: {
                                min: { x: 0, y: 0 },
                                max: { x: width, y: height }
                            }
                        },
                        item: { order: 1, size: { x: width, y: height } }
                    },
                    {
                        id: 'canvasB',
                        renderable: {
                            type: 'box',
                            aabb: {
                                min: { x: 0, y: 0 },
                                max: { x: width, y: height }
                            }
                        },
                        item: { order: 2, size: { x: width, y: height } }
                    }
                ]
            });


            // You can customise the animation. This is simple crossfade but you could do anything.
            // card slide, zoomfade, rotate, or even use a custom shader to do something even more detailed
            // https://www.koya-ui.com/ui-animation/index.html

            const canvasA = await UI.getElementById(win, 'canvasA');
            const animA = {
                hidden: await UI.addAnimation(win, canvasA, [{time:0, opacity:0}]),
                shown: await UI.addAnimation(win, canvasA, [{time:0, opacity:1}]),
                show: await UI.addAnimation(win, canvasA, [{time:0, opacity:0}, {time:this.config.fadeTime, opacity:1}])
            };

            const canvasB = await UI.getElementById(win, 'canvasB');
            const animB = {
                hidden: await UI.addAnimation(win, canvasB, [{time:0, opacity:0}]),
                shown: await UI.addAnimation(win, canvasB, [{time:0, opacity:1}]),
                show: await UI.addAnimation(win, canvasB, [{time:0, opacity:0}, {time:this.config.fadeTime, opacity:1}])
            };


            this.backgrounds[display.display].win = win;
            this.backgrounds[display.display].active = '';
            this.backgrounds[display.display].root = root;
            this.backgrounds[display.display].canvasA = canvasA;
            this.backgrounds[display.display].canvasB = canvasB;
            this.backgrounds[display.display].animA = animA;
            this.backgrounds[display.display].animB = animB;

            await UI.startAnimation(win, canvasA, animA.hidden);
            await UI.startAnimation(win, canvasB, animB.hidden);
            await UI.attachRoot(win, root);
        }
    }

    async changeTo (path, display = '*')
    {
        // Ugh. wildcard
        if(display == '*')
        {
            const displays = await Compositor.listDisplays();
            for(const d of displays)
            {
                await this.changeTo(path, d.display);
            }
            return;
        }

        const {win, canvasA, canvasB, animA, animB} = this.backgrounds[display];

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
                assetKey = `/ram/video/${display}:${path}`;
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

        await UI.onAnimationEnd(win, canvasB, animB.show, async () => {
            if(this.backgrounds[display].current?.startsWith('/ram/video/') &&
                this.backgrounds[display].current !== assetKey)
            {
                ff.stop(win, this.backgrounds[display].current);
            }
            this.backgrounds[display].current = assetKey;
            await UI.setTexture(win, canvasA, assetKey);
            await UI.startAnimation(win, canvasB, animB.hidden);
            await UI.startAnimation(win, canvasA, animA.shown);
        });

        await UI.setTexture(win, canvasB, assetKey);
        await UI.startAnimation(win, canvasB, animB.show);
    }
}
