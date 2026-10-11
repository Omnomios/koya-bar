export function createLockController({ authenticate, unlock, lockState, onStatus = () => {}, now = () => Date.now() }) {
  let busy = false, failures = 0, retryAt = 0, unlocked = false;
  return {
    get busy() { return busy; }, get unlocked() { return unlocked; },
    async submit(answer) {
      if (busy || unlocked) return false;
      if (now() < retryAt) { onStatus('Try again in a moment'); return false; }
      busy = true; onStatus('Checking…');
      try {
        if (!answer || await lockState() !== 'locked') throw new Error('No confirmed session lock');
        const result = await authenticate(answer); answer = '';
        if (result?.ok !== true || await lockState() !== 'locked') throw new Error('Authentication was not confirmed');
        if (await unlock() !== true) throw new Error('Session did not unlock');
        unlocked = true; failures = 0; onStatus(''); return true;
      } catch (_) {
        answer = ''; retryAt = now() + Math.min(30000, 1000 * 2 ** Math.min(failures++, 5));
        onStatus('Could not unlock. Check your password.'); return false;
      } finally { busy = false; }
    }
  };
}
