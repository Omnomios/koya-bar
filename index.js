import * as Compositor from 'Koya/Compositor';
import * as UI from 'Koya/UserInterface';
import * as Event from 'Koya/Event';
import * as Log from 'Koya/Log';
import * as Hypr from 'Module/hypr';

import { HyprWorkspaces } from './hypr/workspaces.js';
import { NetworkManager } from './lib/NetworkManager.js';

export default function main()
{
	Hypr.connect();
	globalThis.workspaces = new HyprWorkspaces();

	globalThis.nm = new NetworkManager();

	(async () => {
		const overview = await globalThis.nm.getOverview();
		Log.debug(JSON.stringify(overview, null, 2));

		const aps = await globalThis.nm.listVisibleAccessPoints();
		Log.debug(JSON.stringify(aps, null, 2));

		return;
		const active = await globalThis.nm.getAllConnections();

		for(const identifier of active)
		{
			const connection = await globalThis.nm.getConnectionDetails(identifier.path);
			Log.debug(JSON.stringify(connection, null, 2));
		}


	})();

	Event.on('cleanup', ()=>{
		Log.debug('close');
	});
}


