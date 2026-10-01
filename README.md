## Koya Bar — demo Waybar replacement

This folder contains a small demo bar built on top of Koya. It showcases a basic, real‑world use of Koya's compositor and UI APIs together with the Hyprland plugin. The bar pops up near the bottom‑left when workspaces change, animates, and auto‑hides.

Left hand status bar features a clock, with popout calendar, battery indicator, and network status icons.

This is intended to be a jump off point for others to build feature rich and visualy pleasing status bars. It'll be a best-effort implementation using Koya's primatives and allow something to work out-of-the-box when evaluating Koya as a UI/Shell tool.

This project is WIP.

### Quick start

1. Install **Koya 0.5.3 or newer** and matching `hypr`, `dbus`, and `ffmpeg` native plugins.
   - See the [Koya install docs](https://developer.koya-ui.com/install/index.html).
   - Use Helix ABI plugins named `libhx-hypr.so`, `libhx-dbus.so`, and `libhx-ffmpeg.so`; rebuild older `libsm-*` plugins with the current [plugin SDK](https://github.com/Omnomios/helix-plugins).
2. Run from this repository with an explicit asset mount and plugin directory:

   ```sh
   koya -m . -n /path/to/plugins -i index.js
   ```

   If the plugins are installed beside the Koya executable, omit `-n`. To use `~/.config/koya` instead, copy the repository there and run `koya -m ~/.config/koya -i index.js`.

Notes:
- Requires a Wayland session (e.g., Hyprland) and Vulkan drivers.
- The demo uses Hyprland IPC events via the `hypr` module.
- Battery, network, and power profile status use the system DBus with UPower, NetworkManager, and power-profiles-daemon respectively.
- Shared UI and logging APIs use `Helix/UserInterface` and `Helix/Log`; Wayland window management remains in `Koya/Compositor`. Native plugin imports remain `Module/<name>`.

### What you get

- Workspace strip with subtle hop animations
- Auto‑hide after a short delay; re‑appears on activity
- Urgency flash when a client on a workspace goes urgent
- Multi‑monitor aware (separate strip per monitor)

### Customize quickly

All customisation is exposed via a config object in index.js

```js
	globalThis.wallpaper = await Wallpaper.create({
		fadeTime: 1 // seconds
	});
	await globalThis.wallpaper.changeTo('/rom/image/wallhaven-yxrkm7.png');

	// Demo of wallpaper cycling.
	// This could also be configured to change wallpaper based on workspace
	setTimeout(() => { globalThis.wallpaper.changeTo('/rom/image/wallhaven-gpelxl.jpg'); }, 30000);
	setTimeout(() => { globalThis.wallpaper.changeTo('/rom/image/wallhaven-yxrkm7.png'); }, 60000);

	globalThis.workspaces = await HyprWorkspaces.create({
		font: FONT,
		background: '#424153ff',
		colour: '#dddddd',
		highlight: ['#dcbdfaff', '#66339933'],
		urgent:    ['#fa5f5fff', '#00000000']
	});

	globalThis.statusBar = await Bar.create({
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

### Compatibility checks

Run `node --experimental-vm-modules --test tests/*.test.mjs` to exercise the bar against Koya 0.5.3 API doubles, including typed DBus replies/signals, complex argument marshalling, numeric wallpaper geometry, and video stream cleanup. These checks require Node.js 18+; the bar itself runs in Koya's QuickJS runtime. Validate rendering and desktop interaction in a Hyprland session with the matching native plugins.

— Powered by Koya
[koya-ui.com](https://www.koya-ui.com)

