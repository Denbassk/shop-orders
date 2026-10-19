// Фонові завдання: довідправка листів про дозвіл і (нижче) tick вигрузки.
const R = require('./rules');
const { sendAndMark } = require('./lateMail');

const MIN_AGE_MS = 30000;   // запит молодший за 30 с ще відправляє фонова відправка requestLate

// Невідправлені листи про дозвіл за сьогодні (запит живе LATE_Q_TTL_MIN хв). env = { at, late, mailer, data }
async function resendLateMails(env) {
  const at = env.at;
  const day = R.kyivNow(at).day;
  const rows = await env.data.unmailedLate(day, new Date(at.getTime() - MIN_AGE_MS), new Date(at.getTime() - R.LATE_Q_TTL_MIN * 60000));
  const out = { sent: 0, failed: 0, skipped: 0 };
  if (!rows.length) return out;
  const [stores, directions] = await Promise.all([env.data.stores(), env.data.directions()]);
  for (const r of rows) {
    const store = stores.find((s) => s.id === r.store_id);
    const cfg = directions[r.dir];
    if (!store || !cfg || !env.mailer.recipient(cfg, store)) { out.skipped++; continue; }
    try {
      if (await sendAndMark(env, cfg, store, r.req_date, new Date(r.requested_at))) out.sent++;
      else out.skipped++;
    } catch (e) {
      console.error('довідправка листа про дозвіл: ' + e.message);
      out.failed++;
    }
  }
  return out;
}

module.exports = { resendLateMails };
