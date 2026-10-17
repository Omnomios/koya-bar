#!/usr/bin/env node
// Exercise real OpenSSH with disposable keys, sockets and fixture passphrases.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import readline from 'node:readline';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const binary = path.resolve(process.argv[2] || 'build/native/modules/koya-ssh-agent');
const wrapper = fileURLToPath(new URL('../ssh-add.sh', import.meta.url));
const secret = 'fixture 秘密 % password', processes = [];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'koya-ssh-test-'));
const deadline = (promise, ms = 8000) => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error('Fixture timed out')), ms); timer.unref();
})]);
const start = (cmd, args, env) => {
  const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.errors = '';
  child.stderr.on('data', chunk => { child.errors += chunk; });
  child.done = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  child.done.catch(() => {}); processes.push(child); return child;
};
const field = value => { const data = Buffer.from(value), length = Buffer.alloc(4); length.writeUInt32BE(data.length); return Buffer.concat([length, data]); };
const message = (type, ...parts) => Buffer.concat([Buffer.from([type]), ...parts]);
const request = (socketPath, payload) => {
  const result = new Promise((resolve, reject) => {
    let received = Buffer.alloc(0), completed = false;
    const socket = net.createConnection(socketPath);
    socket.setTimeout(8000, () => socket.destroy(new Error('Agent response timed out')));
    socket.once('connect', () => socket.write(field(payload)));
    socket.on('data', chunk => {
      received = Buffer.concat([received, chunk]);
      if (received.length >= 4 && received.length >= received.readUInt32BE(0) + 4) {
        completed = true; resolve(received.subarray(4, received.readUInt32BE(0) + 4)); socket.destroy();
      }
    });
    socket.on('error', reject); socket.on('close', () => { if (!completed) reject(new Error('Agent closed connection')); });
  });
  result.catch(() => {}); return result;
};
const waitSocket = async (file, child) => {
  const end = Date.now() + 5000;
  while (!fs.existsSync(file)) {
    assert.equal(child.exitCode, null, 'Fixture exited before socket creation: ' + child.errors);
    assert(Date.now() < end, 'Socket startup timed out'); await pause(20);
  }
};
try {
  const keys = path.join(work, 'keys'), runtime = path.join(work, 'runtime');
  fs.mkdirSync(keys, { mode: 0o700 }); fs.mkdirSync(runtime, { mode: 0o700 });
  const privateKey = path.join(keys, 'key with space 魚'), publicKey = privateKey + '.pub';
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', secret, '-C', 'fixture public key', '-f', privateKey]);
  const blob = Buffer.from(fs.readFileSync(publicKey, 'utf8').split(/\s+/)[1], 'base64');
  const sign = message(13, field(blob), field('fixture message'), Buffer.alloc(4));
  const upstream = path.join(work, 'upstream.sock'), sockets = path.join(runtime, 'koya-ssh');
  const agentSocket = path.join(sockets, 'agent.sock'), promptSocket = path.join(sockets, 'prompt.sock');
  const env = { ...process.env, SSH_AUTH_SOCK: agentSocket, KOYA_SSH_UPSTREAM: upstream, XDG_RUNTIME_DIR: runtime };
  const agent = start('ssh-agent', ['-D', '-a', upstream], { ...env, SSH_ASKPASS: '/bin/false', SSH_ASKPASS_REQUIRE: 'force', DISPLAY: 'fixture:0' });
  await waitSocket(upstream, agent);
  const proxy = start(binary, ['--agent-socket', agentSocket, '--prompt-socket', promptSocket, '--upstream', upstream, '--key-dir', keys], env);
  const queued = [], waiting = [];
  readline.createInterface({ input: proxy.stdout }).on('line', line => {
    const resolve = waiting.shift(); if (resolve) resolve(line); else queued.push(line);
  });
  const next = () => deadline(queued.length ? Promise.resolve(queued.shift()) : new Promise(resolve => waiting.push(resolve)));
  assert.equal(await next(), 'READY'); await waitSocket(promptSocket, proxy);
  assert.equal(fs.statSync(sockets).mode & 0o777, 0o700); assert.equal(fs.statSync(agentSocket).mode & 0o777, 0o600);
  const empty = message(12, Buffer.alloc(4));
  assert.deepEqual(await request(upstream, message(11)), empty);
  assert((await request(agentSocket, message(11))).includes(blob), 'Unloaded public key is advertised without a prompt');
  assert.equal((await request(agentSocket, message(13, field(blob))))[0], 5, 'Malformed requests do not unlock keys');
  assert.equal(queued.length, 0);
  const event = async kind => {
    const line = await next(), [type, id, value = ''] = line.split(' ');
    assert.equal(type, kind, 'Unexpected proxy event: ' + line); return [Number(id), decodeURIComponent(value)];
  };
  const answer = (id, value) => proxy.stdin.write(value === null ? 'C ' + id + '\n' : 'R ' + id + ' ' + encodeURIComponent(value) + '\n');

  const verify = start('ssh-add', ['-T', publicKey], env);
  let [id, text] = await event('P'); assert(text.includes(privateKey));
  answer(id, 'wrong fixture password'); assert.equal((await event('D'))[0], id);
  const [retry, retryText] = await event('P'); assert.notEqual(retry, id); assert(retryText.includes('Bad passphrase'));
  answer(retry, secret); assert.equal((await event('D'))[0], retry);
  assert.equal(await deadline(verify.done), 0, 'OpenSSH verifies the real signature');
  assert((await request(upstream, message(11))).includes(blob));
  assert.equal((await request(agentSocket, sign))[0], 14); assert.equal(queued.length, 0);

  assert.equal((await request(agentSocket, message(19)))[0], 6);
  const canceled = request(agentSocket, sign);
  [id] = await event('P'); answer(id, null); assert.equal((await event('D'))[0], id);
  assert.equal((await canceled)[0], 5); assert.deepEqual(await request(upstream, message(11)), empty);

  const first = request(agentSocket, sign), second = request(agentSocket, sign);
  [id] = await event('P'); answer(id, secret); assert.equal((await event('D'))[0], id);
  assert.equal((await first)[0], 14); assert.equal((await second)[0], 14); assert.equal(queued.length, 0);

  await request(upstream, message(19));
  const manual = start(wrapper, ['-c', privateKey], env);
  [id] = await event('P'); answer(id, secret); assert.equal((await event('D'))[0], id);
  assert.equal(await deadline(manual.done), 0);
  assert.equal((await request(agentSocket, sign))[0], 5, 'Loaded confirmation constraints survive proxying');
  assert.equal(queued.length, 0);

  const lock = field('fixture agent lock');
  assert.equal((await request(agentSocket, message(22, lock)))[0], 6);
  assert.deepEqual(await request(agentSocket, message(11)), empty);
  assert.equal((await request(agentSocket, sign))[0], 5); assert.equal(queued.length, 0);
  assert.equal((await request(agentSocket, message(23, lock)))[0], 6); await request(upstream, message(19));

  const abandoned = net.createConnection(agentSocket);
  abandoned.on('error', () => {}); abandoned.once('connect', () => abandoned.write(field(sign)));
  [id] = await event('P'); abandoned.destroy(); assert.equal((await event('D'))[0], id);
  assert.deepEqual(await request(upstream, message(11)), empty);
  for (let i = 0; i < 80; i++) assert((await request(agentSocket, message(11))).includes(blob));
  await pause(400); assert(fs.readdirSync('/proc/' + proxy.pid + '/task').length < 8, 'Connections do not accumulate threads');
  assert.deepEqual(fs.readdirSync(keys).sort(), [path.basename(privateKey), path.basename(publicKey)].sort(), 'No extra key or password store');

  const blocked = request(agentSocket, sign);
  await event('P'); proxy.stdin.end(); assert.equal(await deadline(proxy.done), 0);
  try { assert.equal((await blocked)[0], 5); } catch (error) { assert.match(error.message, /closed connection|ECONNRESET/); }
  assert(!fs.existsSync(agentSocket) && !fs.existsSync(promptSocket)); assert(!proxy.errors.includes(secret));
  console.log('OpenSSH first use, retries, cancellation, concurrency, constraints and shutdown: passed');
} finally {
  for (const child of processes.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill();
    try { await deadline(child.done, 3000); } catch (_) { child.kill('SIGKILL'); await child.done.catch(() => {}); }
  }
  fs.rmSync(work, { recursive: true, force: true });
}
