// /api noticeSeen: телефон повідомляє, що магазин побачив сервісне повідомлення (banner) і/або натиснув «Зрозуміло» (див. src/notices.js).
// payload: { storeId, seen: [id], acked: [id] }. Приймаються лише діючі повідомлення, що стосуються цього магазину (для всіх або з його напрямком);
// чужі, минулі й невідомі мовчки відкидаються. Підтвердження теж означає «побачив». Не більше 20 id кожного списку за раз.
const N = require('../notices');

const MAX_IDS = 20;
const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).slice(0, MAX_IDS) : []);

async function apiNoticeSeen(payload, env) {
  payload = payload || {};
  const [stores, settings] = await Promise.all([env.data.stores(), env.data.settings()]);
  const store = stores.find((s) => s.id === String(payload.storeId || ''));
  const none = { seen: 0, acked: 0 };
  if (!store) return none;
  const mine = N.activeList(settings.service_notice, env.at)
    .filter((n) => !n.dir || (store.directions || []).indexOf(n.dir) >= 0).map((n) => n.id);
  const ok = (list) => list.filter((id) => mine.indexOf(id) >= 0);
  const acked = ok(ids(payload.acked));
  const seen = [...new Set([...ok(ids(payload.seen)), ...acked])];
  if (!seen.length) return none;
  await env.data.noticeSeen(store.id, seen);
  if (acked.length) await env.data.noticeAcked(store.id, acked);
  return { seen: seen.length, acked: acked.length };
}

module.exports = { apiNoticeSeen };
