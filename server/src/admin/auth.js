// Вхід у пульт і на сторінку закупниці. Перенос adminLogin_/adminCheck_/adminFailCheck_ (app/Admin.gs):
// PIN у ScriptProperties -> хеш у секреті (ADMIN_PASSWORD_HASH, BUYER_<DIR>_HASH); токен adm_<uuid> -> підписаний JWT (12 год).
// Лічильник невдалих спроб (admin_fail: { n, ts першої }) - через fails { get, set, del } (у бойовому - база).
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const ADMIN_TOKEN_TTL = 12 * 60 * 60 * 1000;      // 12 годин
const ADMIN_FAIL_MAX = 5;                         // спроб на годину
const FAIL_WINDOW = 3600000;

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return 'scrypt$' + salt + '$' + crypto.scryptSync(String(pw), salt, 32).toString('hex');
}
function verifyPassword(pw, stored) {
  const [alg, salt, h] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !/^[0-9a-f]{64}$/.test(h || '')) return false;
  const a = Buffer.from(h, 'hex');
  return crypto.timingSafeEqual(a, crypto.scryptSync(String(pw), salt, a.length));
}
// 'admin' -> ADMIN_PASSWORD_HASH; 'buyer:bread' -> BUYER_BREAD_HASH
function hashEnvName(role) {
  return role === 'admin' ? 'ADMIN_PASSWORD_HASH' : 'BUYER_' + String(role).split(':')[1].toUpperCase() + '_HASH';
}

function memoryFails() {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); }, del: async (k) => { m.delete(k); } };
}

function createAuth({ secret, hashes = {}, fails = memoryFails(), now = Date.now }) {
  async function login(role, pin) {
    const real = hashes[role];
    if (!real) throw new Error('PIN ще не задано. Запустіть i01_setAdminPin() у редакторі.');
    if (!secret) throw new Error('Сервер не налаштований: не задано ADMIN_JWT_SECRET');
    let o = (await fails.get(role)) || {};
    if (o.ts && (now() - o.ts) > FAIL_WINDOW) o = {};
    if ((o.n || 0) >= ADMIN_FAIL_MAX) throw new Error('Забагато спроб. Спробуйте за годину.');
    if (!verifyPassword(String(pin || '').trim(), real)) {
      await fails.set(role, { n: (o.n || 0) + 1, ts: o.ts || now() });
      throw new Error('Невірний PIN');
    }
    await fails.del(role);
    const iat = Math.floor(now() / 1000);
    return jwt.sign({ role, iat, exp: iat + ADMIN_TOKEN_TTL / 1000 }, secret, { algorithm: 'HS256' });
  }
  function check(token, role) {
    token = String(token || '');
    if (!token || !secret) throw new Error('AUTH');
    let p;
    try { p = jwt.verify(token, secret, { algorithms: ['HS256'], clockTimestamp: Math.floor(now() / 1000) }); }
    catch (e) { throw new Error('AUTH'); }
    if (!p || p.role !== role) throw new Error('AUTH');
    return true;
  }
  return { login, check };
}

module.exports = { createAuth, hashPassword, verifyPassword, hashEnvName, memoryFails, ADMIN_TOKEN_TTL, ADMIN_FAIL_MAX };