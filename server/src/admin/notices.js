// Пульт: сервісні повідомлення продавцям (src/notices.js) - список діючих, нове, вимкнути. Зберігаються в settings.service_notice.
const R = require('../rules');
const N = require('../notices');
const { DIRECTIONS } = require('../directions');
const { logSafe } = require('./write');

const KEY = 'service_notice';
const ALL = 'Усі продавці';
const toOf = (n) => (n.dir && DIRECTIONS[n.dir] ? DIRECTIONS[n.dir].title : ALL);
const dm = (until) => until.slice(8, 10) + '.' + until.slice(5, 7) + ' ' + until.slice(11);

const pad = (n) => ('0' + n).slice(-2);
const hm = (iso) => { const k = R.kyivNow(new Date(iso)); return k.dmy.slice(0, 5) + ' ' + pad(k.hh) + ':' + pad(k.mm); };
const byLabel = (a, b) => a.label.localeCompare(b.label, 'uk');

// «Побачили N з M»: одним запитом по всіх діючих повідомленнях. Якщо таблиці підтверджень нема (міграція не застосована) або база не відповіла -
// список усе одно відкривається, лише без цифр (seen/acked/total = null).
async function admNoticeList(payload, env) {
  const list = N.activeList(await env.adm.getSetting(KEY), env.at);
  let stores = [], acks = null;
  if (list.length) {
    try { [stores, acks] = await Promise.all([env.data.stores(), env.adm.noticeAcks(list.map((n) => n.id))]); }
    catch (e) { acks = null; }
  }
  return { now: N.stamp(env.at), day: R.kyivNow(env.at).day, max: N.MAX_ACTIVE,
    notices: list.map((n) => {
      const st = acks ? N.ackStats(n, stores, acks) : null;
      return { id: n.id, text: n.text, dir: n.dir || '', dirTitle: toOf(n), until: n.until, modal: !!n.modal,
        total: st ? st.total : null, seen: st ? st.seen : null, acked: st ? st.acked : null };
    }) };
}

// Хто побачив, а хто ні (для дзвінка): payload { id }
async function admNoticeWho(payload, env) {
  const id = String((payload || {}).id || '');
  const n = N.activeList(await env.adm.getSetting(KEY), env.at).find((x) => x.id === id);
  if (!n) throw new Error('Невідоме повідомлення');
  const [stores, acks] = await Promise.all([env.data.stores(), env.adm.noticeAcks([id])]);
  const st = N.ackStats(n, stores, acks);
  return { id, text: n.text, dir: n.dir || '', dirTitle: toOf(n), until: n.until, modal: !!n.modal, total: st.total, seen: st.seen, acked: st.acked,
    missing: st.missing.map((s) => ({ id: s.id, label: s.label, code: s.code || '', route: s.route || '' })).sort(byLabel),
    seenList: st.seenRows.map((r) => ({ id: r.store.id, label: r.store.label, seenAt: hm(r.ack.seen_at), acked: !!r.ack.ack_at })).sort(byLabel) };
}

// payload: { text, dir ('' | 'all' | напрямок), until ('yyyy-MM-ddTHH:MM' за Києвом), modal }
async function admNoticeAdd(payload, env) {
  const n = N.makeNotice(payload, env.at);
  const live = N.activeList(await env.adm.getSetting(KEY), env.at);          // минулі й пошкоджені записи випадають
  if (live.length >= N.MAX_ACTIVE) throw new Error('Одночасно діє не більше ' + N.MAX_ACTIVE + ' повідомлень - вимкніть зайве');
  live.push(n);
  await env.adm.setSetting(KEY, live);
  await logSafe(env, 'Додано повідомлення продавцям', toOf(n) + ': ' + n.text.slice(0, 200) + ' (до ' + dm(n.until) + (n.modal ? ', з вікном' : '') + ')');
  return { ok: true, id: n.id };
}

async function admNoticeOff(payload, env) {
  const id = String((payload || {}).id || '');
  if (!id) throw new Error('Невідоме повідомлення');
  const live = N.activeList(await env.adm.getSetting(KEY), env.at);
  const gone = live.find((n) => n.id === id);
  await env.adm.setSetting(KEY, live.filter((n) => n.id !== id));
  if (gone) await logSafe(env, 'Вимкнено повідомлення продавцям', toOf(gone) + ': ' + gone.text.slice(0, 200));
  return { ok: true, off: !!gone };
}

module.exports = { admNoticeList, admNoticeWho, admNoticeAdd, admNoticeOff };
