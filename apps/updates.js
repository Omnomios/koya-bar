import * as UI from './theme-ui.js';
import { appFrame, glyph } from './app-frame.js';
import { connect, call } from './session.js';
import { pill, text, throbber } from './touch-ui.js';
import { PHASES, sinceLabel, needsRestart, majorChange, progressStep } from './updates-model.js';
import { presets } from './motion.js';
import { SPACE, TYPE, TEXT, SURFACE, FONT } from './theme.js';

const ROW = 44, ACTION_WIDTH = 96, MARK = 18, VERSION_WIDTH = 150;
const SOURCES = [['Repository', 'Arch Linux'], ['AUR', 'AUR']];
const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');

// One page: the state of the system as a hero (what is going on, and the one
// thing to do about it), then the packages, grouped by where they come from.
// While installing, the same rows show each package's progress; the raw
// package-manager output is a page of its own, for when something goes wrong.
export default async () => {
  let state, latest, revision, pending = false, disconnect;
  const frame = await appFrame({ title: 'OS updates', namespace: 'koya-updates',
    hint: () => !state ? 'Connecting to the shell…' : '',
    onBack: () => go(overview), onClose: () => disconnect?.() });
  const { win, kit } = frame;
  const busy = () => pending || latest?.checking || latest?.installing;
  const allowed = () => state?.Active && state.ScreenState === 'unlocked';
  const go = (build, direction = -1) => frame.go(build, { title: build === overview ? 'OS updates' : 'Output', back: build !== overview, direction });
  const request = async method => {
    if (busy()) return;
    pending = true;
    try { await call(method); }
    catch (error) { frame.flash(String(error.message || error), TEXT.accent, 5000); }
    finally { pending = false; }
  };
  const install = async () => {
    if (busy() || !allowed()) return;
    pending = true;
    try {
      // Let the shell's administrator prompt take keyboard and pointer input.
      await frame.suspend();
      await call('InstallUpdates');
    } catch (error) { await frame.resume(); frame.flash(String(error.message || error), TEXT.accent, 5000); }
    finally { pending = false; }
  };

  // What the page is about. Installing, finished and failed show the
  // packages of that installation; otherwise the packages waiting.
  const view = () => {
    const progress = latest?.progress, packages = latest?.packages || [];
    const mode = !latest?.available ? 'unavailable' : latest.installing ? 'installing'
      : progress && latest.error ? 'failed' : progress?.phase === 'done' ? 'finished' : 'waiting';
    return { mode, progress, list: ['installing', 'failed', 'finished'].includes(mode) ? progress.packages : packages };
  };
  // The hero's words and its one action, for the current state.
  const hero = () => {
    const { mode, progress, list } = view(), count = (latest?.packages || []).length;
    const checked = latest?.checkedAt ? 'Checked ' + sinceLabel(latest.checkedAt) : 'Not checked yet';
    const restart = list.some(item => needsRestart(item.name));
    if (mode === 'unavailable') return { title: 'Unavailable', subtitle: 'Needs Arch Linux and pacman', dot: 'warn' };
    if (mode === 'installing') {
      const step = progressStep(progress);
      return { title: latest.authenticating ? 'Waiting for approval' : 'Updating', dot: 'good', pulse: true,
        subtitle: [PHASES[progress.phase], progress.current, step.total ? step.done + ' of ' + step.total : ''].filter(Boolean).join(' · ') };
    }
    if (mode === 'failed') return { title: 'Update failed', subtitle: latest.error.split('\n')[0], dot: 'warn', action: { label: 'Retry', run: install, primary: true } };
    if (mode === 'finished') return { title: plural(progress.packages.length, 'update') + ' installed', dot: restart ? 'warn' : 'good',
      subtitle: restart ? 'Restart to finish' : count ? plural(count, 'update') + ' remaining' : 'Up to date', action: { label: 'Check', run: () => request('CheckUpdates') } };
    if (latest.checking) return { title: 'Checking…', subtitle: checked, dot: 'good', pulse: true };
    if (count) return { title: plural(count, 'update'), subtitle: latest.error ? 'Check incomplete' : checked, dot: latest.error ? 'warn' : 'good',
      action: { label: 'Update', run: install, primary: true } };
    return { title: latest.checkedAt ? 'Up to date' : 'Not checked', subtitle: latest.error ? 'Check failed' : checked,
      dot: latest.error ? 'warn' : 'good', action: { label: 'Check', run: () => request('CheckUpdates') } };
  };
  // Rebuild only when the page's structure changes; words and marks update in place.
  const shapeOf = () => {
    const { mode, list } = view();
    return JSON.stringify([mode, list.map(item => [item.name, item.current, item.next, item.source]),
      mode === 'waiting' ? latest?.error || '' : '', !!latest?.log, !!hero().action]);
  };

  async function overview() {
    const page = await frame.newPage(SPACE.s);
    const shape = shapeOf(), { mode, progress, list } = view(), first = hero();
    const width = frame.width;

    // Hero: the badge, what is going on, and the thing to do.
    const top = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.m, alignItems: 'center' }, item: { size: { x: width, y: 52 } } });
    const badge = await kit.badge({ glyph: glyph('koya-update'), health: first.dot });
    const words = await kit.titleBlock({ title: first.title, subtitle: first.subtitle, dot: first.dot });
    await Promise.all([UI.attach(win, top, badge.id), UI.attach(win, top, words.id)]);
    let action, actionLabel, run = () => {};
    if (first.action) {
      action = await pill(win, top, first.action.label, ACTION_WIDTH, () => run(), { height: 32,
        colour: first.action.primary ? SURFACE.accent : SURFACE.control, labelColour: first.action.primary ? TEXT.onAccent : TEXT.primary,
        onLabel: id => { actionLabel = id; } });
      await UI.setElementId(win, action, 'updates-action');
    }
    await UI.attach(win, page.el, top);
    page.items.push(top);
    badge.pop();
    let used = 52;

    // Progress across the installation's packages.
    let meter;
    if (mode === 'installing' || mode === 'finished') {
      meter = await kit.meter({ label: 'Packages', width, segments: Math.max(1, Math.min(12, list.length)) });
      await UI.attach(win, page.el, meter.id); page.items.push(meter.id); used += meter.height + SPACE.s;
    }

    // A check that failed, source by source.
    const problems = mode === 'waiting' && latest?.error ? latest.error.split('\n').filter(Boolean) : [];
    if (problems.length) {
      const height = problems.length * 22 + SPACE.s * 2;
      const card = await kit.surface('inset', { size: { x: width, y: height }, padding: { t: SPACE.s, r: SPACE.m, b: SPACE.s, l: SPACE.m } });
      for (const line of problems) await text(win, card.content, line, TYPE.caption, width - SPACE.m * 2, 22, TEXT.accent, FONT, 'left');
      await UI.attach(win, page.el, card.id); page.items.push(card.id); used += height + SPACE.s;
    }

    // The output of the last installation, while there is one.
    let output;
    if (latest?.log) {
      output = await frame.navigate(null, 'Output', mode === 'installing' ? 'Live' : mode === 'failed' ? 'See what went wrong' : 'Last installation', 48, () => go(installationLog, 1));
      used += 48 + SPACE.s;
    }

    // The packages, by source, each in a card.
    const rows = new Map();
    const groups = SOURCES.map(([source, caption]) => ({ caption, items: list.filter(item => item.source === source) })).filter(group => group.items.length);
    if (groups.length) {
      const area = await kit.scrollArea({ width, height: 60, gap: SPACE.s, id: 'updates-packages' });
      let content = 0, checkHeader;
      for (const [index, group] of groups.entries()) {
        const header = await kit.sectionHeader({ caption: group.caption + ' · ' + group.items.length,
          action: index === 0 && mode === 'waiting' && list.length ? { label: 'Check', id: 'updates-check', onActivate: () => request('CheckUpdates') } : undefined });
        if (index === 0) checkHeader = header;
        const height = group.items.length * ROW + SPACE.xs * 2;
        const card = await kit.surface('inset', { size: { x: width, y: height }, padding: { t: SPACE.xs, r: SPACE.m, b: SPACE.xs, l: SPACE.m } });
        for (const item of group.items) rows.set(item.name, await packageRow(card.content, item, width - SPACE.m * 2, mode !== 'waiting'));
        await Promise.all([UI.attach(win, area.content, header.id), UI.attach(win, area.content, card.id)]);
        content += header.height + height + SPACE.s * (index ? 2 : 1);
      }
      const room = Math.max(120, frame.stageHeight - SPACE.xs - used - SPACE.s - 20);
      const shown = Math.min(content, room);
      await Promise.all([UI.setLayoutSize(win, area.id, { x: width, y: shown }), area.setContentHeight(content)]);
      // Attached in reading order: hero, meter, problems, list, output.
      await UI.attach(win, page.el, area.id); page.items.push(area.id); used += shown + SPACE.s;
      page.check = checkHeader;
    }
    if (output) { await UI.attach(win, page.el, output.target); page.items.push(output.target); }
    page.height = SPACE.xs + used + 20;

    // In place: words, the action, the meter and each row's mark.
    let shown = -1, pulsing = false;
    page.update = async () => {
      if (shapeOf() !== shape) return frame.show(overview, { title: 'OS updates', animate: false });
      const now = hero(), current = view();
      run = now.action?.run || (() => {});
      const ready = now.action && !busy() && (now.action.run !== install || allowed());
      await Promise.all([UI.setTextString(win, words.heading, now.title), UI.setTextString(win, words.caption, now.subtitle), words.setDot(now.dot),
        ...(action ? [UI.setHitTarget(win, action, !!ready), UI.setTextString(win, actionLabel, now.action?.label || ''),
          UI.setTextColour(win, actionLabel, !ready ? TEXT.disabled : now.action?.primary ? TEXT.onAccent : TEXT.primary),
          UI.setBoxColour(win, action, ready && now.action?.primary ? SURFACE.accent : SURFACE.control)] : []),
        page.check?.setBusy(!!latest?.checking)]);
      // A looping pulse while busy; stopping plays one last ripple out.
      if (!!now.pulse !== pulsing) { pulsing = !!now.pulse; badge.pulse(pulsing); }
      if (current.progress && current.mode !== 'waiting') {
        const step = progressStep(current.progress);
        if (meter && step.done !== shown) {
          await meter.set(step.total ? step.done / step.total * 100 : 0, step.done + ' of ' + step.total, shown >= 0);
          shown = step.done;
        }
        const done = new Set(current.progress.done);
        await Promise.all([...rows].map(([name, row]) => row.mark(done.has(name) ? 'done'
          : current.mode === 'installing' && current.progress.current === name ? 'active' : 'pending')));
      }
    };
    page.dispose = () => rows.forEach(row => row.dispose());
    await page.update();
    return page;
  }

  // A package: name (and whether it needs a restart) on the left; the new
  // version over the old on the right, in accent for a major change. With
  // `marked`, a leading mark shows its progress in an installation.
  async function packageRow(parent, item, width, marked) {
    const line = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: width, y: ROW } } });
    let slot, dot, spinner;
    if (marked) {
      slot = await UI.createElement(win, { layout: { type: 'none' }, item: { size: { x: MARK, y: ROW } } });
      dot = await UI.createElement(win, { renderable: { type: 'circle', aabb: { min: { x: 0, y: 0 }, max: { x: 8, y: 8 } }, resolution: 16, colour: SURFACE.track, origin: { x: 0.5, y: 0.5 } },
        item: { size: { x: 8, y: 8 } }, contentAlign: { x: 'center', y: 'center' } });
      spinner = await throbber(win, null, 14, TEXT.primary, ROW);
      await Promise.all([UI.attach(win, slot, dot), UI.attach(win, slot, spinner.id), UI.setEnabled(win, spinner.id, false), UI.attach(win, line, slot)]);
    }
    const nameWidth = width - VERSION_WIDTH - SPACE.s - (marked ? MARK + SPACE.s : 0);
    const left = await UI.createElement(win, { layout: { type: 'column', justifyContent: 'center' }, item: { size: { x: nameWidth, y: ROW } } });
    const restart = needsRestart(item.name);
    await text(win, left, item.name, TYPE.body, nameWidth, restart ? 20 : ROW, TEXT.primary, FONT, 'left');
    if (restart) await text(win, left, 'Restart required', TYPE.caption, nameWidth, 18, TEXT.secondary, FONT, 'left');
    const right = await UI.createElement(win, { layout: { type: 'column', justifyContent: 'center' }, item: { size: { x: VERSION_WIDTH, y: ROW } } });
    await text(win, right, item.next, TYPE.detail, VERSION_WIDTH, 20, majorChange(item.current, item.next) ? TEXT.accent : TEXT.primary, FONT, 'right');
    await text(win, right, item.current, TYPE.caption, VERSION_WIDTH, 18, TEXT.disabled, FONT, 'right');
    await Promise.all([UI.attach(win, line, left), UI.attach(win, line, right)]);
    await UI.attach(win, parent, line);
    let state;
    return {
      mark: async next => {
        if (!marked || next === state) return;
        const was = state; state = next;
        await Promise.all([UI.setEnabled(win, dot, next !== 'active'), UI.setEnabled(win, spinner.id, next === 'active'),
          UI.setCircleColour(win, dot, next === 'done' ? SURFACE.accent : SURFACE.track)]);
        if (next === 'active') spinner.start(); else spinner.stop();
        if (next === 'done' && was) kit.play(dot, presets.pop(0, 0.3));
      },
      dispose: () => spinner?.stop()
    };
  }

  // The package manager's own words, following along while it runs.
  async function installationLog() {
    const page = await frame.newPage();
    const height = Math.max(60, frame.stageHeight - SPACE.xs - 20);
    const area = await kit.scrollArea({ width: frame.width, height, id: 'updates-log' });
    await UI.attach(win, page.el, area.id);
    const output = await text(win, area.content, '', TYPE.caption, frame.width, height, TEXT.secondary, FONT, 'left');
    await Promise.all([UI.setTextVerticalAlign(win, output, 'top'), UI.setContentAlign(win, output, { x: 'start', y: 'start' })]);
    page.height = frame.stageHeight; page.items.push(area.id);
    let previous;
    page.update = async () => {
      const value = latest?.log || 'No output yet.';
      if (previous === value) return;
      previous = value;
      await UI.setTextString(win, output, value);
      const metrics = await UI.measureText(win, output);
      const contentHeight = Math.max(height, Math.ceil(Math.max(Number(metrics?.size?.y || 0),
        Number(metrics?.lineCount || 1) * Number(metrics?.lineAdvance || TYPE.caption * 1.3))));
      await Promise.all([UI.setLayoutSize(win, output, { x: frame.width, y: contentHeight }),
        UI.setTextAabb(win, output, { min: { x: 0, y: 0 }, max: { x: frame.width, y: contentHeight } }), area.setContentHeight(contentHeight)]);
      if (latest?.installing) await area.scrollTo(contentHeight - height);
    };
    await page.update();
    return page;
  }

  disconnect = connect('updates', value => frame.enqueue(async () => {
    state = value;
    if (!latest || revision !== state.UpdatesRevision) {
      latest = JSON.parse(await call('GetUpdates')); revision = state.UpdatesRevision;
    }
    if (latest.authenticating) await frame.suspend(); else await frame.resume();
    if (!frame.current) await frame.show(overview, { title: 'OS updates' });
    else await frame.current.update();
    await frame.refreshHint();
  }));
  globalThis.koyaUpdates = { frame, check: () => request('CheckUpdates'),
    go: name => go(({ overview, log: installationLog })[name], name === 'overview' ? -1 : 1) };
  return frame;
};
