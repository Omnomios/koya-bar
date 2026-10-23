#!/bin/bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ ${1:-} != --inside ]]; then
  binary=${KOYA_BIN:-koya}
  export KOYA_BIN KOYA_ASSET_DIR
  KOYA_BIN=$(command -v -- "$binary") || { printf 'Install Koya or set KOYA_BIN.\n' >&2; exit 1; }
  KOYA_ASSET_DIR=${KOYA_ASSET_DIR:-$(dirname -- "$KOYA_BIN")/../share/koya/assets}
  plugins=${KOYA_PLUGIN_DIR:-$(dirname -- "$KOYA_BIN")/../lib}
  if [[ ! -f $root/build/build.ninja ]]; then meson setup "$root/build" "$root"; fi
  meson compile -C "$root/build"
  for name in dbus process hypr; do
    [[ -f $plugins/libhx-$name.so ]] || { printf 'Missing plugin: %s\n' "$name" >&2; exit 1; }
    ln -sfn -- "$(realpath -- "$plugins/libhx-$name.so")" "$root/build/native/modules/libhx-$name.so"
  done
  runtime=$(mktemp -d /tmp/koya-desktop-test.XXXXXX)
  trap 'rm -rf -- "$runtime"' EXIT
  export XDG_RUNTIME_DIR=$runtime XDG_CONFIG_HOME=$runtime/config XDG_CACHE_HOME=$runtime/cache XDG_DATA_HOME=$runtime/data XDG_DATA_DIRS=$runtime/data
  export KOYA_DESKTOP_ROOT=$root
  unset HYPRLAND_INSTANCE_SIGNATURE
  unset WAYLAND_DISPLAY DISPLAY
  mkdir -p "$runtime/data" "$runtime/config" "$runtime/cache"
  dbus-run-session -- "$0" --inside
  exit
fi
export DBUS_SYSTEM_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS
export GIO_USE_VFS=local
KOYA_PLUGIN_DIR="$root/build/native/modules" bash "$root/tests/caffeine.sh"
status=0
timeout -k 2 10 "$KOYA_BIN" -n "$root/build/native/modules" -m "$root" -i tests/updates-native.js > "$XDG_RUNTIME_DIR/updates.log" 2>&1 || status=$?
cat "$XDG_RUNTIME_DIR/updates.log"
if (( status != 0 )) || ! rg -q KOYA_UPDATES_NATIVE_PASS "$XDG_RUNTIME_DIR/updates.log" || rg -q KOYA_UPDATES_NATIVE_FAIL "$XDG_RUNTIME_DIR/updates.log"; then exit 1; fi
args=(-n "$root/build/native/modules" -m "$root" -i tests/power-contract.js)
status=0
timeout -k 2 20 "$KOYA_BIN" "${args[@]}" > "$XDG_RUNTIME_DIR/power.log" 2>&1 || status=$?
cat "$XDG_RUNTIME_DIR/power.log"
if (( status != 0 )) || ! rg -q KOYA_POWER_TEST_PASS "$XDG_RUNTIME_DIR/power.log" || rg -q KOYA_POWER_TEST_FAIL "$XDG_RUNTIME_DIR/power.log"; then exit 1; fi
"$root/tests/greeter-autologin.sh"
# Password changes through a terminal-driven passwd (a fake one here).
status=0
KOYA_PASSWD="$root/tests/fake-passwd.sh" timeout -k 2 40 "$KOYA_BIN" -n "$root/build/native/modules" -m "$root" -i tests/password-native.js > "$XDG_RUNTIME_DIR/password.log" 2>&1 || status=$?
cat "$XDG_RUNTIME_DIR/password.log"
if (( status != 0 )) || ! rg -q KOYA_PASSWORD_TEST_PASS "$XDG_RUNTIME_DIR/password.log" || rg -q KOYA_PASSWORD_TEST_FAIL "$XDG_RUNTIME_DIR/password.log"; then exit 1; fi

# Greeter state and the login wallpaper's settings read: one home per case.
greeter=$XDG_RUNTIME_DIR/greeter; user=$(id -un)
mkdir -p "$greeter"/{valid,symlink,fifo,large,missing}/"$user"/.config/koya-bar
printf '{"Wallpaper":"nocturne","GreeterWallpaper":true}' > "$greeter/valid/$user/.config/koya-bar/settings.json"
ln -s "$greeter/valid/$user/.config/koya-bar/settings.json" "$greeter/symlink/$user/.config/koya-bar/settings.json"
mkfifo "$greeter/fifo/$user/.config/koya-bar/settings.json"
head -c 70000 /dev/zero | tr '\0' ' ' > "$greeter/large/$user/.config/koya-bar/settings.json"
for case in state valid symlink fifo large missing; do
  status=0
  KOYA_TEST_USER=$user KOYA_TEST_CASE=$case KOYA_GREETER_STATE_DIR=$greeter/state KOYA_LOGIN_HOME_ROOT=$greeter/$case \
    timeout -k 2 20 "$KOYA_BIN" -n "$root/build/native/modules" -m "$root" -i tests/greeter-state-native.js > "$greeter/$case.log" 2>&1 || status=$?
  cat "$greeter/$case.log"
  if (( status != 0 )) || ! rg -q KOYA_GREETER_STATE_TEST_PASS "$greeter/$case.log" || rg -q KOYA_GREETER_STATE_TEST_FAIL "$greeter/$case.log"; then exit 1; fi
done

# Imported login wallpapers: rendered copies, opt-out and unsafe file handling.
for case in valid disabled missing missing-cache symlink cache-symlink fifo large invalid-image traversal null-settings invalid-settings; do
  wallpaper_home=$greeter/wallpaper-$case/$user
  mkdir -p "$wallpaper_home/.config/koya-bar" "$wallpaper_home/.local/share/koya-bar/wallpapers"
  printf '{"Wallpaper":"user:fixture.png","GreeterWallpaper":true}' > "$wallpaper_home/.config/koya-bar/settings.json"
  if [[ $case == disabled ]]; then printf '{"Wallpaper":"user:fixture.png","GreeterWallpaper":false}' > "$wallpaper_home/.config/koya-bar/settings.json"; fi
  case $case in
    valid|disabled|missing-cache|cache-symlink|invalid-image)
      cp "$root/assets/brand/koya-fish.png" "$wallpaper_home/.local/share/koya-bar/wallpapers/fixture.png"
      node --input-type=module - "$wallpaper_home" "$case" <<'JS'
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const [directory, kind] = process.argv.slice(2);
const source = directory + '/.local/share/koya-bar/wallpapers/fixture.png';
const info = fs.statSync(source, { bigint: true });
const identity = source + ':' + info.mtimeNs / 1000000000n + ':' + info.mtimeNs % 1000000000n + ':' + info.size;
const cache = directory + '/.cache/koya/wallpapers';
fs.mkdirSync(cache, { recursive: true });
const target = cache + '/koya-wallpaper-' + createHash('sha256').update(identity).digest('hex').slice(0, 24) + '.png';
if (kind === 'cache-symlink') fs.symlinkSync(source, target);
else if (kind === 'invalid-image') fs.writeFileSync(target, 'Not an image');
else if (kind !== 'missing-cache') fs.copyFileSync(source, target);
JS
      ;;
    symlink) ln -s "$root/assets/brand/koya-fish.png" "$wallpaper_home/.local/share/koya-bar/wallpapers/fixture.png" ;;
    fifo) mkfifo "$wallpaper_home/.local/share/koya-bar/wallpapers/fixture.png" ;;
    large) truncate -s 67108865 "$wallpaper_home/.local/share/koya-bar/wallpapers/fixture.png" ;;
    traversal) printf '{"Wallpaper":"user:../fixture.png","GreeterWallpaper":true}' > "$wallpaper_home/.config/koya-bar/settings.json" ;;
    null-settings) printf null > "$wallpaper_home/.config/koya-bar/settings.json" ;;
    invalid-settings) printf '?' > "$wallpaper_home/.config/koya-bar/settings.json" ;;
  esac
  status=0
  KOYA_TEST_USER=$user KOYA_TEST_CASE=$case KOYA_GREETER_STATE_DIR=$greeter/cache-$case KOYA_LOGIN_HOME_ROOT=$greeter/wallpaper-$case \
    timeout -k 2 20 "$KOYA_BIN" -n "$root/build/native/modules" -m "$root" -i tests/greeter-wallpaper-native.js > "$greeter/wallpaper-$case.log" 2>&1 || status=$?
  cat "$greeter/wallpaper-$case.log"
  if (( status != 0 )) || ! rg -q KOYA_GREETER_WALLPAPER_TEST_PASS "$greeter/wallpaper-$case.log" || rg -q KOYA_GREETER_WALLPAPER_TEST_FAIL "$greeter/wallpaper-$case.log"; then exit 1; fi
done

node "$root/tests/login-transport.mjs"
