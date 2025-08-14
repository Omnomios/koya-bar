## Koya Bar — demo Waybar replacement

This folder contains a small demo bar built on top of Koya. It showcases a basic, real‑world use of Koya's compositor and UI APIs together with the Hyprland plugin. The bar pops up near the bottom‑left when workspaces change, animates, and auto‑hides.

### Quick start

1. Install Koya and the Hypr plugin.
   - See the Koya install docs and ensure the `hypr` native module is available to Koya.
2. Copy this repo into ~/.config/koya
3. Make sure the shaders are provided by the package or copy them into ~/.config/koya/shaders
4. Run Koya

Notes:
- Requires a Wayland session (e.g., Hyprland) and Vulkan drivers.
- The demo uses Hyprland IPC events via the `hypr` module.

### What you get

- Workspace strip with subtle hop animations
- Auto‑hide after a short delay; re‑appears on activity
- Urgency flash when a client on a workspace goes urgent
- Multi‑monitor aware (separate strip per monitor)

### Customize quickly

- Font: edit the `FONT` constant at the top of `hypr/workspaces.js` to point to a font on your system.
- Colours and sizes: tweak colour strings (e.g., `"#444"`, `"#5fd1fa"`) and dimensions in `WorkspaceCell` and `DisplayWindow`.
- Positioning: change the window creation options in `DisplayWindow.createUI()` (e.g., `location`, `anchor`, `width`, `height`).
- Hide timing: adjust the timeout in `DisplayWindow.show()`.

### File structure

- `index.js`: connects to Hyprland and instantiates the workspace UI.
- `hypr/workspaces.js`: UI layout, animations, and event handling.

### Build more

Use additional native modules (DBus, HTTP, Process, SQLite, WebSocket) to extend the bar with system metrics, network calls, or storage. See the plugins repository for small, focused examples.

— Powered by Koya
[koya-ui.com](https://www.koya-ui.com)


