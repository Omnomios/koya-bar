import * as UI from './theme-ui.js';
import * as Image from 'Koya/Image';
import { accounts } from './accounts.js';
import { text } from './touch-ui.js';
import { SURFACE, TEXT, FONT_STRONG, TYPE } from './theme.js';

// Initials paint immediately. Account metadata and image decoding run after
// presentation, with a generation check when the selected account changes.
export async function userAvatar(win, { size = 40, id, onName = () => {} } = {}) {
  const root = await UI.createElement(win, { id, renderable: { type: 'box', colour: SURFACE.avatar, cornerRadius: size / 2, cornerResolution: 32, origin: { x: 0.5, y: 0.5 } },
    layout: { type: 'none' }, item: { size: { x: size, y: size } }, contentAlign: 'fill' });
  const [letter, picture] = await Promise.all([
    text(win, root, '', TYPE.heading, 'auto', 'auto', TEXT.accent, FONT_STRONG),
    UI.createElement(win, { id: id + '-picture', renderable: { type: 'circle', resolution: 64, colour: [1, 1, 1, 1],
      aabb: { min: { x: 0, y: 0 }, max: { x: size, y: size } } }, item: { size: { x: size, y: size } }, contentAlign: 'fill' })
  ]);
  await Promise.all([UI.attach(win, root, picture), UI.setEnabled(win, picture, false), UI.setElementId(win, letter, id + '-initial')]);
  let username = '', revision = 0, unsubscribe, disposed = false, texture = '', updates = Promise.resolve();
  const paint = (profile, version) => {
    updates = updates.then(async () => {
      if (disposed || version !== revision) return;
      onName(profile.name);
      await UI.setTextString(win, letter, Array.from(profile.name.trim())[0]?.toUpperCase() || '');
      let loaded = '';
      try {
        if (profile.icon) loaded = await Image.load(win, { path: profile.icon, id: 'account-avatar-' + win + '-' + root + '-' + version });
      } catch (_) {}
      if (disposed || version !== revision) {
        if (loaded) await Image.destroy(win, loaded);
        return;
      }
      if (loaded) await UI.setTexture(win, picture, loaded);
      await Promise.all([UI.setEnabled(win, picture, !!loaded), UI.setEnabled(win, letter, !loaded)]);
      const previous = texture; texture = loaded;
      if (previous && previous !== loaded) await Image.destroy(win, previous);
    }).catch(() => {});
  };
  return {
    id: root,
    setUser(name) {
      name = String(name || '').trim();
      if (disposed || name === username) return;
      username = name; unsubscribe?.();
      const version = ++revision;
      // Clear the previous face before a potentially slow lookup.
      UI.setEnabled(win, picture, false).catch(() => {});
      UI.setEnabled(win, letter, true).catch(() => {});
      UI.setTextString(win, letter, Array.from(name)[0]?.toUpperCase() || '').catch(() => {});
      onName(name);
      unsubscribe = accounts.watch(name, profile => paint(profile, version));
    },
    dispose() {
      disposed = true; revision++; unsubscribe?.();
      return updates.then(async () => { if (texture) await Image.destroy(win, texture); texture = ''; }).catch(() => {});
    }
  };
}
