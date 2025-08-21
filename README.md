## Koya Bar — demo Waybar replacement

This folder contains a small demo bar built on top of Koya. It showcases a basic, real‑world use of Koya's compositor and UI APIs together with the Hyprland plugin. The bar pops up near the bottom‑left when workspaces change, animates, and auto‑hides.

Left hand status bar features a clock, with popout calendar and network status icons.

This project is WIP.

### Quick start

1. Install Koya and the Hypr plugin.
   - See the Koya install docs and ensure the `hypr` native module is available to Koya.
2. Copy this repo into ~/.config/koya
3. Run Koya

Notes:
- Requires a Wayland session (e.g., Hyprland) and Vulkan drivers.
- The demo uses Hyprland IPC events via the `hypr` module.

### What you get

- Workspace strip with subtle hop animations
- Auto‑hide after a short delay; re‑appears on activity
- Urgency flash when a client on a workspace goes urgent
- Multi‑monitor aware (separate strip per monitor)

### Customize quickly

All customisation is exposed via a config object in index.js

```js
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
		colour:         '#ffffff',
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
```

### Build more

Use additional native modules (DBus, HTTP, Process, SQLite, WebSocket) to extend the bar with system metrics, network calls, or storage. See the plugins repository for small, focused examples.

— Powered by Koya
[koya-ui.com](https://www.koya-ui.com)


