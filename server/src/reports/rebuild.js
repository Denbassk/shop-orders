// Перебудова звітів ВК з бази в таблицю-ціль (EXPORT_TARGET). Аналог refreshBakeryReports + buildBakeryReports (BakeryReport.gs).
//   env = { data: { reportSnapshot }, google: { sheetMeta, batchUpdate }, target, at }
// Сигнатура змісту (рядки + список ТТ дня) тримається в памʼяті процесу: tick не пише в Google, якщо нічого не змінилось
// (в Apps Script те саме - bakerySignature_). Рядків за сьогодні нема - не чіпаємо листи (вихідний напрямку, після дедлайну).
const crypto = require('node:crypto');
const R = require('../rules');
const { buildBakeryReports, bakeryRowsFromOrders } = require('./bakery');
const { writeSheet } = require('./sheetWriter');

const lastSig = {};          // spreadsheetId -> сигнатура останньої перебудови
const running = {};          // spreadsheetId -> проміс поточної перебудови (одна на таблицю одночасно)

async function rebuildBakeryReportsLocked(env, { force }) {
  const day = R.kyivNow(env.at).day;
  const snap = await env.data.reportSnapshot('bakery', day);
  const rows = bakeryRowsFromOrders(snap.orders, snap.orderStores, day);
  const spreadsheetId = env.target.spreadsheetId('bakery');
  if (!rows.length) return { skipped: 'нема замовлень за сьогодні', rows: 0 };

  const plans = buildBakeryReports(rows, { stores: snap.stores, products: snap.products, now: env.at });
  const sig = crypto.createHash('sha1').update(JSON.stringify([day, rows, plans['Заказы ВК'].data.length,
    snap.stores.map((s) => [s.id, s.label, s.zone, s.directions, s.days])])).digest('hex');
  if (!force && lastSig[spreadsheetId] === sig) return { skipped: 'без змін', rows: rows.length };

  const done = [];
  for (const name of Object.keys(plans)) {
    await writeSheet(env.google, spreadsheetId, name, plans[name]);
    done.push(name);
  }
  lastSig[spreadsheetId] = sig;                        // лише після успіху всіх трьох листів
  return { rows: rows.length, sheets: done, target: env.target.mode };
}

// force - перебудувати навіть без змін (ручний запуск)
function rebuildBakeryReports(env, { force = false } = {}) {
  const key = env.target.spreadsheetId('bakery');
  const prev = running[key] || Promise.resolve();
  const next = prev.catch(() => {}).then(() => rebuildBakeryReportsLocked(env, { force }));
  running[key] = next.catch(() => {});
  return next;
}

// Після вигрузки ВК - поставити перебудову звітів у чергу (черга з дебаунсом: десятки замовлень = одна перебудова)
function exportThenReports(exportFn, queueReports) {
  return async (dir) => {
    const res = await exportFn(dir);
    if (dir === 'bakery') queueReports('bakery');
    return res;
  };
}

module.exports = { rebuildBakeryReports, exportThenReports };
