// Exercise the real native transport against a disposable greetd Unix socket.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'koya-login-'));
const sessions = path.join(work, 'sessions'), tasks = [];
fs.mkdirSync(sessions);
fs.writeFileSync(path.join(sessions, 'fixture.desktop'), '[Desktop Entry]\nType=Application\nName=Fixture desktop\nExec=/bin/true "two words" %c %U\nDesktopNames=Fixture;Desktop;\n');
fs.writeFileSync(path.join(sessions, 'hidden.desktop'), '[Desktop Entry]\nType=Application\nName=Hidden\nExec=/bin/true\nHidden=true\n');
fs.writeFileSync(path.join(sessions, 'missing.desktop'), '[Desktop Entry]\nType=Application\nName=Missing\nExec=/no/such/program\n');
const length = value => { const buffer = Buffer.alloc(4); buffer[os.endianness() === 'LE' ? 'writeUInt32LE' : 'writeUInt32BE'](value); return buffer; };
async function* frames(socket) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of socket) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer[os.endianness() === 'LE' ? 'readUInt32LE' : 'readUInt32BE']();
      if (buffer.length < size + 4) break;
      yield JSON.parse(buffer.subarray(4, size + 4).toString()); buffer = buffer.subarray(size + 4);
    }
  }
}
const reply = async (socket, value) => {
  const payload = Buffer.from(JSON.stringify(value)), frame = Buffer.concat([length(payload.length), payload]);
  for (let i = 0; i < frame.length; i += 3) { socket.write(frame.subarray(i, i + 3)); await pause(1); }
};
let connection = 0, child;
const server = net.createServer(socket => {
  const index = connection++;
  socket.setTimeout(10000, () => socket.destroy(new Error('Fixture timeout')));
  const task = (async () => {
    const reader = frames(socket), receive = async () => { const next = await reader.next(); assert(!next.done, 'Greeter disconnected early'); return next.value; };
    if (index) { await receive(); socket.end(); return; }
    assert.deepEqual(await receive(), { type: 'create_session', username: 'fixture' });
    await reply(socket, { type: 'auth_message', auth_message_type: 'secret', auth_message: 'Pässword:' });
    assert.deepEqual(await receive(), { type: 'post_auth_message_response', response: 'fixture-secret' });
    await reply(socket, { type: 'success' });
    const start = await receive(); assert.equal(start.type, 'start_session'); assert.deepEqual(start.cmd.slice(0, 2), ['/bin/true', 'two words']);
    await reply(socket, { type: 'success' });
    assert.equal((await receive()).type, 'cancel_session');
    socket.end(length(1024 * 1024 + 1));
  })();
  task.catch(() => socket.destroy()); tasks.push(task);
});
try {
  server.listen(path.join(work, 'greetd.sock')); await once(server, 'listening');
  const env = { ...process.env, GREETD_SOCK: path.join(work, 'greetd.sock'), KOYA_LOGIN_SESSION_DIRS: sessions, XDG_RUNTIME_DIR: work };
  delete env.WAYLAND_DISPLAY;
  child = spawn(env.KOYA_BIN || 'koya', ['-m', root, '-n', path.join(root, 'build/native/modules'), '-i', 'tests/login-native.js'],
    { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  const [code] = await once(child, 'exit'); process.stdout.write(output);
  await Promise.all(tasks); assert.equal(code, 0); assert.match(output, /KOYA_LOGIN_TEST_PASS/); assert.doesNotMatch(output, /KOYA_LOGIN_TEST_FAIL/);
} finally { child?.kill(); server.close(); fs.rmSync(work, { recursive: true, force: true }); }
