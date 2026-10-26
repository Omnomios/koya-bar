// Small assertions shared by tests running in Koya's QuickJS runtime.
const describe = value => { try { return JSON.stringify(value); } catch (_) { return String(value); } };
const assert = (value, message = 'Assertion failed') => { if (!value) throw new Error(message); };
assert.fail = message => { throw new Error(message || 'Unexpected execution'); };
assert.equal = (actual, expected, message) => assert(Object.is(actual, expected), message || `${describe(actual)} !== ${describe(expected)}`);
assert.notEqual = (actual, expected, message) => assert(!Object.is(actual, expected), message || 'Values unexpectedly equal');
const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const keys = Object.keys(a), other = Object.keys(b);
  return keys.length === other.length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};
assert.deepEqual = (actual, expected, message) => assert(same(actual, expected), message || `${describe(actual)} differs from ${describe(expected)}`);
assert.match = (value, pattern, message) => assert(pattern.test(value), message || `${value} does not match ${pattern}`);
const checkError = (error, expected, message) => {
  if (expected instanceof RegExp) assert.match(String(error?.message || error), expected, message);
  else if (typeof expected === 'function') assert(error instanceof expected, message || 'Unexpected error type');
};
assert.throws = (fn, expected, message) => {
  try { fn(); } catch (error) { checkError(error, expected, message); return; }
  assert.fail(message || 'Expected an exception');
};
assert.rejects = async (promise, expected, message) => {
  try { await (typeof promise === 'function' ? promise() : promise); } catch (error) { checkError(error, expected, message); return; }
  assert.fail(message || 'Expected a rejection');
};
export default assert;
