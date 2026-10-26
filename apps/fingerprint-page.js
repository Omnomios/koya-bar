import * as UI from './theme-ui.js';
import { system } from 'Module/dbus';
import { createFingerprintService, fingerName } from './fingerprint-model.js';
import { fingerprintHands } from './fingerprint-hands.js';
import { text, pill } from './touch-ui.js';
import { SPACE, TYPE, TEXT } from './theme.js';

export async function fingerprintPage(frame) {
  const page = await frame.newPage(SPACE.m), win = frame.win;
  const scroll = await frame.kit.scrollArea({ width: frame.width, height: frame.stageHeight - 24, gap: SPACE.s, id: 'fingerprints-content' });
  await UI.attach(win, page.el, scroll.id);
  let selected = '', armed = false, pending = false, rendering = Promise.resolve();
  let hands, status, action, actionLabel, cancel;
  const shortMessage = state => {
    if (state.enrolling) {
      const prompt = /^Touch the sensor with|Preparing/.test(state.message) ? 'Touch the sensor' : state.message === 'Lift your finger, then touch again' ? 'Lift and touch again' : state.message;
      return `${prompt} · ${state.completed}/${state.stages}`;
    }
    if (state.busy) return 'Connecting…';
    if (!state.available) return 'Reader unavailable';
    if (armed) return 'Remove ' + fingerName(selected).toLowerCase() + '?';
    if (state.message && !['Fingerprint added', 'Fingerprint removed'].includes(state.message)) return state.message;
    if (!selected) return 'Choose a finger';
    return fingerName(selected) + (state.fingers.includes(selected) ? ' · Enrolled' : '');
  };
  const render = state => {
    rendering = rendering.then(async () => {
      if (!page.alive) return;
      await hands.set({ fingers: state.fingers, selected, disabled: pending || state.busy || !state.available });
      await UI.setTextString(win, status, shortMessage(state));
      await UI.setTextString(win, actionLabel, !state.available ? 'Retry' : armed ? 'Remove?' : state.fingers.includes(selected) ? 'Remove' : 'Enroll');
      await UI.setEnabled(win, action, !state.busy && (!!selected || !state.available));
      await UI.setHitTarget(win, action, !pending && !state.busy);
      await UI.setEnabled(win, cancel, state.enrolling || armed);
      await UI.setHitTarget(win, cancel, !pending);
    }).catch(() => {});
  };
  const service = createFingerprintService(system, { changed: render });
  hands = await fingerprintHands(win, scroll.content, frame.width, finger => {
    if (pending || service.state.busy || !service.state.available) return;
    selected = finger; armed = false; render(service.state);
  });
  status = await text(win, scroll.content, 'Connecting…', TYPE.caption, frame.width, 40, TEXT.secondary);
  await UI.setElementId(win, status, 'fingerprints-status');
  const actions = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, justifyContent: 'center' }, item: { size: { x: frame.width, y: 36 } } });
  action = await pill(win, actions, 'Enroll', 112, async () => {
    if (pending || service.state.busy) return;
    if (!service.state.available) { await service.refresh(); return; }
    if (!selected) return;
    const finger = selected, remove = service.state.fingers.includes(finger);
    if (remove && !armed) { armed = true; render(service.state); return; }
    armed = false; pending = true; render(service.state);
    try {
      await frame.suspend();
      if (!page.alive) return;
      if (remove) await service.remove(finger); else await service.enroll(finger);
    } finally {
      pending = false; await frame.resume();
      if (page.alive) render(service.state);
    }
  }, { height: 32, onLabel: id => { actionLabel = id; } });
  cancel = await pill(win, actions, 'Cancel', 112, async () => {
    armed = false; await service.cancel(); render(service.state);
  }, { height: 32 });
  await UI.attach(win, scroll.content, actions);
  const height = hands.height + 40 + 36 + SPACE.s * 2;
  await scroll.setContentHeight(height);
  page.height = Math.min(height, frame.stageHeight - 24);
  page.items.push(scroll.id);
  page.dispose = async () => { page.alive = false; await service.dispose(); await rendering; await hands.dispose(); };
  await service.refresh();
  return page;
}
