import * as Process from 'Module/process';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import { pulseAudio } from '../apps/pulse-audio.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
const fixture = Process.getEnv('KOYA_DESKTOP_ROOT') + '/tests/pactl-fixture.py';
const control = args => new Promise((resolve, reject) => {
  const child = Process.spawn({ cmd: fixture, args });
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.on('exit', code => code ? reject(new Error('Fixture control failed: ' + args)) : resolve(output));
});
export default function main() {
  let audio;
  const timer = setTimeout(() => { audio?.dispose(); Log.error('KOYA_AUDIO_TEST_FAIL: timed out'); Engine.quit(); }, 12000);
  setTimeout(async () => {
    try {
      await control(['init']);
      audio = pulseAudio({ command: fixture }); audio.start();
      const wait = async predicate => {
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
          if (!audio.busy && predicate(audio.snapshot)) return audio.snapshot;
          await pause();
        }
        throw new Error('Audio state did not settle: ' + JSON.stringify(audio.snapshot));
      };
      const level = percent => wait(state => state.available && state.percent === percent);
      await level(100);
      audio.setPercent(30);
      let state = await level(30);
      assert(Math.abs(state.channels[1] / state.channels[0] - 0.5) < 0.001, 'Channel balance changed');
      audio.toggleMute(); await wait(state => state.muted && state.percent === 30);
      audio.setPercent(60); state = await level(60);
      assert(!state.muted, 'Choosing a volume did not unmute');
      audio.setPercent(20); audio.setPercent(40); audio.setPercent(80); await level(80);
      audio.toggleMute(); audio.setPercent(40); audio.toggleMute();
      await wait(state => state.muted && state.percent === 40);
      audio.setPercent(0); await level(0);
      audio.setPercent(50); state = await level(50);
      assert(!state.muted && Math.abs(state.channels[1] / state.channels[0] - 0.5) < 0.001, 'Balance was lost at zero');
      await control(['default', 'second']); audio.refresh();
      await wait(state => state.name === 'second' && state.percent === 50);
      audio.setPercent(25); await level(25);
      const stored = JSON.parse(await control(['state']));
      assert(stored.sinks[0].volume['front-left'].value === 32768, 'Write changed the previous output');
      // Subscription must catch externally changed volume/mute without refresh.
      await control(['external', 'second', '85', '1']);
      await wait(state => state.name === 'second' && state.percent === 85 && state.muted);
      await control(['fail', '1']); audio.refresh(); await wait(state => !state.available);
      await control(['fail', '0']); audio.refresh(); await level(85);
      audio.dispose(); clearTimeout(timer); Log.info('KOYA_AUDIO_TEST_PASS'); Engine.quit();
    } catch (error) {
      audio?.dispose(); clearTimeout(timer); Log.error('KOYA_AUDIO_TEST_FAIL: ' + error + '\n' + error.stack); Engine.quit();
    }
  }, 0);
}
