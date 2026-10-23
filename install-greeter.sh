#!/bin/bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if (( EUID != 0 )); then
  printf 'Run with sudo: sudo ./install-greeter.sh\n' >&2
  exit 1
fi
for required in /usr/bin/koya /usr/bin/greetd \
  /usr/lib/libhx-dbus.so \
  /usr/share/koya/assets/std/koya-controls.js \
  "$root/build/native/modules/libhx-login.so" \
  "$root/build/native/modules/libhx-desktop.so"; do
  [[ -f $required ]] || { printf 'Missing required file: %s\n' "$required" >&2; exit 1; }
done

# Exercise the greeter's real import graph with candidate native modules and
# installed Koya assets before replacing any installed greeter files.
KOYA_BIN=/usr/bin/koya KOYA_ASSET_DIR=/usr/share/koya/assets KOYA_PLUGIN_DIR=/usr/lib \
  bash "$root/tests/greeter-modules.sh"

if [[ -e /usr/local/share/koya-greeter && ! -L /usr/local/share/koya-greeter ]]; then
  printf '/usr/local/share/koya-greeter exists and is not a symlink.\n' >&2
  exit 1
fi
install -o root -g root -d -m 755 /usr/local/lib/koya-greeter
ln -sfnT -- "$root" /usr/local/share/koya-greeter
install -o root -g root -m 755 "$root/build/native/modules/libhx-login.so" \
  "$root/build/native/modules/libhx-desktop.so" /usr/local/lib/koya-greeter/
install -o root -g root -m 755 "$root/greeter-installed.sh" /usr/local/bin/koya-greeter
# Automatic login: the helper (run through pkexec), its polkit action, and
# greetd starting through koya-greetd, which adds initial_session when on.
install -o root -g root -d -m 755 /usr/local/libexec /etc/koya-greeter /etc/systemd/system/greetd.service.d
install -o root -g root -m 755 "$root/greeter/koya-greeter-autologin" "$root/greeter/koya-greetd" /usr/local/libexec/
install -o root -g root -m 644 "$root/greeter/org.koya.greeter.policy" /usr/share/polkit-1/actions/org.koya.greeter.policy
install -o root -g root -m 644 "$root/greeter/greetd-koya.conf" /etc/systemd/system/greetd.service.d/koya.conf
systemctl daemon-reload

if [[ ! -e /etc/greetd/config.toml.before-koya ]]; then
  install -o root -g root -m 644 /etc/greetd/config.toml /etc/greetd/config.toml.before-koya
fi
install -o root -g root -m 644 "$root/greetd.installed.toml" /etc/greetd/config.toml
systemctl enable greetd.service
printf 'Installed Koya greeter on tty1 and enabled greetd for boot.\n'
