// Пульт: ціни з приходів (BigQuery). Три речі:
//   admIncomingPreview - свіжий запит, перегляд «було -> стало» (нічого не пише);
//   admIncomingApply   - застосування вибраних позицій: сервер ПЕРЕРАХОВУЄ зміни з приходу і приймає лише ті рядки, що збігаються
//                        (ціна з екрана не довіряється); ціна, що вже інша, - помилка ДО запису;
//   checkIncomingPrices - автоперевірка в tick: підсумок у settings.incoming_price_changes + одне повідомлення в журнал на новий набір змін.
//                        Прайс автоматично НЕ змінюється.
const crypto = require('node:crypto');
const P = require('../prices');
const I = require('../incoming');
const { cfgOf, logSafe } = require('./write');

const KEY = 'incoming_price_changes';
const MIN_INTERVAL_MS = 3 * 3600 * 1000;       // автоперевірка не частіше, ніж раз на 3 години
const MAX_ROWS = 200;
const ITEMS_IN_SUMMARY = 10;
const LOG_ITEMS = 8;
const LOG_MAX = 900;
const STALE = 'Ціна змінилась з моменту перегляду. Оновіть екран.';

function incomingCfg(dir) {
  const cfg = cfgOf(dir);                       // «Невідомий напрямок», якщо ключа нема
  if (!Object.prototype.hasOwnProperty.call(I.INCOMING, dir)) throw new Error('Для цього напрямку ціни з приходів не підтримується');
  return cfg;
}

async function compute(dir, env) {
  const [products, incoming] = await Promise.all([env.adm.dirProducts(dir), env.incoming.fetch(dir)]);
  return I.planIncoming(products, incoming);
}

const sum2 = (rows, f) => P.round2(rows.reduce((s, r) => s + r[f], 0));
const sigOf = (rows) => (rows.length ? crypto.createHash('sha1').update(rows.map((r) => r.id + ':' + r.new).join('|')).digest('hex').slice(0, 12) : '');
const summaryOf = (rows) => ({ n: rows.length, big: rows.filter((r) => r.big).length, sig: sigOf(rows),
  items: rows.slice(0, ITEMS_IN_SUMMARY).map((r) => ({ name: r.name, old: r.old, new: r.new })) });
const listText = (rows) => rows.slice(0, LOG_ITEMS).map((r) => r.name + ' ' + r.old + ' → ' + r.new).join('; ') +
  (rows.length > LOG_ITEMS ? '; …ще ' + (rows.length - LOG_ITEMS) : '');

async function saveSummary(env, dir, rows) {
  const prev = await env.adm.getSetting(KEY);
  const dirs = prev && typeof prev === 'object' && prev.dirs && typeof prev.dirs === 'object' ? prev.dirs : {};
  await env.adm.setSetting(KEY, { checkedAt: env.at.toISOString(), dirs: { ...dirs, [dir]: summaryOf(rows) } });
}

async function admIncomingPreview(payload, env) {
  const dir = String((payload || {}).dir || '');
  incomingCfg(dir);
  const plan = await compute(dir, env);
  return { dir, rows: plan.rows, n: plan.rows.length, big: plan.rows.filter((r) => r.big).length, noIncoming: plan.noIncoming,
    sumOld: sum2(plan.rows, 'old'), sumNew: sum2(plan.rows, 'new'), checkedAt: env.at.toISOString() };
}

// payload: { dir, rows: [{ id, old, new }] } - те, що бачили в перегляді
async function admIncomingApply(payload, env) {
  payload = payload || {};
  const dir = String(payload.dir || '');
  const cfg = incomingCfg(dir);
  const req = Array.isArray(payload.rows) ? payload.rows : [];
  if (!req.length) throw new Error('Оберіть позиції');
  if (req.length > MAX_ROWS) throw new Error('Позицій не більше ' + MAX_ROWS + ' за раз');
  const ids = req.map((r) => String((r || {}).id));
  if (new Set(ids).size !== ids.length) throw new Error('Позиція вказана двічі');

  const plan = await compute(dir, env);
  const fresh = new Map(plan.rows.map((r) => [String(r.id), r]));
  const todo = req.map((r) => {
    const f = fresh.get(String(r.id));
    if (!f || P.parseMoney(r.old) !== f.old || P.parseMoney(r.new) !== f.new) throw new Error(STALE);
    return f;
  });

  const done = [];
  let failed = null;
  try {
    for (const r of todo) {
      if (!await env.adm.setProduct(dir, r.id, { price: r.new })) { failed = r; throw new Error('Товар не знайдено. Оновіть сторінку.'); }
      done.push(r);
    }
  } finally {
    if (done.length) {
      const head = cfg.title + ': за приходами, ' + done.length + ' поз.' + (failed ? ' (збій на «' + failed.name + '», решту не записано)' : '');
      await logSafe(env, 'Змінено ціни', (head + '; ' + listText(done)).slice(0, LOG_MAX));
      const left = plan.rows.filter((r) => !done.includes(r));
      try { await saveSummary(env, dir, left); } catch (e) { (env.log || console.error)('підсумок цін з приходів: ' + e.message); }
    }
  }
  return { changed: done.length, rows: done.map((r) => ({ id: r.id, name: r.name, old: r.old, new: r.new })) };
}

// Автоперевірка (tick). Збій BigQuery - виняток (tick занесе його в «Здоров'я»), старий підсумок лишається.
async function checkIncomingPrices(env, { force = false } = {}) {
  const prev = await env.adm.getSetting(KEY);
  if (!force && prev && prev.checkedAt && env.at.getTime() - Date.parse(prev.checkedAt) < MIN_INTERVAL_MS) return { skipped: 'перевірка свіжа' };
  const out = {};
  const dirs = prev && typeof prev === 'object' && prev.dirs && typeof prev.dirs === 'object' ? { ...prev.dirs } : {};
  const notes = [];
  for (const dir of Object.keys(I.INCOMING)) {
    const plan = await compute(dir, env);
    const s = summaryOf(plan.rows);
    const notified = s.n > 0 && (!dirs[dir] || dirs[dir].sig !== s.sig);
    dirs[dir] = s;
    out[dir] = { n: s.n, big: s.big, notified };
    if (notified) notes.push(['Змінилась вхідна ціна', cfgOf(dir).title + ': ' + s.n + ' поз. (за приходами), у прайсі ще старі: ' + listText(plan.rows).slice(0, LOG_MAX)]);
  }
  await env.adm.setSetting(KEY, { checkedAt: env.at.toISOString(), dirs });
  for (const [a, d] of notes) await logSafe(env, a, d);
  return out;
}

// для екрана «Сегодня»: { dir: { n, big, checkedAt } } лише де є розбіжності
function incomingBanner(settings) {
  const s = settings && settings[KEY];
  const out = {};
  if (!s || typeof s !== 'object' || !s.dirs || typeof s.dirs !== 'object') return out;
  for (const [dir, v] of Object.entries(s.dirs)) {
    if (v && Number(v.n) > 0) out[dir] = { n: Number(v.n), big: Number(v.big) || 0, checkedAt: s.checkedAt || '' };
  }
  return out;
}

// для екрана «Ассортимент и цены»: null - напрямок без цін з приходів
async function incomingInfo(dir, env) {
  if (!Object.prototype.hasOwnProperty.call(I.INCOMING, dir)) return null;
  let s = null;
  try { s = env.adm.getSetting ? await env.adm.getSetting(KEY) : null; } catch (e) { s = null; }
  const b = incomingBanner({ [KEY]: s })[dir] || { n: 0, big: 0, checkedAt: (s && s.checkedAt) || '' };
  return { enabled: true, n: b.n, big: b.big, checkedAt: b.checkedAt };
}

module.exports = { KEY, admIncomingPreview, admIncomingApply, checkIncomingPrices, incomingBanner, incomingInfo };
