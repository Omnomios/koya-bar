#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ -n ${XDG_RUNTIME_DIR:-} ]]; then
  exec 9>"$XDG_RUNTIME_DIR/koya-wifi.lock"
  flock -n 9 || exit 0
fi
exec "$root/run.sh" --app wifi "$@"
