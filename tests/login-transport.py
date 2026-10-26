"""Disposable greetd socket; the transport assertions run in Koya."""
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import threading
import time

root = Path(__file__).resolve().parent.parent
errors = []

def receive(sock):
    def exact(size):
        result = b''
        while len(result) < size:
            chunk = sock.recv(size - len(result))
            if not chunk:
                raise RuntimeError('Greeter disconnected early')
            result += chunk
        return result
    return json.loads(exact(struct.unpack('=I', exact(4))[0]))

def reply(sock, value):
    payload = json.dumps(value, ensure_ascii=False).encode()
    frame = struct.pack('=I', len(payload)) + payload
    for start in range(0, len(frame), 3):
        sock.sendall(frame[start:start + 3])
        time.sleep(.001)

with tempfile.TemporaryDirectory(prefix='koya-login-') as work:
    sessions = Path(work) / 'sessions'
    sessions.mkdir()
    for name, extra in [('fixture', 'Name=Fixture desktop\nExec=/bin/true "two words" %c %U\nDesktopNames=Fixture;Desktop;'),
                        ('hidden', 'Name=Hidden\nExec=/bin/true\nHidden=true'),
                        ('missing', 'Name=Missing\nExec=/no/such/program')]:
        (sessions / (name + '.desktop')).write_text('[Desktop Entry]\nType=Application\n' + extra + '\n')
    address = str(Path(work) / 'greetd.sock')
    with socket.socket(socket.AF_UNIX) as server:
        server.bind(address)
        server.listen()
        server.settimeout(15)
        def serve():
            try:
                with server.accept()[0] as sock:
                    sock.settimeout(10)
                    assert receive(sock) == {'type': 'create_session', 'username': 'fixture'}
                    reply(sock, {'type': 'auth_message', 'auth_message_type': 'secret', 'auth_message': 'Pässword:'})
                    assert receive(sock) == {'type': 'post_auth_message_response', 'response': 'fixture-secret'}
                    reply(sock, {'type': 'success'})
                    start = receive(sock)
                    assert start['type'] == 'start_session' and start['cmd'][:2] == ['/bin/true', 'two words']
                    reply(sock, {'type': 'success'})
                    assert receive(sock)['type'] == 'cancel_session'
                    sock.sendall(struct.pack('=I', 1024 * 1024 + 1))
                with server.accept()[0] as sock:
                    sock.settimeout(10)
                    receive(sock)
            except Exception as error:
                errors.append(error)
        worker = threading.Thread(target=serve, daemon=True)
        worker.start()
        env = {**os.environ, 'GREETD_SOCK': address, 'KOYA_LOGIN_SESSION_DIRS': str(sessions), 'XDG_RUNTIME_DIR': work}
        env.pop('WAYLAND_DISPLAY', None)
        result = subprocess.run([env.get('KOYA_BIN', 'koya'), '-m', str(root), '-n', str(root / 'build/native/modules'),
                                 '-i', 'tests/login-native.js'], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=20)
        print(result.stdout, end='')
        worker.join(16)
        assert not worker.is_alive(), 'Fixture did not finish'
        if errors:
            raise errors[0]
        assert result.returncode == 0 and 'KOYA_LOGIN_TEST_PASS' in result.stdout and 'KOYA_LOGIN_TEST_FAIL' not in result.stdout
