import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';
import * as Log from 'Koya/Log';
import * as Hypr from 'Module/hypr';

import { HyprWorkspaces } from './hypr/workspaces.js';

export default function main()
{
	Hypr.connect();
	globalThis.workspaces = new HyprWorkspaces();
}


