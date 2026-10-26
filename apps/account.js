import * as UI from './theme-ui.js';
import * as Desktop from 'Module/desktop';
import * as Log from 'Helix/Log';
import { accounts } from './accounts.js';
import { appFrame, glyph } from './app-frame.js';
import { userAvatar } from './user-avatar.js';
import { textInput } from './text-input.js';
import { passwordInput } from './password-input.js';
import { chooseImage } from './portal.js';
import { button, pill, icon, text, toggle, children } from './touch-ui.js';
import { greeterAutologin } from './greeter-autologin.js';
import { fingerprintPages } from './fingerprint-page.js';
import { presets } from './motion.js';
import { SPACE, TYPE, TEXT, SURFACE, CLEAR, HIGHLIGHT, FONT, FONT_STRONG, configureTheme } from './theme.js';

const AVATAR = 88, RING = 4, BADGE = 26, FIELD = 36, ROW = 44, KEY_WIDTH = 72, ACTION_WIDTH = 88;
const pad = value => String(value).padStart(2, '0');
// Local time, ISO-shaped like the clock's date.
const when = ms => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const details = profile => [
  { key: 'Last sign-in', value: profile.lastLogin ? when(profile.lastLogin) : '—' },
  { key: 'Account', value: profile.administrator === true ? 'Administrator' : profile.administrator === false ? 'Standard' : '—' },
  { key: 'Home', value: profile.home || '—' },
  { key: 'Shell', value: profile.shell || '—' }
];

// This app edits the current account through AccountsService (and the
// password through passwd). It does not change the login name or store a
// separate Koya profile.
//
// The person is centred at the top: their picture (the button that changes
// it), name, login name and account type. Under it, cards: Profile (name and
// email, one Save that lights up once something differs), Sign-in (the
// password, changed on its own page) and Details.
export default async function main() {
  await configureTheme(Desktop.loadPreferences());
  const username = Desktop.userName();
  let busy = false, profile;
  const drafts = { name: '', email: '' }, edited = { name: false, email: false };
  const frame = await appFrame({ title: 'Account', namespace: 'koya-account',
    onBack: () => go(frame.current?.back || overview, -1), onClose: () => frame.current?.dispose?.() });
  // Pages may name where Back leads (`page.back`); otherwise the overview.
  const fingerprints = fingerprintPages(frame, (build, direction) => go(build, direction));
  const titles = new Map([[fingerprints.list, 'Fingerprints'], [fingerprints.add, 'Add Fingerprint'], [passwordPage, 'Password']]);
  const go = (build, direction) => frame.go(build, { title: build === overview ? 'Account' : titles.get(build), back: build !== overview, direction });
  const report = (action, error) => {
    Log.error('Account ' + action + ': ' + error);
    frame.flash(/denied|authorized|permission/i.test(String(error)) ? 'Permission to change your account was denied' : 'Could not ' + action, TEXT.accent, 4000);
  };
  const saved = () => ({ name: profile?.name || username, email: profile?.email || '' });
  const changed = () => !busy && (drafts.name.trim() !== saved().name || drafts.email.trim() !== saved().email);
  const changePicture = async () => {
    if (busy || frame.closing) return;
    busy = true;
    try {
      // Leave both the chooser and any system authorization prompt visible.
      await frame.suspend();
      const uri = await chooseImage('Choose your account picture');
      if (!uri || frame.closing) return;
      const path = await Desktop.prepareAvatar(uri);
      if (frame.closing) return;
      await accounts.setIcon(username, path);
    } catch (error) { report('change your picture', error); }
    finally { busy = false; await frame.resume(); }
  };
  const saveProfile = async () => {
    if (!changed() || frame.closing) return;
    const next = { name: drafts.name.trim(), email: drafts.email.trim() }, before = saved();
    busy = true; frame.current?.saving?.(true);
    try {
      await frame.suspend();
      if (next.name !== before.name) await accounts.setName(username, next.name);
      if (next.email !== before.email) await accounts.setEmail(username, next.email);
      for (const key of ['name', 'email']) if (drafts[key].trim() === next[key]) edited[key] = false;
    } catch (error) { report('save your profile', error); frame.current?.refused?.(); }
    finally { busy = false; await frame.resume(); frame.current?.saving?.(false); }
  };

  // A muted caption with an optional trailing control, over a card.
  const section = async (page, caption, trailing) => {
    const header = await UI.createElement(frame.win, { layout: { type: 'row', alignItems: 'center' }, item: { size: { x: frame.width, y: 28 } } });
    const label = await text(frame.win, header, caption, TYPE.caption, frame.width - (trailing ? ACTION_WIDTH : 0), 28, TEXT.secondary, FONT, 'left');
    // Siblings sort by order, then creation; the trailing control often exists first.
    if (trailing) await Promise.all([UI.setLayoutOrder(frame.win, label, 0), UI.setLayoutOrder(frame.win, trailing, 1), UI.attach(frame.win, header, trailing)]);
    await UI.attach(frame.win, page, header);
    return { header, label };
  };
  // An inset card holding rows of `ROW` height.
  const card = async (page, rows) => {
    const height = rows * ROW + SPACE.s * 2;
    const surface = await frame.kit.surface('inset', { size: { x: frame.width, y: height }, layout: { type: 'column' },
      padding: { t: SPACE.s, r: SPACE.m, b: SPACE.s, l: SPACE.m } });
    await UI.attach(frame.win, page, surface.id);
    return { ...surface, height };
  };
  // A labelled row: the key, then the given control.
  const row = async (parent, key, control, keyWidth = KEY_WIDTH) => {
    const line = await UI.createElement(frame.win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: 'auto', y: ROW } } });
    const label = await text(frame.win, line, key, TYPE.caption, keyWidth, ROW, TEXT.secondary, FONT, 'left');
    await Promise.all([UI.setLayoutOrder(frame.win, label, 0), UI.setLayoutOrder(frame.win, control, 1), UI.attach(frame.win, line, control)]);
    await UI.attach(frame.win, parent, line);
    return line;
  };

  async function overview() {
    const page = await frame.newPage(SPACE.m);
    page.hint = '';
    const win = frame.win, kit = frame.kit, inner = frame.width - SPACE.m * 2 - KEY_WIDTH - SPACE.s;
    const slot = AVATAR + RING * 2;
    const content = await kit.scrollArea({ width: frame.width, height: frame.stageHeight - SPACE.xs - 20, gap: SPACE.s, id: 'account-content' });
    await UI.attach(win, page.el, content.id);
    const column = content.content;
    let avatar, saveLabel, feedback, ready, shownIcon;

    // The person, centred: each line is a full-width row that centres it.
    const centred = async (child, height) => {
      const line = await UI.createElement(win, { layout: { type: 'row', justifyContent: 'center' }, item: { size: { x: frame.width, y: height } } });
      await UI.attach(win, line, child); await UI.attach(win, column, line);
      return line;
    };
    const picture = await button(win, null, '', slot, slot, changePicture, { colour: CLEAR, hover: HIGHLIGHT.hover, radius: slot / 2,
      pressScale: 0.94, element: { layout: { type: 'none' } } });
    avatar = await userAvatar(win, { size: AVATAR, id: 'account-avatar' });
    const badge = await UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.accent, cornerRadius: BADGE / 2, cornerResolution: 32 },
      layout: { type: 'none' }, item: { size: { x: BADGE, y: BADGE }, margin: { t: slot - BADGE, r: 0, b: 0, l: slot - BADGE } }, contentAlign: 'fill' });
    const badgeGlyph = await icon(win, badge, glyph('add'), 12, 'auto', 'auto');
    await Promise.all([UI.setMargin(win, avatar.id, { t: RING, r: RING, b: RING, l: RING }), UI.attach(win, picture, avatar.id), UI.attach(win, picture, badge),
      ...[badge, badgeGlyph].map(id => UI.setHitTarget(win, id, false)), UI.setElementId(win, picture, 'account-change-picture')]);
    const [heading, subline] = await Promise.all([
      text(win, null, saved().name, TYPE.title, frame.width, 28, TEXT.primary, FONT_STRONG),
      text(win, null, username, TYPE.caption, frame.width, 18, TEXT.secondary)
    ]);
    const hero = [await centred(picture, slot), await centred(heading, 28), await centred(subline, 18)];
    await UI.setElementId(win, heading, 'account-heading');
    await UI.setMargin(win, hero[2], { t: 0, r: 0, b: SPACE.m, l: 0 });

    // Profile: name and email, one Save.
    const save = await pill(win, null, 'Save', ACTION_WIDTH, saveProfile, { height: 28, onLabel: id => { saveLabel = id; }, onFeedback: value => { feedback = value; } });
    const profileHeader = await section(column, 'Profile', save);
    const profileCard = await card(column, 2);
    const field = (key, placeholder, extra = {}) => textInput(win, { width: inner, height: FIELD, size: TYPE.body, id: 'account-' + key, textId: 'account-' + key + '-text',
      placeholder, value: drafts[key], maxLength: 256, onInput: value => { drafts[key] = value; edited[key] = true; refresh(); }, onSubmit: saveProfile, ...extra });
    const [nameInput, emailInput] = await Promise.all([field('name', username), field('email', 'name@example.org')]);
    const profileRows = [await row(profileCard.content, 'Name', nameInput.master.id), await row(profileCard.content, 'Email', emailInput.master.id)];
    await UI.setElementId(win, save, 'account-save');

    // Sign-in: the password, changed on its own page, and (with the Koya
    // greeter installed) automatic login.
    const autologin = greeterAutologin.available(), hasFingerprints = await fingerprints.available();
    await section(column, 'Sign-in');
    const signInCard = await card(column, 1 + Number(autologin) + Number(hasFingerprints));
    const change = await pill(win, null, 'Change…', ACTION_WIDTH, () => go(passwordPage, 1), { height: 28 });
    const passwordLine = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: 'auto', y: ROW } } });
    const passwordParts = [await text(win, passwordLine, 'Password', TYPE.caption, KEY_WIDTH, ROW, TEXT.secondary, FONT, 'left'),
      await text(win, passwordLine, '••••••••', TYPE.body, inner - ACTION_WIDTH - SPACE.s, ROW, TEXT.primary, FONT, 'left'), change];
    await Promise.all([...passwordParts.map((id, index) => UI.setLayoutOrder(win, id, index)), UI.attach(win, passwordLine, change)]);
    await UI.attach(win, signInCard.content, passwordLine);
    await UI.setElementId(win, change, 'account-change-password');
    if (hasFingerprints) {
      // Enrollment is available even when this reader has no enrolled fingers.
      const manageHolder = await UI.createElement(win, { layout: { type: 'row', justifyContent: 'end' }, item: { size: { x: inner, y: ROW } } });
      const manage = await pill(win, manageHolder, 'Manage…', ACTION_WIDTH, () => go(fingerprints.list, 1), { height: 28 });
      await row(signInCard.content, 'Fingerprints', manageHolder);
      await UI.setElementId(win, manage, 'account-fingerprints');
    }
    let autologinSwitch, autologinOn = false, autologinBusy = false;
    const toggleAutologin = async () => {
      if (autologinBusy || busy || frame.closing) return;
      autologinBusy = true;
      const wanted = !autologinOn;
      // Moves at once; slides back if the change does not happen.
      await autologinSwitch.set(wanted);
      try {
        // The authorization prompt is a normal window: step aside for it.
        await frame.suspend();
        const outcome = await greeterAutologin.set(wanted);
        if (outcome === 'denied') report('change automatic login', new Error('permission denied'));
      } finally { await frame.resume(); }
      autologinOn = (await greeterAutologin.user()) === username;
      await autologinSwitch.set(autologinOn);
      autologinBusy = false;
    };
    if (autologin) {
      const holder = await UI.createElement(win, { layout: { type: 'row', justifyContent: 'end' }, item: { size: { x: inner, y: ROW } } });
      autologinSwitch = await toggle(win, holder, false, toggleAutologin);
      await row(signInCard.content, 'Automatic', holder);
      await UI.setElementId(win, autologinSwitch.id, 'account-autologin');
      greeterAutologin.user().then(name => { autologinOn = name === username; return autologinSwitch.set(autologinOn); }).catch(() => {});
    }

    // Details: what AccountsService knows, read-only.
    await section(column, 'Details');
    const facts = await kit.keyValue(details(profile || { administrator: null }), { keyWidth: KEY_WIDTH + SPACE.s });
    await UI.attach(win, column, facts.id);

    const height = slot + 28 + 18 + SPACE.m + 28 * 3 + profileCard.height + signInCard.height + facts.height + SPACE.s * 9;
    await content.setContentHeight(height);
    page.height = SPACE.xs + Math.min(height, frame.stageHeight - SPACE.xs - 20);
    page.items.push(...hero, profileHeader.header, profileCard.id, signInCard.id, facts.id);

    // Save is the thing to do only while something differs; it pops when it becomes so.
    const refresh = () => {
      const on = changed();
      Promise.all([UI.setHitTarget(win, save, on), UI.setBoxColour(win, save, on ? SURFACE.accent : SURFACE.control),
        UI.setTextColour(win, saveLabel, on ? TEXT.onAccent : TEXT.disabled)]).catch(() => {});
      if (on && ready === false) kit.play(save, presets.pop(0, 0.85));
      ready = on;
    };
    page.refused = () => profileRows.forEach(line => kit.play(line, presets.shake()));
    page.saving = on => { (on ? feedback?.begin() : feedback?.end())?.catch?.(() => {}); refresh(); };
    avatar.setUser(username);
    const unsubscribe = accounts.watch(username, value => {
      if (!page.alive) return;
      const renamed = profile && value.name !== profile.name, repictured = shownIcon !== undefined && value.icon !== shownIcon;
      profile = value; shownIcon = value.icon;
      const typeLine = value.administrator === true ? ' · Administrator' : '';
      Promise.all([UI.setTextString(win, heading, value.name), UI.setTextString(win, subline, username + typeLine),
        facts.set(details(value).map(item => item.value))]).catch(() => {});
      for (const [key, input] of [['name', nameInput], ['email', emailInput]]) {
        if (!edited[key] || drafts[key].trim() === saved()[key]) { drafts[key] = saved()[key]; edited[key] = false; input.setValue(drafts[key]).catch(() => {}); }
      }
      // A new picture or name lands with a little motion.
      if (repictured) kit.play(avatar.id, presets.pop(0, 0.7));
      if (renamed) kit.play(heading, presets.bump());
      refresh();
    });
    refresh();
    page.dispose = async () => {
      page.alive = false; unsubscribe(); facts.dispose();
      await Promise.all([avatar.dispose(), nameInput.destroy(), emailInput.destroy()]);
    };
    return page;
  }

  // The password page: the current one, then the new one twice. passwd checks
  // the current password and applies the system's rules; its own words come
  // back on the status line when it refuses.
  async function passwordPage() {
    const page = await frame.newPage(SPACE.m);
    page.hint = '';
    const win = frame.win, kit = frame.kit, inner = frame.width - SPACE.m * 2 - KEY_WIDTH - SPACE.s;
    const values = { current: '', next: '', confirm: '' };
    // passwd's refusal stays on the status line until the next keystroke.
    let changeLabel, feedback, ready, working = false, refusal = '';
    const surface = await card(page.el, 3);
    const inputs = await Promise.all(['current', 'next', 'confirm'].map(key => passwordInput(win, { width: inner, height: FIELD, size: TYPE.body,
      id: 'account-password-' + key, placeholder: '', maxLength: 512, onInput: value => { values[key] = value; refusal = ''; refresh(); }, onSubmit: () => submit() })));
    const rows = [];
    for (const [index, key] of ['Current', 'New', 'Confirm'].entries()) rows.push(await row(surface.content, key, inputs[index].master.id));
    const status = await text(win, page.el, '', TYPE.caption, frame.width, 20, TEXT.accent, FONT, 'left');
    const actions = await UI.createElement(win, { layout: { type: 'row', justifyContent: 'end' }, item: { size: { x: frame.width, y: 36 } } });
    const submitButton = await pill(win, actions, 'Change password', 160, () => submit(), { height: 36, onLabel: id => { changeLabel = id; }, onFeedback: value => { feedback = value; } });
    await UI.attach(win, page.el, actions);
    await Promise.all([UI.setElementId(win, status, 'account-password-status'), UI.setElementId(win, submitButton, 'account-password-submit')]);
    page.items.push(surface.id, actions);
    page.height = SPACE.xs + surface.height + 20 + 36 + SPACE.m * 2;
    const filled = () => !!values.current && !!values.next && values.next === values.confirm;
    const refresh = () => {
      const on = !working && filled();
      Promise.all([UI.setHitTarget(win, submitButton, on), UI.setBoxColour(win, submitButton, on ? SURFACE.accent : SURFACE.control),
        UI.setTextColour(win, changeLabel, on ? TEXT.onAccent : TEXT.disabled),
        // Only a mismatch is worth saying before submitting.
        ...(working ? [] : [UI.setTextString(win, status, refusal || (values.confirm && values.next !== values.confirm ? 'The new passwords differ' : ''))])]).catch(() => {});
      if (on && ready === false) kit.play(submitButton, presets.pop(0, 0.85));
      ready = on;
    };
    const submit = async () => {
      if (working || !filled() || frame.closing) return;
      working = true; feedback?.begin(); refresh();
      let current = values.current, next = values.next, result;
      try { result = await Desktop.changePassword(current, next); }
      catch (error) { result = { ok: false, message: 'Could not change the password' }; Log.error('Account password: ' + error); }
      finally { current = next = ''; working = false; feedback?.end(); }
      if (result?.ok) {
        await Promise.all(inputs.map(input => input.setValue('')));
        Object.assign(values, { current: '', next: '', confirm: '' });
        frame.flash('Password changed', TEXT.accent);
        await go(overview, -1);
        return;
      }
      refusal = result?.message || 'Could not change the password';
      rows.forEach(line => kit.play(line, presets.shake()));
      await inputs[result?.field === 'next' ? 1 : 0].focus();
      refresh();
    };
    refresh();
    await inputs[0].focus();
    page.dispose = async () => { page.alive = false; Object.assign(values, { current: '', next: '', confirm: '' }); await Promise.all(inputs.map(input => input.destroy())); };
    return page;
  }

  await go(overview, 0);
  globalThis.koyaAccount = { frame, changePicture, saveProfile };
  return frame;
}
