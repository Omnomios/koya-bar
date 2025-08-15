import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';
import * as Event from 'Koya/Event';
import * as Log from 'Koya/Log';
import * as Hypr from 'Module/hypr';

import { HyprWorkspaces } from './hypr/workspaces.js';
import { NetworkManager } from './lib/NetworkManager.js';

const FONT = '/rom/font/DroidSansMNerdFont-Regular.otf';

export default function main()
{
	Hypr.connect();
	globalThis.workspaces = new HyprWorkspaces();

	const win = Compositor.createWindow({
		location: 'top',
		height: 24,
		keyboardInteractivity: 'none',
		acceptPointerEvents: false
	});

	Log.debug(JSON.stringify(Compositor.getWindowInfo(win),null,2));

	// Dark background
	Compositor.setClearColor(win, 0.08, 0.09, 0.10, 0.3);

// Root
	const root = UI.createElement(win, {
		layout: { type: 'row', wrap: false, justifyContent: 'start', alignItems: 'center', size: { h: 24 } }
	});
	UI.attachRoot(win, root);

	// Left (fixed)
	const left = UI.createElement(win, { layout: { type: 'row', wrap: false, alignItems: 'center' }, item: { preferredSize: { w: 120 } } });
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


	for(let i = 0; i < 3;i++)
	UI.attach(win, left, UI.createElement(win, {
		renderable: {
			type: 'box',
			aabb: { min: { x: 0, y: 0 }, max: { x: 22, y: 14 } },
			cornerRadius: 7,
			cornerResolution: 8,
			colour: [1, 1, 1, 1]
		},
	}));

	for(let i = 0; i < 3;i++)
	UI.attach(win, right, UI.createElement(win, {
		renderable: {
			type: 'box',
			aabb: { min: { x: 0, y: 0 }, max: { x: 22, y: 14 } },
			cornerRadius: 7,
			cornerResolution: 8,
			colour: [1, 1, 1, 1]
		},
	}));


	const textId = UI.createElement(win, {
		renderable: {
			type: 'text',
			string: 'hello koya',
			size: 14,
			colour: [1, 1, 1, 1],
			font: FONT
		},
		contentAlign: { y: 'center' }
	});
	UI.attach(win, middle, textId);

	/*
	globalThis.nm = new NetworkManager();

	(async () => {
		const overview = await globalThis.nm.getOverview();
		Log.debug(JSON.stringify(overview, null, 2));

	})();
	*/

	Event.on('cleanup', ()=>{
		Log.debug('close');
	});
}


