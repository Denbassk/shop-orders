// Дії пульта, що змінюють дані: перенос admCancelOrder_ / admOpenStore_ / admOpenAll_ / admCloseAll_ / admSetDirEnabled_
// (app/Admin.gs, Config.gs setDirEnabled_, Deadline.gs allowLate_/closeLate_, LateRequest.gs approveLate_).
// Замок листа (dirLockAcquire_) не потрібен: скасування - один UPDATE у базі, рядки з листа прибирає вигрузка (export/raw.js).
// clearMark не перенесено: окремої позначки немає, «вже замовила» = активне замовлення в базі (записується транзакцією).
const { DIRECTIONS } = require('../directions');
const R = require('../rules');

const STORE_NOT_FOUND = 'Торгову точку не знайдено. Оновіть сторінку.';

function cfgOf(dir) {
  const cfg = Object.prototype.hasOwnProperty.call(DIRECTIONS, dir) ? DIRECTIONS[dir] : null;
  if (!cfg) throw new Error('Невідомий напрямок: "' + dir + '"');
  return cfg;
}
async function storeOf(id, env) {
  const s = (await env.data.stores()).find((x) => x.id === String(id));
  if (!s) throw new Error(STORE_NOT_FOUND);
  return s;
}
const dayOf = (env) => R.kyivNow(env.at).day;
const logErr = (env, msg) => (env.log || console.error)(msg);
async function logSafe(env, action, details) {
  try { await env.adm.adminLog(action, details); } catch (e) { logErr(env, 'adminLog: ' + ((e && e.message) || e)); }
}

async function admCancelOrder(payload, env) {
  const store = await storeOf(payload.storeId, env);
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  const removed = await env.adm.cancelDay(dir, store.id, dayOf(env));
  try { env.queueExport(dir); } catch (e) { logErr(env, 'queueExport: ' + ((e && e.message) || e)); }
  await logSafe(env, 'Скасовано замовлення', cfg.title + ' / ' + store.label + ' - рядків ' + removed);
  return { removed };
}

async function admOpenStore(payload, env) {
  const store = await storeOf(payload.storeId, env);
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  await env.data.approveLate(dir, store.id, dayOf(env), env.at);
  await logSafe(env, 'Відкрито прийом точці', cfg.title + ' / ' + store.label + ' - на ' + R.LATE_TTL_MIN + ' хв');
  return { left: R.LATE_TTL_MIN };                       // щойно видано: lateLeftMin_ = ceil(30 хв)
}

async function admOpenAll(payload, env) {
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  const v = { ...((await env.adm.getSetting('late_all')) || {}) };
  v[dir] = dayOf(env);
  await env.adm.setSetting('late_all', v);
  await logSafe(env, 'Відкрито прийом усім', cfg.title + ' - до кінця дня');
  return { ok: true };
}

async function admCloseAll(payload, env) {
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  const v = { ...((await env.adm.getSetting('late_all')) || {}) };
  delete v[dir];
  await env.adm.setSetting('late_all', v);
  await logSafe(env, 'Повернуто звичайний режим', cfg.title);
  return { ok: true };
}

// Увімкнути/вимкнути напрямок ЦІЛКОМ - зникає з меню всіх продавців. Існуючі замовлення і звіти не чіпає.
async function admSetDirEnabled(payload, env) {
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  const on = !!payload.on;
  const cur = await env.adm.getSetting('dirs_off');
  const list = (Array.isArray(cur) ? cur : []).filter((k) => k !== dir);
  if (!on) list.push(dir);
  await env.adm.setSetting('dirs_off', list);
  await logSafe(env, on ? 'Увімкнено напрямок' : 'Вимкнено напрямок', cfg.title);
  return { ok: true, enabled: on };
}

// Правка замовлення точки (admEditOrder_, AdminTools.gs). row = order_lines.id (картка точки, шаг 3б).
// Кожен рядок звіряється з базою: є, та сама назва, та сама стара кількість. Не збіглось - помилка до запису.
// Кількість 0 - рядок прибрано; порожнє замовлення -> cancelled. Рядки в листі перебудовує вигрузка (changed_at).
async function admEditOrder(payload, env) {
  const store = await storeOf(payload.storeId, env);
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  const seen = {};
  const ch = (Array.isArray(payload.changes) ? payload.changes : []).map((x) => {
    const q = Number(x.qty), row = Math.floor(Number(x.row));
    if (!(row >= 1)) throw new Error('Невірний рядок');
    if (seen[row]) throw new Error('Рядок ' + row + ' указано двічі');
    seen[row] = 1;
    if (!isFinite(q) || q < 0) throw new Error('Невірна кількість: ' + x.name);
    if (dir !== 'veg' && q % 1) throw new Error('Кількість має бути цілою: ' + x.name);
    return { row, name: String(x.name || ''), oldQty: Number(x.oldQty), qty: Math.round(q * 1000) / 1000 };
  }).filter((x) => x.qty !== x.oldQty);
  if (!ch.length) throw new Error('Змін немає');

  const stale = (x) => new Error('Рядок «' + x.name + '» змінився з моменту відкриття. Оновіть екран.');
  const lines = await env.adm.dayStoreLines(dir, store.id, dayOf(env));
  const byId = new Map(lines.map((l) => [Number(l.id), l]));
  ch.forEach((x) => {
    const l = byId.get(x.row);
    if (!l) throw new Error('Рядок «' + x.name + '» вже не на місці. Оновіть екран.');
    if (String(l.name) !== x.name || Number(l.qty) !== x.oldQty) throw stale(x);
    x.l = l;
  });

  const log = [], touched = new Set(), gone = new Set();
  try {
    for (const x of ch) {
      if (x.qty <= 0) continue;
      if (!await env.adm.setLineQty(x.row, x.oldQty, x.qty)) throw stale(x);
      touched.add(x.l.order_pk);
      log.push(x.name + ': ' + x.oldQty + ' → ' + x.qty);
    }
    const del = ch.filter((x) => x.qty <= 0).sort((a, b) => b.row - a.row);      // як в оригіналі: знизу вгору
    for (const x of del) {
      if (!await env.adm.deleteLine(x.row, x.oldQty)) throw stale(x);
      touched.add(x.l.order_pk); gone.add(x.row);
      log.push(x.name + ': прибрано (було ' + x.oldQty + ')');
    }
  } finally {
    if (touched.size) {
      const rest = lines.filter((l) => !gone.has(Number(l.id)));
      const emptied = [...touched].filter((pk) => !rest.some((l) => l.order_pk === pk));
      await env.adm.touchOrders([...touched], emptied);
      try { env.queueExport(dir); } catch (e) { logErr(env, 'queueExport: ' + ((e && e.message) || e)); }
    }
  }
  const left = lines.length - gone.size;
  await logSafe(env, 'Змінено замовлення', cfg.title + ' / ' + store.label + ': ' + log.join('; ') +
    (left ? '' : ' - замовлення порожнє, позначку знято'));
  return { changed: log.length, left };
}

// Пакетний запит (admBatch_): кілька читань за один виклик; лише ADM_BATCH_OK, не більше 8
const ADM_BATCH_OK = { today: 1, dirStores: 1, stores: 1, store: 1, schedule: 1, log: 1 };
async function admBatch(payload, call) {
  const calls = Array.isArray(payload.calls) ? payload.calls.slice(0, 8) : [];
  return Promise.all(calls.map((c) => ((!c || !ADM_BATCH_OK[c.a]) ? { ok: false, error: 'not allowed' } : call(c.a, c.p || {}))));
}

module.exports = { STORE_NOT_FOUND, admCancelOrder, admOpenStore, admOpenAll, admCloseAll, admSetDirEnabled, admEditOrder, admBatch };