// The PAM plugin owns authentication, message delivery and helper cancellation.
// This adapter translates its generic outcome into the lock controller's states.
const SERVICE = 'koya-fingerprint';
const configurationErrors = new Set([1, 2, 3, 4, 19, 28]);
export function fingerprintOutcome(value, cancelled = false, timedOut = false) {
  if (cancelled || value?.phase === 'cancelled') return { ok: false, cancelled: true, reason: 'cancelled' };
  if (value?.ok === true && value.pamCode === 0 && value.phase === 'authentication')
    return { ok: true, cancelled: false, reason: 'success' };
  const reason = value?.phase === 'account' ? 'account' : value?.pamCode === 11 ? 'attempts'
    : value?.phase !== 'timeout' && (configurationErrors.has(value?.pamCode) || !Number.isInteger(value?.pamCode)) ? 'configuration' : 'retry';
  return { ok: false, cancelled: false, reason, ...(timedOut || value?.phase === 'timeout' ? { timedOut: true } : {}) };
}
export function createFingerprintAuth(pam, { user, configured = () => false }) {
  let active;
  const available = () => {
    try { return typeof pam.begin === 'function' && typeof user === 'string' && !!user && configured() === true; }
    catch (_) { return false; }
  };
  return {
    available,
    verify(onMessage = () => {}) {
      if (active) throw new Error('Fingerprint verification is already running');
      // Missing policy must never fall through to PAM's generic "other" policy.
      if (!available()) return Promise.resolve({ ok: false, cancelled: false, reason: 'configuration' });
      const request = { cancelled: false, timedOut: false };
      active = request;
      try {
        request.attempt = pam.begin({ service: SERVICE, user, timeoutMs: 35000,
          // Deliberately omit password: unexpected secret prompts fail closed.
          onMessage: event => {
            if (active !== request || request.cancelled || !['info', 'error'].includes(event?.type) || typeof event.message !== 'string') return;
            if (/verification timed out/i.test(event.message)) request.timedOut = true;
            onMessage(event.message, event.type);
          }
        });
        if (!request.attempt?.result || typeof request.attempt.cancel !== 'function') throw new Error('Unsupported PAM transaction API');
        request.result = Promise.resolve(request.attempt.result)
          .then(value => fingerprintOutcome(value, request.cancelled, request.timedOut), () => fingerprintOutcome(undefined, request.cancelled, request.timedOut))
          .finally(() => { if (active === request) active = undefined; });
        return request.result;
      } catch (error) { active = undefined; throw error; }
    },
    async cancel() {
      const request = active;
      if (!request) return;
      request.cancelled = true;
      await request.attempt.cancel();
      await request.result;
    }
  };
}
