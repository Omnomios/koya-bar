const NAME = 'net.reactivated.Fprint', ROOT = '/net/reactivated/Fprint/Manager';
const DEVICE = NAME + '.Device', MANAGER = NAME + '.Manager';
export const fingers = ['left-thumb', 'left-index-finger', 'left-middle-finger', 'left-ring-finger', 'left-little-finger',
  'right-thumb', 'right-index-finger', 'right-middle-finger', 'right-ring-finger', 'right-little-finger'];
export const fingerName = finger => String(finger).replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
// The finger to offer first: index fingers, then thumbs, then the rest, right
// before left. Optionally limited to one hand.
const preference = ['index-finger', 'thumb', 'middle-finger', 'ring-finger', 'little-finger'];
export function suggestedFinger(enrolled, hand) {
  const order = preference.flatMap(kind => (hand ? [hand] : ['right', 'left']).map(side => side + '-' + kind));
  return order.find(finger => !enrolled.includes(finger)) || '';
}
// The enrollment heading: a few words for the person, not the reader.
export function enrollPrompt(message) {
  if (!message || /^Preparing/.test(message)) return 'Getting ready…';
  if (/^Touch the sensor with/.test(message)) return 'Touch the sensor';
  if (message === 'Lift your finger, then touch again') return 'Lift, then touch again';
  return message;
}
export function fingerprintError(error) {
  const text = String(error);
  if (/NoSuchDevice|ServiceUnknown|NameHasNoOwner/.test(text)) return 'No fingerprint reader available';
  if (/AlreadyInUse/.test(text)) return 'The fingerprint reader is in use. Try again.';
  if (/PermissionDenied|NotAuthorized|AccessDenied/.test(text)) return 'Permission to manage fingerprints was denied';
  return 'The fingerprint reader is unavailable. Try again.';
}
const prompts = {
  'enroll-retry-scan': 'Touch the sensor again',
  'enroll-swipe-too-short': 'Swipe across the whole sensor',
  'enroll-too-fast': 'Hold your finger a little longer',
  'enroll-finger-not-centered': 'Centre your finger on the sensor',
  'enroll-remove-and-retry': 'Lift your finger, then touch again',
  'enroll-duplicate': 'That fingerprint is already registered. Choose another finger.',
  'enroll-data-full': 'The reader is full. Remove a fingerprint first.',
  'enroll-failed': 'Could not save that fingerprint. Try again.',
  'enroll-disconnected': 'The fingerprint reader was disconnected',
  'enroll-unknown-error': 'The fingerprint reader reported an error'
};

// Enrollment only. Verification used to unlock the session is owned by PAM.
// All operations use the caller's account (empty username), never an arbitrary user.
export function createFingerprintService(bus, { changed = () => {}, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  // `events` counts the reader's enrollment reports, so a repeated prompt
  // (the same retry twice) still reads as a new one.
  const state = { available: false, busy: false, enrolling: false, name: '', fingers: [], stages: 0, completed: 0, events: 0, message: '' };
  let path = '', owner = '', connected = false, closed = false, claimed = false, active = false;
  let generation = 0, timer, queue = Promise.resolve();
  const publish = () => { if (!closed) changed({ ...state, fingers: [...state.fingers] }); };
  const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const call = (method, signature = '', ...args) => bus.call(NAME, path, DEVICE, method, signature, ...args);
  const cleanup = async () => {
    unschedule(timer); timer = undefined;
    if (active) { active = false; try { await call('EnrollStop'); } catch (_) {} }
    if (claimed) { claimed = false; try { await call('Release'); } catch (_) {} }
    state.enrolling = false;
  };
  const list = async () => {
    try { state.fingers = (await call('ListEnrolledFingers', 's', '')).filter(f => fingers.includes(f)); }
    catch (error) { if (/NoEnrolledPrints/.test(String(error))) state.fingers = []; else throw error; }
  };
  const signal = event => {
    if (closed) return;
    if (event.interface === 'org.freedesktop.DBus.Local' && event.member === 'Disconnected' ||
        event.interface === 'org.freedesktop.DBus' && event.member === 'NameOwnerChanged' && event.args?.[0] === NAME && event.args[1] === owner && event.args[2] !== owner) {
      generation++; active = claimed = false; owner = ''; unschedule(timer);
      state.available = state.busy = state.enrolling = false; state.message = 'The fingerprint reader was disconnected'; publish(); return;
    }
    if (!state.enrolling || event.path !== path || event.interface !== DEVICE || event.member !== 'EnrollStatus' || event.sender !== owner) return;
    const [result, done] = event.args || [];
    state.events++;
    if (result === 'enroll-stage-passed') { state.completed = Math.min(state.stages, state.completed + 1); state.message = 'Lift your finger, then touch again'; }
    else state.message = prompts[result] || (result === 'enroll-completed' ? 'Fingerprint added' : 'Touch the sensor again');
    publish();
    if (done === true) {
      const token = ++generation;
      // Stop accepting signals before awaiting Stop/Release.
      state.enrolling = false;
      serial(async () => {
        await cleanup();
        if (closed || token !== generation) return;
        try { await list(); } catch (error) { state.message = fingerprintError(error); }
        state.busy = false; publish();
      });
    }
  };
  const start = async () => {
    await bus.connect();
    if (!connected) {
      bus.onSignal(signal); connected = true;
      await bus.addMatch("type='signal',sender='net.reactivated.Fprint',interface='net.reactivated.Fprint.Device',member='EnrollStatus'");
      await bus.addMatch("type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='net.reactivated.Fprint'");
    }
    path = await bus.call(NAME, ROOT, MANAGER, 'GetDefaultDevice', '');
    owner = await bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetNameOwner', 's', NAME);
    const properties = await bus.call(NAME, path, 'org.freedesktop.DBus.Properties', 'GetAll', 's', DEVICE);
    state.name = properties.name || 'Fingerprint reader';
    state.stages = Math.max(1, Number(properties['num-enroll-stages']) || 1);
    await list(); state.available = true;
  };
  const cancel = () => {
    generation++; state.enrolling = false; unschedule(timer);
    return serial(async () => { await cleanup(); state.busy = false; state.message = ''; publish(); });
  };
  return {
    get state() { return { ...state, fingers: [...state.fingers] }; },
    refresh() {
      if (closed || state.busy) return Promise.resolve();
      state.busy = true; publish();
      return serial(async () => {
        try { await start(); state.message = ''; }
        catch (error) { state.available = false; state.message = fingerprintError(error); }
        finally { state.busy = false; publish(); }
      });
    },
    enroll(finger) {
      if (!fingers.includes(finger)) return Promise.reject(new Error('Invalid finger'));
      if (closed || !state.available || state.busy) return Promise.reject(new Error('Fingerprint reader is busy or unavailable'));
      if (state.fingers.includes(finger)) return Promise.reject(new Error('Remove the existing fingerprint before replacing it'));
      const token = ++generation;
      state.busy = true; state.completed = 0; state.message = 'Preparing the fingerprint reader…'; publish();
      return serial(async () => {
        try {
          await call('Claim', 's', ''); claimed = true;
          if (closed || token !== generation) { await cleanup(); return; }
          state.enrolling = true; active = true; state.message = 'Touch the sensor with your ' + fingerName(finger).toLowerCase(); publish();
          await call('EnrollStart', 's', finger);
          if (token !== generation || closed) { await cleanup(); return; }
          timer = schedule(() => { cancel().then(() => { state.message = 'Enrollment timed out. Try again.'; publish(); }); }, 90000);
        } catch (error) { await cleanup(); state.busy = false; state.message = fingerprintError(error); publish(); }
      });
    },
    remove(finger) {
      if (!fingers.includes(finger)) return Promise.reject(new Error('Invalid finger'));
      if (closed || !state.available || state.busy) return Promise.reject(new Error('Fingerprint reader is busy or unavailable'));
      const token = ++generation;
      state.busy = true; publish();
      return serial(async () => {
        try {
          await call('Claim', 's', ''); claimed = true;
          if (closed || token !== generation) return;
          await call('DeleteEnrolledFinger', 's', finger); await list(); state.message = 'Fingerprint removed';
        } catch (error) { state.message = fingerprintError(error); }
        finally { await cleanup(); state.busy = false; publish(); }
      });
    },
    cancel,
    async dispose() { closed = true; await cancel(); if (connected) bus.offSignal(signal); }
  };
}
