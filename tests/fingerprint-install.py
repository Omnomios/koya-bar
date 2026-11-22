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
print('Fingerprint staged installer: passed')
