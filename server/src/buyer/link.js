// Секретне посилання закупниці: /buyer/<код>/<ключ>, без PIN. Код - закупниця (src/buyer/people.js): bakery - ВК, hlib - хліб Рома, НБХЗ, овочі.
// Ключ = HMAC-SHA256(BUYER_LINK_SECRET, 'buyer|' + код), base64url, 24 символи (як lateToken у листах). Ключ ВК не змінився.
// Зміна секрету робить усі старі посилання недійсними.
const crypto = require('node:crypto');
const { BUYERS, buyerOf } = require('./people');

function buyerKey(code, secret) {
  return crypto.createHmac('sha256', String(secret)).update('buyer|' + code).digest('base64url').slice(0, 24);
}

function verifyBuyerKey(code, key, secret) {
  if (!secret || !buyerOf(code)) return false;
  const a = Buffer.from(String(key || ''));
  const b = Buffer.from(buyerKey(code, secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function buyerLinks(base, secret) {
  const root = String(base).replace(/\/+$/, '');
  return Object.fromEntries(Object.keys(BUYERS).map((c) => [c, root + '/buyer/' + c + '/' + buyerKey(c, secret)]));
}

module.exports = { buyerKey, verifyBuyerKey, buyerLinks };