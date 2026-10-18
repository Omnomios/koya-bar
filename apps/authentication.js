import * as Polkit from 'Module/polkit-agent';
import * as Log from 'Helix/Log';
import { createAuthentication } from './authentication-model.js';
import { showAuthenticationPrompt } from './authentication-prompt.js';
import { watchSession } from './session-state.js';

export function authentication(changed) {
  const prompts = createAuthentication({ backend: Polkit,
    show: showAuthenticationPrompt,
    onError: error => Log.error('Authentication: ' + (error?.message || 'Could not display the prompt')) });
  return { ...prompts, start: () => watchSession(state => {
    changed(state);
    const registered = prompts.setAvailable(state.Active && state.ScreenState === 'unlocked');
    if (registered === false) Log.warn('Koya could not register its polkit agent; check for another session authentication agent');
  }).catch(error => Log.error('Session authentication: ' + error)) };
}
