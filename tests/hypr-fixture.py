"""Private Hyprland IPC endpoint; Koya still uses the real native plugin."""
import json
import pathlib
import selectors
import socket
import sys

directory = pathlib.Path(sys.argv[1]) / 'hypr' / 'koya-bar-test'
directory.mkdir(parents=True)
selector = selectors.DefaultSelector()
events = []
for name in ('.socket.sock', '.socket2.sock'):
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(str(directory / name))
    listener.listen()
    selector.register(listener, selectors.EVENT_READ, name)
while True:
    for key, _ in selector.select():
        client, _ = key.fileobj.accept()
        if key.data == '.socket2.sock':
            events.append(client)
            continue
        with client:
            query = client.recv(4096).decode().rstrip('\0\r\n ')
            if query == 'j/workspaces':
                reply = [{'id': 1, 'name': '1', 'monitor': 'headless'}]
            elif query == 'j/clients':
                reply = []
            else:
                reply = []
            client.sendall(json.dumps(reply).encode())
