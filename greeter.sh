#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
entry=apps/greeter.js
if [[ ${1:-} == --preview ]]; then entry=demos/login-preview.js; shift
elif [[ -z ${GREETD_SOCK:-} ]]; then
  printf 'Start this greeter through greetd, or use --preview to test the UI.\n' >&2
  exit 1
fi
binary=${KOYA_BIN:-koya}
binary=$(command -v -- "$binary") || { printf 'Install Koya with raw display support, or set KOYA_BIN to its executable.\n' >&2; exit 1; }
assets=${KOYA_ASSET_DIR:-$(dirname -- "$binary")/../share/koya/assets}
if [[ ! -f $assets/std/koya-controls.js ]]; then printf 'Set KOYA_ASSET_DIR to the matching Koya assets.\n' >&2; exit 1; fi
if [[ ! -f $root/build/native/modules/libhx-login.so ]]; then
  printf 'Build the login module first: meson setup build; meson compile -C build\n' >&2
  exit 1
fi
exec "$binary" -m "$assets" -m "$root" -n "$root/build/native/modules" -i "$entry" "$@"
