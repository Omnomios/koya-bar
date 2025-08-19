import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';
import * as Event from 'Koya/Event';
import * as Log from 'Koya/Log';
import * as Hypr from 'Module/hypr';

import { HyprWorkspaces } from './hypr/workspaces.js';
import { TopBar } from './top-bar.js';

import * as network from './lib/NetworkManager.js';

const FONT = '/rom/font/Inter_18pt-Regular.ttf';
const FONT_B = '/rom/font/Inter_18pt-Medium.ttf';
//const FONT = '/rom/font/DroidSansMNerdFont-Regular.otf';

export default function main()
{
	Hypr.connect();

	globalThis.workspaces = new HyprWorkspaces({
		font: FONT,
		background: [0,0,0,0.75],
		colour: "#fff",
		highlight: ["#5fd1faff", "#5fd1fa33"],
		urgent:    ["#fa5f5fff", "#00000000"]
	});

	globalThis.topBar = new TopBar();

	const displays = Compositor.listDisplays().map(i=>i.display);


	return;
	const size = {w: 600, h: 48};

	const win = Compositor.createWindow({
		role: 'overlay',
		anchor: 'top',
		size,
		display: displays[0],
		keyboardInteractivity: 'none',
		acceptPointerEvents: false,
		msaaSamples: 4
	});

	const background = UI.createElement(win, {
		renderable: {
			type: 'box',
			aabb: { min: { x: 0, y: 0 }, max: {x: size.w, y: size.h} },
			cornerRadius: { bl: 20, br: 20},
			cornerResolution: { bl: 10, br: 10},
			colour: "#ffff"
		}
	});
	UI.attachRoot(win, background);

	const root = UI.createElement(win, {
		renderable: {
			type: 'box',
			aabb: { min: { x: 0, y: 0 }, max: {x: size.w, y: size.h} },
			cornerRadius: { bl: 20, br: 20},
			cornerResolution: { bl: 10, br: 10},
			colour: "#888",
			inset: 2
		},
		layout: {
			type: 'row',
			wrap: false,
			gap: 10,
			padding: { t: 10, r: 10, b: 10, l: 15 },
			justifyContent: 'begin',
			alignItems: 'center',
			size
		},
		child: [
			{
				id: 'connection-icon',
				renderable: {
					type: 'box',
					aabb: { min: { x: 0, y: 0 }, max: {x: 30, y: 30} },
					cornerRadius: 5,
					cornerResolution: 3,
					colour: "#f00"
				}
			},
			{
				id: 'connection-text',
				renderable: {
					type: 'box',
					aabb: { min: { x: 0, y: 0 }, max: {x: 24, y: 24} },
					cornerRadius: 5,
					cornerResolution: 3,
					colour: "#0f0"
				},
				item: {
					size: {w: 24, h: 24}
				}
			}
		]
	});
	UI.attach(win, background, root);

	const anim = {
		show: UI.addAnimation(win, background, [
			{ time: 0.0,  position: { x: 0, y: -size.h }, ease: 'outCubic' },
			{ time: 0.2,  position: { x: 0, y: -2 },      ease: 'inOutCubic'},
			{ time: 0.25, position: { x: 0, y: -5 },      ease: 'inCubic'}
		]),
		hide: UI.addAnimation(win, background, [
			{ time: 0.0, position: { x: 0, y: -5 }, ease: 'outCubic' },
			{ time: 0.5, position: { x: 0, y: -size.h } }
		]),
		hidden: UI.addAnimation(win, background, [
			{ time: 0, position: { x: 0, y: -size.h } }
		])
	};

	UI.startAnimation(win, background, anim.hidden);
	setTimeout(() => {
		UI.startAnimation(win, background, anim.show);
	}, 1000);

	(async () => {

		const connections = [];
		const modem = [
			await network.getModem(0).catch((e)=>{return false;}),
			await network.getModem(1).catch((e)=>{return false;})
		];

		/*
		network.activityMonitor((event) => {
			Log.debug(JSON.stringify(event, null, 2));
		});
		*/

		try
		{
			const allConnections = await network.getAllDeviceInfoIPDetail(false);
			//Log.debug(JSON.stringify(allConnections, null, 2));
			for(const connection of allConnections)
			{
			}

		}
		catch (e)
		{
			Log.error(e.message);
		}


	})();

	Event.on('cleanup', ()=>{
		Log.debug('close');
	});
}


