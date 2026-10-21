// Сторінка закупниці напрямку (/buyer/<dir>): хто замовив сьогодні, видалення замовлення точки, асортимент.
// Видалення - перенос delCancelOrder_/onDeleteSheetEdit (app/DeleteSheet.gs): тексти й запис у журнал дослівно.
// Асортимент (ціна, стоп, наявність) - нове за планом Task 9: оригіналу в Apps Script немає (закупниці правили лист «Ассортимент»).
// До Task 11 правку асортименту перезапише import-reference --force (правда - у листах Google).
const { DIRECTIONS } = require('../directions');
const R = require('../rules');
const { STORE_NOT_FOUND } = require('../admin/write');

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
  })).sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'uk'));
  return { dir, title: cfg.title, hasAvailability: dir === 'bakery', products: list };
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
  if (!log.length) throw new Error('Змін немає');
  if (!await env.adm.setProduct(dir, cur.id, patch)) throw new Error(NOT_FOUND);
  await logSafe(env, 'Змінено асортимент', cfg.title + ' / ' + cur.name + ': ' + log.join('; '));
  return { id: cur.id, ...patch };
}

module.exports = { buyerToday, buyerDelete, buyerProducts, buyerSetProduct };