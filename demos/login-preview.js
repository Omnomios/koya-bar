import { createGreeter } from '../apps/greeter.js';
import * as Log from 'Helix/Log';
import * as Engine from 'Helix/Engine';

export default function main() {
  setTimeout(() => createGreeter({ preview: true }).catch(error => {
    Log.error('Login preview: ' + error); setTimeout(() => Engine.quit(), 50);
  }), 0);
}
