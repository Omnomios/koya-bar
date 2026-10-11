import { readSettings, settingValue } from './settings-model.js';

export function createShellService({ applications, stored, persist, openBuiltin, changed = () => {} }) {
  let settings = readSettings(stored), saving = Promise.resolve();
  let state = { Active: true, ScreenState: 'unlocked', PowerMenuState: 'closed' };
  const snapshot = () => ({ ...state, ...settings });
  const update = values => { state = { ...state, ...values }; changed(snapshot()); };
  return { snapshot, update,
    async request(method, args = []) {
      switch (method) {
      case 'GetState': return snapshot();
      case 'Ready': return;
      case 'GetApplications': return applications.list();
      case 'ResolveIcon': return applications.resolveIcon(args[0]);
      case 'OpenSettings': await openBuiltin('settings'); return;
      case 'OpenWifi': await openBuiltin('wifi'); return;
      case 'SetSetting': {
        const [key, value] = args;
        const validated = settingValue(key, value);
        const operation = saving.then(async () => {
          const next = { ...settings, [key]: validated };
          await persist(JSON.stringify(next)); settings = next; changed(snapshot()); return snapshot();
        });
        saving = operation.catch(() => {});
        return operation;
      }
      default: throw new Error('Unknown shell method: ' + method);
      }
    }
  };
}
