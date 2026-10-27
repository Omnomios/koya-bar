// pam_fprintd writes terminal sentences. The lock shows the sensor on a
// badge, so each one reduces to a reaction and, at most, a few words.
// Prompts to touch the sensor say nothing the badge does not. Unrecognised
// (for example translated) messages pass through unchanged.
export const SENSOR_PROMPT = 'Touch the sensor';
const sensorMessages = [
  [/timed out/i, null, SENSOR_PROMPT],
  [/failed to match|no match/i, 'mismatch', 'Not recognised'],
  [/too short/i, 'adjust', 'Swipe the whole sensor'],
  [/not cent(ered|red)/i, 'adjust', 'Centre your finger'],
  [/remove your finger/i, 'adjust', 'Lift, then touch again'],
  [/\bagain\b/i, 'adjust', 'Try again'],
  [/^(place|swipe|touch|put) your|unknown error|disconnected/i, null, SENSOR_PROMPT]
];
export function sensorMessage(message) {
  const text = String(message).trim();
  const [, reaction, words] = sensorMessages.find(([pattern]) => pattern.test(text)) || [null, null, text];
  return { reaction, text: words };
}

// onStatus(text, tone) is the line under the password ('info' or 'error').
// onSensor(phase, detail) drives the fingerprint badge: the phases
// 'listening', 'paused', 'resting' ({ resumeAt }), 'unavailable' and
// 'matched' persist; 'mismatch' and 'adjust' are reactions while listening.
export function createLockController({ authenticate, fingerprint, unlock, lockState, wakeDisplay = () => {}, onStatus = () => {}, onSensor = () => {}, now = () => Date.now() }) {
  let busy = false, failures = 0, retryAt = 0, unlocked = false;
  let fingerprintBusy = false, generation = 0, verification, fingerprintRetry = 0, watchGeneration = 0, fingerprintLimited = false;
  const cancelFingerprint = async () => {
    generation++; watchGeneration++;
    const pending = verification;
    if (pending) { await fingerprint.cancel(); await pending.catch(() => {}); }
    if (!unlocked) onSensor('paused');
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
        // A timed-out scan restarts quietly; the badge keeps listening.
        const delay = fingerprintLimited ? Math.min(30000, fingerprintRetry * 2 ** Math.min(retries++, 5)) : fingerprintRetry;
        if (fingerprintLimited) onSensor('resting', { resumeAt: now() + delay });
        await pause(delay);
      }
      return false;
    },
    async scan() {
      if (!fingerprint || busy || fingerprintBusy || unlocked) return false;
      const token = ++generation;
      fingerprintBusy = true; fingerprintRetry = 0; fingerprintLimited = false;
      let wake;
      const wakeCurrent = () => Promise.resolve().then(() => {
        if (token === generation && !busy && !unlocked) return wakeDisplay();
      }).catch(() => {});
      const wakeOnce = () => { if (!wake) wake = wakeCurrent(); return wake; };
      try {
        if (await lockState() !== 'locked' || token !== generation || busy) return false;
        onSensor('listening'); onStatus(SENSOR_PROMPT);
        verification = Promise.resolve(fingerprint.verify((message, type) => {
          if (token !== generation || busy || unlocked || typeof message !== 'string') return;
          const { reaction, text } = sensorMessage(message);
          if (reaction || type === 'error' && !/timed out/i.test(message)) wakeOnce();
          if (reaction) onSensor(reaction);
          onStatus(text, reaction === 'mismatch' ? 'error' : 'info');
          // An error lingers, then the prompt returns: PAM is still listening.
          if (reaction === 'mismatch') onStatus(SENSOR_PROMPT);
        }));
        const result = await verification;
        if (token !== generation || busy || unlocked) return false;
        if (result?.ok === true) await wakeCurrent();
        else if (!result?.cancelled && !result?.timedOut && result?.reason !== 'configuration') await wakeOnce();
        if (token !== generation || busy || unlocked) return false;
        if (result?.ok !== true) {
          if (result?.cancelled) return false;
          if (['configuration', 'account'].includes(result?.reason)) {
            onSensor('unavailable'); onStatus('Fingerprint unavailable'); return false;
          }
          fingerprintLimited = result?.reason === 'attempts';
          fingerprintRetry = 2000;
          if (fingerprintLimited) { onSensor('mismatch'); onStatus('Too many attempts', 'error'); }
          return false;
        }
        // Only one authentication method may commit the compositor handoff.
        onSensor('matched');
        busy = true;
        try { return await release(); } finally { busy = false; }
      } catch (_) {
        if (token === generation && !busy) { onSensor('unavailable'); onStatus('Fingerprint unavailable'); }
        return false;
      } finally {
        verification = undefined;
        fingerprintBusy = false;
      }
    },
    async submit(answer) {
      if (busy || unlocked) return false;
      if (now() < retryAt) { onStatus(`Try again in ${Math.ceil((retryAt - now()) / 1000)}s`, 'error'); return false; }
      // The Unlock button shows the check in progress.
      busy = true; onStatus('');
      let refused = false;
      try {
        await cancelFingerprint();
        if (!answer || await lockState() !== 'locked') throw new Error('No confirmed session lock');
        const result = await authenticate(answer); answer = '';
        if (result?.ok !== true) { refused = result?.ok === false; throw new Error('Authentication was not confirmed'); }
        return await release();
      } catch (_) {
        answer = ''; retryAt = now() + Math.min(30000, 1000 * 2 ** Math.min(failures++, 5));
        onStatus(refused ? 'Incorrect password' : 'Could not unlock', 'error'); return false;
      } finally { busy = false; }
    }
  };
}
