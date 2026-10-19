import { readSettings, settingValue } from './settings-model.js';

// The native D-Bus serializer infers plain numbers as int32 variants. Tag
// fractional readings explicitly so state replies/signals retain precision.
export const shellStatePayload = state => Object.fromEntries(Object.entries(state).map(([key, value]) =>
  [key, typeof value === 'number' && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
    ? { _t: 'd', _v: value } : value]));

export function createShellService({ applications, stored, persist, openBuiltin, setPowerProfile, setChargeControl, updates, sessionActions, displays, changed = () => {} }) {
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
      case 'OpenUpdates': await openBuiltin('updates'); return;
      case 'OpenDisplays': await openBuiltin('displays'); return;
      case 'GetDisplays': return JSON.stringify(await displays.read());
      case 'ApplyDisplays': case 'ConfirmDisplays': case 'RevertDisplays': {
        if (!state.Active || state.ScreenState !== 'unlocked') throw new Error('Display changes require an active unlocked session');
        const value = method === 'ApplyDisplays' ? await displays.apply(JSON.parse(args[0]))
          : method === 'ConfirmDisplays' ? await displays.confirm(args[0]) : await displays.revert(args[0] || undefined);
        return JSON.stringify(value);
      }
      case 'GetUpdates': return JSON.stringify(updates.snapshot());
      case 'GetSessionActions': return JSON.stringify(await sessionActions.list());
      case 'RunSessionAction':
        if (!state.Active || state.ScreenState !== 'unlocked' || !sessionActions) throw new Error('Session actions require an active unlocked session');
        await sessionActions.run(args[0]); return;
      case 'CheckUpdates':
        updates.check(); return snapshot();
      case 'InstallUpdates':
        if (!state.Active || state.ScreenState !== 'unlocked') throw new Error('Updates require an active unlocked session');
        updates.install(); return snapshot();
      case 'SetPowerProfile':
        if (!state.Active || state.ScreenState !== 'unlocked' || !setPowerProfile) throw new Error('Power mode change is unavailable');
        await setPowerProfile(args[0]); return snapshot();
      case 'SetChargeControl':
        if (!state.Active || state.ScreenState !== 'unlocked' || !setChargeControl) throw new Error('Charge control change is unavailable');
        if (typeof args[0] !== 'string' || typeof args[1] !== 'boolean') throw new Error('Invalid charge control arguments');
        await setChargeControl(args[0], args[1]); return snapshot();
      case 'SetSetting': {
        const [key, value] = args;
        const validated = settingValue(key, value);
        const operation = saving.then(async () => {
          if (key === 'UpdatesIncludeAUR' && (state.UpdatesInstalling || state.UpdatesChecking)) throw new Error('Wait for the current update operation to finish');
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
