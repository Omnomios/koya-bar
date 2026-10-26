import * as UI from './theme-ui.js';
import { system } from 'Module/dbus';
import * as Fingerprint from 'Module/fingerprint';
import { createFingerprintService, fingers, fingerName } from './fingerprint-model.js';
import { text, pill } from './touch-ui.js';
import { SPACE, TYPE, TEXT, FONT } from './theme.js';

export async function fingerprintPage(frame) {
  const page = await frame.newPage(SPACE.m), win = frame.win;
  const scroll = await frame.kit.scrollArea({ width: frame.width, height: frame.stageHeight - 24, gap: SPACE.s, id: 'fingerprints-content' });
  await UI.attach(win, page.el, scroll.id);
  const status = await text(win, scroll.content, 'Looking for a fingerprint reader…', TYPE.caption, frame.width, 40, TEXT.accent, FONT, 'left');
  await UI.setElementId(win, status, 'fingerprints-status');
  const rows = [], controls = [];
  let armed = '', rendering = Promise.resolve(), pending = false;
  const render = state => {
    // Serialize UI updates so a late busy render cannot overwrite completion.
    rendering = rendering.then(async () => {
      if (!page.alive) return;
      const progress = state.enrolling ? ` (${state.completed}/${state.stages})` : '';
      await UI.setTextString(win, status, (state.message || (state.available ? 'Add a finger to sign in and unlock' : 'No fingerprint reader available')) + progress);
      for (const item of rows) {
        const enrolled = state.fingers.includes(item.finger);
        await UI.setTextString(win, item.label, armed === item.finger ? 'Confirm' : enrolled ? 'Remove' : 'Add');
        await UI.setHitTarget(win, item.action, state.available && !state.busy && !pending);
      }
      await UI.setHitTarget(win, controls[0], !pending && state.busy);
      await UI.setHitTarget(win, controls[1], !pending && !state.busy);
    }).catch(() => {});
  };
  const service = createFingerprintService(system, { changed: render });
  for (const finger of fingers) {
    const line = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: frame.width, y: 40 } } });
    await text(win, line, fingerName(finger), TYPE.body, frame.width - 100 - SPACE.s, 40, TEXT.primary, FONT, 'left');
    let label;
    const action = await pill(win, line, 'Add', 100, async () => {
      if (pending || service.state.busy) return;
      if (service.state.fingers.includes(finger) && armed !== finger) {
        armed = finger;
        for (const item of rows) await UI.setTextString(win, item.label, item.finger === finger ? 'Confirm' : service.state.fingers.includes(item.finger) ? 'Remove' : 'Add');
        await UI.setTextString(win, status, 'Remove your ' + fingerName(finger).toLowerCase() + ' fingerprint?');
        return;
      }
      armed = ''; pending = true;
      try {
        // fprintd may ask polkit to authorize enrollment/removal. Let its
        // normal authentication window take focus, then return to the reader.
        await frame.suspend();
        if (!page.alive) return;
        if (service.state.fingers.includes(finger)) await service.remove(finger);
        else await service.enroll(finger);
      } catch (_) {
        if (page.alive) await UI.setTextString(win, status, 'Could not update fingerprints. Try again.');
      } finally {
        pending = false; await frame.resume();
        if (page.alive) render(service.state);
      }
    }, { height: 28, onLabel: value => { label = value; } });
    await UI.setElementId(win, action, 'fingerprint-' + finger);
    await UI.attach(win, scroll.content, line);
    rows.push({ finger, label, action });
  }
  const actions = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m }, item: { size: { x: frame.width, y: 36 } } });
  controls.push(await pill(win, actions, 'Cancel', 100, () => service.cancel(), { height: 32 }));
  controls.push(await pill(win, actions, 'Refresh', 100, () => { armed = ''; return service.refresh(); }, { height: 32 }));
  await UI.attach(win, scroll.content, actions);
  let height = 40 + fingers.length * (40 + SPACE.s) + 36 + SPACE.s;
  if (!Fingerprint.available()) {
    await text(win, scroll.content, 'Fingerprint unlock is not enabled on this system yet.', TYPE.caption, frame.width, 40, TEXT.secondary, FONT, 'left');
    height += 40 + SPACE.s;
  }
  await scroll.setContentHeight(height);
  page.height = Math.min(height, frame.stageHeight - 24);
  page.items.push(scroll.id);
  page.dispose = async () => { page.alive = false; await service.dispose(); await rendering; };
  await service.refresh();
  return page;
}
