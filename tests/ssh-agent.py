#!/usr/bin/env python3
"""Exercise real OpenSSH with disposable keys, sockets and fixture passphrases."""
import base64
import concurrent.futures
import os
import pathlib
import queue
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

binary = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'build/native/modules/koya-ssh-agent').resolve()
wrapper = pathlib.Path(__file__).resolve().parents[1] / 'ssh-add.sh'
secret = 'fixture 秘密 % password'

def field(value):
    return struct.pack('>I', len(value)) + value

def exact(client, length):
    data = b''
    while len(data) < length:
        part = client.recv(length - len(data))
        if not part:
            raise EOFError('Agent closed connection')
        data += part
    return data

def request(path, payload):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(8)
        client.connect(str(path))
        client.sendall(field(payload))
        return exact(client, struct.unpack('>I', exact(client, 4))[0])

def wait_socket(path, process):
    deadline = time.monotonic() + 5
    while not path.exists():
        assert process.poll() is None, 'Fixture process exited before socket creation'
        assert time.monotonic() < deadline, 'Socket startup timed out'
        time.sleep(.02)

with tempfile.TemporaryDirectory(prefix='koya-ssh-test-') as folder:
    root = pathlib.Path(folder)
    keys = root / 'keys'
    keys.mkdir(mode=0o700)
    private = keys / 'key with space 魚'
    subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', secret, '-C', 'fixture public key', '-f', str(private)], check=True)
    public = pathlib.Path(str(private) + '.pub')
    blob = base64.b64decode(public.read_text().split()[1])
    sign = b'\x0d' + field(blob) + field(b'fixture message') + struct.pack('>I', 0)
    upstream = root / 'upstream.sock'
    runtime = root / 'runtime'
    runtime.mkdir(mode=0o700)
    sockets = runtime / 'koya-ssh'
    agent_socket, prompt_socket = sockets / 'agent.sock', sockets / 'prompt.sock'
    env = dict(os.environ, SSH_AUTH_SOCK=str(agent_socket), KOYA_SSH_UPSTREAM=str(upstream), XDG_RUNTIME_DIR=str(runtime))
    agent = subprocess.Popen(['ssh-agent', '-D', '-a', str(upstream)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             env=dict(env, SSH_ASKPASS='/bin/false', SSH_ASKPASS_REQUIRE='force', DISPLAY='fixture:0'))
    proxy = None
    processes = []
    try:
        wait_socket(upstream, agent)
        proxy = subprocess.Popen([str(binary), '--agent-socket', str(agent_socket), '--prompt-socket', str(prompt_socket),
                                  '--upstream', str(upstream), '--key-dir', str(keys)], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        events = queue.Queue()
        threading.Thread(target=lambda: [events.put(line.rstrip('\n')) for line in proxy.stdout], daemon=True).start()
        assert events.get(timeout=5) == 'READY'
        wait_socket(prompt_socket, proxy)
        assert (sockets.stat().st_mode & 0o777) == 0o700
        assert (agent_socket.stat().st_mode & 0o777) == 0o600
        assert request(upstream, b'\x0b') == b'\x0c\0\0\0\0'
        assert blob in request(agent_socket, b'\x0b'), 'Unloaded public key must be advertised without prompting'
        assert request(agent_socket, b'\x0d' + field(blob))[0] == 5, 'Malformed signing requests must not unlock a key'
        assert events.empty()

        def event(kind):
            line = events.get(timeout=8)
            parts = line.split(' ', 2)
            assert parts[0] == kind, f'Expected {kind}, received {line}'
            return int(parts[1]), urllib.parse.unquote(parts[2]) if len(parts) > 2 else ''

        def answer(prompt_id, value):
            proxy.stdin.write(f'C {prompt_id}\n' if value is None else f'R {prompt_id} {urllib.parse.quote(value, safe="")}\n')
            proxy.stdin.flush()

        # Real ssh-add -T verifies the returned signature, including retry behavior.
        verify = subprocess.Popen(['ssh-add', '-T', str(public)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        processes.append(verify)
        prompt_id, text = event('P'); assert str(private) in text
        answer(prompt_id, 'wrong fixture password'); assert event('D')[0] == prompt_id
        retry, text = event('P'); assert retry != prompt_id and 'Bad passphrase' in text
        answer(retry, secret); assert event('D')[0] == retry
        assert verify.wait(timeout=8) == 0, 'OpenSSH must verify the real signature'
        assert blob in request(upstream, b'\x0b'), 'Key must be loaded in upstream memory'
        assert request(agent_socket, sign)[0] == 14
        assert events.empty(), 'Loaded keys must not prompt again'

        # Removal forwards unchanged; another first use can be canceled.
        assert request(agent_socket, b'\x13')[0] == 6
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            canceled = executor.submit(request, agent_socket, sign)
            prompt_id, _ = event('P'); answer(prompt_id, None); assert event('D')[0] == prompt_id
            assert canceled.result(timeout=8)[0] == 5
        assert request(upstream, b'\x0b') == b'\x0c\0\0\0\0'

        # Concurrent first uses share a single load, then both receive signatures.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(request, agent_socket, sign)
            second = executor.submit(request, agent_socket, sign)
            prompt_id, _ = event('P'); answer(prompt_id, secret); assert event('D')[0] == prompt_id
            assert first.result(timeout=8)[0] == second.result(timeout=8)[0] == 14
        assert events.empty()

        # Preserve loaded confirmation constraints: do not silently re-add.
        request(upstream, b'\x13')
        manual = subprocess.Popen([str(wrapper), '-c', str(private)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        processes.append(manual)
        prompt_id, _ = event('P'); answer(prompt_id, secret); assert event('D')[0] == prompt_id
        assert manual.wait(timeout=8) == 0
        assert request(agent_socket, sign)[0] == 5, 'Existing confirmation requirement must survive proxying'
        assert events.empty(), 'Proxy must not replace a constrained loaded key'

        # A locked upstream must not advertise or load private files.
        lock = field(b'fixture agent lock')
        assert request(agent_socket, b'\x16' + lock)[0] == 6
        assert request(agent_socket, b'\x0b') == b'\x0c\0\0\0\0'
        assert request(agent_socket, sign)[0] == 5
        assert events.empty()
        assert request(agent_socket, b'\x17' + lock)[0] == 6
        request(upstream, b'\x13')

        # Abandoning an SSH request cancels ssh-add and dismisses the prompt.
        client = socket.socket(socket.AF_UNIX); client.connect(str(agent_socket)); client.sendall(field(sign))
        prompt_id, _ = event('P'); client.close(); assert event('D')[0] == prompt_id
        assert request(upstream, b'\x0b') == b'\x0c\0\0\0\0'

        # Completed connections must not accumulate daemon threads.
        for _ in range(80):
            assert blob in request(agent_socket, b'\x0b')
        time.sleep(.4)
        assert len(list(pathlib.Path(f'/proc/{proxy.pid}/task').iterdir())) < 8
        assert sorted(path.name for path in keys.iterdir()) == [private.name, public.name], 'No extra key/passphrase store'

        # Closing the UI pipe while a prompt is active must unblock and clean up.
        with concurrent.futures.ThreadPoolExecutor() as executor:
            blocked = executor.submit(request, agent_socket, sign)
            event('P'); proxy.stdin.close()
            assert proxy.wait(timeout=8) == 0
            try:
                result = blocked.result(timeout=8)
                assert result[0] == 5
            except (EOFError, ConnectionResetError):
                pass
        assert not agent_socket.exists() and not prompt_socket.exists()
        assert secret not in proxy.stderr.read()
        print('OpenSSH first use, retries, cancellation, concurrency, constraints and shutdown: passed')
    finally:
        for process in processes + ([proxy] if proxy else []) + [agent]:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
