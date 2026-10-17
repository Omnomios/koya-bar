import { createGreeter } from '../apps/greeter.js';
import * as Log from 'Helix/Log';
import * as Engine from 'Helix/Engine';

// The login preview in a fullscreen window on the focused output, for working
// on the design inside a desktop session. Nothing authenticates; the
// password is "koya". Escape exits.
export default function main() {
  setTimeout(() => createGreeter({ preview: true, surface: 'window' }).catch(error => {
    Log.error('Login preview: ' + error); setTimeout(() => Engine.quit(), 50);
  }), 0);
}
