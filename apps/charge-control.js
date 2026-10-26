// Charge providers own only charge policy. Battery telemetry stays in UPower.
// The first provider that supports a battery owns it, even if a later read
// fails: an error must never silently switch writes to another controller.
export function createChargeControls(backends) {
  const owners = new Map();
  const validate = value => {
    const percent = n => Number.isInteger(n) && n >= 0 && n <= 100;
    if (!value || typeof value.enabled !== 'boolean' || !percent(value.end) ||
        value.start !== null && !percent(value.start) || value.start !== null && value.start > value.end)
      throw new Error('Invalid charge-control reading');
    return value;
  };
  return {
    async describe(devices) {
      owners.clear();
      const result = [];
      for (const device of devices) {
        const item = { ...device, thresholdSupported: false, thresholdEnabled: false, start: -1, end: -1 };
        for (const backend of backends) {
          let supports;
          try { supports = await backend.supports(device, devices); } catch (_) { item.chargeBackend = backend.id; break; }
          if (!supports) continue;
          try {
            const value = validate(await backend.read(device));
            Object.assign(item, { thresholdSupported: true, thresholdEnabled: value.enabled,
              start: value.start ?? -1, end: value.end, chargeBackend: backend.id, adjustable: !!value.adjustable,
              minimum: value.minimum ?? 25, maximum: value.maximum ?? 100 });
            owners.set(device.path, { backend, device });
          } catch (_) {
            // Keep telemetry available; do not advertise a stale control.
            item.chargeBackend = backend.id;
          }
          break;
        }
        result.push(item);
      }
      return result;
    },
    async setEnabled(path, enabled) {
      if (typeof path !== 'string' || typeof enabled !== 'boolean') throw new Error('Invalid charge control arguments');
      const owner = owners.get(path);
      if (!owner) throw new Error('Charge control is unavailable');
      await owner.backend.setEnabled(owner.device, enabled);
      const value = validate(await owner.backend.read(owner.device));
      if (value.enabled !== enabled) throw new Error('Could not confirm the charge control change');
    },
    async setLimit(path, percent) {
      if (typeof path !== 'string' || !Number.isInteger(percent) || percent < 25 || percent > 100) throw new Error('Invalid charge limit');
      const owner = owners.get(path);
      if (!owner?.backend.setLimit) throw new Error('Adjustable charge control is unavailable');
      await owner.backend.setLimit(owner.device, percent);
      const value = validate(await owner.backend.read(owner.device));
      if (value.end !== percent) throw new Error('Could not confirm the charge limit');
    },
    dispose() { owners.clear(); for (const backend of backends) backend.dispose?.(); }
  };
}

export function upowerChargeBackend(bus) {
  const NAME = 'org.freedesktop.UPower.Device';
  return {
    id: 'upower',
    supports: device => device.thresholdSupported === true,
    async read(device) {
      const value = await bus.call('org.freedesktop.UPower', device.path, 'org.freedesktop.DBus.Properties', 'GetAll', 's', NAME);
      if (!value.IsPresent || !value.PowerSupply || !value.ChargeThresholdSupported) throw new Error('Battery charge control disappeared');
      return { enabled: value.ChargeThresholdEnabled === true,
        start: Number.isInteger(value.ChargeStartThreshold) && value.ChargeStartThreshold >= 0 ? value.ChargeStartThreshold : null,
        end: value.ChargeEndThreshold };
    },
    async setEnabled(device, enabled) {
      await bus.call('org.freedesktop.UPower', device.path, NAME, 'EnableChargeThreshold', 'b', enabled);
    }
  };
}

