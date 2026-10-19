import * as UI from './theme-ui.js';
import * as Compositor from 'Koya/Compositor';
import * as Log from 'Helix/Log';
import { appFrame } from './app-frame.js';
import { wifiNetwork } from './wifi-network.js';
import { icon, text, label, pill, toggle, throbber, children } from './touch-ui.js';
import { controlCursor } from './cursor.js';
import { passwordInput } from './password-input.js';
import { GUTTER, SPACE, RADIUS, TYPE, MIN_CONTROL_SIZE, LIST_ROW_HEIGHT, TEXT, SURFACE } from './theme.js';

const TRAILING_ICON_WIDTH = 24, PASSWORD_FIELD_HEIGHT = 44;
const idOf = network => network.path.split('/').pop();
const bars = network => Math.max(0, Math.min(3, Math.ceil(Number(network.Strength) * 3 / 100)));
const signal = network => '/rom/assets/status/wifi-' + bars(network) + '.png';
const quality = strength => strength >= 75 ? 'Excellent' : strength >= 50 ? 'Good' : strength >= 25 ? 'Fair' : 'Weak';
const securityName = kind => ({ open: 'None', 'wpa-psk': 'WPA/WPA2 Personal', sae: 'WPA3 Personal', owe: 'Enhanced Open',
  wep: 'WEP', enterprise: 'Enterprise' })[kind] || kind;
const statusOf = network => network.connected ? 'Connected' : network.saved ? 'Saved' : network.security === 'open' ? 'Open'
  : network.security === 'owe' ? 'Encrypted' : !network.supported ? 'Requires advanced network settings' : 'Password required';

export default async (options = {}) => {
  let latest = { networks: [], loading: true }, form, detail, password = '', reveal = false, submitted = false;
  let input, entry, connectFeedback;
  let backend;
  const frame = await appFrame({ title: 'Wi-Fi', namespace: 'koya-wifi', name: 'Wi-Fi',
    hint: () => latest.loading ? 'Finding networks…' : latest.working && latest.message ? latest.message
      : latest.hardware === false ? 'Wi-Fi is blocked by the device' : latest.enabled === false && !form && !detail ? 'Wi-Fi is off' : '',
    onBack: () => back(),
    onClose: () => { backend?.dispose(); input?.destroy(); } });
  const { win, play, hidden, punch, shake, flash, host } = frame;

  // Koya's standard InputText owns editing, composition, focus and caret.
  const updateField = async () => {
    if (!input) return;
    await Promise.all([...(input.getValue() !== password ? [input.setValue(password)] : []), input.setRevealed(reveal), input.setDisabled(!!latest.working)]);
  };
  const submit = async () => {
    if (!form || latest.working) return;
    const network = form, secret = password;
    submitted = true;
    await input?.setDisabled(true);
    connectFeedback?.begin().catch(() => {});
    const accepted = await backend.connect(network, secret);
    if (form !== network) return;
    if (!accepted) {
      connectFeedback?.end().catch(() => {});
      await frame.enqueue(updateField);
      await input?.focus();
      if (latest.error) { flash(latest.error, TEXT.accent, 4000); shake(entry); }
    }
  };

  // ---- Pages -------------------------------------------------------------
  const listPageBuild = async () => {
    const page = await frame.newPage(), ok = frame.live(page);
    page.hint = 'Choose a network to connect';
    // Wide screens: the switch and scan controls on the left, the list on the
    // right with the full height. Portrait stacks them in the page column.
    const wide = frame.size.x > frame.size.y;
    const width = wide ? (frame.width - SPACE.l) / 2 : frame.width;
    let controls = page.el, listParent = page.el;
    if (wide) {
      const columns = await UI.createElement(win, { layout: { type: 'row', gap: SPACE.l }, item: { size: { x: frame.width, y: frame.stageHeight - SPACE.xs - GUTTER } } });
      await UI.attach(win, page.el, columns);
      [controls, listParent] = await children(win, columns, [
        UI.createElement(win, { layout: { type: 'column', gap: SPACE.s }, item: { size: { x: width, y: frame.stageHeight - SPACE.xs - GUTTER } } }),
        UI.createElement(win, { layout: { type: 'column', gap: SPACE.s }, item: { size: { x: width, y: frame.stageHeight - SPACE.xs - GUTTER } } })
      ]);
    }
    // Master switch: the same row anatomy as a Settings toggle.
    let power;
    const flipPower = () => {
      if (!ok() || latest.working || latest.hardware === false) { shake(powerRow.target); return; }
      power.set(!latest.enabled);
      backend.toggle();
    };
    let refresh, refreshLabel, spinner;
    // Power row and section line are fixed; the networks scroll beneath.
    const listHeight = frame.stageHeight - SPACE.xs - GUTTER - (wide ? 0 : LIST_ROW_HEIGHT + 32 + 2 * SPACE.s);
    const [powerRow, heading, area] = await Promise.all([
      frame.navigate(null, 'Wi-Fi', '', LIST_ROW_HEIGHT, flipPower, { width, trailing: 56,
        trailingBuild: async target => { power = await toggle(win, target, !!latest.enabled, flipPower); await UI.setElementId(win, power.id, 'wifi-power'); return power; } }),
      // Section line: the caption, a throbber right after it while a scan
      // runs, and Refresh (dimmed meanwhile) at the trailing edge.
      (async () => {
        const NETWORK_HEADER_HEIGHT = 32, NETWORK_HEADER_TEXT = 'Available networks';
        const line = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center', gap: SPACE.s }, item: { size: { x: width, y: NETWORK_HEADER_HEIGHT } } });
        let caption, spacer;
        [caption, spinner, spacer, refresh] = await Promise.all([
          text(win, null, NETWORK_HEADER_TEXT, TYPE.caption, width - 88 - 14 - 3 * SPACE.s, NETWORK_HEADER_HEIGHT, TEXT.secondary, undefined, 'left'),
          throbber(win, null, 14, TEXT.primary, NETWORK_HEADER_HEIGHT),
          UI.createElement(win, { item: { size: { x: 0, y: NETWORK_HEADER_HEIGHT }, flexGrow: 1 } }),
          pill(win, null, 'Refresh', 88, () => {
            if (!ok() || !latest.enabled || latest.scanning || latest.working) return;
            backend.scan();
          }, { labelColour: latest.scanning ? TEXT.secondary : TEXT.accent, height: 28, onLabel: id => { refreshLabel = id; } })
        ]);
        await Promise.all([caption, spinner.id, spacer, refresh].map(id => UI.attach(win, line, id)));
        // Fit the caption to its text so the throbber sits right after it.
        const end = await UI.getTextCaretPosition(win, caption, NETWORK_HEADER_TEXT.length);
        await Promise.all([UI.setLayoutSize(win, caption, { x: Math.ceil(Number(end?.x || 0)) + 2, y: NETWORK_HEADER_HEIGHT }),
          UI.setElementId(win, refresh, 'wifi-refresh')]);
        if (latest.scanning) spinner.start();
        return { line };
      })(),
      frame.kit.scrollArea({ width, height: listHeight, gap: SPACE.s, id: 'wifi-networks' })
    ]);
    const box = area.content;
    await Promise.all([UI.attach(win, controls, powerRow.target), UI.attach(win, controls, heading.line), UI.attach(win, listParent, area.id)]);
    page.items.push(powerRow.target, heading.line);
    let shape, rows = new Map(), wasScanning = !!latest.scanning;
    const powerText = () => latest.hardware === false ? 'Blocked by the device' : !latest.enabled ? 'Off'
      : latest.networks.find(item => item.connected) ? 'Connected to ' + latest.networks.find(item => item.connected).name : 'On · not connected';
    // Rows rebuild only when the list's shape changes; signal, captions and
    // the switch otherwise update in place, so the list never flickers.
    const buildRows = async animate => {
      const visible = latest.enabled ? latest.networks : [];
      await Promise.all([...rows.values()].map(child => UI.destroyElement(win, child.target))
        .concat(rows.empty ? [UI.destroyElement(win, rows.empty)] : []));
      rows = new Map();
      if (!visible.length) {
        rows.empty = await text(win, box, latest.loading ? '' : latest.enabled ? 'No networks found' : 'Turn Wi-Fi on to find networks', TYPE.body, width, 120, TEXT.secondary);
      }
      const built = await Promise.all(visible.map(async network => {
        let rowIcon;
        const trailing = await frame.navigate(null, network.name, statusOf(network), LIST_ROW_HEIGHT, () => select(network), {
          width, lead: 28 + 12, trailing: 2 * TRAILING_ICON_WIDTH, valueColour: network.connected ? TEXT.accent : TEXT.secondary,
          leading: async target => { rowIcon = await icon(win, target, signal(network), 20, 28, LIST_ROW_HEIGHT); return rowIcon; },
          trailingBuild: async target => {
            // Every row ends in the same two slots: lock, then chevron. Locks
            // line up whether or not a network has details to open.
            const slots = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center' }, item: { size: { x: 2 * TRAILING_ICON_WIDTH, y: LIST_ROW_HEIGHT } } });
            if (target != null) await UI.attach(win, target, slots);
            const lock = await UI.createElement(win, { item: { size: { x: TRAILING_ICON_WIDTH, y: LIST_ROW_HEIGHT } } });
            await UI.attach(win, slots, lock);
            const [, chevron] = await Promise.all([
              network.security !== 'open' ? icon(win, lock, '/rom/assets/power-menu/lock.png', 13, TRAILING_ICON_WIDTH, LIST_ROW_HEIGHT) : undefined,
              network.connected || network.saved ? frame.chevron(slots, LIST_ROW_HEIGHT) : undefined
            ]);
            return { id: slots, nudge: chevron?.nudge };
          } });
        await UI.setElementId(win, trailing.target, 'wifi-network-' + idOf(network));
        return { target: trailing.target, caption: trailing.valueLabel, icon: rowIcon, network };
      }));
      await Promise.all(built.map(entry => UI.attach(win, box, entry.target)));
      built.forEach((entry, index) => {
        rows.set(entry.network.key, entry);
        if (animate) frame.rise(entry.target, 0.03 + index * 0.03);
        else page.items.push(entry.target);
      });
      // The scroll range follows the list.
      await area.setContentHeight(visible.length ? visible.length * LIST_ROW_HEIGHT + (visible.length - 1) * SPACE.s : 120);
      shape = shapeOf();
    };
    const shapeOf = () => JSON.stringify([latest.enabled, latest.loading, latest.networks.map(item => [item.key, item.connected, !!item.saved])]);
    await buildRows(false);
    page.update = async () => {
      if (!page.alive) return;
      await Promise.all([
        UI.setTextString(win, powerRow.valueLabel, powerText()),
        UI.setTextColour(win, powerRow.valueLabel, latest.networks.some(item => item.connected) && latest.enabled ? TEXT.accent : TEXT.secondary),
        ...(!latest.working ? [power.set(!!latest.enabled)] : [])
      ]);
      // The button itself stays still while busy: motion on a button reads
      // as a call to press it.
      if (latest.scanning !== wasScanning) {
        wasScanning = latest.scanning;
        await Promise.all([latest.scanning ? spinner.start() : spinner.stop(),
          UI.setTextColour(win, refreshLabel, latest.scanning ? TEXT.secondary : TEXT.accent)]);
      }
      if (shapeOf() !== shape) {
        await buildRows(true);
        return;
      }
      await Promise.all([...rows.values()].flatMap(entryRow => {
        const network = latest.networks.find(item => item.key === entryRow.network.key) || entryRow.network;
        entryRow.network = network;
        return [UI.setTextString(win, entryRow.caption, latest.working && latest.message?.includes(network.name) ? 'Connecting…' : statusOf(network)),
          UI.setTexture(win, entryRow.icon, signal(network))];
      }));
    };
    await Promise.all([UI.setTextString(win, powerRow.valueLabel, powerText()),
      UI.setTextColour(win, powerRow.valueLabel, latest.networks.some(item => item.connected) && latest.enabled ? TEXT.accent : TEXT.secondary)]);
    return page;
  };

  const detailPageBuild = async () => {
    const page = await frame.newPage(SPACE.m), ok = frame.live(page), width = frame.width;
    const network = () => latest.networks.find(item => item.key === detail.key) || detail;
    page.hint = network().connected ? 'Connected' : 'Saved network';
    // Facts first, in one quiet card; actions below it.
    const card = await UI.createElement(win, { renderable: { type: 'box', colour: SURFACE.card, cornerRadius: RADIUS.surface, cornerResolution: 16 },
      layout: { type: 'column', padding: { l: 12, r: 12, t: SPACE.xs, b: SPACE.xs } }, item: { size: { x: width, y: 3 * 36 + 2 * SPACE.xs } }, contentAlign: 'fill' });
    await UI.attach(win, page.el, card);
    const keys = ['Status', 'Signal', 'Security'];
    const lines = await Promise.all(keys.map(async key => {
      const line = await UI.createElement(win, { layout: { type: 'row', alignItems: 'center' }, item: { size: { x: width - 24, y: 36 } } });
      const [, value] = await children(win, line, [
        label(win, null, key, TYPE.body, (width - 24) / 2, 36, TEXT.secondary),
        text(win, null, '', TYPE.body, (width - 24) / 2, 36, TEXT.primary, undefined, 'right')
      ]);
      return { line, key, value };
    }));
    await Promise.all(lines.map(({ line }) => UI.attach(win, card, line)));
    const facts = Object.fromEntries(lines.map(({ key, value }) => [key, value]));
    page.items.push(card);
    const paint = async () => {
      const current = network();
      await Promise.all([
        UI.setTextString(win, facts.Status, current.connected ? 'Connected' : latest.working ? 'Connecting…' : 'Not connected'),
        UI.setTextColour(win, facts.Status, current.connected ? TEXT.accent : TEXT.primary),
        UI.setTextString(win, facts.Signal, quality(Number(current.Strength)) + ' · ' + Number(current.Strength) + '%'),
        UI.setTextString(win, facts.Security, securityName(current.security))
      ]);
    };
    await paint();
    const actions = await UI.createElement(win, host({ layout: { type: 'column', gap: SPACE.s }, item: { size: { x: width, y: 2 * MIN_CONTROL_SIZE + SPACE.s } } }));
    await UI.attach(win, page.el, actions);
    let primaryFeedback, primaryLabel;
    const connected = network().connected;
    const primary = async () => {
      if (!ok() || latest.working) return;
      primaryFeedback?.begin().catch(() => {});
      if (network().connected) await backend.disconnect();
      else if (!await backend.connect(network()) && network().password) { primaryFeedback?.end().catch(() => {}); openForm(network()); return; }
      primaryFeedback?.end().catch(() => {});
      if (latest.error) { flash(latest.error, TEXT.accent, 4000); shake(actions); }
    };
    const [primaryButton, forget] = await children(win, actions, [pill(win, null, connected ? 'Disconnect' : 'Connect', width, primary,
      { colour: connected ? SURFACE.control : SURFACE.accent, labelColour: connected ? TEXT.accent : TEXT.onAccent, size: TYPE.body,
        spinnerColour: TEXT.primary, onLabel: id => { primaryLabel = id; }, onFeedback: value => { primaryFeedback = value; } }),
      pill(win, null, 'Forget network', width, async () => {
      if (!ok() || latest.working) return;
      const name = network().name;
      await backend.forget(network());
      if (latest.error) { flash(latest.error, TEXT.accent, 4000); shake(actions); return; }
      detail = undefined;
      frame.go(listPageBuild, { title: 'Wi-Fi', direction: -1 });
      setTimeout(() => flash('Forgot ' + name, TEXT.accent), 320);
    })]);
    await Promise.all([UI.setElementId(win, forget, 'wifi-forget-' + idOf(detail)),
      UI.setElementId(win, primaryButton, (connected ? 'wifi-disconnect-' : 'wifi-connect-') + idOf(detail))]);
    page.items.push(actions);
    // Facts card and actions; the panel fits to this.
    page.height = SPACE.xs + 3 * 36 + 2 * SPACE.xs + SPACE.m + 2 * MIN_CONTROL_SIZE + SPACE.s;
    page.update = async () => {
      if (!page.alive) return;
      const connected = network().connected;
      const caption = connected ? 'Disconnect' : 'Connect';
      page.hint = connected ? 'Connected' : 'Saved network';
      await Promise.all([paint(), frame.refreshHint(),
        UI.setTextString(win, primaryLabel, caption),
        UI.setBoxColour(win, primaryButton, connected ? SURFACE.control : SURFACE.accent),
        UI.setTextColour(win, primaryLabel, connected ? TEXT.accent : TEXT.onAccent),
        UI.setElementId(win, primaryButton, (connected ? 'wifi-disconnect-' : 'wifi-connect-') + idOf(detail))]);
      const end = await UI.getTextCaretPosition(win, primaryLabel, caption.length);
      await UI.setLayoutSize(win, primaryLabel, { x: Math.ceil(Number(end?.x || 0)) + 2, y: MIN_CONTROL_SIZE });
    };
    return page;
  };

  const formPageBuild = async () => {
    const page = await frame.newPage(SPACE.m), width = frame.width;
    page.hint = 'Enter the password for ' + form.name;
    const control = await passwordInput(win, { width, height: PASSWORD_FIELD_HEIGHT, size: TYPE.heading,
      id: 'wifi-password', textId: 'wifi-password-text', onSubmit: submit,
      onInput: value => { password = value; }, onFocus: () => punch(control.master.id, 1.02) });
    input = control; entry = control.master.id;
    await UI.attach(win, page.el, entry);
    page.items.push(entry);
    const helpers = await UI.createElement(win, host({ layout: { type: 'row', gap: SPACE.s }, item: { size: { x: width, y: MIN_CONTROL_SIZE } } }));
    await UI.attach(win, page.el, helpers);
    let revealLabel;
    await children(win, helpers, [pill(win, null, 'Paste', 80, async () => {
      if (latest.working) return;
      try { password = (await Compositor.getClipboardText()).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512); await frame.enqueue(updateField); await input?.focus(); punch(entry, 1.02); }
      catch (_) { flash('Clipboard unavailable', TEXT.accent); shake(entry); }
    }), pill(win, null, reveal ? 'Hide' : 'Show', 80, async () => {
      reveal = !reveal;
      if (revealLabel) await UI.setTextString(win, revealLabel, reveal ? 'Hide' : 'Show');
      return frame.enqueue(updateField);
    }, { onLabel: id => { revealLabel = id; } })]);
    page.items.push(helpers);
    // The one primary action on screen: filled and full width.
    const connectButton = await pill(win, page.el, 'Connect', width, submit, { colour: SURFACE.accent, labelColour: TEXT.onAccent, size: TYPE.body,
      onFeedback: value => { connectFeedback = value; } });
    page.items.push(connectButton);
    page.height = SPACE.xs + PASSWORD_FIELD_HEIGHT + SPACE.m + MIN_CONTROL_SIZE + SPACE.m + MIN_CONTROL_SIZE;
    page.update = async () => {
      if (!page.alive) return;
      if (submitted && !latest.working) connectFeedback?.end().catch(() => {});
      await updateField();
    };
    page.dispose = () => { connectFeedback = undefined; if (input === control) input = entry = undefined; control.destroy().catch(() => {}); };
    await updateField();
    return page;
  };

  // ---- Navigation --------------------------------------------------------
  const openForm = async (network, restore) => {
    if (latest.working && !restore) return;
    detail = undefined;
    form = network; password = ''; reveal = false; submitted = false;
    await frame.go(formPageBuild, { title: network.name, direction: 1, back: true });
    await input?.focus();
  };
  const closeForm = async () => {
    if (!form) return;
    form = undefined; password = ''; submitted = false;
    await input?.destroy(); input = entry = undefined;
    backend.clearError();
    await frame.go(listPageBuild, { title: 'Wi-Fi', direction: -1 });
  };
  const openDetail = network => { detail = network; return frame.go(detailPageBuild, { title: network.name, direction: 1, back: true }); };
  const back = () => {
    if (form) return closeForm();
    if (detail) { detail = undefined; return frame.go(listPageBuild, { title: 'Wi-Fi', direction: -1 }); }
  };
  const select = async network => {
    if (latest.working) { flash('Busy — wait for the current change to finish'); return; }
    if (!network.supported) { flash('This network needs setup on another device', TEXT.accent); return; }
    if (network.connected || network.saved) { openDetail(network); return; }
    if (network.password) { openForm(network); return; }
    if (!await backend.connect(network) && latest.error) flash(latest.error, TEXT.accent, 4000);
  };

  // ---- Backend reactions -------------------------------------------------
  let previous = latest;
  backend = wifiNetwork(value => {
    const before = previous;
    latest = value; previous = value;
    frame.enqueue(async () => {
      await frame.current?.update();
      if (value.error && value.error !== before.error) {
        flash(value.error, TEXT.accent, 4000);
        if (form && entry) shake(entry);
      }
      else frame.refreshHint();
      // A connection that lands while its password sheet is open returns to
      // the list with the news, rather than leaving the sheet behind.
      const joined = value.networks.find(item => item.connected);
      if (joined && !before.networks.find(item => item.connected && item.key === joined.key)) {
        if (form && form.key === joined.key) {
          form = undefined; password = ''; submitted = false;
          await input?.destroy(); input = entry = undefined;
          frame.go(listPageBuild, { title: 'Wi-Fi', direction: -1 });
        }
        setTimeout(() => flash('Connected to ' + joined.name, TEXT.accent), 320);
      }
    });
  });

  await frame.show(listPageBuild, { title: 'Wi-Fi' });
  // Native promises need the running engine event loop.
  setTimeout(() => backend.start().catch(() => { latest = { ...latest, loading: false, error: 'NetworkManager is unavailable' }; frame.enqueue(() => frame.current?.update()); }), 0);
  globalThis.koyaWifi = { backend, select, openForm, closeForm, get window() { return win; }, get password() { return password; },
    setPassword: value => { password = value; return frame.enqueue(updateField); }, submit };
  return win;
};
