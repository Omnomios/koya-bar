import * as Compositor from 'Koya/Compositor';
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
    constructor (images = {})
    {
        if(Object.keys(images).length == 0) return;

        this.backgrounds = {};
        for(const display of Compositor.listDisplays())
        {
            // If there's no image specified, yet there's a wildcard.
            if(Object.keys(images).includes('*') && !Object.keys(images).includes(display.display))
            {
                images[display.display] = images['*'];
            }

            // Still nothing? Then ignore this display.
            if(!Object.keys(images).includes(display.display)) continue;

            this.backgrounds[display.display] = {};

            const win = Compositor.createWindow({
                role: 'background',
                namespace: 'koya-background',
                display: display.display
            });
            this.backgrounds[display.display].win = win;

            this.assetKey = false;
            switch(getExtension(images[display.display]).toLowerCase())
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
                    this.assetKey = `/ram/video/${display.display}:${images[display.display]}`;
                    // Need to ask ffmpeg to help us out.
                    ff.load(win, this.assetKey, images[display.display]);
                    break;

                case "jpg":
                case "jpeg":
                case "png":
                default:
                    // Images are loaded by the renderer automatically.
                    this.assetKey = images[display.display];
                    break;
            }

            const root = UI.createElement(win, {
                layout: {
                    type:'column'
                },
                child: [
                    {
                        renderable: {
                            type: 'box',
                            texture: this.assetKey,
                            aabb: {
                                min: { x: 0, y: 0 },
                                max: { x: display.logical_width, y: display.logical_height }
                            }
                        }
                    }
                ]
            });
            this.backgrounds[display.display].root = root;

            UI.attachRoot(win, root);
        }
    }
}