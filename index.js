import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';
import * as Event from 'Koya/Event';
import * as Log from 'Koya/Log';
import * as Hypr from 'Module/hypr';

import { HyprWorkspaces } from './hypr/workspaces.js';
import { Bar } from './bar/index.js';
import { Wallpaper } from './bar/wallpaper.js';

const FONT = '/rom/font/Inter_18pt-Regular.ttf';
const FONT_B = '/rom/font/Inter_18pt-Medium.ttf';
const ICON_FONT = '/rom/font/DroidSansMNerdFont-Regular.otf';

export default function main()
{
	Hypr.connect();
	globalThis.wallpaper = new Wallpaper({
		fadeTime: 1 // seconds
	});
	globalThis.wallpaper.changeTo('/rom/image/wallhaven-yxrkm7.png');

	// Demo of wallpaper cycling.
	// This could also be configured to change wallpaper based on workspace
	setTimeout(() => { globalThis.wallpaper.changeTo('/rom/image/wallhaven-gpelxl.jpg'); }, 30000);
	setTimeout(() => { globalThis.wallpaper.changeTo('/rom/image/wallhaven-yxrkm7.png'); }, 60000);

	globalThis.workspaces = new HyprWorkspaces({
		font: FONT,
		background: '#000000aa',
		colour: '#dddddd',
		highlight: ['#663399ff', '#66339933'],
		urgent:    ['#fa5f5fff', '#00000000']
	});

	globalThis.statusBar = new Bar({
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
	});
}


