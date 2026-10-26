#!/bin/bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
# Copy, not symlink: dladdr must resolve the helper in the disposable directory.
cp "$root/build/native/modules/libhx-fingerprint.so" "$work/"
ln -s "${KOYA_PLUGIN_DIR:-/usr/lib}/libhx-process.so" "$work/"
cat > "$work/koya-fingerprint-auth" <<'HELPER'
#!/bin/bash
case "$KOYA_FINGERPRINT_FIXTURE" in
  success) exit 0 ;;
  denied) exit 1 ;;
  cancel) exec sleep 30 ;;
esac
exit 2
HELPER
chmod 755 "$work/koya-fingerprint-auth"
for mode in success denied cancel; do
  KOYA_FINGERPRINT_FIXTURE=$mode timeout -k 2 10 "${KOYA_BIN:-koya}" -m "$root" -n "$work" -i tests/fingerprint-native.js > "$work/log" 2>&1
  cat "$work/log"
  rg -q KOYA_FINGERPRINT_NATIVE_PASS "$work/log"
  ! rg -q KOYA_FINGERPRINT_NATIVE_FAIL "$work/log"
done
