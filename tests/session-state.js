import assert from './assert.js';
import * as Log from 'Helix/Log';
import { resolveSession } from '../apps/session-state-model.js';
export async function test() {
  let failure, properties = { Id: '3', Name: 'fixture', Remote: false, Active: true, Type: 'wayland' };
  const calls = [];
  const bus = { connect: async () => {}, call: async (name, path, iface, method, signature, value) => {
    calls.push([method, value]);
    if (method === 'GetSessionByPID') { if (failure) throw new Error(failure); return '/session/pid'; }
    if (method === 'GetSession') return '/session/3';
    if (method === 'GetAll') return properties;
    assert.fail('Unexpected call: ' + method);
  } };
  const context = { pid: 42, sessionId: '3', username: 'fixture' };
  assert.equal(await resolveSession(bus, context), '/session/pid');
  assert.deepEqual(calls, [['GetSessionByPID', 42]]);
  failure = 'ERROR:org.freedesktop.login1.NoSessionForPID: PID 42 does not belong to any known session';
  calls.length = 0;
  assert.equal(await resolveSession(bus, context), '/session/3');
  assert.deepEqual(calls, [['GetSessionByPID', 42], ['GetSession', '3'], ['GetAll', 'org.freedesktop.login1.Session']]);
  // Retain a known session across VT switching, including desktops started on a TTY.
  properties.Active = false; properties.Type = 'tty';
  assert.equal(await resolveSession(bus, context), '/session/3');
  for (const field of [{ Name: 'someone-else' }, { Id: '4' }, { Remote: true }]) {
    const original = properties; properties = { ...properties, ...field };
    await assert.rejects(resolveSession(bus, context), /local session/); properties = original;
  }
  calls.length = 0;
  await assert.rejects(resolveSession(bus, { ...context, sessionId: '' }), /NoSessionForPID/);
  assert.equal(calls.length, 1);
  failure = 'org.freedesktop.DBus.Error.AccessDenied'; calls.length = 0;
  await assert.rejects(resolveSession(bus, context), /AccessDenied/); assert.equal(calls.length, 1);
  Log.info('Session lookup by PID and validated inherited session: passed');
}
