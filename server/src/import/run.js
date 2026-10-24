// Підтяжка сьогоднішніх замовлень з БОЙОВИХ сирих листів Google в базу: один виклик = читання листів + план + (apply) запис.
// Використовують scripts/import-today.js (вручну) і tick сервера (IMPORT_SHEETS_TODAY=on, лише при EXPORT_TARGET=live):
// замовлення, зроблені зі старої сторінки Apps Script, потрапляють у базу (пульт і звіти їх бачать) за один tick.
// Листи лише ЧИТАЮТЬСЯ. Імпортовані замовлення мають exported_at = changed_at, тож вигрузка не дописує їх у лист вдруге.
const R = require('../rules');
const { planImport, rowsOfSheet, loadExisting, loadRealKeys, applyPlan } = require('./today');

// Порожнє читання листа (збій Google, лист щойно очищено) не має скасовувати вже імпортовані замовлення цього напрямку
function guardCancels(plan, rowsByDir) {
  const kept = [], dropped = [];
  plan.cancels.forEach((c) => (rowsByDir[c.dir] ? kept : dropped).push(c));
  const stale = dropped.length ? [...new Set(dropped.map((c) => c.dir))] : [];
  return { ...plan, cancels: kept, guarded: stale };
}

// deps - для тестів: { readSheet(dir, cfg) -> values, loadProducts(dir), loadExisting(day), loadRealKeys(day), apply(plan) }
async function importToday({ sb, loadStores, googleApi, directions, now = new Date(), apply = true, deps = {} }) {
  const k = R.kyivNow(now);
  const stores = await loadStores();
  const products = {}, rows = [], rowsByDir = {};
  for (const dir of Object.keys(directions)) {
    const cfg = directions[dir];
    products[dir] = deps.loadProducts ? await deps.loadProducts(dir)
      : (await sb.from('products').select('id,barcode,name').eq('dir', dir).then(({ data, error }) => { if (error) throw new Error('products: ' + error.message); return data; }));
    const sheet = deps.readSheet ? await deps.readSheet(dir, cfg) : await googleApi.getValues(cfg.spreadsheetId, googleApi.a1q(cfg.rawSheet, 'A:H'));
    const got = rowsOfSheet(dir, sheet, k.dmy);
    rowsByDir[dir] = got.length;
    rows.push(...got);
  }
  const existing = deps.loadExisting ? await deps.loadExisting(k.day) : await loadExisting(sb, k.day);
  const exclude = deps.loadRealKeys ? await deps.loadRealKeys(k.day) : await loadRealKeys(sb, k.day);
  let plan = planImport({ day: k.day, now, stores, products, existing, rows, exclude });
  plan = guardCancels(plan, rowsByDir);
  if (apply) await (deps.apply ? deps.apply(plan) : applyPlan(sb, plan));
  return { day: k.day, dmy: k.dmy, rowsByDir, plan, existingCount: existing.length };
}

module.exports = { importToday, guardCancels };
