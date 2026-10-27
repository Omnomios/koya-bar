#!/usr/bin/env bash
# Automatic login: the helper's record and the greetd config koya-greetd
# builds from it, against fixtures (no root, no real greetd or AccountsService).
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d); trap 'rm -rf -- "$work"' EXIT
fail() { printf 'GREETER AUTOLOGIN FAIL: %s\n' "$1" >&2; exit 1; }
export KOYA_GREETER_ETC=$work/etc KOYA_GREETER_HELPER=$root/greeter/koya-greeter-autologin
export KOYA_GREETD_BASE=$work/config.toml KOYA_GREETD_RUNTIME=$work/run/greetd.toml
export KOYA_LOGIN_SESSION_DIRS=$work/sessions KOYA_BUSCTL=$work/busctl
mkdir -p "$work/sessions"
printf '[terminal]\nvt = 1\n\n[default_session]\ncommand = "greeter"\nuser = "root"\n' > "$KOYA_GREETD_BASE"
printf '[Desktop Entry]\nType=Application\nName=Fixture\nExec=/usr/bin/true --fixture %%U\nDesktopNames=Fixture;Desk;\n' > "$work/sessions/fixture.desktop"
printf '[Desktop Entry]\nType=Application\nName=Hyprland\nExec=/usr/bin/env\n' > "$work/sessions/hyprland.desktop"
session=fixture
cat > "$KOYA_BUSCTL" <<SH
#!/bin/bash
case "\$*" in *FindUserByName*) echo 'o "/org/freedesktop/Accounts/User1"' ;; *Session*) echo "s \"\$(cat $work/session)\"" ;; esac
SH
chmod +x "$KOYA_BUSCTL"; echo fixture > "$work/session"
helper=$KOYA_GREETER_HELPER; greetd=$root/greeter/koya-greetd; me=$(id -nu)

[[ -z $("$helper" status) ]] || fail 'nobody signs in automatically at first'
"$greetd" --write-only; cmp -s "$KOYA_GREETD_BASE" "$KOYA_GREETD_RUNTIME" || fail 'without automatic login the config is unchanged'
if "$helper" enable 2>/dev/null; then fail 'enable outside pkexec is refused'; fi
PKEXEC_UID=$(id -u) "$helper" enable
[[ $("$helper" status) == "$me" ]] || fail 'enable records the calling account'
"$greetd" --write-only
grep -qx '\[initial_session\]' "$KOYA_GREETD_RUNTIME" || fail 'automatic login adds an initial session'
grep -qxF "command = \"env XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=Fixture:Desk /usr/bin/systemd-cat --identifier=koya-session -- /usr/bin/true --fixture\"" "$KOYA_GREETD_RUNTIME" || { cat "$KOYA_GREETD_RUNTIME"; fail 'the account session starts with journal output, without field codes'; }
grep -qxF "user = \"$me\"" "$KOYA_GREETD_RUNTIME" || fail 'as the account'
echo gone > "$work/session"; "$greetd" --write-only
grep -qF 'command = "env XDG_SESSION_TYPE=wayland /usr/bin/systemd-cat --identifier=koya-session -- /usr/bin/env"' "$KOYA_GREETD_RUNTIME" || { cat "$KOYA_GREETD_RUNTIME"; fail 'an unknown session falls back to Hyprland with journal output'; }
printf '\n[initial_session]\ncommand = "own"\nuser = "x"\n' >> "$KOYA_GREETD_BASE"; "$greetd" --write-only
[[ $(grep -c '^\[initial_session\]' "$KOYA_GREETD_RUNTIME") == 1 ]] || fail 'an administrator initial session is left alone'
PKEXEC_UID=$(id -u) "$helper" disable
[[ -z $("$helper" status) ]] || fail 'disable stops automatic login'
mv "$KOYA_GREETD_BASE" "$work/missing"
if "$greetd" --write-only 2>/dev/null; then fail 'a missing base config is reported'; fi
printf 'Greeter automatic login: passed\n'
