#!/bin/bash
set -euo pipefail
if [[ -z ${GREETD_SOCK:-} ]]; then
  printf 'Start this greeter through greetd.\n' >&2
  exit 1
fi
# This application mount links to the development checkout.
exec /usr/bin/koya \
  -m /usr/share/koya/assets \
  -m /usr/local/share/koya-greeter \
  -n /usr/local/lib/koya-greeter \
  -i apps/greeter.js "$@"
