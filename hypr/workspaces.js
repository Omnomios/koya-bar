import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';
import * as Log from 'Koya/Log';
import * as Hypr from 'Module/hypr';

//const FONT = '/home/user/.local/share/fonts/JetBrainsMonoNerdFontMono-Regular.ttf';
const FONT = '/usr/share/fonts/open-sans/OpenSans-Regular.ttf';

class WorkspaceCell
{
    constructor (window, workspace)
    {
        this.size = {x:26, y:24};
        this.window = window;
        this.workspace = workspace;
        this.isUrgent = false;
    }

    createUI ()
    {
        // If it already exists, nuke it.
        if(this.boxElement)
        {
            this.destroy();
        }

        const textId = UI.createElement(this.window.win, {
            renderable: {
                type: 'text',
                justify: 'center',
                string: `${this.workspace.name}`,
                size: 16,
                colour: "#fff",
                font: FONT
            },
            layoutSize: { w: this.size.x-2, h:this.size.y-4 },
            contentAlign: {x: 'center', y: 'center'}
        });

        this.boxElement = UI.createElement(this.window.win, {
            renderable: {
                type: 'box',
                aabb: { min: { x: 0, y: 0 }, max: {x: this.size.x, y: this.size.y} },
                cornerRadius: [2,2,0,0],
                cornerResolution: 2,
                colour: "#444",
            },
            layoutOrder: parseInt(this.workspace.id)
        });
        UI.attach(this.window.win, this.boxElement, textId);

        this.topLine = UI.createElement(this.window.win, {
            renderable: {
                type: 'box',
                aabb: { min: { x: 0, y: 0 }, max: { x: this.size.x, y: 4 } },
                cornerRadius: [2,2,0,0],
                cornerResolution: 2,
                colour: "#5fd1fa"
            }
        });
        UI.attach(this.window.win, this.boxElement, this.topLine);
        UI.attach(this.window.win, this.window.root, this.boxElement);

        const H        = this.size.y;    // usually this.size.y
        const A1       = H * 0.52;       // first hop height
        const A2       = H * 0.16;       // second hop height
        const A3       = H * 0.08;       // micro hop
        const DURATION = 0.64;           // total loop time in seconds

        // Keep noise identical at t=0 and t=DURATION so the loop seam is invisible.
        const baseNoise = {
            type: 'simplex',
            seed: 7,
            timeScale: { x: 0.7, y: 0.7 },
            position: { x: 0.2, y: 0.4 },     // tiny positional life; keep small
            scale:    { x: 0.002, y: 0.002 }  // micro breath in scale
        };

        this.boxAnim = {
            urgent: UI.addAnimation(this.window.win, this.boxElement, [
                // Rest
                { time: 0.00, position: { x: 0, y: 0 },        scale: { x: 1.00, y: 1.00 }, noise: baseNoise },
                // Hop 1: up with ease-out, slight stretch
                { time: 0.12, position: { x: 0, y: -A1 },      scale: { x: 1, y: 1.08 }, noise: baseNoise, ease: 'outQuad' },
                // Impact 1: down with ease-in, quick squash/overshoot
                { time: 0.24, position: { x: 0, y: 0 },        scale: { x: 1, y: 0.94 }, noise: baseNoise, ease: 'inQuad' },
                // Hop 2
                { time: 0.32, position: { x: 0, y: -A2 },      scale: { x: 1, y: 1.04 }, noise: baseNoise, ease: 'outQuad' },
                { time: 0.42, position: { x: 0, y: 0 },        scale: { x: 1, y: 0.97 }, noise: baseNoise, ease: 'inQuad' },
                // Micro hop for organic feel
                { time: 0.54, position: { x: 0, y: -A3 },      scale: { x: 1, y: 1.02 }, noise: baseNoise, ease: 'outQuad' },
                // Clean settle at rest; loop here
                { time: DURATION, position: { x: 0, y: 0 },    scale: { x: 1.00, y: 1.00 }, noise: baseNoise, ease: 'inQuad', looping: true }
            ])
        }

        this.toplineAnim = {
            focus: UI.addAnimation(this.window.win, this.topLine, [
                { time: 0.0, colour:"#5fd1fa", ease: 'outQuad' },
                { time: 0.2, colour:"#5fd1fa33", ease: 'inQuad' },
                { time: 0.8, colour:"#5fd1fa", looping: true},
            ]),
            urgent: UI.addAnimation(this.window.win, this.topLine, [
                { time: 0.0, colour:"#fa5f5fff" },
                { time: 0.5, colour:"#00000000" },
                { time: 1.0, colour:"#fa5f5fff", looping: true},
            ])
        }

        this.focus(false);
    }

    focus (enabled)
    {
        if(!this.boxElement) return;

        UI.setEnabled(this.window.win, this.topLine, enabled || this.isUrgent);

        if(enabled)
        {
            this.isUrgent = false;
            UI.stopAnimation(this.window.win, this.boxElement);
            UI.startAnimation(this.window.win, this.topLine, this.toplineAnim.focus);
        }
    }

    destroy ()
    {
        if(!this.boxElement) return;
        UI.destroyElement(this.window.win, this.boxElement);
    }

    getMonitor ()
    {
        return this.workspace.monitor;
    }

    setUrgent ()
    {
        this.isUrgent = true;
        UI.setEnabled(this.window.win, this.topLine, true);
        UI.startAnimation(this.window.win, this.boxElement, this.boxAnim.urgent);
        UI.startAnimation(this.window.win, this.topLine, this.toplineAnim.urgent);
    }
}

class DisplayWindow
{
    constructor (display)
    {
        this.monitor = display;
        this.hideTimer = 0;
        this.visible = true;
    }

    createUI ()
    {
        // If it already exists, tear it down
        if(this.win)
        {
            Compositor.destroyWindow(this.win);
        }

        this.win = Compositor.createWindow({
            location: 'floating',
            anchor: 'bottom-left',
            height: 32,
            width: 500,
            display: this.monitor,
            keyboardInteractivity: 'none',
            acceptPointerEvents: false,
            msaaSamples: 4
        });

        this.root = UI.createElement(this.win, {
            layout: {
                type: 'flow-row',
                wrap: false,
                gap: { x: 1, y: 0 },
                padding: { t: 8, r: 4, b: 0, l: 4 },
                justify: 'left',
                align: 'left'
            }
        });
        UI.attachRoot(this.win, this.root);

        this.anim = {
            show: UI.addAnimation(this.win, this.root, [
                { time: 0.0, position: { x: 0, y: 24 }, ease: 'outQuad' },
                { time: 0.25, position: { x: 0, y: 0 } }
            ]),
            hide: UI.addAnimation(this.win, this.root, [
                { time: 0.0, position: { x: 0, y: 0 }, ease: 'outQuad' },
                { time: 0.25, position: { x: 0, y: 24 } }
            ])
        };
    }

    addCell (workspace)
    {
        return new WorkspaceCell(this, workspace);
    }

    show (locked = false)
    {
        if(!this.visible) UI.startAnimation(this.win, this.root, this.anim.show);
        this.visible = true;
        clearTimeout(this.hideTimer);

        if(!locked)
        {
            this.hideTimer = setTimeout(()=>{
                this.hide();
            }, 2000);
        }
    }

    hide ()
    {
        if(this.visible) UI.startAnimation(this.win, this.root, this.anim.hide);
        this.visible = false;
        clearTimeout(this.hideTimer);
    }
}

export class HyprWorkspaces
{
    constructor ()
    {
        this.displayWindow = {};
        this.workspaceCell = {};

        Hypr.on('createworkspace', async ({payload:workspace}) => {
            this.createWorkspace(workspace).catch((e)=>{
                Log.error(e.message);
                Log.debug(e.stack);
            });
        });

        Hypr.on('destroyworkspace', async ({payload:workspace}) => {
            this.removeWorkspace(workspace).catch((e)=>{
                Log.error(e.message);
                Log.debug(e.stack);
            });
        });

        Hypr.on('focusedmon', async ({payload}) => {
            const [monitor, workspace] = payload.split(',');
            this.switchTo(workspace).catch((e)=>{
                Log.error(e.message);
                Log.debug(e.stack);
            });
        });

        Hypr.on('workspace', async ({payload:workspace}) => {
            this.switchTo(workspace).catch((e)=>{
                Log.error(e.message);
                Log.debug(e.stack);
            });
        });

        Hypr.on('urgent', async ({payload: clientAddress}) => {
            const clients = await Hypr.json('clients');
            const window = clients.find(i=>i.address.includes(clientAddress));

            if(!this.workspaceCell[window.workspace.id]) return;

            const monitor = this.workspaceCell[window.workspace.id].getMonitor();

            if(!this.displayWindow[monitor]) return;
            this.displayWindow[monitor].show(true);
            this.workspaceCell[window.workspace.id].setUrgent();
        });

        this.buildWorkspaces().catch((e)=>{
            Log.error(e.message);
            Log.debug(e.stack);
        });
    }

    async switchTo (workspaceName)
    {
        for(const w of Object.values(this.workspaceCell)) w.focus(false);

        if(!this.workspaceCell[workspaceName])
        {
            Log.warn(`${workspaceName} does not exist.`);
            return;
        }

        this.workspaceCell[workspaceName].focus(true);
        for(const w of Object.values(this.displayWindow)) w.show();
    }

    async removeWorkspace (workspaceName)
    {
        if(this.workspaceCell[workspaceName])
        {
            this.workspaceCell[workspaceName].destroy();
            delete this.workspaceCell[workspaceName];
        }
    }

    async createWorkspace (workspaceName)
    {
        const workspaces = await Hypr.workspaces();
        const workspace = workspaces.find(i=>i.name == workspaceName);

        if(!this.workspaceCell[workspaceName])
        {
            this.workspaceCell[workspaceName] = this.displayWindow[workspace.monitor].addCell(workspace);
            this.workspaceCell[workspaceName].createUI();
        }
        await this.switchTo(workspaceName);
    }

    async buildWorkspaces ()
    {
        const workspaces = await Hypr.workspaces();

        for(const workspace of workspaces)
        {
            if(!this.displayWindow[workspace.monitor])
            {
                this.displayWindow[workspace.monitor] = new DisplayWindow(workspace.monitor);
                this.displayWindow[workspace.monitor].createUI();
                this.displayWindow[workspace.monitor].show();
            }

            if(this.workspaceCell[workspace.id])
            {
                this.removeWorkspace(workspace.id);
            }
            this.workspaceCell[workspace.id] = this.displayWindow[workspace.monitor].addCell(workspace);
            this.workspaceCell[workspace.id].createUI();
        }
    }
}