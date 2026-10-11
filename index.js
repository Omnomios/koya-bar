import * as Log from 'Helix/Log';
import * as Engine from 'Helix/Engine';
import { startShell } from './apps/shell.js';

export default function main() {
  // Native promises require the engine's event loop to be running.
  setTimeout(() => startShell().catch(error => {
    Log.error('Desktop shell: ' + error);
    if (error?.stack) Log.error(error.stack);
    Engine.quit();
  }), 0);
}
