# Koya Desktop Shell

A Wayland desktop shell and login greeter built with [Koya](https://www.koya-ui.com/).
Designed for Hyprland on GNU/Linux, this project demonstrates Koya with a
desktop bar, application picker, account app, settings, Wi-Fi controls and
session locking.

The bar provides workspaces, a clock, network and battery status, volume
controls and notifications. Every connected monitor gets its own bar and
wallpaper. Hyprland manages application windows and workspaces.

## Requirements

- Installed Koya **0.7.1 or newer**, its shared assets, and matching Helix
  `dbus`, `hypr` and `process` plugins. Session locking also needs `pam`.
- A working Hyprland session and Vulkan driver.
- Meson, Ninja, a C++17 compiler, pkg-config and the `gio-unix-2.0` development
  library to build this project's native modules.
- GdkPixbuf and its image loaders; librsvg for SVG icons.

Install the services for the features you use:

| Feature | Service or tool |
| --- | --- |
| Network and Wi-Fi | NetworkManager and a session polkit agent |
| Battery and charge control | UPower |
| Power modes | power-profiles-daemon |
| Audio | PulseAudio or PipeWire's PulseAudio server, with `pactl` |
| Account profiles | AccountsService (`accountsservice` on Arch) |
| Image chooser | xdg-desktop-portal and a file-chooser backend, such as GTK |
| Login greeter | greetd |
| SSH prompts | OpenSSH and an existing ssh-agent |
| Idle locking | hypridle |

## Run

```bash
git clone https://github.com/Omnomios/koya-bar.git
cd koya-bar
./run.sh
```

The runner uses installed Koya and builds this project's native modules into
`build/`. For a nonstandard installation, set `KOYA_BIN`,
`KOYA_ASSET_DIR` and `KOYA_PLUGIN_DIR` to the executable, matching shared assets
and plugins. Assets default to `../share/koya/assets` relative to the executable.

Add the absolute path to `run.sh` to Hyprland's startup commands. Run one shell
per session and stop any existing bar or wallpaper service before starting it.

The standalone apps are:

```bash
./launcher.sh     # Application picker
./settings.sh     # Theme, wallpaper and clock
./account.sh      # Profile, password and sign-in options
./wifi.sh         # Wireless networks
./lock.sh         # Lock the session
```

To add Account, Koya Settings and Koya Wi-Fi to other launchers and desktop
menus, run:

```bash
./install-desktop-entries.sh
```

The installer writes to `${XDG_DATA_HOME:-~/.local/share}/applications`, or its
first argument. Entries refer to this checkout; rerun it after moving the repo.
Koya's picker also discovers the generated entries directly in `build/`.

The bar and apps use layer-shell surfaces. Configure Hyprland's blur for
namespaces beginning with `koya-` if desired. Float the desktop portal's file
chooser so it opens as a dialog. Settings and Account release their input and
hide while the chooser or an authorization prompt is open.

## Settings

**Theme** opens the theme editor. Edit the base palette and individual surfaces,
text, borders, dividers, highlights, status colours and shadows. The colour
picker supports HSV, RGBA and hex. The preview follows the draft; **Save theme**
applies it to open shell apps. Unsaved drafts survive page navigation and are
discarded when Settings closes. Invalid or unreadable drafts cannot be saved.

**Wallpaper** offers bundled artwork and an image chooser for your own files.
**Show on login screen** shares the selected wallpaper with the greeter for
this account. Imported images are cached and only the selected rendered image
is copied to the greeter's cache.

**Date & time** controls 24/12-hour time, date visibility and seconds. Dates use
ISO `YYYY-MM-DD` format. The bar and lock screen use the same saved options.

Preferences are saved atomically to
`${XDG_CONFIG_HOME:-~/.config}/koya-bar/settings.json`.

## Account

The separate Account app edits the current user's AccountsService profile.
Choose a picture, edit your display name and email, or open the password page.
Images are centred, cropped to a square and converted to a 256px PNG. The
greeter and lock screen follow profile changes and fall back to initials when
no image is available. Authentication always uses the login name.

Password changes run through `passwd` on a private terminal. The app reports
the system's refusal and clears password fields after use. Automatic login
requires the greeter installation below and administrator authorization.

## Bar controls

- **Network:** connection summary, addresses and connectivity; **Configure
  Wi-Fi** opens the Wi-Fi app for joining and managing saved networks.
- **Battery:** status, time estimates, power rate, energy, health and cycles.
  Supported batteries get an individual charge-control switch using UPower's
  configured preset. Available power modes come from power-profiles-daemon.
- **Audio:** click the speaker for volume and mute controls. The slider follows
  the default output and external volume changes.
- **Notifications:** banners and history with actions, dismissal and clear-all.
  History remains in memory until the shell exits.

Controls for unavailable hardware or services are omitted. System changes use
the corresponding service's existing authorization policy.

## Application picker

Bind `launcher.sh` to your preferred Hyprland shortcut to replace a launcher
such as `rofi -show drun`. Type to search desktop entries by name, keywords,
description or executable; matching ignores case and accents.

Use Up/Down or Tab to select, Page Up/Down to move through results, Enter to
launch, and Escape to close. Left/Right, Home/End, Backspace and Delete edit the
query; Ctrl+U clears it, Ctrl+W removes a word and Ctrl+A/Ctrl+E move to either
end. Input methods supply text composition. A second invocation is ignored
while the picker is open.

Applications launch through GIO's desktop-entry handling, including terminal
entries, Exec field codes and D-Bus activation.

## Login greeter

The greeter discovers installed Wayland sessions and asks greetd to authenticate
and start the selected session. After logout, greetd shows the greeter again.
Configure the chosen desktop session to start `run.sh` itself.

Build the native modules, then install from a checkout that will remain
accessible before login:

```bash
meson setup build             # --reconfigure if already configured
meson compile -C build
sudo ./install-greeter.sh
```

The installer enables greetd at boot and configures tty1. It installs the
launcher, native modules and automatic-login helpers under `/usr/local`, saves
the previous greetd configuration as `/etc/greetd/config.toml.before-koya`, and
links `/usr/local/share/koya-greeter` to this checkout. JavaScript and assets
remain in the repo for development; rerun the installer after native changes.
System plugins load from their installed locations.

Log out of the desktop before starting the service, for example from SSH:

```bash
sudo systemctl start greetd
```

The raw greeter runs as root for DRM, input-device and VT access. greetd starts
the desktop as the authenticated user. Escape or Back cancels authentication;
secret prompts stay masked. The last account and its opted-in wallpaper are
recalled, and AccountsService supplies its last selected session.

The Account app's **Automatic** switch uses polkit to record automatic login
in `/etc/koya-greeter/autologin`. The installed greetd wrapper builds its runtime
configuration under `/run/koya-greeter/` and adds an initial session for that
account. greetd starts it once at boot; signing out returns to the greeter.

For a preview inside an existing desktop, without real authentication:

```bash
koya -m /usr/share/koya/assets -m . -n build/native/modules -i demos/login-window-preview.js
```

Use any user name and the preview password `koya`. Escape exits the preview.
For raw output, use `sudo ./greeter.sh --preview --raw-tty /dev/tty3` from that
active, available VT. `KOYA_GREETER_WALLPAPER` selects the system wallpaper by
built-in id; `KOYA_GREETER_STATE_DIR` overrides `/var/lib/koya-greeter`.

## Session locking

`lock.sh` creates compositor session-lock surfaces on every output and checks
the current account through PAM. It releases the lock only after authentication
and confirmation that the compositor still owns the lock. Escape clears the
password. Locking works independently of the status shell.

Merge `build/hypridle.example.conf` into your existing hypridle configuration
for idle, sleep and logind lock requests. `KOYA_PAM_SERVICE` selects the PAM
service; the default is `login`. A custom service needs both authentication and
account-policy rules.

## SSH keys

The shell provides a proxy for an existing OpenSSH agent. It discovers paired
private and `.pub` files directly in `~/.ssh`, advertises the public keys and
asks for a passphrase on first use. Only `ssh-add` decrypts the private key;
unlocked keys remain in the upstream agent's memory. No passphrases are saved.

Configure the desktop session's environment before launching SSH clients:

```bash
export KOYA_SSH_UPSTREAM="$XDG_RUNTIME_DIR/ssh-agent.socket"
export SSH_AUTH_SOCK="$XDG_RUNTIME_DIR/koya-ssh/agent.sock"
```

Set the upstream path to your existing agent's socket and keep its service
enabled. Clients must inherit the proxy address; open new terminals after
changing it. Loaded keys retain their confirmation, lifetime and destination
restrictions. Lock and unlock through the proxy so it can track agent locking.

`./ssh-add.sh [options or key paths]` opens a Koya passphrase prompt for manual
loads. Ordinary `ssh-add` remains available for terminal prompts. Keys outside
`~/.ssh` need a manual load; custom `IdentityAgent` settings bypass this proxy.
Closing Koya leaves the upstream agent running but makes the proxy unavailable
until the shell starts again.

## Develop and test

UI code is in `apps/`, artwork in `assets/`, and native modules in
`native/modules/`. Plugin SDK headers are bundled in `native/sdk/`.

Run the focused login, locking, account and SSH-prompt checks with Node.js:

```bash
npm test
```

For native integration checks:

```bash
meson setup build
meson compile -C build
meson test -C build
./tests/run.sh
```

Native checks cover the SSH proxy, password changes, greetd handoff, automatic
login, charge-control writes and privileged greeter file handling. They use
disposable keys, an isolated agent, a private D-Bus and temporary settings and
sockets.

`raw-unlock-demo.sh` is a password-screen demo for an active, available VT. It
does not unlock LUKS or change boot configuration. Its demo password is `koya`.

## Licence

Project material is released under Creative Commons Attribution 4.0
International; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The bundled Inter
fonts and QuickJS header retain their original licences.
