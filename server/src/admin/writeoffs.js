// Екрани «Списання» пульта (admWoBrief_/admWoStats_/admWoStore_/admWoDelete_/admWoOpen_ з app/WriteOff.gs).
// Джерело - таблиці writeoffs/writeoff_lines (не Google-листи): стан і суми завжди збігаються з тим, що бачать продавці.
// env = { at, data: { stores, settings, products, woRange, woFind, woMarkDeleted, adminLog }, adm: { setSetting }, queueWoExport? }
const R = require('../rules');
const W = require('../api/writeoff');
const { isUaStore } = require('./read');

const UA_EDRPOU = '45672783';
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const dayNum = (day) => W.numOfDay(day);                         // 'YYYY-MM-DD' -> yyyymmdd
const isoOfNum = (n) => { const s = String(n); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); };
const kyivDayOf = (iso) => R.kyivNow(new Date(iso)).day;
const bookUrl = (id) => 'https://docs.google.com/spreadsheets/d/' + id + '/edit';

// Період -> { from, to (yyyymmdd), title }; як woPeriod_
function period(p, at) {
  const now = R.kyivNow(at), t = dayNum(now.day), y = Math.floor(t / 10000), m = Math.floor(t / 100) % 100;
  const back = (n) => { const d = new Date(now.day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return dayNum(d.toISOString().slice(0, 10)); };
  switch (String(p || 'month')) {
    case 'today': return { from: t, to: t, title: 'сегодня' };
    case 'yesterday': return { from: back(1), to: back(1), title: 'вчера' };
    case 'week': return { from: back(6), to: t, title: '7 дней' };
    case 'prev': {
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      return { from: py * 10000 + pm * 100 + 1, to: py * 10000 + pm * 100 + 31, title: 'прошлый месяц' };
    }
    default: return { from: y * 10000 + m * 100 + 1, to: t, title: 'этот месяц' };
  }
}

const bakeryStores = (stores) => (stores || []).filter((s) => (s.directions || []).includes('bakery'));
const state = (env, settings) => ({ closed: W.woClosed(env, settings), openedAll: (settings || {}).wo_late === R.kyivNow(env.at).dmy });
const booksOf = (settings) => (settings && settings.wo_books) || {};
const entityName = (settings, e) => (booksOf(settings)[e] && booksOf(settings)[e].name) || ('ЕГРПОУ ' + e);

// плашка на головному екрані пульта
async function admWoBrief(env) {
  const settings = await env.data.settings();
  const now = R.kyivNow(env.at), t = dayNum(now.day), mFrom = Math.floor(t / 100) * 100 + 1;
  const docs = await env.data.woRange(isoOfNum(mFrom), now.day);
  let month = 0, todaySum = 0;
  const todayDocs = new Set(), todayStores = new Set();
  docs.forEach((w) => {
    const sum = Number(w.total) || 0;
    month += sum;
    if (kyivDayOf(w.submitted_at) === now.day) { todayDocs.add(w.doc_id); todaySum += sum; todayStores.add(w.store_id); }
  });
  return { todayDocs: todayDocs.size, todayStores: todayStores.size, todaySum: r2(todaySum), monthSum: r2(month),
    books: Object.keys(booksOf(settings)).length, deadline: W.woDeadline(settings), ...state(env, settings) };
}

async function admWoStats(payload, env) {
  const per = period(payload.period, env.at), only = String(payload.edrpou || '');
  const [settings, stores, prodRows, docs] = await Promise.all([env.data.settings(), env.data.stores(),
    env.data.products('bakery'), env.data.woRange(isoOfNum(per.from), isoOfNum(per.to))]);
  const books = booksOf(settings), bakery = bakeryStores(stores), label = {};
  bakery.forEach((s) => { label[s.id] = s; });

  const byStore = {}, byProd = {}, byDay = {}, byEnt = {}, ids = new Set();
  let total = 0, qty = 0;
  docs.filter((w) => !only || w.edrpou === only).forEach((w) => {
    const s = byStore[w.store_id] || (byStore[w.store_id] = { id: w.store_id, label: w.store_label, code: w.store_code, edrpou: w.edrpou, sum: 0, qty: 0, docs: new Set() });
    const en = byEnt[w.edrpou] || (byEnt[w.edrpou] = { sum: 0, qty: 0, stores: new Set() });
    const dn = dayNum(w.wo_date);
    ids.add(w.doc_id); s.docs.add(w.doc_id); en.stores.add(w.store_id);
    (w.lines || []).forEach((l) => {
      const sum = Number(l.amount) || 0, q = Number(l.qty) || 0;
      total += sum; qty += q; s.sum += sum; s.qty += q; en.sum += sum; en.qty += q;
      const pk = l.barcode || l.name, p = byProd[pk] || (byProd[pk] = { name: l.name, cat: l.category || 'Інше', sum: 0, qty: 0 });
      p.sum += sum; p.qty += q;
      byDay[dn] = (byDay[dn] || 0) + sum;
    });
  });

  const storeList = Object.keys(byStore).map((k) => {
    const s = byStore[k], cur = label[k];
    return { id: k, label: cur ? cur.label : s.label, code: cur ? cur.code : s.code,
      ua: cur ? isUaStore(cur) : String(s.edrpou) === UA_EDRPOU, edrpou: s.edrpou, nowEdrpou: cur ? W.woEdrpouOf(cur) : '',
      sum: r2(s.sum), qty: r3(s.qty), docs: s.docs.size };
  }).sort((a, b) => b.sum - a.sum);
  const prodList = Object.keys(byProd).map((k) => ({ name: byProd[k].name, cat: byProd[k].cat, sum: r2(byProd[k].sum), qty: r3(byProd[k].qty) }))
    .sort((a, b) => b.sum - a.sum).slice(0, 20);
  const dayList = Object.keys(byDay).map(Number).sort((a, b) => b - a).map((d) => ({ date: W.woDmyOfNum(d), sum: r2(byDay[d]) }));
  const silent = bakery.filter((s) => !byStore[s.id] && (!only || W.woEdrpouOf(s) === only)).map((s) => s.label);

  const missing = {};
  bakery.forEach((s) => { const e = W.woEdrpouOf(s); if (!(books[e] && books[e].id)) (missing[e] = missing[e] || []).push(s.label); });
  const bookList = Object.keys(books).map((e) => {
    const en = byEnt[e] || { sum: 0, qty: 0, stores: new Set() };
    return { edrpou: e, name: entityName(settings, e), url: bookUrl(books[e].id), xlsx: '', sum: r2(en.sum), qty: r3(en.qty),
      active: en.stores.size, storesNow: bakery.filter((s) => W.woEdrpouOf(s) === e).length };
  }).sort((a, b) => b.storesNow - a.storesNow);

  const prods = W.buildWoProducts(prodRows);
  const today = dayNum(R.kyivNow(env.at).day);
  return { period: String(payload.period || 'month'), periodTitle: per.title,
    from: W.woDmyOfNum(per.from), to: W.woDmyOfNum(Math.min(per.to, today)), edrpou: only,
    total: r2(total), qty: r3(qty), docs: ids.size, storesCount: storeList.length, storesAll: bakery.length,
    stores: storeList, products: prodList, days: dayList, silent, books: bookList,
    missing: Object.keys(missing).map((e) => ({ edrpou: e, stores: missing[e] })),
    costCol: prods.costCol, prodCount: prods.products.length, noCost: prods.noCost || [],
    ...state(env, settings), deadline: W.woDeadline(settings), keepDays: W.WO_KEEP_DAYS };
}

async function admWoStore(payload, env) {
  const per = period(payload.period, env.at), key = String(payload.storeId || '');
  const [settings, stores, all] = await Promise.all([env.data.settings(), env.data.stores(), env.data.woRange(isoOfNum(per.from), isoOfNum(per.to))]);
  const mine = all.filter((w) => w.store_id === key);
  const docs = W.woDocs(mine);
  const edr = {}; mine.forEach((w) => { edr[w.doc_id] = w.edrpou; });
  docs.forEach((d) => { d.edrpou = edr[d.id]; });
  const cur = bakeryStores(stores).find((s) => s.id === key) || null, e = cur ? W.woEdrpouOf(cur) : '';
  const book = booksOf(settings)[e];
  let tot = 0, qty = 0;
  docs.forEach((d) => { tot += d.total; qty += d.qty; delete d.atNum; });
  const today = dayNum(R.kyivNow(env.at).day);
  return { id: key, label: cur ? cur.label : (docs[0] ? docs[0].store : key), code: cur ? cur.code : '',
    ua: cur ? isUaStore(cur) : e === UA_EDRPOU, edrpou: e, bookUrl: book && book.id ? bookUrl(book.id) : '',
    period: String(payload.period || 'month'), periodTitle: per.title,
    from: W.woDmyOfNum(per.from), to: W.woDmyOfNum(Math.min(per.to, today)),
    docs, total: r2(tot), qty: r3(qty) };
}

// видалення з пульта - без дедлайну і без перевірки «своя точка / сьогодні» (як admWoDelete_)
async function admWoDelete(payload, env) {
  const docId = String(payload.docId || '');
  if (!/^[a-z0-9]{8,40}$/i.test(docId)) throw new Error('Невірний ID списання');
  const w = await env.data.woFind(docId);
  if (!w || !(w.lines || []).length || !(await env.data.woMarkDeleted(w.id))) throw new Error('Списание не найдено');
  const total = r2(w.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)), date = W.woDmyOfNum(dayNum(w.wo_date));
  try {
    await env.data.adminLog('Видалено списання (пульт)', w.store_label + ' - за ' + date + ', рядків ' + w.lines.length + ', ' + total + ' грн (ID ' + docId + ')');
  } catch (e) { console.error('Журнал дій: ' + e.message); }
  if (env.queueWoExport) env.queueWoExport('wo');
  return { removed: w.lines.length, total, date, store: w.store_label };
}

// «Открыть приём списаний до конца дня» / «обычный режим»: settings.wo_late = сьогоднішня дата (woClosed її порівнює)
async function admWoOpen(payload, env) {
  const on = !!payload.on;
  await env.adm.setSetting('wo_late', on ? R.kyivNow(env.at).dmy : '');
  const settings = await env.data.settings();
  try { await env.data.adminLog(on ? 'Списання: відкрито до кінця дня' : 'Списання: звичайний режим', 'дедлайн ' + W.woDeadline(settings)); } catch (e) { console.error('Журнал дій: ' + e.message); }
  return state(env, settings);
}

// у Node списання живуть у базі: лист «Архив» не потрібен, таблиці юросіб задаються в settings.wo_books
async function admWoArchive() {
  throw new Error('Архів не потрібен: списання зберігаються в базі, листи у таблицях юросіб - лише вигрузка.');
}
async function admWoSetup(payload, env) {
  const [settings, stores] = await Promise.all([env.data.settings(), env.data.stores()]);
  const books = booksOf(settings), need = [...new Set(bakeryStores(stores).map(W.woEdrpouOf))];
  const lack = need.filter((e) => !(books[e] && books[e].id));
  if (lack.length) throw new Error('Немає таблиці для ЄДРПОУ ' + lack.join(', ') + ': додайте її в налаштування wo_books (створює власник вручну).');
  return need.map((e) => ({ edrpou: e, created: false }));
}

module.exports = { admWoBrief, admWoStats, admWoStore, admWoDelete, admWoOpen, admWoArchive, admWoSetup, period };
