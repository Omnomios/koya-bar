#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ ${1:-} != --inside ]]; then
  runtime=$(mktemp -d /tmp/kr.XXXXXX)
  trap 'rm -rf -- "$runtime"' EXIT
  export KOYA_DESKTOP_ROOT=$root KOYA_RENDER_RUN=$runtime
  export KOYA_BIN=${KOYA_BIN:?Set KOYA_BIN}
  export KOYA_RENDER_OUTPUT=$root/.work/launcher.png
  export XDG_RUNTIME_DIR=$runtime XDG_CONFIG_HOME=$runtime/config XDG_CACHE_HOME=$runtime/cache XDG_DATA_HOME=$runtime/data
  unset DISPLAY WAYLAND_DISPLAY HYPRLAND_INSTANCE_SIGNATURE
  mkdir -p "$runtime/config" "$runtime/data" "$runtime/cache" "$root/.work"
  dbus-run-session -- bash "$0" --inside
  exit
fi
export DBUS_SYSTEM_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS GIO_USE_VFS=local
cat > "$KOYA_RENDER_RUN/hyprland.conf" <<'CONFIG'
monitor = ,1280x800,0x0,1
misc {
  disable_hyprland_logo = true
  disable_splash_rendering = true
}
animation = global,0
CONFIG
AQ_BACKEND=headless Hyprland -c "$KOYA_RENDER_RUN/hyprland.conf" > "$KOYA_RENDER_RUN/compositor.log" 2>&1 &
compositor=$!
trap 'kill "$compositor" 2>/dev/null || true; wait "$compositor" 2>/dev/null || true' EXIT
for attempt in {1..100}; do
  socket=$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -name 'wayland-*' -type s -print -quit)
  [[ -n $socket ]] && break
  kill -0 "$compositor" 2>/dev/null || { cat "$KOYA_RENDER_RUN/compositor.log"; exit 1; }
  sleep .1
done
if [[ -z ${socket:-} ]]; then cat "$KOYA_RENDER_RUN/compositor.log"; exit 1; fi
export WAYLAND_DISPLAY=$socket
status=0
timeout -k 2 20 "$KOYA_BIN" -m "$root" -n "$root/build/native/modules" -i tests/render.js > "$KOYA_RENDER_RUN/test.log" 2>&1 || status=$?
cat "$KOYA_RENDER_RUN/test.log"
if (( status != 0 )) || ! rg -q KOYA_RENDER_TEST_PASS "$KOYA_RENDER_RUN/test.log"; then exit 1; fi
