#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
destination=${1:-${XDG_DATA_HOME:-$HOME/.local/share}/applications}
if [[ ! -f $root/build/build.ninja ]]; then meson setup "$root/build" "$root"; fi
meson compile -C "$root/build"
install -d "$destination"
install -m 644 "$root/build/koya-settings.desktop" "$root/build/koya-wifi.desktop" "$root/build/koya-account.desktop" "$destination/"
if command -v update-desktop-database >/dev/null; then update-desktop-database "$destination"; fi
printf 'Installed Koya desktop entries in %s\n' "$destination"
