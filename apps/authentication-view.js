// Presentation for a password or confirmation prompt. Raw prompts come from
// three places (polkit, askpass for sudo and OpenSSH, and the SSH agent
// proxy); each says who is asking in its own words. This turns them into a
// title that names the action, the account being used and short labels.
const SUDO = /^\[sudo\] password for (.+?):\s*$/;
const PASSPHRASE = /^(Enter passphrase|Bad passphrase, try again) for (?:key )?['"]?(.+?)['"]?:\s*$/;
const KEY_USE = /^Allow use of key (.+?)\?\s*(?:\n\s*Key fingerprint (\S+?)\.?\s*)?$/s;
const POLKIT_REQUIRED = /^Authentication is (?:needed|required) (?:to|for) (.+?)\.?$/is;

export const tildePath = (path, home = '') => home && path.startsWith(home + '/') ? '~' + path.slice(home.length) : path;
// pkexec quotes programs `like this'.
const sentence = value => value ? (value[0].toUpperCase() + value.slice(1)).replace(/`([^'`]*)'/g, '‘$1’') : value;
const fieldLabel = question => String(question || '').trim().replace(/:$/, '').trim() || 'Password';

export function authenticationView({ text = '', options = {}, status, error } = {}, home = '') {
  const question = String(options.question ?? text).trim();
  const mode = options.mode || 'entry';
  const base = { glyph: 'lock', title: 'Password required', body: '', detail: '', user: '', placeholder: 'Password',
    confirm: 'Authenticate', cancel: 'Cancel', input: mode === 'entry', echo: !!options.echo,
    retry: !!options.retry, status: status ?? options.status ?? '', error: !!(error ?? options.error) };
  // Who is asking, as the shell resolved it from the askpass caller.
  const requester = String(options.requester || '').trim();
  const passphrase = PASSPHRASE.exec(question);
  if ((options.source === 'ssh' || options.source === 'askpass') && mode === 'entry' && passphrase) {
    const retry = base.retry || passphrase[1].startsWith('Bad');
    return { ...base, glyph: 'key', title: 'Unlock SSH key', body: tildePath(passphrase[2], home), detail: requester, placeholder: 'Passphrase',
      confirm: 'Unlock', retry, status: retry ? base.status || 'Wrong passphrase' : base.status, error: retry || base.error };
  }
  if (options.source === 'askpass') {
    const sudo = SUDO.exec(question), use = KEY_USE.exec(question);
    if (mode === 'entry' && sudo) return { ...base, title: 'Administrator access', body: requester || 'sudo needs your password to continue.', user: sudo[1] };
    if (mode === 'confirm' && use) return { ...base, glyph: 'key', title: 'Use SSH key?', body: tildePath(use[1], home), detail: [use[2], requester].filter(Boolean).join('\n'),
      confirm: 'Allow', cancel: 'Deny' };
    if (mode === 'confirm') return { ...base, title: 'Confirm', body: question, detail: requester, confirm: 'Allow', cancel: 'Deny' };
    if (mode === 'none') return { ...base, title: 'Notice', body: question, detail: requester, confirm: 'OK', cancel: '' };
    return { ...base, body: question.replace(/:$/, ''), detail: requester, placeholder: 'Password' };
  }
  if (options.source === 'polkit') {
    const message = String(options.message || '').trim(), required = POLKIT_REQUIRED.exec(message);
    return { ...base, title: required ? sentence(required[1]) : 'Administrator access', body: required ? '' : message,
      user: options.user || '', placeholder: fieldLabel(question) };
  }
  return { ...base, body: question };
}
