// Пульт: сервісні повідомлення продавцям (src/notices.js) - список діючих, нове, вимкнути. Зберігаються в settings.service_notice.
const R = require('../rules');
const N = require('../notices');
const { DIRECTIONS } = require('../directions');
const { logSafe } = require('./write');

const KEY = 'service_notice';
const ALL = 'Усі продавці';
const toOf = (n) => (n.dir && DIRECTIONS[n.dir] ? DIRECTIONS[n.dir].title : ALL);
const dm = (until) => until.slice(8, 10) + '.' + until.slice(5, 7) + ' ' + until.slice(11);

async function admNoticeList(payload, env) {
  const list = N.activeList(await env.adm.getSetting(KEY), env.at);
  return { now: N.stamp(env.at), day: R.kyivNow(env.at).day, max: N.MAX_ACTIVE,
    notices: list.map((n) => ({ id: n.id, text: n.text, dir: n.dir || '', dirTitle: toOf(n), until: n.until, modal: !!n.modal })) };
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

module.exports = { admNoticeList, admNoticeAdd, admNoticeOff };
