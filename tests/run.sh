#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ ${1:-} != --inside ]]; then
  node "$root/tests/models.mjs"
  node "$root/tests/ssh-agent-model.mjs"
  node --experimental-vm-modules "$root/tests/cursor.mjs"
  node --experimental-vm-modules "$root/tests/batching.mjs"
  binary=${KOYA_BIN:-koya}
  export KOYA_BIN
  KOYA_BIN=$(command -v -- "$binary") || { printf 'Set KOYA_BIN to a Koya executable.\n' >&2; exit 1; }
  plugins=${KOYA_PLUGIN_DIR:?Set KOYA_PLUGIN_DIR to matching plugins}
  if [[ ! -f $root/build/build.ninja ]]; then meson setup "$root/build" "$root"; fi
  meson compile -C "$root/build"
  for name in dbus hypr process; do
    [[ -f $plugins/libhx-$name.so ]] || { printf 'Missing plugin: %s\n' "$name" >&2; exit 1; }
    ln -sfn -- "$(realpath -- "$plugins/libhx-$name.so")" "$root/build/native/modules/libhx-$name.so"
  done
  runtime=$(mktemp -d /tmp/koya-desktop-test.XXXXXX)
  trap 'rm -rf -- "$runtime"' EXIT
  export XDG_RUNTIME_DIR=$runtime XDG_CONFIG_HOME=$runtime/config XDG_CACHE_HOME=$runtime/cache XDG_DATA_HOME=$runtime/data XDG_DATA_DIRS=$runtime/data
  export KOYA_DESKTOP_ROOT=$root
  export KOYA_TEST_AUDIO_STATE=$runtime/audio
  unset HYPRLAND_INSTANCE_SIGNATURE
  unset WAYLAND_DISPLAY DISPLAY
  mkdir -p "$runtime/data/applications" "$runtime/config" "$runtime/cache"
  cat > "$runtime/data/applications/example.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Example
Exec=/usr/bin/touch $runtime/launched
Icon=$root/assets/launcher/application.png
StartupWMClass=Example
GenericName=Example utility
Keywords=fixture;testing;
DESKTOP
  cat > "$runtime/data/applications/terminal.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Terminal utility
Exec=/usr/bin/true
Terminal=true
DESKTOP
  cat > "$runtime/data/applications/hidden.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Hidden utility
Exec=/usr/bin/true
NoDisplay=true
DESKTOP
  dbus-run-session -- bash "$0" --inside
  exit
fi
export DBUS_SYSTEM_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS
export GIO_USE_VFS=local
args=(-n "$root/build/native/modules" -m "$root" -i tests/native-contract.js)
if [[ -n ${KOYA_ASSET_DIR:-} ]]; then args=(-m "$KOYA_ASSET_DIR" "${args[@]}"); fi
status=0
timeout -k 2 20 "$KOYA_BIN" "${args[@]}" > "$XDG_RUNTIME_DIR/test.log" 2>&1 || status=$?
cat "$XDG_RUNTIME_DIR/test.log"
if (( status != 0 )) || ! rg -q KOYA_DESKTOP_TEST_PASS "$XDG_RUNTIME_DIR/test.log" || rg -q KOYA_DESKTOP_TEST_FAIL "$XDG_RUNTIME_DIR/test.log"; then exit 1; fi
args=(-n "$root/build/native/modules" -m "$root" -i tests/audio-contract.js)
status=0
timeout -k 2 20 "$KOYA_BIN" "${args[@]}" > "$XDG_RUNTIME_DIR/audio.log" 2>&1 || status=$?
cat "$XDG_RUNTIME_DIR/audio.log"
if (( status != 0 )) || ! rg -q KOYA_AUDIO_TEST_PASS "$XDG_RUNTIME_DIR/audio.log" || rg -q KOYA_AUDIO_TEST_FAIL "$XDG_RUNTIME_DIR/audio.log"; then exit 1; fi
