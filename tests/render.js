import * as Process from 'Module/process';
import * as Engine from 'Helix/Engine';
import * as Event from 'Helix/Event';
import * as UI from 'Helix/UserInterface';
import * as Screenshot from 'Koya/Screenshot';
import * as Image from 'Koya/Image';
import * as Log from 'Helix/Log';
import launcher from '../apps/launcher.js';

export default function main() {
  launcher();
  const timer = setTimeout(() => { Log.error('KOYA_RENDER_TEST_FAIL: launcher did not become ready'); Engine.quit(); }, 15000);
  let attempts = 0;
  const check = async () => {
    try {
      const picker = globalThis.koyaLauncher;
      if (!picker) { if (++attempts < 100) setTimeout(check, 100); return; }
      const query = await UI.getElementById(picker.window, 'launcher-query');
      if (!query) throw new Error('Search field is missing');
      Event.emit('textInput', { id: picker.window, text: 'koya settings' });
      await new Promise(resolve => setTimeout(resolve, 400));
      if (picker.model.current?.id !== 'koya-settings.desktop') throw new Error('Keyboard filtering failed');
      Event.emit('keyDown', { id: picker.window, key: 14 });
      await new Promise(resolve => setTimeout(resolve, 100));
      if (picker.model.query !== 'koya setting') throw new Error('Backspace failed');
      Event.emit('textInput', { id: picker.window, text: '\u0015' });
      await new Promise(resolve => setTimeout(resolve, 100));
      if (picker.model.query) throw new Error('Clear-query shortcut failed');
      picker.filter('koya settings'); await picker.render();
      await new Promise(resolve => setTimeout(resolve, 400));
      if (!await Screenshot.capture(picker.window, { id: 'launcher', source: 'vulkan', mipmaps: false })) throw new Error('Screenshot failed');
      const png = await Image.encode(picker.window, { src: '/ram/screenshot/launcher', format: 'png' });
      const path = Process.getEnv('KOYA_RENDER_OUTPUT');
      if (!Process.writeFile(path, png instanceof ArrayBuffer ? png : Uint8Array.from(png).buffer)) throw new Error('Could not save screenshot');
      clearTimeout(timer); Log.info('KOYA_RENDER_TEST_PASS'); Engine.quit();
    } catch (error) { clearTimeout(timer); Log.error('KOYA_RENDER_TEST_FAIL: ' + error); Engine.quit(); }
  };
  setTimeout(check, 100);
}
