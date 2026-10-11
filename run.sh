#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
entry=index.js
if [[ ${1:-} == --app ]]; then
  component=${2:?Missing application name}
  case $component in launcher|settings|wifi|lock) entry=apps/$component.js ;; *) printf 'Unknown application: %s\n' "$component" >&2; exit 2 ;; esac
  shift 2
fi
export KOYA_DESKTOP_ROOT=$root
# Development builds need the standard controls from the matching source tree.
if [[ -z ${KOYA_ASSET_DIR:-} && -f $root/../helix/koya-base/assets/std/koya-controls.js ]]; then
  export KOYA_ASSET_DIR
  KOYA_ASSET_DIR=$(realpath -- "$root/../helix/koya-base/assets")
fi
binary=${KOYA_BIN:-koya}
export KOYA_BIN
KOYA_BIN=$(command -v -- "$binary") || { printf 'Set KOYA_BIN to an installed Koya executable.\n' >&2; exit 1; }
runtime_version=$("$KOYA_BIN" --version)
if [[ ! $runtime_version =~ ^Koya[[:space:]]+([0-9]+)\.([0-9]+)\.([0-9]+) ]] ||
   (( 10#${BASH_REMATCH[1]} == 0 && 10#${BASH_REMATCH[2]} < 6 )); then
  printf 'Koyabar requires Koya 0.6.0 or newer; found %s.\n' "$runtime_version" >&2
  exit 1
fi
if [[ ! -f $root/build/build.ninja ]]; then meson setup "$root/build" "$root"; fi
meson compile -C "$root/build"
plugins=${KOYA_PLUGIN_DIR:-}
if [[ -z $plugins ]]; then
  for candidate in "$(dirname -- "$KOYA_BIN")/plugins" "$(dirname -- "$KOYA_BIN")/../lib" /usr/lib; do
    if [[ -f $candidate/libhx-dbus.so ]]; then plugins=$candidate; break; fi
  done
fi
for name in dbus hypr process; do
  [[ -f $plugins/libhx-$name.so ]] || { printf 'Set KOYA_PLUGIN_DIR to matching dbus, hypr and process plugins.\n' >&2; exit 1; }
  ln -sfn -- "$(realpath -- "$plugins/libhx-$name.so")" "$root/build/native/modules/libhx-$name.so"
done
if [[ $entry == apps/lock.js ]]; then
  [[ -f $plugins/libhx-pam.so ]] || { printf 'The lock app requires the matching PAM plugin.\n' >&2; exit 1; }
  ln -sfn -- "$(realpath -- "$plugins/libhx-pam.so")" "$root/build/native/modules/libhx-pam.so"
fi
args=(-m "$root" -n "$root/build/native/modules" -i "$entry")
if [[ -n ${KOYA_ASSET_DIR:-} ]]; then args=(-m "$KOYA_ASSET_DIR" "${args[@]}"); fi
exec "$KOYA_BIN" "${args[@]}" "$@"
