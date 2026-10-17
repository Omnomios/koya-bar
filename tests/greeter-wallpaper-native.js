import * as Login from 'Module/login';
import * as Process from 'Module/process';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';

const assert = (value, message) => { if (!value) throw new Error(message); };
export default function main() {
  setTimeout(() => {
    try {
      const user = Process.getEnv('KOYA_TEST_USER', ''), kind = Process.getEnv('KOYA_TEST_CASE', '');
      const image = Login.userWallpaper(user);
      if (kind === 'valid') {
        assert(image?.wallpaper?.id === 'user:fixture.png', 'The selected imported wallpaper is shared');
        assert(image.directory === Process.getEnv('KOYA_GREETER_STATE_DIR', '') + '/wallpapers', 'Image is in the greeter cache');
        assert(image.wallpaper.texture.startsWith('/rom/koya-greeter-wallpaper-'), 'The texture uses the rendered copy');
        assert(image.wallpaper.size.x > 0 && image.wallpaper.size.y > 0
          && Math.max(image.wallpaper.size.x, image.wallpaper.size.y) <= 3840, 'Rendered dimensions are bounded');
        assert(Login.userWallpaper(user).wallpaper.texture === image.wallpaper.texture, 'Unchanged images reuse their rendered copy');
      } else {
        assert(image === null, kind + ': no image is shared');
      }
      assert(Login.userWallpaper('../' + user) === null, 'Account path traversal is refused');
      Log.info('KOYA_GREETER_WALLPAPER_TEST_PASS');
    } catch (error) { Log.error('KOYA_GREETER_WALLPAPER_TEST_FAIL: ' + error); }
    finally { setTimeout(() => Engine.quit(), 30); }
  }, 0);
}
