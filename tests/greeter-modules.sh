#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
binary=$(command -v -- "${KOYA_BIN:-koya}")
assets=${KOYA_ASSET_DIR:-$(dirname -- "$binary")/../share/koya/assets}
modules=${KOYA_GREETER_MODULE_DIR:-$root/build/native/modules}
plugins=${KOYA_PLUGIN_DIR:-}
if [[ -z $plugins ]]; then
  for candidate in "$(dirname -- "$binary")/plugins" "$(dirname -- "$binary")/../lib" "$(dirname -- "$binary")/../lib64"; do
    if [[ -f $candidate/libhx-dbus.so ]]; then plugins=$candidate; break; fi
  done
fi
[[ -f $assets/std/koya-ui.js ]] || { printf 'Set KOYA_ASSET_DIR to matching Koya assets.\n' >&2; exit 1; }
work=$(mktemp -d /tmp/koya-greeter-modules.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/modules" "$work/sessions"
for name in desktop login; do
  [[ -f $modules/libhx-$name.so ]] || { printf 'Missing greeter module: %s\n' "$name" >&2; exit 1; }
  ln -s -- "$(realpath -- "$modules/libhx-$name.so")" "$work/modules/libhx-$name.so"
done
for name in dbus process; do
  [[ -f $plugins/libhx-$name.so ]] || { printf 'Missing matching plugin: %s\n' "$name" >&2; exit 1; }
  ln -s -- "$(realpath -- "$plugins/libhx-$name.so")" "$work/modules/libhx-$name.so"
done
export XDG_RUNTIME_DIR=$work XDG_CONFIG_HOME=$work/config XDG_CACHE_HOME=$work/cache XDG_DATA_HOME=$work/data
export KOYA_GREETER_STATE_DIR=$work/state KOYA_LOGIN_SESSION_DIRS=$work/sessions
unset GREETD_SOCK WAYLAND_DISPLAY DISPLAY HYPRLAND_INSTANCE_SIGNATURE
status=0
timeout -k 2 10 "$binary" -m "$assets" -m "$root" -n "$work/modules" -i tests/greeter-modules.js >"$work/test.log" 2>&1 || status=$?
cat "$work/test.log"
if (( status != 0 )) || ! grep -q KOYA_GREETER_MODULES_PASS "$work/test.log" || grep -q KOYA_GREETER_MODULES_FAIL "$work/test.log"; then exit 1; fi
