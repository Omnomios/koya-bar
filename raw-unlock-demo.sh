#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
binary=${KOYA_BIN:-koya}
binary=$(command -v -- "$binary") || { printf 'Install Koya with raw display support, or set KOYA_BIN to its executable.\n' >&2; exit 1; }
assets=${KOYA_ASSET_DIR:-$(dirname -- "$binary")/../share/koya/assets}
if [[ ! -f $assets/std/koya-controls.js ]]; then
  printf 'Set KOYA_ASSET_DIR to the matching Koya assets directory.\n' >&2
  exit 1
fi
# The demo uses built-in APIs and bundled UI assets; no desktop plugins needed.
exec "$binary" -m "$assets" -m "$root" -i demos/raw-unlock.js "$@"
