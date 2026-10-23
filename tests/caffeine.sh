#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export KOYA_BIN
KOYA_BIN=$(command -v -- "${KOYA_BIN:-koya}")
plugins=${KOYA_PLUGIN_DIR:-}
if [[ -z $plugins ]]; then
  for candidate in "$(dirname -- "$KOYA_BIN")/plugins" "$(dirname -- "$KOYA_BIN")/../lib" "$(dirname -- "$KOYA_BIN")/../lib64"; do
    if [[ -f $candidate/libhx-dbus.so ]]; then plugins=$candidate; break; fi
  done
fi
modules=${KOYA_TEST_MODULE_DIR:-$root/build/native/modules}
[[ -f $modules/libhx-desktop.so ]] || { printf 'Build the desktop native module first.\n' >&2; exit 1; }
[[ -f $modules/libhx-sleep.so ]] || { printf 'Build the sleep native module first.\n' >&2; exit 1; }
for name in dbus process hypr; do
  [[ -f $plugins/libhx-$name.so ]] || { printf 'Set KOYA_PLUGIN_DIR to matching dbus and process plugins.\n' >&2; exit 1; }
  ln -sfn -- "$(realpath -- "$plugins/libhx-$name.so")" "$modules/libhx-$name.so"
done
runtime=$(mktemp -d /tmp/koya-caffeine-test.XXXXXX)
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
  rm -rf -- "$runtime"
}
trap cleanup EXIT
export XDG_RUNTIME_DIR=$runtime XDG_CONFIG_HOME=$runtime/config XDG_CACHE_HOME=$runtime/cache XDG_DATA_HOME=$runtime/data
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=$runtime/bus DBUS_SESSION_BUS_ADDRESS=unix:path=$runtime/bus
export KOYA_DESKTOP_ROOT=$root GIO_USE_VFS=local
unset WAYLAND_DISPLAY DISPLAY HYPRLAND_INSTANCE_SIGNATURE
dbus-daemon --session --nofork --address="$DBUS_SYSTEM_BUS_ADDRESS" >"$runtime/bus.log" 2>&1 & pids+=("$!")
for attempt in {1..100}; do [[ -S $runtime/bus ]] && break; sleep .02; done
python3 "$root/tests/caffeine-logind.py" >"$runtime/logind.log" 2>&1 & pids+=("$!")
for suite in caffeine-native caffeine-holder caffeine-released; do
  status=0
  timeout -k 2 30 "$KOYA_BIN" -n "$modules" -m "$root" -i "tests/$suite.js" >"$runtime/$suite.log" 2>&1 || status=$?
  cat "$runtime/$suite.log"
  if (( status != 0 )) || ! rg -q KOYA_CAFFEINE_TEST_PASS "$runtime/$suite.log" || rg -q KOYA_CAFFEINE_TEST_FAIL "$runtime/$suite.log"; then
    printf 'Koya test exit status: %s\n' "$status" >&2
    cat "$runtime/logind.log" "$runtime/bus.log" >&2; exit 1
  fi
done
