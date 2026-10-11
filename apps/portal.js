import { session as Bus } from 'Module/dbus';

const PORTAL = 'org.freedesktop.portal.Desktop', PATH = '/org/freedesktop/portal/desktop';
const REQUEST = 'org.freedesktop.portal.Request';
let serial = 0;

// Ask the desktop's file chooser (xdg-desktop-portal) for one image. Resolves
// with a file:// URI, or null when the person cancels. The portal answers
// with a Response signal on the request object returned by OpenFile.
export async function chooseImage(title = 'Choose an image') {
  try { await Bus.connect(); } catch (_) {}
  let handle, settle;
  const early = [];
  const answer = new Promise(resolve => { settle = resolve; });
  const signal = event => {
    if (event.interface !== REQUEST || event.member !== 'Response') return;
    if (!handle) { early.push(event); return; }
    if (event.path === handle) settle(event);
  };
  Bus.onSignal(signal);
  try {
    await Bus.addMatch("type='signal',sender='" + PORTAL + "',interface='" + REQUEST + "',member='Response'");
    handle = await Bus.callComplex(PORTAL, PATH, 'org.freedesktop.portal.FileChooser', 'OpenFile', 'ssa{sv}', '', title, {
      handle_token: { _t: 's', _v: 'koya' + Date.now().toString(36) + (++serial) },
      modal: { _t: 'b', _v: true },
      multiple: { _t: 'b', _v: false },
      filters: { _t: 'a(sa(us))', _v: [['Images', [[1, 'image/png'], [1, 'image/jpeg'], [1, 'image/webp'], [1, 'image/*']]]] }
    });
    if (Array.isArray(handle)) handle = handle[0];
    const missed = early.find(event => event.path === handle);
    const [response, results] = (missed || await answer).args || [];
    if (Number(response) !== 0) return null;
    const uris = results?.uris;
    return Array.isArray(uris) && uris.length ? String(uris[0]) : null;
  } finally { Bus.offSignal(signal); }
}
