#!/bin/bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
"${CXX:-c++}" -std=c++17 -O2 -DKOYA_PAM_IPC_PROBE "$root/tests/pam-fixture.cpp" -o "$work/ipc-probe"
ipc_status=0
"$work/ipc-probe" || ipc_status=$?
if (( ipc_status != 0 )); then exit "$ipc_status"; fi
"${CXX:-c++}" -std=c++17 -shared -fPIC -O2 "$root/tests/pam-fixture.cpp" -o "$work/libpam-fixture.so"
# Interpose only for these isolated Koya processes and hx-pam's embedded helper.
# The fixture rejects every account/service outside its fixed test identities.
for mode in success denied retry attempts account prompt unavailable cancel race timeout; do
  status=0
  KOYA_PAM_FIXTURE=$mode LD_PRELOAD="$work/libpam-fixture.so${LD_PRELOAD:+:$LD_PRELOAD}" \
    timeout -k 2 8 "${KOYA_BIN:-koya}" -m "$root" -n "${KOYA_PLUGIN_DIR:-/usr/lib}" \
    -i tests/fingerprint-pam-native.js >"$work/log" 2>&1 || status=$?
  cat "$work/log"
  if (( status != 0 )) || ! grep -q KOYA_FINGERPRINT_PAM_PASS "$work/log" || grep -q KOYA_FINGERPRINT_PAM_FAIL "$work/log"; then exit 1; fi
done
