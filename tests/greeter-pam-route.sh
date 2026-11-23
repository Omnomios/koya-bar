#!/bin/bash
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/include/security" "$work/pam" "$work/approved"
cat > "$work/include/security/pam_appl.h" <<'HEADER'
#pragma once
typedef struct pam_handle pam_handle_t;
struct pam_message { int msg_style; const char *msg; };
struct pam_response { char *resp; int resp_retcode; };
struct pam_conv { int (*conv)(int, const struct pam_message **, struct pam_response **, void *); void *appdata_ptr; };
#define PAM_SUCCESS 0
#define PAM_PERM_DENIED 6
#define PAM_AUTH_ERR 7
#define PAM_AUTHINFO_UNAVAIL 9
#define PAM_IGNORE 25
#define PAM_CONV 5
#define PAM_PROMPT_ECHO_OFF 1
#define PAM_ESTABLISH_CRED 0x0002
#ifdef __cplusplus
extern "C" {
#endif
int pam_start_confdir(const char *, const char *, const struct pam_conv *, const char *, pam_handle_t **);
int pam_authenticate(pam_handle_t *, int);
int pam_acct_mgmt(pam_handle_t *, int);
int pam_setcred(pam_handle_t *, int);
int pam_open_session(pam_handle_t *, int);
int pam_close_session(pam_handle_t *, int);
int pam_end(pam_handle_t *, int);
int pam_get_item(const pam_handle_t *, int, const void **);
#ifdef __cplusplus
}
#endif
HEADER
cat > "$work/include/security/pam_modules.h" <<'HEADER'
#pragma once
#include "pam_appl.h"
HEADER
cat > "$work/approved/greetd" <<'POLICY'
auth required pam_securetty.so
auth requisite pam_nologin.so
auth include system-local-login
POLICY
cat > "$work/approved/system-local-login" <<'POLICY'
auth include system-login
POLICY
cat > "$work/approved/system-login" <<'POLICY'
auth required pam_shells.so
auth requisite pam_nologin.so
auth include system-auth
POLICY
cat > "$work/approved/system-auth" <<'POLICY'
auth required pam_faillock.so preauth
-auth [success=2 default=ignore] pam_systemd_home.so
auth [success=1 default=bad] pam_unix.so try_first_pass nullok
auth [default=die] pam_faillock.so authfail
auth optional pam_permit.so
auth required pam_env.so
auth required pam_faillock.so authsucc
POLICY
c++ -std=c++17 -Wall -Wextra -Werror -shared -fPIC -I"$work/include" \
  -DKOYA_GREETD_POLICY="\"$work/approved/greetd\"" -DKOYA_PAM_DIR="\"$work/approved/\"" \
  "$root/native/modules/pam-koya-greeter.cpp" -o "$work/route.so"
c++ -std=c++17 -Wall -Wextra -Werror -shared -fPIC -I"$work/include" \
  "$root/tests/greeter-pam-mock.cpp" -o "$work/mock.so"
python3 - "$root" "$work" <<'PY'
import pathlib, re, sys
root, work = map(pathlib.Path, sys.argv[1:])
source = {
    'koya-greeter': (root / 'auth/koya-greeter').read_text(),
    'greetd': '''auth required pam_securetty.so
auth requisite pam_nologin.so
auth include system-local-login
account include system-local-login
password include system-local-login
session include system-local-login
''',
    'system-local-login': '''auth include system-login
account include system-login
password include system-login
session include system-login
''',
    'system-login': '''auth required pam_shells.so
auth requisite pam_nologin.so
auth include system-auth
account include system-auth
password include system-auth
session include system-auth
''',
    'system-auth': '''auth required pam_faillock.so preauth
-auth [success=2 default=ignore] pam_systemd_home.so
auth [success=1 default=bad] pam_unix.so try_first_pass nullok
auth [default=die] pam_faillock.so authfail
auth optional pam_permit.so
auth required pam_env.so
auth required pam_faillock.so authsucc
account required pam_unix.so
password required pam_unix.so
session required pam_unix.so
'''
}
for name, policy in source.items():
    policy = re.sub(r'\binclude (greetd|system-local-login|system-login|system-auth)\b',
                    lambda m: 'include ' + str(work / 'pam' / m[1]), policy)
    policy = policy.replace('pam_koya_greeter.so', str(work / 'route.so'))
    policy = re.sub(r'\bpam_([a-z0-9_]+)\.so\b',
                    lambda m: str(work / 'mock.so') + ' ' + ('fingerprint' if m[1] == 'fprintd' else m[1]), policy)
    (work / 'pam' / name).write_text(policy)
PY
c++ -std=c++17 -Wall -Wextra -Werror -I"$work/include" \
  "$root/tests/greeter-pam-route.cpp" -l:libpam.so.0 -o "$work/fixture"
KOYA_LOG="$work/log" "$work/fixture" "$work/pam" "$work/log"
cat > "$work/approved/greetd" <<'POLICY'
auth include base-auth
account include base-account
password include base-password
session include base-session
POLICY
cat > "$work/approved/base-auth" <<'POLICY'
auth required pam_unix.so nullok
auth required pam_nologin.so
auth required pam_env.so
-auth optional pam_gnome_keyring.so
-auth optional pam_kwallet5.so
POLICY
c++ -std=c++17 -Wall -Wextra -Werror -shared -fPIC -I"$work/include" \
  -DKOYA_GREETD_POLICY="\"$work/approved/greetd\"" -DKOYA_PAM_DIR="\"$work/approved/\"" \
  -DKOYA_PAM_VENDOR_DIR="\"$work/approved/\"" \
  "$root/native/modules/pam-koya-greeter.cpp" -o "$work/route.so"
python3 - "$root" "$work" <<'PY'
import pathlib, re, sys
root, work = map(pathlib.Path, sys.argv[1:])
source = {
    'koya-greeter': (root / 'auth/koya-greeter-alpine').read_text(),
    'greetd': (work / 'approved/greetd').read_text(),
    'base-auth': (work / 'approved/base-auth').read_text(),
    'base-account': 'account required pam_unix.so\n',
    'base-password': 'password required pam_unix.so\n',
    'base-session': 'session required pam_unix.so\n',
}
for name, policy in source.items():
    policy = re.sub(r'\binclude (greetd|base-auth|base-account|base-password|base-session)\b',
                    lambda m: 'include ' + str(work / 'pam' / m[1]), policy)
    policy = policy.replace('pam_koya_greeter.so', str(work / 'route.so'))
    policy = re.sub(r'\bpam_([a-z0-9_]+)\.so\b',
                    lambda m: str(work / 'mock.so') + ' ' + ('fingerprint' if m[1] == 'fprintd' else m[1]), policy)
    (work / 'pam' / name).write_text(policy)
PY
KOYA_LOG="$work/log" "$work/fixture" "$work/pam" "$work/log" alpine
