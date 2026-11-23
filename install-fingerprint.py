#!/usr/bin/env python3
"""Install Koya-owned fingerprint PAM policy; opt in greetd with --greeter."""
import argparse
import copy
import os
from pathlib import Path
import re
import tempfile
import tomllib

LOCK_SOURCE = Path(__file__).resolve().parent / 'auth/koya-fingerprint'
ALPINE_LOCK_SOURCE = Path(__file__).resolve().parent / 'auth/koya-fingerprint-alpine'
GREETER_SOURCE = Path(__file__).resolve().parent / 'auth/koya-greeter'
ALPINE_GREETER_SOURCE = Path(__file__).resolve().parent / 'auth/koya-greeter-alpine'
PASSWORD_ONLY = ('#%PAM-1.0\n# Koya password-only greeter service for a running greetd.\n'
                 'auth include greetd\naccount include greetd\n'
                 'password include greetd\nsession include greetd\n')
MANAGED_PREFIX = '# Koya greeter fingerprint service: '
MANAGED_RE = re.compile(r'(?m)^# Koya greeter fingerprint service: (greetd|none|section)\nservice = "koya-greeter"\n')

def managed(kind):
    return MANAGED_PREFIX + kind + '\nservice = "koya-greeter"\n'

STOCK_AUTH = ['auth required pam_securetty.so', 'auth requisite pam_nologin.so',
              'auth include system-local-login']
STOCK_LOCAL = ['auth include system-login']
STOCK_LOGIN = ['auth required pam_shells.so', 'auth requisite pam_nologin.so', 'auth include system-auth']
STOCK_SYSTEM = ['auth required pam_faillock.so preauth',
                '-auth [success=2 default=ignore] pam_systemd_home.so',
                'auth [success=1 default=bad] pam_unix.so try_first_pass nullok',
                'auth [default=die] pam_faillock.so authfail', 'auth optional pam_permit.so',
                'auth required pam_env.so', 'auth required pam_faillock.so authsucc']
ALPINE_GREETD = ['auth include base-auth']
ALPINE_GREETD_ALL = ALPINE_GREETD + ['account include base-account',
                                    'password include base-password', 'session include base-session']
ALPINE_BASE = ['auth required pam_unix.so nullok', 'auth required pam_nologin.so',
               'auth required pam_env.so', '-auth optional pam_gnome_keyring.so',
               '-auth optional pam_kwallet5.so']
PACKAGED_COMMANDS = {
    '/usr/bin/koya-greeter --raw-tty /dev/tty1',
}
OPTOUT = Path('etc/greetd/.koya-fingerprint-disabled')

def regular(path):
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError(f'Refusing non-regular file: {path}')

def write(path, content):
    regular(path)
    fd, temp = tempfile.mkstemp(prefix='.koya-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, 0o644)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)

def stock_auth(path, expected):
    regular(path)
    lines = path.read_text().splitlines()
    auth = [' '.join(line.split('#', 1)[0].split()) for line in lines]
    if any(line.lower().startswith('@include ') for line in auth):
        return False
    return [line for line in auth if line.lower().startswith(('auth ', '-auth '))] == expected

def stock_alpine_greetd(path):
    regular(path)
    lines = [' '.join(line.split('#', 1)[0].split()) for line in path.read_text().splitlines()]
    return [line for line in lines if line and not line.startswith('#')] == ALPINE_GREETD_ALL

def _config_change(content, disable):
    if '# Koya fingerprint login (managed by install-fingerprint.py)' in content:
        raise ValueError('Legacy managed greetd PAM policy found; restore greetd from greetd.before-koya-fingerprint after review, then retry')
    matches = list(MANAGED_RE.finditer(content))
    if len(matches) > 1 or (MANAGED_PREFIX in content and not matches):
        raise ValueError('Modified Koya greetd service; review it manually')
    if matches:
        match = matches[0]
        general = re.search(r'(?m)^\[general\][ \t]*$', content[:match.start()])
        if not general or re.search(r'(?m)^\[', content[general.end():match.start()]):
            raise ValueError('Managed service is outside [general]; review it manually')
        without_managed = content[:match.start()] + content[match.end():]
        section_end = re.search(r'(?m)^\[', without_managed[general.end():])
        section = without_managed[general.end():general.end() + section_end.start()] if section_end else without_managed[general.end():]
        if re.search(r'(?m)^[ \t]*service[ \t]*=', section):
            raise ValueError('Additional greetd service; review it manually')
        if disable:
            if match.group(1) == 'section':
                suffix = '\n[general]\n' + match.group(0)
                if not content.endswith(suffix):
                    raise ValueError('Managed greetd section changed; review it manually')
                return content[:-len(suffix)]
            replacement = 'service = "greetd"\n' if match.group(1) == 'greetd' else ''
            return content[:match.start()] + replacement + content[match.end():]
        return content
    if disable:
        return content
    sections = list(re.finditer(r'(?m)^\[general\][ \t]*\n', content))
    if len(sections) > 1:
        raise ValueError('Duplicate greetd general section; review it manually')
    if '[general]' in content and not sections:
        raise ValueError('Nonstandard greetd general section; review it manually')
    if sections:
        start = sections[0].end()
        end_match = re.search(r'(?m)^\[', content[start:])
        end = start + end_match.start() if end_match else len(content)
        section = content[start:end]
        services = list(re.finditer(r'(?m)^[ \t]*service[ \t]*=.*(?:\n|$)', section))
        if len(services) > 1:
            raise ValueError('Duplicate greetd service; review it manually')
        if services:
            service = services[0]
            if service.group(0).strip() != 'service = "greetd"' or not service.group(0).endswith('\n'):
                raise ValueError('Custom greetd service; review it manually')
            return content[:start + service.start()] + managed('greetd') + content[start + service.end():]
        return content[:start] + managed('none') + content[start:]
    return content + ('' if content.endswith('\n') else '\n') + '\n[general]\n' + managed('section')

def config_change(content, disable):
    try:
        original = tomllib.loads(content)
    except tomllib.TOMLDecodeError as error:
        raise ValueError(f'Invalid greetd config: {error}') from error
    updated = _config_change(content, disable)
    expected = copy.deepcopy(original)
    if disable:
        match = MANAGED_RE.search(content)
        if match:
            if match.group(1) == 'greetd':
                expected['general']['service'] = 'greetd'
            else:
                expected['general'].pop('service')
                if match.group(1) == 'section': expected.pop('general')
    else:
        expected.setdefault('general', {})['service'] = 'koya-greeter'
    try:
        actual = tomllib.loads(updated)
    except tomllib.TOMLDecodeError as error:
        raise ValueError(f'Unsupported greetd config formatting: {error}') from error
    if actual != expected:
        raise ValueError('Greetd config rewrite would change unrelated settings; review it manually')
    return updated

def effective_pam(root, name):
    local = root / 'etc/pam.d' / name
    return local if local.exists() or local.is_symlink() else root / 'usr/lib/pam.d' / name

def security_module(root, name):
    return next((path for path in (root / 'usr/lib/security' / name,
                                   root / 'lib/security' / name) if path.is_file()), None)

def reviewed_auth(root, platform):
    pam = root / 'etc/pam.d'
    if platform == 'arch':
        return all(stock_auth(path, expected) for path, expected in (
            (pam / 'greetd', STOCK_AUTH), (pam / 'system-local-login', STOCK_LOCAL),
            (pam / 'system-login', STOCK_LOGIN), (pam / 'system-auth', STOCK_SYSTEM)))
    return stock_alpine_greetd(effective_pam(root, 'greetd')) and \
        stock_auth(effective_pam(root, 'base-auth'), ALPINE_BASE) and \
        all(effective_pam(root, name).is_file() for name in
            ('base-account', 'base-password', 'base-session'))

def configure(root, greeter=False, disable=False, platform='arch'):
    if platform not in ('arch', 'alpine'):
        raise ValueError('Unsupported platform')
    pam = root / 'etc/pam.d'
    lock, route = pam / 'koya-fingerprint', pam / 'koya-greeter'
    lock_source = LOCK_SOURCE if platform == 'arch' else ALPINE_LOCK_SOURCE
    greetd = pam / 'greetd' if platform == 'arch' else effective_pam(root, 'greetd')
    config = root / 'etc/greetd/config.toml'
    module = security_module(root, 'pam_koya_greeter.so')
    regular(lock)
    if lock.exists() and lock.read_text() not in (LOCK_SOURCE.read_text(), ALPINE_LOCK_SOURCE.read_text()):
        raise ValueError(f'{lock} has local changes; review it manually')
    if not disable and platform == 'arch' and not (pam / 'system-auth').is_file():
        raise ValueError('Arch system-auth policy is missing')
    update = None
    if greeter:
        regular(greetd)
        if '# Koya fingerprint login (managed by install-fingerprint.py)' in greetd.read_text():
            raise ValueError('Legacy managed greetd PAM policy found; restore greetd from greetd.before-koya-fingerprint after review, then retry')
        regular(route)
        if route.exists() and route.read_text() not in (GREETER_SOURCE.read_text(), ALPINE_GREETER_SOURCE.read_text(), PASSWORD_ONLY):
            raise ValueError(f'{route} has local changes; review it manually')
        regular(config)
        current = config.read_text()
        update = config_change(current, disable)
        if not disable:
            if module is None:
                raise ValueError('Build and install the Koya PAM route first')
            regular(module)
            if not reviewed_auth(root, platform):
                raise ValueError('Stock greetd auth policy drifted; fingerprint route requires manual review')
    # Validate every dependency and local edit before the first write. Restore
    # owned files if a later write fails, including config.toml's exact bytes.
    changes = [(lock, None if disable else lock_source.read_text())]
    if greeter:
        if disable: changes.insert(0, (config, update))
        route_policy = (PASSWORD_ONLY if route.exists() or MANAGED_RE.search(current) else None) if disable else (GREETER_SOURCE if platform == 'arch' else ALPINE_GREETER_SOURCE).read_text()
        changes.append((route, route_policy))
        if not disable: changes.append((config, update))
        if disable: changes.append((root / OPTOUT, 'Disabled by install-fingerprint.py\n'))
        else: changes.append((root / OPTOUT, None))
    before = [(path, path.read_text() if path.exists() else None) for path, _ in changes]
    try:
        for path, value in changes:
            if value is None:
                if path.exists(): path.unlink()
            elif not path.exists() or path.read_text() != value:
                write(path, value)
    except OSError:
        for path, value in reversed(before):
            if value is None:
                if path.exists(): path.unlink()
            else:
                write(path, value)
        raise

def package_activate(root, platform):
    if platform not in ('arch', 'alpine'):
        raise ValueError('Unsupported platform')
    config = root / 'etc/greetd/config.toml'
    if (root / OPTOUT).exists():
        print('Koya fingerprint package activation skipped: user disabled fingerprint login.')
        return False
    route = root / 'etc/pam.d/koya-greeter'
    try:
        regular(route)
        if route.exists() and route.read_text() == PASSWORD_ONLY:
            print('Koya fingerprint package activation skipped: password-only greeter route is an opt-out.')
            return False
    except (ValueError, OSError) as error:
        print(f'Koya fingerprint package activation skipped: {error}')
        return False
    try:
        if platform == 'alpine':
            confd = root / 'etc/conf.d/greetd'
            if confd.exists() and any(line.strip() and not line.lstrip().startswith('#')
                                      for line in confd.read_text().splitlines()):
                print('Koya fingerprint package activation skipped: custom OpenRC greetd startup.')
                return False
        regular(config)
        data = tomllib.loads(config.read_text())
        session = data.get('default_session', {})
        general = data.get('general', {})
        if not isinstance(session, dict) or session.get('command') not in PACKAGED_COMMANDS or \
                session.get('service') is not None or not isinstance(general, dict) or \
                general.get('service', 'greetd') not in ('greetd', 'koya-greeter'):
            print('Koya fingerprint package activation skipped: unsupported greetd config.')
            return False
        content = config.read_text()
        if general.get('service') == 'koya-greeter' and not MANAGED_RE.search(content):
            print('Koya fingerprint package activation skipped: unmanaged greetd service.')
            return False
        if not security_module(root, 'pam_fprintd.so') or \
                not security_module(root, 'pam_koya_greeter.so') or \
                not reviewed_auth(root, platform):
            print('Koya fingerprint package activation skipped: stock PAM prerequisites unavailable.')
            return False
        configure(root, True, False, platform)
    except (ValueError, OSError) as error:
        print(f'Koya fingerprint package activation skipped: {error}')
        return False
    return True

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--greeter', action='store_true', help='Select fingerprint on Right from the greeter Password prompt')
    parser.add_argument('--disable', action='store_true', help='Disable Koya fingerprint policy; retain password-only greeter service')
    parser.add_argument('--package-activate', action='store_true', help='Select fingerprint only for a supported packaged Koya greetd setup')
    parser.add_argument('--platform', choices=('arch', 'alpine'), help='Distribution PAM policy for package activation')
    parser.add_argument('--root', type=Path, default=Path('/'), help='Staging root for packaging/tests')
    args = parser.parse_args()
    if args.package_activate and (args.greeter or args.disable or not args.platform):
        parser.error('--package-activate requires --platform and cannot be combined with --greeter or --disable')
    root = args.root.resolve()
    if root == Path('/') and os.geteuid() != 0:
        parser.error('Run with sudo to configure system PAM files')
    if root == Path('/') and not args.disable and not args.package_activate and not Path('/usr/lib/security/pam_fprintd.so').is_file():
        parser.error('Install fprintd first: sudo pacman -S --needed fprintd')
    if args.package_activate:
        if package_activate(root, args.platform): print('Koya fingerprint package activation installed; greetd was not restarted.')
        return
    try: configure(root, args.greeter, args.disable, args.platform or 'arch')
    except (ValueError, OSError) as error: parser.exit(1, str(error) + '\n')
    print('Fingerprint PAM configuration ' + ('removed.' if args.disable else 'installed.'))
    print('greetd was not restarted.')

if __name__ == '__main__': main()
