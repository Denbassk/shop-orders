// Підпис посилання "Дозволити" (lateToken_ з app/LateRequest.gs): HMAC-SHA256(dir|storeId|day), base64url, 24 символи.
const crypto = require('node:crypto');

function createLate({ secret, baseUrl = 'https://shop-orders.fly.dev' }) {
  function token(dirKey, storeId, day) {
    if (!secret) throw new Error('Не задано LATE_SECRET');
    return crypto.createHmac('sha256', secret).update(dirKey + '|' + storeId + '|' + day).digest('base64url').slice(0, 24);
  }

  function verify(dirKey, storeId, day, sig) {
    if (!secret || typeof sig !== 'string' || sig.length !== 24) return false;
    const a = Buffer.from(token(dirKey, storeId, day)), b = Buffer.from(sig);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function approveUrl(dirKey, storeId, day) {
    const q = new URLSearchParams({ dir: dirKey, st: storeId, d: day, s: token(dirKey, storeId, day) });
    return baseUrl.replace(/\/+$/, '') + '/ok?' + q.toString();
  }

  return { token, verify, approveUrl };
}

module.exports = { createLate };
