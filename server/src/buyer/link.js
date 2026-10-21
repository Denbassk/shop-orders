// Секретне посилання закупниці: /buyer/<dir>/<ключ>, без PIN. Ключ = HMAC-SHA256(BUYER_LINK_SECRET, 'buyer|' + dir),
// base64url, 24 символи (як lateToken у листах). Зміна секрету робить усі старі посилання недійсними.
const crypto = require('node:crypto');
const { DIRECTIONS } = require('../directions');

function buyerKey(dir, secret) {
  return crypto.createHmac('sha256', String(secret)).update('buyer|' + dir).digest('base64url').slice(0, 24);
}

function verifyBuyerKey(dir, key, secret) {
  if (!secret || !Object.prototype.hasOwnProperty.call(DIRECTIONS, dir)) return false;
  const a = Buffer.from(String(key || ''));
  const b = Buffer.from(buyerKey(dir, secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function buyerLinks(base, secret) {
  const root = String(base).replace(/\/+$/, '');
  return Object.fromEntries(Object.keys(DIRECTIONS).map((d) => [d, root + '/buyer/' + d + '/' + buyerKey(d, secret)]));
}

module.exports = { buyerKey, verifyBuyerKey, buyerLinks };