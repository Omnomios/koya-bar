#!/bin/bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
daemon=${FRAMEWORK_DBUS_TEST_DAEMON:-$root/../framework-dbus/build/framework-dbus-test-daemon}
if [[ ! -x "$daemon" ]]; then
  echo "Build framework-dbus first: missing $daemon" >&2
  exit 1
fi
if [[ ${KOYA_FRAMEWORK_PRIVATE_BUS:-} != yes ]]; then
  exec dbus-run-session -- env KOYA_FRAMEWORK_PRIVATE_BUS=yes bash "$0"
fi
work=$(mktemp -d)
pid=
trap '[[ -z "$pid" ]] || { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }; rm -rf -- "$work"' EXIT
"$daemon" --session --simulate --test-allow >"$work/service.log" 2>&1 & pid=$!
for ((i=0; i<100; i++)); do
  if gdbus call --session --dest org.framework_dbus --object-path /org/framework_dbus \
    --method org.freedesktop.DBus.Properties.Get org.framework_dbus.Manager1 Available 2>/dev/null | grep -q true; then break; fi
  sleep .05
done
status=0
timeout -k 2 20 "${KOYA_BIN:-koya}" -m "$root" -n "${KOYA_PLUGIN_DIR:-$root/build/native/modules}" \
  -i tests/framework-dbus.js >"$work/koya.log" 2>&1 || status=$?
cat "$work/service.log" "$work/koya.log"
(( status == 0 )) && grep -q KOYA_FRAMEWORK_DBUS_PASS "$work/koya.log" && ! grep -q KOYA_FRAMEWORK_DBUS_FAIL "$work/koya.log"
