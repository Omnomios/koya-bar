import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';
import * as Event from 'Koya/Event';
import * as Log from 'Koya/Log';
import * as Hypr from 'Module/hypr';

import { HyprWorkspaces } from './hypr/workspaces.js';
import { Bar } from './bar/index.js';

const FONT = '/rom/font/Inter_18pt-Regular.ttf';
const FONT_B = '/rom/font/Inter_18pt-Medium.ttf';
const ICON_FONT = '/rom/font/DroidSansMNerdFont-Regular.otf';

export default function main()
{
	Hypr.connect();

	globalThis.workspaces = new HyprWorkspaces({
		font: FONT,
		background: [0,0,0,0.75],
		colour: '#fff',
		highlight: ['#5fd1faff', '#5fd1fa33'],
		urgent:    ['#fa5f5fff', '#00000000']
	});

	globalThis.topBar = new Bar({
		thickness: 48,
		font: FONT_B,
		iconFont: ICON_FONT,
		colour: '#fff',
		alertColour: '#ff5511',
	});

	const displays = Compositor.listDisplays().map(i=>i.display);

	Event.on('cleanup', ()=>{
		Log.debug('close');
	});
}


