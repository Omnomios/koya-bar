// Load the actual greeter and standard controls without reserving a DRM/VT
// device. The runner deliberately omits desktop-shell-only native plugins.
import { createGreeter } from '../apps/greeter.js';
import { Element, InputText } from '/rom/std/koya-ui.js';
import * as Login from 'Module/login';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';

export default function () {
  setTimeout(() => {
    try {
      if (typeof createGreeter !== 'function' || typeof Element.fromId !== 'function' || typeof InputText.create !== 'function')
        throw new Error('Greeter or standard input controls failed to load');
      const sessions = Login.sessions();
      if (!Array.isArray(sessions)) throw new Error('Login.sessions must return an array');
      for (const session of sessions) {
        if (typeof session.id !== 'string' || typeof session.name !== 'string' || !Array.isArray(session.cmd) || !Array.isArray(session.env))
          throw new Error('Invalid login session descriptor');
      }
      Log.info('KOYA_GREETER_MODULES_PASS');
    } catch (error) { Log.error('KOYA_GREETER_MODULES_FAIL: ' + error + '\n' + (error.stack || '')); }
    finally { setTimeout(() => Engine.quit(), 50); }
  }, 0);
}
