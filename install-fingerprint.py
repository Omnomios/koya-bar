#!/usr/bin/env python3
"""Opt-in, reversible PAM configuration for Arch Linux; does not restart greetd."""
import argparse
import os
from pathlib import Path
import tempfile

MARKER = '# Koya fingerprint login (managed by install-fingerprint.py)\n'
RULE = 'auth       sufficient   pam_fprintd.so max-tries=3 timeout=10\n'
BLOCK = MARKER + RULE
SOURCE = Path(__file__).resolve().parent / 'auth/koya-fingerprint'
STOCK_AUTH = [['auth', 'required', 'pam_securetty.so'], ['auth', 'requisite', 'pam_nologin.so'],
              ['auth', 'include', 'system-local-login']]

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

def configure(root, greeter=False, disable=False):
    pam = root / 'etc/pam.d'
    policy, login = pam / 'koya-fingerprint', pam / 'greetd'
    regular(policy)
    expected = SOURCE.read_text()
    if policy.exists() and policy.read_text() != expected:
        raise ValueError(f'{policy} has local changes; review it manually before changing fingerprint support')
    if not disable and not (pam / 'system-auth').is_file():
        raise ValueError('Arch system-auth policy is missing')
    updated = None
    if greeter:
        regular(login)
        original = login.read_text()
        clean = original.replace(BLOCK, '')
        if MARKER in clean or 'pam_fprintd.so' in clean:
            raise ValueError('greetd already has custom fingerprint rules; review them manually')
        if disable:
            updated = clean
        else:
            auth = [line.split() for line in clean.splitlines() if line.strip() and line.split()[0] == 'auth']
            if auth != STOCK_AUTH:
                raise ValueError('Only the stock Arch greetd auth stack can be edited automatically; review this custom stack manually')
            lines = clean.splitlines(keepends=True)
            index = next(i for i, line in enumerate(lines) if line.split() == STOCK_AUTH[-1])
            lines.insert(index, BLOCK)
            updated = ''.join(lines)
        backup = login.with_name('greetd.before-koya-fingerprint')
        regular(backup)
        if not backup.exists(): write(backup, original)
    # Validate both policies before changing either. Never edit system-auth.
    if updated is not None: write(login, updated)
    if disable:
        if policy.exists(): policy.unlink()
    else:
        write(policy, expected)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--greeter', action='store_true', help='Also configure fingerprint-first greetd login with password fallback')
    parser.add_argument('--disable', action='store_true', help='Remove only the managed configuration')
    parser.add_argument('--root', type=Path, default=Path('/'), help='Staging root for packaging/tests')
    args = parser.parse_args()
    root = args.root.resolve()
    if root == Path('/') and os.geteuid() != 0:
        parser.error('Run with sudo to configure system PAM files')
    if root == Path('/') and not args.disable and not Path('/usr/lib/security/pam_fprintd.so').is_file():
        parser.error('Install fprintd first: sudo pacman -S --needed fprintd')
    try: configure(root, args.greeter, args.disable)
    except (ValueError, OSError) as error: parser.exit(1, str(error) + '\n')
    print('Fingerprint PAM configuration ' + ('removed.' if args.disable else 'installed.'))
    print('greetd was not restarted. Password authentication remains available.')

if __name__ == '__main__': main()
