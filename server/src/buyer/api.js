// Сторінка закупниці напрямку (/buyer/<dir>): хто замовив сьогодні, видалення замовлення точки, асортимент.
// Видалення - перенос delCancelOrder_/onDeleteSheetEdit (app/DeleteSheet.gs): тексти й запис у журнал дослівно.
// Асортимент (ціна, стоп, наявність) - нове за планом Task 9: оригіналу в Apps Script немає (закупниці правили лист «Ассортимент»).
// Після переходу (23.10.2026) правда про асортимент - таблиця products у базі; лист «Ассортимент» сервер не читає (лише ручний scripts/import-reference.js --force його перезапише).
const { DIRECTIONS } = require('../directions');
const R = require('../rules');
const { STORE_NOT_FOUND } = require('../admin/write');
const { nameKey } = require('../import/parse');

function cfgOf(dir) {
  const cfg = Object.prototype.hasOwnProperty.call(DIRECTIONS, dir) ? DIRECTIONS[dir] : null;
  if (!cfg) throw new Error('Невідомий напрямок: "' + dir + '"');
  return cfg;
}
const dayOf = (env) => R.kyivNow(env.at).day;
const r3 = (n) => Math.round(n * 1000) / 1000;
const HM = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hm = (iso) => (iso ? HM.format(new Date(iso)) : '');
const logErr = (env, msg) => (env.log || console.error)(msg);
async function logSafe(env, action, details) {
  try { await env.adm.adminLog(action, details); } catch (e) { logErr(env, 'adminLog: ' + ((e && e.message) || e)); }
}

// delTodayOrders_ + рядок delSheetRefresh_: N поз. · кількість од. · час (час - лише ВК і овочі)
async function buyerToday(dir, env) {
  const cfg = cfgOf(dir);
  const hasTime = dir === 'bakery' || dir === 'veg';
  const [orders, stores] = await Promise.all([env.adm.dayOrders(dir, dayOf(env)), env.data.stores()]);
  const byId = new Map(stores.map((s) => [s.id, s]));
  const agg = new Map();
  orders.forEach((o) => {
    let a = agg.get(o.store_id);
    if (!a) agg.set(o.store_id, a = { storeId: o.store_id, label: (byId.get(o.store_id) || {}).label || o.store_id, n: 0, qty: 0, time: '', lines: [] });
    (o.lines || []).forEach((l) => { a.n++; a.qty += Number(l.qty) || 0; a.lines.push({ row: Number(l.id), name: l.name, qty: Number(l.qty) }); });
    if (hasTime) { const t = hm(o.created_at); if (t) a.time = t; }
  });
  const unit = cfg.unit ? ' ' + cfg.unit : '';
  const list = [...agg.values()].map((a) => ({ ...a, qty: r3(a.qty), sub: a.n + ' поз. · ' + r3(a.qty) + unit + (a.time ? ' · ' + a.time : '') }));
  list.sort((x, y) => x.label.localeCompare(y.label, 'uk'));
  return { dir, title: cfg.title, unit: cfg.unit || '', stores: list };
}

// delCancelOrder_: скасування замовлень точки за сьогодні, журнал 'Видалено з таблиці' з переліком рядків
async function buyerDelete(dir, p, env) {
  const cfg = cfgOf(dir);
  const store = (await env.data.stores()).find((s) => s.id === String((p || {}).storeId));
  if (!store) throw new Error(STORE_NOT_FOUND);
  const day = dayOf(env);
  const items = (await env.adm.dayStoreLines(dir, store.id, day)).map((l) => l.name + ' x' + Number(l.qty));
  const removed = await env.adm.cancelDay(dir, store.id, day);
  try { env.queueExport(dir); } catch (e) { logErr(env, 'queueExport: ' + ((e && e.message) || e)); }
  await logSafe(env, 'Видалено з таблиці', cfg.title + ' / ' + store.label + ' - рядків ' + removed +
    (items.length ? ' (' + items.join('; ') + ')' : ''));
  const message = removed
    ? '✅ Видалено ' + removed + ' рядків замовлення: ' + store.label + '. ТТ може замовити знову.'
    : '⚠ Замовлення для "' + store.label + '" не знайдено - можливо, його вже видалили. ' +
      'Позначку "вже замовляли" знято, ТТ може замовити знову.';
  return { removed, items, message };
}

async function buyerProducts(dir, env) {
  const cfg = cfgOf(dir);
  const list = (await env.adm.dirProducts(dir)).map((x) => ({
    id: x.id, name: x.name, barcode: x.barcode || '', price: Number(x.price) || 0, stop: x.status === 'stop',
    category: x.category || '', availability: x.availability || '', box: x.box || '', sort: Number(x.sort) || 0,
    cost: dir === 'bakery' ? Number(x.cost) || 0 : 0,
  })).sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'uk'));
  return { dir, title: cfg.title, hasAvailability: dir === 'bakery', hasCost: dir === 'bakery', products: list };
}

const NOT_FOUND = 'Товар не знайдено. Оновіть сторінку.';
async function buyerSetProduct(dir, p, env) {
  const cfg = cfgOf(dir);
  p = p || {};
  const cur = (await env.adm.dirProducts(dir)).find((x) => x.id === String(p.id));
  if (!cur) throw new Error(NOT_FOUND);
  const patch = {}, log = [];
  if (p.price !== undefined) {
    const v = Number(String(p.price).replace(',', '.'));
    if (!isFinite(v) || v < 0 || v > 100000 || String(p.price).trim() === '') throw new Error('Невірна ціна: ' + cur.name);
    const price = Math.round(v * 100) / 100;
    if (price !== Number(cur.price)) { patch.price = price; log.push('ціна ' + Number(cur.price) + ' → ' + price); }
  }
  if (typeof p.stop === 'boolean') {
    const status = p.stop ? 'stop' : 'active';
    if (status !== cur.status) { patch.status = status; log.push(p.stop ? 'стоп' : 'знято стоп'); }
  }
  if (p.availability !== undefined) {
    if (dir !== 'bakery') throw new Error('Наявність - лише для випічки');
    const a = String(p.availability || '').trim().slice(0, 60);
    if (a !== (cur.availability || '')) { patch.availability = a; log.push('наявність "' + (cur.availability || '') + '" → "' + a + '"'); }
  }
  if (p.cost !== undefined) {
    if (dir !== 'bakery') throw new Error('Собівартість - лише для випічки і кулінарії');
    const raw = String(p.cost == null ? '' : p.cost).trim().replace(',', '.'), v = Number(raw);
    if (raw === '' || !isFinite(v) || v < 0 || v > 100000) throw new Error('Невірна собівартість: ' + cur.name);
    const cost = Math.round(v * 100) / 100;
    if (cost !== (Number(cur.cost) || 0)) { patch.cost = cost; log.push('собівартість ' + (Number(cur.cost) || 0) + ' → ' + cost); }
  }
  if (!log.length) throw new Error('Змін немає');
  if (!await env.adm.setProduct(dir, cur.id, patch)) throw new Error(NOT_FOUND);
  await logSafe(env, 'Змінено асортимент', cfg.title + ' / ' + cur.name + ': ' + log.join('; '));
  return { id: cur.id, ...patch };
}

// Нова позиція в асортименті (кнопка «Нова позиція» на вкладці «Асортимент»): id = штрихкод, інакше ключ назви (як import-reference).
// Для випічки: категорія, наявність і собівартість (без собівартості позицію не видно в списаннях продавців).
const CATEGORY_MAX = 40;
async function buyerAddProduct(dir, p, env) {
  const cfg = cfgOf(dir);
  p = p || {};
  const name = String(p.name == null ? '' : p.name).trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Вкажіть назву');
  if (name.length > 120) throw new Error('Назва задовга (до 120 символів)');
  const priceRaw = String(p.price == null ? '' : p.price).trim().replace(',', '.');
  const price = Number(priceRaw);
  if (priceRaw === '' || !isFinite(price) || price < 0 || price > 100000) throw new Error('Невірна ціна: вкажіть число від 0');
  const barcode = String(p.barcode == null ? '' : p.barcode).trim();
  if (barcode && !/^\d{4,20}$/.test(barcode)) throw new Error('Штрихкод - лише цифри (4-20) або порожньо');
  const id = barcode || nameKey(name);
  const row = { dir, id, barcode, name, price: Math.round(price * 100) / 100, status: 'active' };
  const bakery = dir === 'bakery';
  if (bakery) {
    row.category = String(p.category == null ? '' : p.category).trim().slice(0, CATEGORY_MAX) || null;
    row.availability = String(p.availability == null ? '' : p.availability).trim().slice(0, 60) || null;
    const costRaw = String(p.cost == null ? '' : p.cost).trim().replace(',', '.');
    if (costRaw !== '') {
      const cost = Number(costRaw);
      if (!isFinite(cost) || cost < 0 || cost > 100000) throw new Error('Невірна собівартість');
      row.cost = Math.round(cost * 100) / 100;
    }
  } else if (dir === 'bread' || dir === 'nbhz') {
    const box = String(p.box == null ? '' : p.box).trim().slice(0, 20);
    row.box = box || null;
  }
  const list = await env.adm.dirProducts(dir);
  const dup = list.find((x) => String(x.id) === id || nameKey(x.name) === nameKey(name));
  if (dup) throw new Error('Така позиція вже є: ' + dup.name + (dup.status === 'stop' ? ' (стоп - зніміть стоп у списку)' : ''));
  row.sort = list.filter((x) => Number(x.sort) < 1000).reduce((m, x) => Math.max(m, Number(x.sort) || 0), 0) + 1;
  await env.adm.addProduct(row);
  await logSafe(env, 'Додано в асортимент', cfg.title + ' / ' + name + ': ' + money2(row.price) + ' грн' +
    (row.category ? ', ' + row.category : '') + (row.cost != null ? ', собівартість ' + money2(row.cost) : '') + (barcode ? ', ' + barcode : ''));
  return { id, name, price: row.price, barcode, category: row.category || '', availability: row.availability || '', stop: false, sort: row.sort,
    cost: row.cost || 0, noCost: bakery && !(row.cost > 0) };
}
const money2 = (n) => String(Math.round(Number(n) * 100) / 100);

// Запити дозволу за сьогодні - замість листа закупниці з кнопкою «Дозволити» (LateRequest.gs).
// Чекають - першими, далі діючі дозволи (LATE_TTL_MIN) і прострочені.
async function buyerLate(dir, env) {
  cfgOf(dir);
  const now = env.at.getTime();
  const ttl = R.LATE_TTL_MIN * 60000;
  const [rows, stores] = await Promise.all([env.adm.dayLate(dir, dayOf(env)), env.data.stores()]);
  const byId = new Map(stores.map((s) => [s.id, s]));
  const rank = { pending: 0, approved: 1, expired: 2 };
  const list = rows.map((r) => {
    const left = r.approved_at ? ttl - (now - new Date(r.approved_at).getTime()) : 0;
    const status = r.status === 'approved' ? (left > 0 ? 'approved' : 'expired') : 'pending';
    return { storeId: r.store_id, label: (byId.get(r.store_id) || {}).label || r.store_id, status,
      time: hm(r.requested_at), leftMin: status === 'approved' ? Math.ceil(left / 60000) : 0, t: r.requested_at || '' };
  }).sort((a, b) => (rank[a.status] - rank[b.status]) || String(b.t).localeCompare(String(a.t)));
  return { dir, pending: list.filter((x) => x.status === 'pending').length, list: list.map(({ t, ...x }) => x) };
}

// Шапка сторінки: дедлайн за розкладом напрямку, прийом усім сьогодні (late_all), час останньої збірки звіту.
async function buyerInfo(dir, env) {
  const cfg = cfgOf(dir);
  const lateAll = (await env.adm.getSetting('late_all')) || {};
  const deadline = cfg.deadline || '';
  let reportAt = '';
  try {
    const v = env.reportAt ? await env.reportAt(dir) : '';
    reportAt = typeof v === 'string' ? v : (v && (v.text || v.hm)) || '';
  } catch (e) { reportAt = ''; }
  return { dir, title: cfg.title, color: cfg.color || '', unit: cfg.unit || '', deadline,
    closed: !!deadline && HM.format(env.at) >= deadline, openAll: lateAll[dir] === dayOf(env),
    lateRequest: !!cfg.lateRequest, reportAt, hasAvailability: dir === 'bakery',
    rules: { byDays: !!cfg.orderDays, dayOffText: cfg.dayOffText || '', unit: cfg.unit || '', lateMin: R.LATE_TTL_MIN,
      minOrder: (cfg.minOrderChanges && cfg.minOrderChanges.length ? cfg.minOrderChanges[cfg.minOrderChanges.length - 1].value : cfg.minOrder) || 0 } };
}

module.exports = { buyerToday, buyerDelete, buyerProducts, buyerSetProduct, buyerAddProduct, buyerLate, buyerInfo };