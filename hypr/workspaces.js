import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';
import * as Log from 'Koya/Log';
import * as Hypr from 'Module/hypr';

class WorkspaceCell
{
    constructor (window, workspace, config = {})
    {
        this.config = config;
        this.size = {x:26, y:24};
        this.window = window;
        this.workspace = workspace;
        this.isUrgent = false;
        this.isFocussed = false;
    }

    async createUI ()
    {
        // If it already exists, nuke it.
        if(this.boxElement)
        {
            await this.destroy();
        }

        const textId = await UI.createElement(this.window.win, {
            renderable: {
                type: 'text',
                string: `${this.workspace.name}`,
                size: 12,
                colour: this.config.colour,
                font: this.config.font,
                vAlign: 'center'
            },
            item: {
                size: { x: this.size.x, y: this.size.y }
            },
            contentAlign: { x: 'center', y: 'center' },
            contentPositioning: 'contain'
        });

        this.boxElement = await UI.createElement(this.window.win, {
            renderable: {
                type: 'box',
                aabb: { min: { x: 0, y: 0 }, max: {x: this.size.x, y: this.size.y} },
                cornerRadius: [2,2,0,0],
                cornerResolution: 2,
                colour: this.config.background,
            },
            item: {
                size: {x: this.size.x, y: this.size.y},
                order: parseInt(this.workspace.id)
            }
        });
        await UI.attach(this.window.win, this.boxElement, textId);

        this.topLine = await UI.createElement(this.window.win, {
            renderable: {
                type: 'box',
                aabb: { min: { x: 0, y: 0 }, max: { x: this.size.x, y: 4 } },
                cornerRadius: [2,2,0,0],
                cornerResolution: 2,
                colour: this.config.highlight[0]
            },
            item: { size: { x: this.size.x, y: 4 } }
        });
        await UI.attach(this.window.win, this.boxElement, this.topLine);
        await UI.attach(this.window.win, this.window.root, this.boxElement);

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
            urgent: await UI.addAnimation(this.window.win, this.boxElement, [
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
            focus: await UI.addAnimation(this.window.win, this.topLine, [
                { time: 0.0, colour:this.config.highlight[0], ease: 'outQuad' },
                { time: 0.2, colour:this.config.highlight[1], ease: 'inQuad' },
                { time: 0.8, colour:this.config.highlight[0], looping: true},
            ]),
            urgent: await UI.addAnimation(this.window.win, this.topLine, [
                { time: 0.0, colour:this.config.urgent[0] },
                { time: 0.5, colour:this.config.urgent[1] },
                { time: 1.0, colour:this.config.urgent[0], looping: true},
            ])
        }

        await this.focus(false);
    }

    async focus (enabled)
    {
        if(!this.boxElement) return;

        this.isFocussed = enabled;
        await UI.setEnabled(this.window.win, this.topLine, enabled || this.isUrgent);

        if(enabled && this.toplineAnim)
        {
            this.isUrgent = false;
            await UI.stopAnimation(this.window.win, this.boxElement);
            await UI.startAnimation(this.window.win, this.topLine, this.toplineAnim.focus);
        }
    }

    async destroy ()
    {
        if(!this.boxElement) return;
        await UI.destroyElement(this.window.win, this.boxElement);
    }

    getMonitor ()
    {
        return this.workspace.monitor;
    }

    async setUrgent ()
    {
        // If they're already on the workspace don't bother
        if(this.isFocussed) return;

        this.isUrgent = true;
        await UI.setEnabled(this.window.win, this.topLine, true);
        await UI.startAnimation(this.window.win, this.boxElement, this.boxAnim.urgent);
        await UI.startAnimation(this.window.win, this.topLine, this.toplineAnim.urgent);
    }
}

class DisplayWindow
{
    constructor (display, config = {})
    {
        this.config = config;
        this.monitor = display;
        this.hideTimer = 0;
        this.visible = true;
    }

    async createUI ()
    {
        // If it already exists, tear it down
        if(this.win) await Compositor.destroyWindow(this.win);

        this.win = await Compositor.createWindow({
            namespace: 'koya',
            role: 'overlay',
            anchor: 'bottom-left',
            size: {x: 250, y: 32},
            display: this.monitor,
            keyboardInteractivity: 'none',
            acceptPointerEvents: false,
            msaaSamples: 4
        });

        this.root = await UI.createElement(this.win, {
            layout: {
                type: 'row',
                wrap: false,
                gap: { x: 1, y: 0 },
                padding: { t: 8, r: 4, b: 0, l: 4 },
                justifyContent: 'start',
                alignItems: 'start'
            }
        });
        await UI.attachRoot(this.win, this.root);

        this.anim = {
            show: await UI.addAnimation(this.win, this.root, [
                { time: 0.0, position: { x: 0, y: 32 }, ease: 'outQuad' },
                { time: 0.25, position: { x: 0, y: 0 } }
            ]),
            hide: await UI.addAnimation(this.win, this.root, [
                { time: 0.0, position: { x: 0, y: 0 }, ease: 'outQuad' },
                { time: 0.25, position: { x: 0, y: 32 } }
            ])
        };

        // Put the window to sleep when the animation is done.
        await UI.onAnimationEnd(this.win, this.root, this.anim.hide, () => {
            Compositor.setWindowRenderingEnabled(this.win, false).catch(() => {});
        });
    }

    addCell (workspace)
    {
        return new WorkspaceCell(this, workspace, this.config);
    }

    async show (locked = false)
    {
        if(!this.visible)
        {
            await Compositor.setWindowRenderingEnabled(this.win, true);
            await UI.startAnimation(this.win, this.root, this.anim.show);
        }
        this.visible = true;
        clearTimeout(this.hideTimer);

        if(!locked)
        {
            this.hideTimer = setTimeout(()=>{
                this.hide().catch(() => {});
            }, 2000);
        }
    }

    async hide ()
    {
        if(this.visible) await UI.startAnimation(this.win, this.root, this.anim.hide);
        this.visible = false;
        clearTimeout(this.hideTimer);
    }
}

export class HyprWorkspaces
{
    constructor (config)
    {
        this.config = config;
        this.displayWindow = {};
        this.workspaceCell = {};
    }

    static async create (config)
    {
        const workspaces = new HyprWorkspaces(config);
        await workspaces.init();
        return workspaces;
    }

    async init ()
    {
        Hypr.on('createworkspace', ({payload:workspace}) => {
            this.createWorkspace(workspace).catch((e)=>{
                Log.error(e.message);
                Log.debug(e.stack);
            });
        });

        Hypr.on('destroyworkspace', ({payload:workspace}) => {
            this.removeWorkspace(workspace).catch((e)=>{
                Log.error(e.message);
                Log.debug(e.stack);
            });
        });

        Hypr.on('focusedmon', ({payload}) => {
            const [monitor, workspace] = payload.split(',');
            this.switchTo(workspace).catch((e)=>{
                Log.error(e.message);
                Log.debug(e.stack);
            });
        });

        Hypr.on('workspace', ({payload:workspace}) => {
            this.switchTo(workspace).catch((e)=>{
                Log.error(e.message);
                Log.debug(e.stack);
            });
        });

        Hypr.on('urgent', async ({payload: clientAddress}) => {
            const clients = await Hypr.json('clients');
            const window = clients.find(i=>i.address.includes(clientAddress));
            if(!window) return;

            if(!this.workspaceCell[window.workspace.id]) return;

            const monitor = this.workspaceCell[window.workspace.id].getMonitor();

            if(!this.displayWindow[monitor]) return;
            await this.displayWindow[monitor].show(true);
            await this.workspaceCell[window.workspace.id].setUrgent();
        });

        await this.buildWorkspaces();
    }

    async switchTo (workspaceName)
    {
        for(const w of Object.values(this.workspaceCell))
        {
            await w.focus(false);
        }

        if(!this.workspaceCell[workspaceName]) return;

        await this.workspaceCell[workspaceName].focus(true);
        for(const w of Object.values(this.displayWindow))
        {
            await w.show();
        }
    }

    async removeWorkspace (workspaceName)
    {
        if(this.workspaceCell[workspaceName])
        {
            await this.workspaceCell[workspaceName].destroy();
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
            await this.workspaceCell[workspaceName].createUI();
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
                this.displayWindow[workspace.monitor] = new DisplayWindow(workspace.monitor, this.config);
                await this.displayWindow[workspace.monitor].createUI();
                await this.displayWindow[workspace.monitor].show();
            }

            if(this.workspaceCell[workspace.id])
            {
                await this.removeWorkspace(workspace.id);
            }
            this.workspaceCell[workspace.id] = this.displayWindow[workspace.monitor].addCell(workspace);
            await this.workspaceCell[workspace.id].createUI();
        }
    }
}
