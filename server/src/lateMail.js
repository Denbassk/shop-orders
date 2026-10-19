// Лист закупниці про запит дозволу: надсилання + позначка late_requests.mailed_at ТІЛЬКИ після успіху.
// Однакові пари (dir|store|day), що зараз у польоті, повторно не шлемо (фонова відправка і tick не наздоганяють одне одного).
const inflight = new Set();

// env = { late, mailer, data.markLateMailed }. Повертає true, якщо лист пішов і позначку поставлено.
async function sendAndMark(env, cfg, store, day, at) {
  const key = cfg.key + '|' + store.id + '|' + day;
  if (inflight.has(key)) return false;
  inflight.add(key);
  try {
    const url = env.late.approveUrl(cfg.key, store.id, day);
    const sent = await env.mailer.sendLateMail(cfg, store, { url, at });
    if (!sent) return false;
    await env.data.markLateMailed(cfg.key, store.id, day, new Date());
    return true;
  } finally { inflight.delete(key); }
}

module.exports = { sendAndMark };
