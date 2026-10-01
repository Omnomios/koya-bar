import * as Hypr from 'Module/hypr';
import * as Log from 'Helix/Log';

import { HyprWorkspaces } from './hypr/workspaces.js';
import { Bar } from './bar/index.js';
import { Wallpaper } from './bar/wallpaper.js';

const FONT = '/rom/font/Inter_18pt-Regular.ttf';
const FONT_B = '/rom/font/Inter_18pt-Medium.ttf';
const ICON_FONT = '/rom/font/DroidSansMNerdFont-Regular.otf';

async function setup ()
{
	Hypr.connect();
	const workspaceConfig = {
		font: FONT,
		background: '#000000aa',
		colour: '#dddddd',
		highlight: ['#663399ff', '#66339933'],
		urgent:    ['#fa5f5fff', '#00000000']
	};

	const barConfig = {
		monitor: '', // Defaults to primary
		thickness: 48,
		font: FONT_B,
		fontLight: FONT,
		iconFont: ICON_FONT,
		background:     '#00000033',
		colour:         '#dddddd',
		disabledColour: '#444444',
		alertColour:    '#ff5511',
		clock: {
			order: 100,
			// dayjs format string
			shortTime: 'HH:mm',
			longTime:  'HH:mm:ss',
			shortDate: 'ddd Do MMM',
			longDate:  'dddd Do MMMM',

			calendar:{
				emptyCell:  '#ffffff0a',
				normalCell: '#ffffff22',
				todayCell:  '#663399ff',
				normalDay: '#fff',
				todayDay:  '#dcbdfaff',
				weekText:  '#aaa',
				showISOWeek: false
			}
		},
		network: {
			order: 0,
			showUnavailable: ['wifi']
		},
		battery: {
			order: 1
		}
	};

	// Prioritize bar creation so something is visible quickly.
	globalThis.statusBar = await Bar.create(barConfig);

	// Start heavier subsystems in the background.
	Wallpaper.create({ fadeTime: 1 })
		.then(async (wallpaper) => {
			globalThis.wallpaper = wallpaper;
			await wallpaper.changeTo('/rom/image/wallhaven-yxrkm7.png');

			// Demo of wallpaper cycling.
			// This could also be configured to change wallpaper based on workspace
			setTimeout(() => {
				wallpaper.changeTo('/rom/image/wallhaven-gpelxl.jpg').catch(() => {});
			}, 30000);
			setTimeout(() => {
				wallpaper.changeTo('/rom/image/wallhaven-yxrkm7.png').catch(() => {});
			}, 60000);
		})
		.catch((e) => {
			Log.error(e?.message || String(e));
		});

	HyprWorkspaces.create(workspaceConfig)
		.then((workspaces) => {
			globalThis.workspaces = workspaces;
		})
		.catch((e) => {
			Log.error(e?.message || String(e));
		});
}

export default function main()
{
	setup().catch((e) => {
		Log.error(e?.message || String(e));
		if(e?.stack) Log.debug(e.stack);
	});
}


