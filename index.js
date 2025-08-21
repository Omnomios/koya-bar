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

	globalThis.statusBar = new Bar({
		monitor: '', // Defaults to primary
		thickness: 48,
		font: FONT_B,
		iconFont: ICON_FONT,
		background: [0,0,0,0.5],
		colour: '#fff',
		alertColour: '#ff5511',
		clock: {
			// dayjs format string
			shortTime: 'HH:mm',
			longTime:  'HH:mm:ss',
			shortDate: 'ddd Do MMM',
			longDate:  'dddd Do MMMM',

			calendar:{
				emptyCell:  '#ffffff0a',
				normalCell: '#ffffff22',
				todayCell:  '#5fd1faff',
				normalDay: '#fff',
				todayDay:  '#000',
				weekText:  '#aaa',
				showISOWeek: true
			}
		},
		network: {
			showUnavailable: ['wifi']
		}
	});
}


