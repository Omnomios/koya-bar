export function createLockController({ authenticate, fingerprint, unlock, lockState, onStatus = () => {}, now = () => Date.now() }) {
  let busy = false, failures = 0, retryAt = 0, unlocked = false;
  let fingerprintBusy = false, generation = 0, verification, fingerprintRetry = 0, watchGeneration = 0, fingerprintLimited = false;
  const cancelFingerprint = async () => {
    generation++; watchGeneration++;
    if (verification) { fingerprint.cancel(); await verification.catch(() => {}); }
  };
  const release = async () => {
    if (await lockState() !== 'locked') throw new Error('No confirmed session lock');
    if (await unlock() !== true) throw new Error('Session did not unlock');
    unlocked = true; failures = 0; onStatus(''); return true;
  };
  return {
    get busy() { return busy; }, get unlocked() { return unlocked; },
    get fingerprintRetry() { return fingerprintRetry; },
    get fingerprintBusy() { return fingerprintBusy; },
    cancelFingerprint,
    async scanWhile({ enabled, changed = async () => {}, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
      if (fingerprintBusy || busy || unlocked) return false;
      const watching = ++watchGeneration;
      let retries = 0;
      while (watching === watchGeneration && enabled()) {
        const checking = this.scan();
        await changed();
        if (await checking) return true;
        await changed();
        if (watching !== watchGeneration || !enabled() || !fingerprintRetry) return false;
        // Failed transactions release the reader before retrying. Back off if
        // the device repeatedly fails instead of spinning new PAM processes.
        const delay = fingerprintLimited ? Math.min(30000, fingerprintRetry * 2 ** Math.min(retries++, 5)) : fingerprintRetry;
        onStatus(`Scanning resumes in ${Math.ceil(delay / 1000)} seconds. Password also works.`);
        await pause(delay);
      }
      return false;
    },
    async scan() {
      if (!fingerprint || busy || fingerprintBusy || unlocked) return false;
      const token = ++generation;
      fingerprintBusy = true; fingerprintRetry = 0; fingerprintLimited = false;
      try {
        if (await lockState() !== 'locked' || token !== generation || busy) return false;
        onStatus('Touch the fingerprint sensor, or enter your password');
        verification = Promise.resolve(fingerprint.verify(message => {
          if (token === generation && !busy && !unlocked && typeof message === 'string') onStatus(message);
        }));
        const result = await verification;
        if (token !== generation || busy || unlocked) return false;
        if (result?.ok !== true) {
          if (result?.cancelled) return false;
          if (['configuration', 'account'].includes(result?.reason)) {
            onStatus('Fingerprint unavailable. Use your password.'); return false;
          }
          fingerprintLimited = result?.reason === 'attempts';
          fingerprintRetry = 2000;
          onStatus(result?.reason === 'attempts' ? 'Too many attempts. Restarting shortly…' : 'Restarting fingerprint scan…');
          return false;
        }
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
