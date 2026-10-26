"""PAM installer fixtures: no system configuration is changed."""
import importlib.util
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import tempfile
spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parent.parent / 'install-fingerprint.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
stock = '#%PAM-1.0\n\nauth required pam_securetty.so\nauth requisite pam_nologin.so\nauth include system-local-login\naccount include system-local-login\nsession include system-local-login\n'
with tempfile.TemporaryDirectory() as work:
    root = Path(work)
    pam = root / 'etc/pam.d'
    pam.mkdir(parents=True)
    (pam / 'system-auth').write_text('fixture account policy')
    login = pam / 'greetd'
    login.write_text(stock)
    installer.configure(root, True)
    first = login.read_text()
    assert first.index('pam_nologin') < first.index('pam_fprintd') < first.index('auth include')
    installer.configure(root, True)
    assert login.read_text() == first
    assert (pam / 'greetd.before-koya-fingerprint').read_text() == stock
    installer.configure(root, True, True)
    assert login.read_text() == stock and not (pam / 'koya-fingerprint').exists()
    login.write_text(stock + 'auth required pam_deny.so\n')
    try: installer.configure(root, True)
    except ValueError: pass
    else: raise AssertionError('Custom PAM must require manual review')
    assert not (pam / 'koya-fingerprint').exists()
    assert (pam / 'system-auth').read_text() == 'fixture account policy'
print('Fingerprint PAM installer: passed')
