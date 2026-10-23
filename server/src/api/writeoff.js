// Списання випічки і кулінарії: woProducts, woSubmit, woMine, woDelete. Перенос apiWo*_ (app/WriteOff.gs).
// Порядок перевірок і тексти - дослівно. Джерело правди - writeoffs/writeoff_lines; лист «Списания» - вигрузка (export/writeoff.js).
//
// env = { at, data, queueWoExport? }; data:
//   stores() | settings() -> {wo_books, wo_late, wo_deadline} | products('bakery') -> рядки products (з cost)
//   woResult(docId) -> збережена відповідь | null | submitWriteoffTx(p) -> { ok, duplicate, result }
//   woDocsOfStore(storeId, sinceDay) -> [writeoff з lines] | woFind(docId) -> writeoff з lines | null
//   woMarkDeleted(id) -> bool | adminLog(action, text)
const R = require('../rules');
const { WO_DEADLINE } = require('../directions');

const WO_KEEP_DAYS = 31;
const WO_MAX_ITEMS = 150;
const WO_MAX_QTY = 500;
const WO_MARKUP = 0.20;                     // «Сумма +20%» (WriteOff.gs v74, з 19.10.2026)
const BREAD_EDRPOU = '44413718';            // BreadReport.gs: порожнє ЄДРПОУ точки = це
const noop = () => {};

function woPlus(sum) { return Math.round(sum * (1 + WO_MARKUP) * 100) / 100; }

// 'ДД.ММ.РРРР' -> yyyyMMdd числом (woNum_)
function woNum(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
}
const numOfDay = (day) => Number(String(day).slice(0, 10).replace(/-/g, ''));
function woDmyOfNum(n) { const s = String(n); return s.slice(6, 8) + '.' + s.slice(4, 6) + '.' + s.slice(0, 4); }
function dayMinus(day, n) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); }
function atText(iso) { const k = R.kyivNow(new Date(iso)); return k.dmy + ' ' + k.time.slice(0, 5); }

function woEdrpouOf(store) { return String((store && store.edrpou) || BREAD_EDRPOU).trim(); }
function woDeadline(settings) { return (settings && settings.wo_deadline) || WO_DEADLINE; }

function woClosed(env, settings) {
  const n = R.kyivNow(env.at);
  if ((settings || {}).wo_late === n.dmy) return false;
  const p = woDeadline(settings).split(':');
  return (n.hh * 60 + n.mm) >= (+p[0] * 60 + +p[1]);
}

function woAllowedDates(now) { return [{ v: now.dmy, t: 'Сьогодні' }]; }

// woProducts_: собівартість у базі є завжди (products.cost), тому costCol = true:
// продавцям - лише товари з cost > 0, «стоп» не важливий; без собівартості - у noCost (для пульта).
function buildWoProducts(rows, costCol = true) {
  const out = { products: [], categories: [], costCol, noCost: [] };
  (rows || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)).forEach((p) => {
    const name = String(p.name || '').trim();
    if (!name) return;
    const barcode = String(p.barcode || '').trim();
    const retail = Number(p.price) || 0;
    const cost = costCol ? (Number(p.cost) || 0) : 0;
    if (costCol) {
      if (!(cost > 0)) { out.noCost.push(name); return; }
    } else if (String(p.status || '').toLowerCase() === 'stop') return;
    out.products.push({
      id: String(p.id), barcode, name,
      category: String(p.category || '').trim() || 'Інше',
      price: Math.round((cost > 0 ? cost : retail) * 100) / 100,
    });
  });
  out.products.sort((a, b) => a.category.localeCompare(b.category, 'uk') || a.name.localeCompare(b.name, 'uk'));
  out.products.forEach((p) => { if (out.categories.indexOf(p.category) < 0) out.categories.push(p.category); });
  return out;
}

async function woStoreChecked(env, storeId) {
  const stores = await env.data.stores();
  const store = stores.find((s) => s.id === String(storeId));
  if (!store) throw new Error('Торгову точку не знайдено. Оновіть сторінку.');
  if (store.directions.indexOf('bakery') < 0) throw new Error('Для цієї ТТ списання випічки не передбачене');
  return store;
}

async function apiWoProducts(payload, env) {
  payload = payload || {};
  const store = await woStoreChecked(env, payload.storeId);
  const [settings, rows] = await Promise.all([env.data.settings(), env.data.products('bakery')]);
  const p = buildWoProducts(rows);
  const edrpou = woEdrpouOf(store);
  return {
    products: p.products.map((x) => ({ id: x.id, name: x.name, category: x.category })),
    categories: p.categories,
    costCol: p.costCol,
    dates: woAllowedDates(R.kyivNow(env.at)),
    closed: woClosed(env, settings),
    deadline: woDeadline(settings),
    hasBook: !!(((settings.wo_books || {})[edrpou]) || {}).id,
  };
}

async function apiWoSubmit(payload, env) {
  payload = payload || {};
  const docId = String(payload.docId || '');
  if (!/^[a-z0-9]{8,40}$/i.test(docId)) throw new Error('Оновіть сторінку і спробуйте ще раз');
  const store = await woStoreChecked(env, payload.storeId);
  const settings = await env.data.settings();
  const D = woDeadline(settings);
  if (woClosed(env, settings)) throw new Error('Прийом списань на сьогодні закрито о ' + D + '. Подати можна завтра до ' + D + '.');

  const now = R.kyivNow(env.at);
  const date = String(payload.date || '');
  const dates = woAllowedDates(now).map((d) => d.v);
  if (dates.indexOf(date) < 0) throw new Error('Списання подається лише за сьогодні - оновіть сторінку');

  const seller = String(payload.seller || '').replace(/\s+/g, ' ').trim();
  if (seller.length < 2 || seller.length > 40 || !/[A-Za-zА-Яа-яІіЇїЄєҐґ]{2}/.test(seller))
    throw new Error('Вкажіть прізвище продавця, який подає списання');

  const prev = await env.data.woResult(docId);
  if (prev) return { ...prev, duplicate: true };

  const edrpou = woEdrpouOf(store);
  const book = (settings.wo_books || {})[edrpou];
  if (!book || !book.id) throw new Error('Для цієї точки ще не налаштовано прийом списань. Повідомте керівника.');

  const byId = {};
  buildWoProducts(await env.data.products('bakery')).products.forEach((p) => { byId[p.id] = p; });
  const merged = {}, order = [];
  (Array.isArray(payload.items) ? payload.items : []).forEach((it) => {
    const p = byId[String(it && it.id)];
    if (!p) throw new Error('Товар не знайдено в асортименті - оновіть сторінку');
    const q = parseFloat(String(it.qty).replace(',', '.'));
    if (!(q > 0)) return;
    if (!merged[p.id]) { merged[p.id] = 0; order.push(p.id); }
    merged[p.id] = Math.round((merged[p.id] + q) * 1000) / 1000;
  });
  if (!order.length) throw new Error('Не вибрано жодного товару');
  if (order.length > WO_MAX_ITEMS) throw new Error('Забагато позицій в одному списанні');

  let total = 0, qty = 0;
  const lines = order.map((id, i) => {
    const p = byId[id], q = merged[id];
    if (q > WO_MAX_QTY) throw new Error('Перевірте кількість: ' + p.name + ' - ' + q);
    const s = Math.round(p.price * q * 100) / 100;
    total += s; qty += q;
    return { line_no: i + 1, product_id: p.id, barcode: p.barcode, category: p.category, name: p.name,
      qty: q, price: p.price, amount: s, amount_plus: woPlus(s) };
  });
  total = Math.round(total * 100) / 100;

  const result = {
    docId, store: store.label, woDate: date, seller,
    positions: lines.length, qty: Math.round(qty * 1000) / 1000, total,
    time: now.time.slice(0, 5),
    date: now.dmy,
  };

  const res = await env.data.submitWriteoffTx({
    doc_id: docId, store_id: store.id, store_label: store.label, store_code: store.code || '',
    edrpou, wo_date: now.day, seller, total, submitted_at: env.at.toISOString(), result, lines,
  });
  if (res && res.duplicate) return { ...res.result, duplicate: true };

  (env.queueWoExport || noop)('wo');
  return { ...result, duplicate: false };
}

function woDocs(list) {
  const out = list.map((w) => {
    const dateNum = numOfDay(w.wo_date);
    const d = { id: w.doc_id, store: w.store_label, code: w.store_code, seller: w.seller,
      dateNum, date: woDmyOfNum(dateNum), at: atText(w.submitted_at), atNum: Date.parse(w.submitted_at),
      items: [], qty: 0, total: 0 };
    (w.lines || []).slice().sort((a, b) => a.line_no - b.line_no).forEach((l) => {
      const q = Number(l.qty) || 0, s = Number(l.amount) || 0;
      d.items.push({ name: l.name, qty: q, price: Number(l.price) || 0, sum: s });
      d.qty = Math.round((d.qty + q) * 1000) / 1000;
      d.total = Math.round((d.total + s) * 100) / 100;
    });
    return d;
  });
  out.sort((a, b) => (b.atNum - a.atNum) || (b.dateNum - a.dateNum));
  return out;
}

async function apiWoMine(payload, env) {
  payload = payload || {};
  const store = await woStoreChecked(env, payload.storeId);
  const now = R.kyivNow(env.at);
  const [settings, list] = await Promise.all([env.data.settings(), env.data.woDocsOfStore(store.id, dayMinus(now.day, WO_KEEP_DAYS))]);
  const docs = woDocs(list);
  const today = now.dmy, closed = woClosed(env, settings);
  const monthFrom = Math.floor(woNum(today) / 100) * 100 + 1;
  let sum = 0, month = 0;
  docs.forEach((d) => {
    d.canDelete = !closed && d.at.indexOf(today) === 0;
    sum += d.total;
    if (d.dateNum >= monthFrom) month += d.total;
    delete d.atNum;
    d.items = d.items.map((it) => ({ name: it.name, qty: it.qty }));
  });
  return { docs, closed, deadline: woDeadline(settings), keepDays: WO_KEEP_DAYS,
    total: Math.round(sum * 100) / 100, month: Math.round(month * 100) / 100 };
}

async function apiWoDelete(payload, env) {
  payload = payload || {};
  const store = await woStoreChecked(env, payload.storeId);
  const settings = await env.data.settings();
  const D = woDeadline(settings);
  if (woClosed(env, settings)) throw new Error('Після ' + D + ' видалити списання вже не можна. Зверніться до керівника.');
  const docId = String(payload.docId || '');
  if (!/^[a-z0-9]{8,40}$/i.test(docId)) throw new Error('Невірний ID списання');

  let res = { removed: 0, total: 0, date: '', store: '' };
  const w = await env.data.woFind(docId);
  if (w && (w.lines || []).length) {
    if (w.store_id !== store.id) throw new Error('Це списання іншої точки');
    if (R.kyivNow(new Date(w.submitted_at)).dmy !== R.kyivNow(env.at).dmy) throw new Error('Видалити можна лише списання, подане сьогодні');
    if (await env.data.woMarkDeleted(w.id)) {
      const total = w.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      res = { removed: w.lines.length, total: Math.round(total * 100) / 100, date: woDmyOfNum(numOfDay(w.wo_date)), store: w.store_label };
    }
  }
  if (!res.removed) throw new Error('Списання не знайдено - можливо, його вже видалили');
  try {
    await env.data.adminLog('Продавець видалив списання', store.label + ' - за ' + res.date + ', позицій ' + res.removed +
      ', ' + res.total + ' грн (ID ' + docId + ')');
  } catch (e) { console.error('Журнал дій: ' + e.message); }
  (env.queueWoExport || noop)('wo');
  return res;
}

module.exports = { apiWoProducts, apiWoSubmit, apiWoMine, apiWoDelete, buildWoProducts, woPlus,
  woDocs, woClosed, woDeadline, woDmyOfNum, numOfDay, woEdrpouOf,
  WO_MARKUP, WO_KEEP_DAYS, WO_MAX_ITEMS, WO_MAX_QTY, BREAD_EDRPOU };
