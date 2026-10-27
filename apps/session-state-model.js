const NAME = 'org.freedesktop.login1', ROOT = '/org/freedesktop/login1';

export async function resolveSession(bus, { pid, sessionId, username }) {
  await bus.connect();
  try {
    return await bus.call(NAME, ROOT, NAME + '.Manager', 'GetSessionByPID', 'u', pid);
  } catch (error) {
    // User-service scopes can sit outside the session's cgroup. The inherited
    // session ID still identifies the desktop that launched the application.
    // Do not guess a session or hide other logind failures.
    if (!String(error).includes('org.freedesktop.login1.NoSessionForPID') || !sessionId) throw error;
    const path = await bus.call(NAME, ROOT, NAME + '.Manager', 'GetSession', 's', sessionId);
    const properties = await bus.call(NAME, path, 'org.freedesktop.DBus.Properties', 'GetAll', 's', NAME + '.Session');
    if (properties.Id !== sessionId || properties.Name !== username || properties.Remote !== false)
      throw new Error('Inherited session does not identify this user’s local session');
    return path;
  }
}
