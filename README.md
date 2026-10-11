# Koya Desktop Shell

A desktop adaptation of the phone-first interface in `../koya-shell`. It uses
Koya's green surfaces, cream text, orange accents, Inter fonts, artwork and
animations, with separate apps for launching applications, settings, Wi-Fi and
locking the session.

The status shell provides a top bar with clock, network and laptop battery
status, volume controls and notifications. Notifications include banners,
actions, dismissal and history. The compact notification panel opens on the
clicked monitor. Each monitor gets a wallpaper and top bar.
There is no bottom bar or desktop picker; Hyprland controls normal window and
workspace behavior.

Every interactive surface sets its cursor explicitly: the default arrow on
backgrounds, a hand on buttons and actionable rows, a text cursor on input
fields, and a horizontal resize cursor on the volume slider. Captured dragging
keeps its cursor until release or cancellation; hiding or closing a popup
restores the arrow. Touch interactions do not change the mouse cursor.

The top bar's fish icon is derived from the official Koya brochure artwork.
Its transparent orange-and-cream treatment is generated for small-size display;
the reference and generation prompt are in `assets/brand/koya-fish.prompt.txt`.

## Run

Use Koya **0.6.0 or newer** and matching Helix `dbus`, `hypr` and `process` plugins.
The lock app also requires the `pam` plugin and compositor session-lock support.
The DBus plugin must provide explicit `session` and `system` handles and directed
notification signals. A Linux Wayland session, Hyprland and Vulkan drivers are
required.

Install Meson, Ninja, a C++17 compiler and the `gio-unix-2.0` development library,
then run:

```bash
KOYA_BIN=/path/to/koya \
KOYA_PLUGIN_DIR=/path/to/plugins \
KOYA_ASSET_DIR=/path/to/koya/assets \
./run.sh
```

When Koya and its plugins are installed in standard locations, the environment
variables can be omitted. `KOYA_ASSET_DIR` is optional when Koya supplies its
shared assets. The runner builds the native desktop-entry, icon and settings
plugin in `build/`. Use the same environment variables for the app commands below.

To start the status shell with Hyprland, add an `exec-once` entry for the absolute
path to `run.sh`. Run one instance per session and stop any existing bar or
wallpaper service to avoid overlapping surfaces.

Settings, Wi-Fi, the launcher, popups and banners are centred or anchored
layer-shell overlays with translucent surfaces; they do not paint the
wallpaper themselves. Enable Hyprland's blur behind them with a layer rule
(without one they stay nearly opaque):

```
layerrule = blur, ^koya-
layerrule = ignorezero, ^koya-
```

Settings adds wallpapers through the desktop portal's file chooser. Overlays
stack above every window, so Settings hides while the chooser is open; float
the chooser so it opens as a dialog rather than a tile:

```
windowrule = float, class:^(xdg-desktop-portal-gtk)$
```

NetworkManager supplies network status and Wi-Fi configuration; UPower supplies
battery status. The battery indicator is hidden on desktops without a battery.
PulseAudio or PipeWire's PulseAudio compatibility server and `pactl` supply
volume controls. Network changes use your session's existing polkit agent.

## Replace `rofi -show drun`

Run the standalone application picker:

```bash
./launcher.sh
```

Replace your existing rofi binding with the absolute launcher path, for example:

```ini
bind = SUPER, D, exec, /home/user/projects/koya-bar/launcher.sh
```

The picker opens on the focused monitor. Type to filter installed `.desktop`
entries by application name, generic name, keywords, descriptions or executable.
Search ignores case and accents, and accepts fuzzy matches. Use **Up/Down** or
**Tab** to select, **Page Up/Down** to move through results, **Enter** to launch,
and **Escape** to close. Click a result to launch it with the mouse.

**Left/Right**, **Home/End**, **Backspace** and **Delete** edit the query.
**Ctrl+U** clears it, **Ctrl+W** removes the previous word, and **Ctrl+A/Ctrl+E**
move to the start/end. Your desktop input method supplies text composition.

The picker respects desktop visibility and `TryExec`, includes terminal entries,
and launches through GIO's standard desktop-entry handling, including Exec field
codes and DBus activation. It does not switch, allocate or reserve workspaces.
Icon rendering happens for visible results so discovery does not wait for every
installed icon. A second invocation while the picker is open is ignored.

## Settings and Wi-Fi desktop entries

Meson generates regular `build/koya-settings.desktop` and
`build/koya-wifi.desktop` files. The picker discovers them in this checkout. To
make them available to other launchers and desktop menus, install them:

```bash
./install-desktop-entries.sh
```

The installer writes to `${XDG_DATA_HOME:-~/.local/share}/applications`, or to the
directory supplied as its first argument. Entries use absolute paths to this
checkout; rerun the installer after moving it. They invoke `settings.sh` and
`wifi.sh`, which launch ordinary desktop windows.

The default wallpaper is a copy of Waypaper's current selection,
`Nocturne-of-Steel-and-Glass.png`. Settings also offers the four phone-shell
wallpapers. Changes apply
immediately and are saved atomically in
`${XDG_CONFIG_HOME:-~/.config}/koya-bar/settings.json`.

The top bar shows local time followed by the local date in ISO `YYYY-MM-DD`
format. Settings → Date & time offers 24/12-hour time, show date and show
seconds. Defaults are 24-hour time, date visible and seconds hidden. The top bar,
Settings previews and lock screen use the same format and local calendar on every
output. Changes apply immediately to the bar; the independent lock app reads the
saved settings on startup and refreshes them while locked.

The top bar's speaker reflects the default audio output's volume and mute
status, including changes made with keyboard shortcuts. Click it to open a
horizontal 0–100% slider beneath the icon on that monitor. Click or drag the
slider to set the volume; click the speaker inside the popup to toggle mute.
Choosing a nonzero volume also unmutes. Click outside or press Escape to close.
Volume has no customization options. Notifications stay in
memory until the status shell exits.

Notifications sit at the top-right beneath the bell, 300 px wide, with a 10 px
inset from the right edge and below the bar. Banners shrink to fit up to a maximum height of 100 px and up to
five are shown together, with a five-second display timeout. The bell opens a
compact history panel in the same position, with actions, dismissal, clear-all
and paging. Press Escape or click its close button to dismiss the panel.

Click the network icon in the bar for the current connection summary. It shows
Internet connectivity, connection name, interface and IP addresses, plus Wi-Fi
signal and security when available. The summary updates as the connection
changes. **Configure Wi-Fi** opens the existing Wi-Fi app for scanning, joining,
disconnecting and managing saved networks. Click outside or press Escape to
close the summary. Network information is separate from notifications.

## SSH keys on first use

Koyabar starts a small socket proxy for the existing OpenSSH agent. It discovers
matching private key and `.pub` files directly inside `~/.ssh`, advertises their
public keys, and runs `ssh-add` when a client first requests a signature with an
unloaded key. Koya shows a centered, masked passphrase dialog; Enter or **Unlock**
submits, and Escape or **Cancel** cancels that request. Wrong passphrases can be
retried. Simultaneous requests for the same key share its initial load.

The encrypted originals stay in `~/.ssh`. Only `ssh-add` reads/decrypts them;
unlocked keys live in the existing OpenSSH agent's memory. Koya creates no key
or passphrase database and saves no passphrases. Already loaded keys retain
their lifetime, confirmation and destination restrictions. A removed or expired
key can prompt again on its next use. The proxy scans again as keys change.

Configure Hyprland to send SSH clients through the proxy, keeping the upstream
socket separate:

```lua
hl.env("KOYA_SSH_UPSTREAM", os.getenv("XDG_RUNTIME_DIR") .. "/ssh-agent.socket")
hl.env("SSH_AUTH_SOCK", os.getenv("XDG_RUNTIME_DIR") .. "/koya-ssh/agent.sock")
local sshAgent = koyaRoot .. "/ssh-add.sh"
```

Keep the existing OpenSSH agent service/socket enabled. Ensure shell startup
files retain the proxy address rather than resetting it to the upstream socket.
After changing session configuration, restart Koyabar and open a new terminal
with the proxy `SSH_AUTH_SOCK`. Existing applications retain their old environment.
All agent-backed requests through the proxy, including requests for already
loaded keys, require Koyabar to be running. Closing the shell stops the proxy and
leaves OpenSSH and its loaded keys running, but the proxy socket is unavailable
until Koyabar starts again. Terminals can be launched directly by Hyprland; they
reach the proxy through the inherited socket address rather than their parent
process. Closing Koyabar does not terminate those terminals or their SSH connections.

For a manual load (including keys elsewhere), use `./ssh-add.sh [ssh-add options
or key paths]`. With no arguments it loads OpenSSH's usual default keys; Super+U
can invoke this command. It forces Koya askpass even when launched from a
terminal. Ordinary `ssh-add` can still be used for terminal prompts and key
administration through the proxy. Lock/unlock the agent through the proxy so it
can suppress automatic loading while locked; locks performed directly on the
upstream socket or before starting the proxy cannot be detected by this protocol.

Only paired files directly in `~/.ssh` are discovered automatically; custom
`IdentityAgent` settings and applications pointing at a different socket bypass
Koya. SSH options controlling which identities are offered still apply.

The proxy and askpass sockets are private to the current user under
`$XDG_RUNTIME_DIR/koya-ssh/`. Prompts travel over the backend's private stdout
pipe, answers over its stdin pipe. Disconnects, cancellation and shell exit
unblock outstanding requests. No GNOME keyring, GCR or GnuPG key store is used;
the helper uses the GIO library already required by the desktop plugin.

## Lock from hypridle

Run the lock app with:

```bash
./lock.sh
```

The app creates compositor session-lock surfaces for every output, follows
output changes and authenticates the current Unix account through PAM. Enter
your password and press Enter or click Unlock. Escape clears the field. It
releases the compositor lock only after PAM confirms authentication and the
compositor still reports a confirmed lock. It runs independently of the status
shell and Settings.

`KOYA_PAM_SERVICE` selects the PAM service; the default is `login`, which checks
both authentication and account policy. A custom service must include both
`auth` and `account` rules. The existing `hyprlock` PAM file on some systems has
only `auth` rules and is insufficient for this plugin's account check.

Meson generates `build/hypridle.example.conf` with this checkout's absolute lock
command. Merge its `lock_cmd`, sleep hook and idle listener into your existing
hypridle configuration, keeping your preferred DPMS behavior. The example uses
`loginctl lock-session` so hypridle invokes `lock.sh` for both idle and logind
lock requests. Run hypridle normally in your graphical session. Repeated lock
requests use a process lock to avoid competing lock applications.

## Develop and test

UI and controllers live in `apps/`, visual assets in `assets/`, and native
integration in `native/modules/`. `index.js` starts the status shell. The original
artwork and fonts remain in `image/` and `font/` as optional assets; the demo's
bar, workspace strip and Day.js code have been removed. The notification and
Wi-Fi interfaces, shared controls, fonts and artwork were
adapted from the local `koya-shell` checkout. The bundled Inter license is in
`assets/fonts/OFL-Inter.txt`.

Password fields in Wi-Fi, the lock screen and the SSH prompt use Koya's standard
`InputText` control with `password: true`. The shell supplies the visuals; the
standard control owns caret blinking, focus, Unicode editing, arrow/Home/End
navigation, deletion, paste and horizontal scrolling. Password mode masks both
committed and composing text, suppresses clipboard copy/cut and never supplies
surrounding text to input methods. Wi-Fi's explicit Show action retains those
privacy rules. Submitted SSH/lock values and destroyed controls are cleared.

Development runs automatically mount `../helix/koya-base/assets` when
`KOYA_ASSET_DIR` is unset. Other installations should supply matching standard
assets with password-enabled `InputText` through `KOYA_ASSET_DIR` or the runtime's
packaged assets.

UI calls cross from the script thread to the render thread. Queue independent
creation, setup and animation calls with `Promise.all`, then await the batch
before using its returned element or animation ids. Shared controls accept
`null` as their parent to build detached; `children()` builds siblings together
and queues their attachments in authored order, preserving layout and drawing
order even when promises finish in a different order. Keep text measurement
after text updates, and retain rendering and input lifecycle ordering.

Run model, SSH prompt queue, launcher editing, lock-policy, cursor lifecycle and UI batching tests:

```bash
npm test
```

The UI batching test runs the real builders against a simulated native queue
with replies delivered in reverse order. It checks dependency batches and
element order across the bar, popups, notifications, launcher, Settings,
Wi-Fi, lock form and SSH passphrase dialog without opening windows or authenticating.

Build and run isolated native integration tests:

```bash
meson setup build
meson compile -C build
meson test -C build
KOYA_BIN=/path/to/koya KOYA_PLUGIN_DIR=/path/to/plugins bash tests/run.sh
```

The SSH proxy test creates an isolated OpenSSH agent and newly generated encrypted
fixture keys. It checks real signature verification, first use, retries, cancellation,
concurrent requests, retained confirmation restrictions, agent locking and shutdown.
It never uses the session agent or personal keys.

The other native tests use a private DBus and temporary XDG directories. They exercise
native desktop-entry discovery and launches, metadata, icon caching, settings
persistence, notification calls and network connection updates without changing
desktop settings. A
simulated audio server checks volume, mute, channel balance, output changes
and subscription updates. Lock
policy tests use simulated authentication; they do not submit real passwords.

For a rendering check with a working headless Hyprland backend and GPU:

```bash
KOYA_BIN=/path/to/koya bash tests/render.sh
```

This exercises picker keyboard input and writes `.work/launcher.png`.

## Koya 0.6.0 input migration

The shell uses virtual mouse/touch interactions: `onActivate` for clicks and
taps, `onPress` for visual held state, and `onDrag` for captured slider movement.
Each held interaction is tracked by its opaque `interactionId`. Releasing one
contact preserves another held contact, and `cancel` clears feedback without
running an action. The volume slider continues outside its bounds, clamps to
0–100%, and ignores canceled or destroyed interactions. Keyboard and text input
continue to use their existing event APIs.

The runner rejects Koya versions older than 0.6.0. Read the source migration
guide in `../helix/koya-base/docs/json/migration-0.5.0-to-0.6.0.json` when updating
additional controls. The desktop plugin does not use the removed native mouse
callbacks; its bundled plugin ABI and QuickJS headers still match this source.

To rebuild the local runtime at the path used by the Hyprland configuration:

```bash
meson setup --reconfigure .work/koya-build ../helix \
  -Dkoya_version=0.6.0 -Dbuild_koya=true -Dbuild_syncromesh=false \
  -Dplugins=dbus,hypr,process,pam
meson compile -C .work/koya-build
KOYA_BIN="$PWD/.work/koya-build/koya-base/koya" \
KOYA_PLUGIN_DIR="$PWD/.work/koya-build/helix-plugin" ./run.sh
```
