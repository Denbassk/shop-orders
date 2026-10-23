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

// Один тік: вигрузка всіх напрямків + довідправка листів + перебудова звітів ВК (env.rebuildReports)
// + вигрузка списань у лист «Списания» (env.exportWriteoffs). Збій однієї частини не зупиняє іншу.
async function tick(env, exportAll) {
  const [exp, mail, rep, wo] = await Promise.allSettled([exportAll(env), resendLateMails(env),
    env.rebuildReports ? env.rebuildReports() : Promise.resolve(null),
    env.exportWriteoffs ? env.exportWriteoffs() : Promise.resolve(null)]);
  const out = {
    export: exp.status === 'fulfilled' ? exp.value : { error: String(exp.reason && exp.reason.message) },
    mail: mail.status === 'fulfilled' ? mail.value : { error: String(mail.reason && mail.reason.message) },
  };
  if (rep.status === 'rejected') { out.reports = { error: String(rep.reason && rep.reason.message) }; console.error('звіти ВК: ' + out.reports.error); }
  else if (rep.value) out.reports = rep.value;
  if (wo.status === 'rejected') { out.writeoffs = { error: String(wo.reason && wo.reason.message) }; console.error('вигрузка списань: ' + out.writeoffs.error); }
  else if (wo.value) out.writeoffs = wo.value;
  return out;
}
module.exports = { resendLateMails, tick };
