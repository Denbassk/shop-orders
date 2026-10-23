// Вхід у пульт і на сторінку закупниці: перенос adminLogin_/adminCheck_/adminFailCheck_ (app/Admin.gs).
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createAuth, hashPassword, verifyPassword, hashEnvName, ADMIN_TOKEN_TTL } = require('../src/admin/auth');

const H = hashPassword('2468', 'salt0001');
function mk(over = {}) {
  let t = Date.parse('2026-10-20T10:00:00Z');
  const mem = new Map();
  const fails = { get: async (k) => mem.get(k), set: async (k, v) => { mem.set(k, v); }, del: async (k) => { mem.delete(k); } };
  const auth = createAuth({ secret: 's3cret', hashes: { admin: H, 'buyer:bread': hashPassword('1111', 'salt0002') }, fails, now: () => t, ...over });
  return { auth, mem, tick: (ms) => { t += ms; } };
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('хеш: scrypt$salt$hex, вірний/невірний пароль, сміття -> false', () => {
  assert.equal(verifyPassword('2468', H), true);
  assert.equal(verifyPassword('2469', H), false);
  assert.equal(verifyPassword('2468', ''), false);
  assert.equal(verifyPassword('2468', 'scrypt$x$zz'), false);
  assert.equal(verifyPassword('2468', 'md5$a$b'), false);
  const a = hashPassword('2468'), b = hashPassword('2468');
  assert.match(a, /^scrypt\$[0-9a-f]+\$[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test('вхід: PIN з пробілами обрізається; токен лише для своєї ролі', async () => {
  const { auth } = mk();
  const tok = await auth.login('admin', ' 2468 ');
  assert.equal(typeof tok, 'string');
  assert.equal(auth.check(tok, 'admin'), true);
  assert.throws(() => auth.check(tok, 'buyer:bread'), { message: 'AUTH' });
  const tb = await auth.login('buyer:bread', '1111');
  assert.equal(auth.check(tb, 'buyer:bread'), true);
  assert.throws(() => auth.check(tb, 'admin'), { message: 'AUTH' });
});

test('невірний PIN -> «Невірний PIN», лічильник { n, ts першої спроби }', async () => {
  const { auth, mem, tick } = mk();
  await assert.rejects(auth.login('admin', '0000'), { message: 'Невірний PIN' });
  const first = mem.get('admin');
  assert.equal(first.n, 1);
  tick(1000);
  await assert.rejects(auth.login('admin', '0000'), { message: 'Невірний PIN' });
  assert.deepEqual(mem.get('admin'), { n: 2, ts: first.ts });
});

test('5 спроб -> «Забагато спроб» навіть з вірним PIN; через годину від першої - знову можна', async () => {
  const { auth, mem, tick } = mk();
  for (let i = 0; i < 5; i++) await assert.rejects(auth.login('admin', '0000'), { message: 'Невірний PIN' });
  await assert.rejects(auth.login('admin', '2468'), { message: 'Забагато спроб. Спробуйте за годину.' });
  tick(3600001);
  assert.equal(typeof await auth.login('admin', '2468'), 'string');
  assert.equal(mem.has('admin'), false);
});

test('успішний вхід скидає лічильник; лічильники ролей окремі', async () => {
  const { auth, mem } = mk();
  await assert.rejects(auth.login('admin', '0000'));
  await assert.rejects(auth.login('buyer:bread', '0000'));
  await auth.login('admin', '2468');
  assert.equal(mem.has('admin'), false);
  assert.equal(mem.get('buyer:bread').n, 1);
});

test('хеш не задано -> текст як в Apps Script', async () => {
  const { auth } = mk({ hashes: {} });
  await assert.rejects(auth.login('admin', '2468'), { message: 'PIN ще не задано. Запустіть i01_setAdminPin() у редакторі.' });
});

test('check: порожній, прострочений (12 год), чужий підпис, alg none -> AUTH', async () => {
  const { auth, tick } = mk();
  assert.throws(() => auth.check('', 'admin'), { message: 'AUTH' });
  assert.throws(() => auth.check(undefined, 'admin'), { message: 'AUTH' });
  const tok = await auth.login('admin', '2468');
  tick(ADMIN_TOKEN_TTL - 1000);
  assert.equal(auth.check(tok, 'admin'), true);
  tick(2000);
  assert.throws(() => auth.check(tok, 'admin'), { message: 'AUTH' });
  assert.throws(() => auth.check(jwt.sign({ role: 'admin' }, 'other'), 'admin'), { message: 'AUTH' });
  const none = b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ role: 'admin', iat: 1, exp: 9999999999 }) + '.';
  assert.throws(() => auth.check(none, 'admin'), { message: 'AUTH' });
});

test('без секрету: вхід - помилка налаштування, check - AUTH', async () => {
  const { auth } = mk({ secret: '' });
  await assert.rejects(auth.login('admin', '2468'), /ADMIN_JWT_SECRET/);
  assert.throws(() => auth.check('x.y.z', 'admin'), { message: 'AUTH' });
});

test('hashEnvName: admin -> ADMIN_PASSWORD_HASH, buyer:bread -> BUYER_BREAD_HASH', () => {
  assert.equal(hashEnvName('admin'), 'ADMIN_PASSWORD_HASH');
  assert.equal(hashEnvName('buyer:bread'), 'BUYER_BREAD_HASH');
});