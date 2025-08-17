import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';
import * as Event from 'Koya/Event';
import * as Log from 'Koya/Log';
import * as Hypr from 'Module/hypr';

import { HyprWorkspaces } from './hypr/workspaces.js';
//import { NetworkManager } from './lib/NetworkManager.js';

const FONT = '/rom/font/Inter_24pt-Regular.ttf';
//const FONT = '/rom/font/DroidSansMNerdFont-Regular.otf';

export default function main()
{
	Hypr.connect();
	globalThis.workspaces = new HyprWorkspaces();

	const win = Compositor.createWindow({
		location: 'top',
		height: 24,
		msaaSamples: 4,
		keyboardInteractivity: 'none',
		acceptPointerEvents: false
	});

	Log.debug(JSON.stringify(Compositor.getWindowInfo(win),null,2));

    // Root
	const root = UI.createElement(win, {
		layout: { type: 'row', wrap: false, justifyContent: 'start', alignItems: 'center', size: { h: 24 } }
	});
	UI.attachRoot(win, root);

	// Left (fixed)
	const left = UI.createElement(win, {
		layout: {
			type: 'row',
			wrap: false,
			justifyContent: 'start',
			gap: {x:5},
			padding: { t: 2, r: 2, b: 2, l: 4 },
		},
		item: {
			preferredSize: { w: 120 }
		}
	});
	UI.attach(win, root, left);

	// Spacer L
	const spacerL = UI.createElement(win, { item: { flexGrow: 1 } });
	UI.attach(win, root, spacerL);

	// Middle (true centered, no grow)
	const middle = UI.createElement(win, { layout: { type: 'row', wrap: false, justifyContent: 'center', alignItems: 'center' } });
	UI.attach(win, root, middle);

	// Spacer R
	const spacerR = UI.createElement(win, { item: { flexGrow: 1 } });
	UI.attach(win, root, spacerR);

	// Right (fixed)
	const right = UI.createElement(win, { layout: { type: 'row', wrap: false, alignItems: 'center' }, item: { preferredSize: { w: 80 } } });
	UI.attach(win, root, right);


	const distroBadge = UI.createElement(win, {
		renderable: {
			type: 'sprite',
			texture: '/rom/image/arch.png',
			frames: [
				{
					size:{x:20,y:20},
					origin:{x:0,y:0},
					aabb:{ min:{x:0, y:0}, max:{x:128,y:128} }
				}
			]
		},
		item: {
			size:{w: 20, h: 20}
		},
		contentAlign: { x:'center', y: 'center' }
	});
	UI.attach(win, left, distroBadge);

	function formatTimeHHMM(d) {
		const h = String(d.getHours()).padStart(2, '0');
		const m = String(d.getMinutes()).padStart(2, '0');
		return `${h}:${m}`;
	}
	const timeText = UI.createElement(win, {
		renderable: {
			type: 'text',
			string: formatTimeHHMM(new Date()),
			size: 16,
			font: FONT,
			vAlign: 'begin',
			colour: '#1793D1'
		},
		contentAlign: { x: 'begin', y:'begin' },
		item: {
			size:{w: 30, h: 20}
		}
	});
	UI.attach(win, left, timeText);

	setInterval(async () => {
		UI.setTextString(win, timeText, formatTimeHHMM(new Date()));
	}, 1000);

	const titleText = UI.createElement(win, {
		renderable: {
			type: 'text',
			string: '',
			size: 16,
			colour: [1, 1, 1, 1],
			font: FONT,
			justify: "center",
			vAlign: 'start'
		},
		contentAlign: { y: 'start' },
		item: {
			preferredSize:{h:20}
		}
	});
	UI.attach(win, middle, titleText);


	Hypr.on('activewindow',({payload})=>{
		const [windowClass, windowTitle] = payload.split(',');
		UI.setTextString(win, titleText, windowTitle);
	});

	//globalThis.nm = new NetworkManager();

	/*
	(async () => {
		const overview = await globalThis.nm.getOverview();
		Log.debug(JSON.stringify(overview, null, 2));
	})();
	*/

	Event.on('cleanup', ()=>{
		Log.debug('close');
	});
}


