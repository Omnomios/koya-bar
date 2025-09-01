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

	globalThis.wallpaper = new Wallpaper({
		'*': '/rom/image/wallhaven-vggdol.jpg'
		/*
		'*': 'file:///home/user/nyan-cat-rainbow.gif'  // Look, just because you can, doesn't mean you should.
		*/
	});

	Hypr.connect();
	globalThis.workspaces = new HyprWorkspaces({
		font: FONT,
		background: '#424153ff',
		colour: '#dddddd',
		highlight: ['#663399ff', '#66339933'],
		urgent:    ['#fa5f5fff', '#00000000']
	});

	globalThis.statusBar = new Bar({
		monitor: '', // Defaults to primary
		thickness: 48,
		font: FONT_B,
		iconFont: ICON_FONT,
		background:     '#00000033',
		colour:         '#dddddd',
		disabledColour: '#444444',
		alertColour:    '#ff5511',
		clock: {
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
				todayDay:  '#000',
				weekText:  '#aaa',
				showISOWeek: false
			}
		},
		network: {
			showUnavailable: ['wifi']
		}
	});
}


