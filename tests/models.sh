#!/bin/bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
log=$(mktemp)
trap 'rm -f -- "$log"' EXIT
status=0
timeout -k 2 40 "${KOYA_BIN:-koya}" -m "$root" -i tests/models.js > "$log" 2>&1 || status=$?
cat "$log"
(( status == 0 )) && grep -q KOYA_MODEL_TEST_PASS "$log" && ! grep -q KOYA_MODEL_TEST_FAIL "$log"
