#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
: "${XDG_RUNTIME_DIR:?A running Koya desktop session is required}"
helper=$root/build/native/modules/koya-ssh-agent
[[ -x $helper ]] || { printf 'Run Koyabar once to build its SSH helper.\n' >&2; exit 1; }
[[ -S $XDG_RUNTIME_DIR/koya-ssh/prompt.sock ]] || { printf 'Koyabar is not running.\n' >&2; exit 1; }
exec env SSH_AUTH_SOCK="$XDG_RUNTIME_DIR/koya-ssh/agent.sock" \
  SSH_ASKPASS="$helper" SSH_ASKPASS_REQUIRE=force KOYA_SSH_ASKPASS=1 \
  KOYA_SSH_PROMPT_SOCKET="$XDG_RUNTIME_DIR/koya-ssh/prompt.sock" LC_ALL=C \
  /usr/bin/ssh-add "$@" < /dev/null
