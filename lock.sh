#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
: "${XDG_RUNTIME_DIR:?A graphical user session is required}"
exec 9>"$XDG_RUNTIME_DIR/koya-lock.lock"
flock -n 9 || exit 0
export KOYA_PAM_SERVICE=${KOYA_PAM_SERVICE:-login}
exec "$root/run.sh" --app lock "$@"
