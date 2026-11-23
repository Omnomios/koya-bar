"""Staged installer contracts; never changes host PAM or greetd."""
import importlib.util
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import tempfile
spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parent.parent / 'install-fingerprint.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

def policy(lines):
    return '#%PAM-1.0\n' + '\n'.join(lines) + '\n'
config = '[terminal]\nvt = 1\n\n[default_session]\ncommand = "koya-greeter"\nservice = "greetd-greeter"\n\n[initial_session]\ncommand = "Hyprland"\nuser = "alice"\nservice = "greetd-initial"\n'
password_only = '#%PAM-1.0\n# Koya password-only greeter service for a running greetd.\nauth include greetd\naccount include greetd\npassword include greetd\nsession include greetd\n'
with tempfile.TemporaryDirectory() as work:
    root = Path(work)
    pam = root / 'etc/pam.d'; pam.mkdir(parents=True)
    greetd = root / 'etc/greetd'; greetd.mkdir(parents=True)
    security = root / 'usr/lib/security'; security.mkdir(parents=True)
    for name, lines in (('greetd', installer.STOCK_AUTH),
                        ('system-local-login', installer.STOCK_LOCAL),
                        ('system-login', installer.STOCK_LOGIN),
                        ('system-auth', installer.STOCK_SYSTEM)):
        (pam / name).write_text(policy(lines) + 'account include system-auth\nsession include system-auth\n')
    login = pam / 'greetd'; original = login.read_text()
    cfg = greetd / 'config.toml'; cfg.write_text(config)
    module = security / 'pam_koya_greeter.so'
    try: installer.configure(root, True)
    except ValueError: pass
    else: raise AssertionError('Missing native route must block opt-in')
    assert cfg.read_text() == config and login.read_text() == original
    module.write_bytes(b'fixture')
    installer.configure(root, True)
    assert login.read_text() == original
    assert '[general]\n' + installer.managed('section') in cfg.read_text()
    assert 'auth [success=5 authinfo_unavail=ignore default=die] pam_koya_greeter.so' in (pam / 'koya-greeter').read_text()
    assert 'auth [success=done default=die] pam_fprintd.so' in (pam / 'koya-greeter').read_text()
    assert (pam / 'koya-greeter').read_text().splitlines()[-4] == 'auth include greetd'
    first = cfg.read_text(); installer.configure(root, True)
    assert cfg.read_text() == first
    original_write = installer.write
    def checked_write(path, content):
        if path == cfg and content == config:
            assert (pam / 'koya-greeter').exists(), 'Config restores before password-only policy is written'
        return original_write(path, content)
    installer.write = checked_write
    installer.configure(root, True, True)
    installer.write = original_write
    assert cfg.read_text() == config and login.read_text() == original
    assert (pam / 'koya-greeter').read_text() == password_only
    installer.configure(root, True, True)
    assert cfg.read_text() == config and (pam / 'koya-greeter').read_text() == password_only
    installer.configure(root, True)
    assert (pam / 'koya-greeter').read_text() == installer.GREETER_SOURCE.read_text()
    explicit = config + '\n[general]\nservice = "greetd"\n'
    cfg.write_text(explicit)
    installer.configure(root, True)
    installer.configure(root, True, True)
    assert cfg.read_text() == explicit
    assert (pam / 'koya-greeter').read_text() == password_only
    for name in ('system-local-login', 'system-login', 'system-auth'):
        before = (pam / name).read_text()
        (pam / name).write_text(before + '-AUTH requisite pam_deny.so\n')
        try: installer.configure(root, True)
        except ValueError: pass
        else: raise AssertionError(name + ' auth drift must block opt-in')
        assert cfg.read_text() == explicit and (pam / 'koya-greeter').read_text() == password_only
        (pam / name).write_text(before)
    route = pam / 'koya-greeter'
    route.write_text('auth required pam_unix.so\n')
    for disable in (False, True):
        try: installer.configure(root, True, disable)
        except ValueError as error: assert 'local changes' in str(error)
        else: raise AssertionError('Foreign greeter policy must be refused')
        assert route.read_text() == 'auth required pam_unix.so\n' and cfg.read_text() == explicit
    route.write_text(password_only)
    cfg.write_text(config + '\n[default_session.extra]\n' + installer.managed('none'))
    try: installer.configure(root, True, True)
    except ValueError: pass
    else: raise AssertionError('Managed marker outside [general] must be refused')
    cfg.write_text(config)
    login.write_text(original + '# Koya fingerprint login (managed by install-fingerprint.py)\nauth sufficient pam_fprintd.so\n')
    try: installer.configure(root, True)
    except ValueError as error: assert 'Legacy managed' in str(error)
    else: raise AssertionError('Legacy managed policy needs migration')
    assert cfg.read_text() == config
    login.write_text(original)
    cfg.write_text(config + '\n[general]\nservice = "custom"\n')
    try: installer.configure(root, True)
    except ValueError: pass
    else: raise AssertionError('Custom service must be preserved')
    assert 'service = "custom"' in cfg.read_text()
    route.write_text(password_only)
    for unusual in (config + '\n[general]\n"service" = "greetd"\n',
                    config + '\n[ general ]\nservice = "greetd"\n'):
        cfg.write_text(unusual)
        before = {path: path.read_bytes() for path in (cfg, route, login)}
        try: installer.configure(root, True)
        except ValueError: pass
        else: raise AssertionError('Unsupported TOML formatting must be refused')
        assert all(path.read_bytes() == data for path, data in before.items())
print('Fingerprint staged installer: passed')

# Package hooks run only for the packaged greeter and never override a local
# service choice. The fixture uses the reviewed Alpine v3.23 vendor policy.
with tempfile.TemporaryDirectory() as work:
    root = Path(work); pam = root / 'etc/pam.d'; pam.mkdir(parents=True)
    vendor = root / 'usr/lib/pam.d'; vendor.mkdir(parents=True)
    greetd = root / 'etc/greetd'; greetd.mkdir(parents=True)
    security = root / 'usr/lib/security'; security.mkdir(parents=True)
    (security / 'pam_koya_greeter.so').write_bytes(b'fixture')
    (security / 'pam_fprintd.so').write_bytes(b'fixture')
    (pam / 'greetd').write_text(policy(['auth include base-auth', 'account include base-account',
                                      'password include base-password', 'session include base-session']))
    (vendor / 'base-auth').write_text(policy([
        'auth required pam_unix.so nullok', 'auth required pam_nologin.so',
        'auth required pam_env.so', '-auth optional pam_gnome_keyring.so',
        '-auth optional pam_kwallet5.so']))
    for name in ('base-account', 'base-password', 'base-session'):
        (vendor / name).write_text(policy([name.split('-')[1] + ' required pam_unix.so']))
    cfg = greetd / 'config.toml'
    cfg.write_text('[default_session]\ncommand = "/usr/bin/koya-greeter --raw-tty /dev/tty1"\nuser = "root"\n')
    assert installer.package_activate(root, 'alpine')
    assert 'service = "koya-greeter"' in cfg.read_text()
    assert (pam / 'koya-greeter').read_text() == installer.ALPINE_GREETER_SOURCE.read_text()
    assert (pam / 'koya-fingerprint').read_text() == installer.ALPINE_LOCK_SOURCE.read_text()
    assert installer.package_activate(root, 'alpine')
    installer.configure(root, True, True, 'alpine')
    assert not installer.package_activate(root, 'alpine')
    assert 'service = "koya-greeter"' not in cfg.read_text()
    installer.configure(root, True, False, 'alpine')
    assert 'service = "koya-greeter"' in cfg.read_text()
    installer.configure(root, True, True, 'alpine')
    (root / installer.OPTOUT).unlink()
    assert (pam / 'koya-greeter').read_text() == installer.PASSWORD_ONLY
    assert not installer.package_activate(root, 'alpine'), 'Released password-only route is an opt-out without a marker'
    assert (pam / 'koya-greeter').read_text() == installer.PASSWORD_ONLY
    installer.configure(root, True, False, 'alpine')
    assert (pam / 'koya-greeter').read_text() == installer.ALPINE_GREETER_SOURCE.read_text()
    installer.configure(root, True, True, 'alpine')
    (root / installer.OPTOUT).unlink()
    (pam / 'koya-greeter').unlink() # Fresh packaged setup for command gating.
    local_command = '/usr/bin/systemd-cat --identifier=koya-greeter -- /usr/local/bin/koya-greeter --raw-tty /dev/tty1'
    cfg.write_text('[default_session]\ncommand = "' + local_command + '"\n')
    assert not installer.package_activate(root, 'alpine'), 'Development greeter is outside packaged activation'
    assert cfg.read_text().endswith(local_command + '"\n')
    assert not (pam / 'koya-greeter').exists()
    cfg.write_text('[default_session]\ncommand = "/usr/bin/koya-greeter --raw-tty /dev/tty1"\n'
                   '\n[general]\nservice = "other"\n')
    assert not installer.package_activate(root, 'alpine')
    assert 'service = "other"' in cfg.read_text()
    cfg.write_text('[default_session]\ncommand = "/usr/bin/koya-greeter --raw-tty /dev/tty1"\n')
    (vendor / 'base-auth').unlink()
    assert not installer.package_activate(root, 'alpine')
    assert not (pam / 'koya-greeter').exists()
    (vendor / 'base-auth').write_text(policy(installer.ALPINE_BASE))
    (security / 'pam_fprintd.so').unlink()
    assert not installer.package_activate(root, 'alpine')
    (security / 'pam_fprintd.so').write_bytes(b'fixture')
    (root / 'etc/conf.d').mkdir()
    (root / 'etc/conf.d/greetd').write_text('cfgfile="/etc/greetd/other.toml"\n')
    assert not installer.package_activate(root, 'alpine')
    (root / 'etc/conf.d/greetd').write_text('# cfgfile="/etc/greetd/config.toml"\n')
    assert installer.package_activate(root, 'alpine')
    installer.configure(root, True, True, 'alpine')
    (root / installer.OPTOUT).unlink()
    (pam / 'koya-greeter').unlink()
    (pam / 'base-auth').write_text(policy(['auth required pam_permit.so']))
    assert not installer.package_activate(root, 'alpine'), '/etc/pam.d must override vendor policy'
    (pam / 'base-auth').unlink()
    assert installer.package_activate(root, 'alpine')
    installer.configure(root, True, True, 'alpine')
    (root / installer.OPTOUT).unlink()
    (pam / 'koya-greeter').unlink()
    (vendor / 'greetd').write_text((pam / 'greetd').read_text())
    (pam / 'greetd').unlink()
    assert installer.package_activate(root, 'alpine'), 'vendor greetd policy is effective without an /etc override'
with tempfile.TemporaryDirectory() as work:
    root = Path(work); pam = root / 'etc/pam.d'; pam.mkdir(parents=True)
    cfgdir = root / 'etc/greetd'; cfgdir.mkdir(parents=True)
    security = root / 'usr/lib/security'; security.mkdir(parents=True)
    (security / 'pam_koya_greeter.so').write_bytes(b'fixture')
    (security / 'pam_fprintd.so').write_bytes(b'fixture')
    for name, lines in (('greetd', installer.STOCK_AUTH),
                        ('system-local-login', installer.STOCK_LOCAL),
                        ('system-login', installer.STOCK_LOGIN),
                        ('system-auth', installer.STOCK_SYSTEM)):
        (pam / name).write_text(policy(lines))
    cfg = cfgdir / 'config.toml'
    cfg.write_text('[default_session]\ncommand = "/usr/bin/koya-greeter --raw-tty /dev/tty1"\n')
    assert installer.package_activate(root, 'arch')
    installer.configure(root, True, True)
    (root / installer.OPTOUT).unlink()
    (pam / 'koya-greeter').unlink()
    cfg.write_text('[default_session]\ncommand = "/usr/bin/other-greeter"\n')
    assert not installer.package_activate(root, 'arch')
    assert 'service = "koya-greeter"' not in cfg.read_text()
    cfg.write_text('[default_session]\ncommand = "/usr/bin/koya-greeter --raw-tty /dev/tty1"\n')
    login = pam / 'greetd'; legacy = login.read_text() + '# Koya fingerprint login (managed by install-fingerprint.py)\nauth sufficient pam_fprintd.so\n'
    login.write_text(legacy)
    assert not installer.package_activate(root, 'arch')
    assert login.read_text() == legacy and cfg.read_text().endswith('/dev/tty1"\n')
print('Fingerprint package activation: passed')
