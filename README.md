## Koya Bar — demo Waybar replacement

This folder contains a small demo bar built on top of Koya. It showcases a basic, real‑world use of Koya's compositor and UI APIs together with the Hyprland plugin. The bar pops up near the bottom‑left when workspaces change, animates, and auto‑hides.

Left hand status bar features a clock, with popout calendar, battery indicator, and network status icons.

This is intended to be a jump off point for others to build feature rich and visualy pleasing status bars. It'll be a best-effort implementation using Koya's primatives and allow something to work out-of-the-box when evaluating Koya as a UI/Shell tool.

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
		background: '#424153ff',
		colour: '#dddddd',
		highlight: ['#dcbdfaff', '#66339933'],
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
```

### Build more

Use additional native modules (DBus, HTTP, Process, SQLite, WebSocket) to extend the bar with system metrics, network calls, or storage. See the plugins repository for small, focused examples.

— Powered by Koya
[koya-ui.com](https://www.koya-ui.com)


