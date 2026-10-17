import * as Login from 'Module/login';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';

const assert = (value, message) => { if (!value) throw new Error(message); };
export default function main() {
  setTimeout(async () => {
    try {
      const sessions = Login.sessions();
      assert(sessions.length === 1 && sessions[0].name === 'Fixture desktop', 'Session discovery filters hidden/unavailable entries');
      assert(sessions[0].cmd[0] === '/bin/true' && sessions[0].cmd[1] === 'two words' && sessions[0].cmd[2] === 'Fixture desktop', 'Session commands retain argument boundaries');
      assert(sessions[0].env.includes('XDG_CURRENT_DESKTOP=Fixture:Desktop'), 'Session environment follows desktop metadata');
      const first = Login.request(JSON.stringify({ type: 'create_session', username: 'fixture' }));
      let rejected = false;
      try { Login.request('{}'); } catch (_) { rejected = true; }
      assert(rejected, 'The transport rejects overlapping requests');
      const reply = await first;
      assert(reply.type === 'auth_message' && reply.auth_message === 'Pässword:', 'Fragmented UTF-8 replies are reassembled');
      assert((await Login.request(JSON.stringify({ type: 'post_auth_message_response', response: 'fixture-secret' }))).type === 'success', 'The same connection carries the conversation');
      assert((await Login.request(JSON.stringify({ type: 'start_session', cmd: sessions[0].cmd, env: sessions[0].env }))).type === 'success', 'Session start is acknowledged');
      rejected = false;
      try { await Login.request('{"type":"cancel_session"}'); } catch (_) { rejected = true; }
      assert(rejected, 'Oversized replies are rejected');
      rejected = false;
      try { await Login.request('{"type":"create_session","username":"fixture"}'); } catch (_) { rejected = true; }
      assert(rejected, 'Disconnected replies reject without hanging');
      Login.close(); Log.info('KOYA_LOGIN_TEST_PASS');
    } catch (error) { Log.error('KOYA_LOGIN_TEST_FAIL: ' + error); }
    finally { Login.close(); setTimeout(() => Engine.quit(), 50); }
  }, 0);
}
