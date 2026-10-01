#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
koya=$(command -v -- "${KOYA_BIN:-koya}") || { echo 'Set KOYA_BIN to a Koya executable.' >&2; exit 1; }
plugins=${KOYA_PLUGIN_DIR:?Set KOYA_PLUGIN_DIR to matching libhx-* plugins}
mode=${1:-all}
[[ $mode == all || $mode == ipc ]] || { echo 'Usage: bash tests/run.sh [all|ipc]' >&2; exit 1; }
for plugin in dbus hypr ffmpeg; do
    [[ -f $plugins/libhx-$plugin.so ]] || { echo "Missing $plugins/libhx-$plugin.so" >&2; exit 1; }
done
if [[ $mode == all ]]; then
    shell=${WESTON_SHELL:?Set WESTON_SHELL to a Weston shell module supporting layer-shell}
    [[ -f $shell ]] || { echo "Missing Weston shell: $shell" >&2; exit 1; }
fi
runtime=$(mktemp -d /tmp/koya-bar-test.XXXXXX)
pids=()
cleanup() {
    for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
    for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
    rm -rf -- "$runtime"
}
trap cleanup EXIT
export XDG_RUNTIME_DIR=$runtime WAYLAND_DISPLAY=koya-bar-test
export XDG_CONFIG_HOME=$runtime/config XDG_CACHE_HOME=$runtime/cache XDG_DATA_HOME=$runtime/data
export DBUS_SESSION_BUS_ADDRESS=unix:path=$runtime/bus
export DBUS_SYSTEM_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS
export HYPRLAND_INSTANCE_SIGNATURE=koya-bar-test
export LD_LIBRARY_PATH=$plugins:${LD_LIBRARY_PATH:-}
unset DISPLAY
# All services, sockets and settings used by the application are private.
dbus-daemon --session --nofork --address="$DBUS_SESSION_BUS_ADDRESS" >"$runtime/dbus.log" 2>&1 & pids+=("$!")
python3 "$root/tests/hypr-fixture.py" "$runtime" >"$runtime/hypr.log" 2>&1 & pids+=("$!")
if [[ $mode == all ]]; then
    weston --backend=headless --renderer=gl --shell="$shell" --socket="$WAYLAND_DISPLAY" \
        --width=960 --height=540 --idle-time=0 --log="$runtime/weston.log" >"$runtime/weston-stdout.log" 2>&1 & pids+=("$!")
fi
for attempt in {1..100}; do
    [[ ( $mode == ipc || -S $runtime/$WAYLAND_DISPLAY ) && -S $runtime/bus && -S $runtime/hypr/koya-bar-test/.socket.sock ]] && break
    sleep .05
done
if [[ ( $mode == all && ! -S $runtime/$WAYLAND_DISPLAY ) || ! -S $runtime/bus || ! -S $runtime/hypr/koya-bar-test/.socket.sock ]]; then
    cat "$runtime/"*.log >&2; exit 1
fi
mkdir "$runtime/assets"
if [[ $mode == all ]]; then
    ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i color=c=blue:s=32x32:r=10 -t 1 \
        -c:v mpeg4 "$runtime/assets/test-video.mp4"
fi
status=0
timeout -k 3 45 "$koya" --no-setcursor -n "$plugins" -m "$root" -m "$runtime/assets" \
    -i tests/api-contract.js -- "$mode" >"$runtime/test.log" 2>&1 || status=$?
cat "$runtime/test.log"
if (( status != 0 )) || ! rg -q 'KOYA_BAR_TEST_PASS' "$runtime/test.log" || rg -q 'KOYA_BAR_TEST_FAIL' "$runtime/test.log"; then
    [[ ! -f $runtime/weston.log ]] || cat "$runtime/weston.log" >&2
    exit 1
fi
