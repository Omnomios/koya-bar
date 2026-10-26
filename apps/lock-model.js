export function createLockController({ authenticate, fingerprint, unlock, lockState, onStatus = () => {}, now = () => Date.now() }) {
  let busy = false, failures = 0, retryAt = 0, unlocked = false;
  let fingerprintBusy = false, generation = 0, verification;
  const cancelFingerprint = async () => {
    generation++;
    if (verification) { fingerprint.cancel(); await verification.catch(() => {}); }
  };
  const release = async () => {
    if (await lockState() !== 'locked') throw new Error('No confirmed session lock');
    if (await unlock() !== true) throw new Error('Session did not unlock');
    unlocked = true; failures = 0; onStatus(''); return true;
  };
  return {
    get busy() { return busy; }, get unlocked() { return unlocked; },
    get fingerprintBusy() { return fingerprintBusy; },
    cancelFingerprint,
    async scan() {
      if (!fingerprint || busy || fingerprintBusy || unlocked) return false;
      const token = ++generation;
      fingerprintBusy = true;
      try {
        if (await lockState() !== 'locked' || token !== generation || busy) return false;
        onStatus('Touch the fingerprint sensor, or enter your password');
        verification = Promise.resolve(fingerprint.verify());
        const result = await verification;
        if (token !== generation || busy || unlocked) return false;
        if (result?.ok !== true) { onStatus('Use your password or try your fingerprint again'); return false; }
        // Only one authentication method may commit the compositor handoff.
        busy = true;
        try { return await release(); } finally { busy = false; }
      } catch (_) {
        if (token === generation && !busy) onStatus('Fingerprint unavailable. Use your password.');
        return false;
      } finally {
        verification = undefined;
        fingerprintBusy = false;
      }
    },
    async submit(answer) {
      if (busy || unlocked) return false;
      if (now() < retryAt) { onStatus('Try again in a moment'); return false; }
      busy = true; onStatus('Checking…');
      try {
        await cancelFingerprint();
        if (!answer || await lockState() !== 'locked') throw new Error('No confirmed session lock');
        const result = await authenticate(answer); answer = '';
        if (result?.ok !== true) throw new Error('Authentication was not confirmed');
        return await release();
      } catch (_) {
        answer = ''; retryAt = now() + Math.min(30000, 1000 * 2 ** Math.min(failures++, 5));
        onStatus('Could not unlock. Check your password.'); return false;
      } finally { busy = false; }
    }
  };
}
