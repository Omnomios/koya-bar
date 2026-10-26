#!/bin/bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d)
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
  rm -rf -- "$work"
}
trap cleanup EXIT
export XDG_RUNTIME_DIR=$work DBUS_SYSTEM_BUS_ADDRESS=unix:path=$work/bus DBUS_SESSION_BUS_ADDRESS=unix:path=$work/bus
unset WAYLAND_DISPLAY DISPLAY
python3 -c 'from gi.repository import Gio, GLib'
dbus-daemon --session --nofork --address="$DBUS_SYSTEM_BUS_ADDRESS" > "$work/bus.log" 2>&1 & pids+=("$!")
for attempt in {1..100}; do [[ -S $work/bus ]] && break; sleep .02; done
[[ -S $work/bus ]] || { cat "$work/bus.log"; exit 1; }
python3 "$root/tests/fingerprint-dbus.py" > "$work/fixture.log" 2>&1 & pids+=("$!")
for attempt in {1..100}; do rg -q READY "$work/fixture.log" && break; sleep .02; done
rg -q READY "$work/fixture.log" || { cat "$work/fixture.log"; exit 1; }
timeout -k 2 15 "${KOYA_BIN:-koya}" -m "$root" -n "${KOYA_PLUGIN_DIR:-/usr/lib}" -i tests/fingerprint-dbus.js > "$work/log" 2>&1
cat "$work/log"
rg -q KOYA_FINGERPRINT_DBUS_PASS "$work/log"
! rg -q KOYA_FINGERPRINT_DBUS_FAIL "$work/log"
