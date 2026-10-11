#!/usr/bin/env python3
"""Isolated audio server fixture. Never connects to the session audio server."""
import json
import os
from pathlib import Path
import sys
import time

root = Path(os.environ['KOYA_TEST_AUDIO_STATE'])
state_path = root / 'state.json'
args = sys.argv[1:]

def load():
    return json.loads(state_path.read_text())

def save(state):
    temporary = root / f'state-{os.getpid()}.tmp'
    temporary.write_text(json.dumps(state))
    temporary.replace(state_path)

def sink(state, name):
    return next(item for item in state['sinks'] if item['name'] == name)

if args == ['init']:
    root.mkdir(parents=True, exist_ok=True)
    save({'default': 'first', 'failed': False, 'sinks': [
        {'name': name, 'index': index, 'description': name, 'mute': False,
         'volume': {'front-left': {'value': volume}, 'front-right': {'value': volume // 2}}}
        for name, index, volume in [('first', 1, 65536), ('second', 2, 32768)]
    ]})
elif args == ['subscribe']:
    previous = state_path.read_text()
    while True:
        time.sleep(0.02)
        current = state_path.read_text()
        if current != previous:
            previous = current
            print("Event 'change' on server #0", flush=True)
else:
    state = load()
    if args == ['state']:
        print(json.dumps(state))
    elif args[0] == 'fail':
        state['failed'] = args[1] == '1'
        save(state)
    elif args[0] == 'default':
        state['default'] = args[1]
        save(state)
    elif args[0] == 'external':
        output = sink(state, args[1])
        volume = round(float(args[2]) * 65536 / 100)
        for channel, value in zip(output['volume'].values(), [volume, volume // 2]):
            channel['value'] = value
        output['mute'] = args[3] == '1'
        save(state)
    elif state['failed']:
        sys.stderr.write('Fixture audio server unavailable\n')
        sys.exit(1)
    elif args == ['get-default-sink']:
        print(state['default'])
    elif args == ['--format=json', 'list', 'sinks']:
        print(json.dumps(state['sinks']))
    elif args[0] == 'set-sink-volume':
        for channel, value in zip(sink(state, args[1])['volume'].values(), args[2:]):
            channel['value'] = round(float(value.rstrip('%')) * 65536 / 100)
        save(state)
    elif args[0] == 'set-sink-mute':
        sink(state, args[1])['mute'] = args[2] == '1'
        save(state)
    else:
        raise ValueError(f'Unexpected command: {args}')
