// Перебудова звітів ВК з бази: ціль, пропуски, повтор після збою, дебаунс після вигрузки, tick.
const test = require('node:test');
const assert = require('node:assert/strict');

const { rebuildBakeryReports, exportThenReports } = require('../src/reports/rebuild');
const { createExportQueue } = require('../src/export/queue');
const { resolveTarget, TEST_EXPORT_SPREADSHEET_ID } = require('../src/export/target');
const { tick } = require('../src/jobs');
const { DIRECTIONS } = require('../src/directions');

const AT = new Date('2026-10-19T11:00:00+03:00');
const store = (id, label, zone) => ({ id, label, addrBakery: 'м. Харків вул. ' + label, zone, directions: ['bakery'], days: { veg: [], bakery: [1, 2, 3, 4, 5] } });
const STORES = [store('a', 'Тестова, 1', 'Салтовка'), store('b', 'Тестова, 2', 'Центр')];
const PRODUCTS = [{ barcode: '111', name: 'Випічка А', category: 'Випічка', status: 'active' }];
const order = (storeId, qty, at = '2026-10-19T09:00:00+03:00') => ({ store_id: storeId, order_date: '2026-10-19', created_at: at,
  lines: [{ line_no: 1, barcode: '111', name: 'Випічка А', price: 10, qty }] });

function makeEnv(over = {}) {
  const log = [];
  let orders = over.orders || [order('a', 2)];
  const env = {
    at: over.at || AT,
    target: over.target,
    data: { reportSnapshot: async (dir, day) => { log.push(['snapshot', dir, day]); return { orders, stores: STORES, orderStores: STORES, products: PRODUCTS }; } },
    google: {
      sheetMeta: async (id, name) => { log.push(['meta', id, name]); return over.noSheets ? null : { properties: { sheetId: 7, gridProperties: { rowCount: 1000, columnCount: 26 } } }; },
      batchUpdate: async (id, reqs) => {
        log.push(['batch', id, reqs.length]);
        if (over.failOn && log.filter((x) => x[0] === 'batch').length === over.failOn) throw new Error('Google тайм-аут');
        return { replies: [{ addSheet: { properties: { sheetId: 9 } } }] };
      },
    },
  };
  return { env, log, setOrders: (o) => { orders = o; } };
}
const batches = (log) => log.filter((x) => x[0] === 'batch');
// сигнатура зберігається на таблицю, тож кожному тесту - своя «таблиця»
let n = 0;
const fresh = () => { const id = 'ss-test-' + (++n); return { mode: 'test', spreadsheetId: () => id }; };

test('ціль test: три листи пишуться лише в тестову таблицю, бойова ВК не чіпається', async () => {
  const { env, log } = makeEnv({ target: resolveTarget('test') });
  const r = await rebuildBakeryReports(env, { force: true });
  assert.deepEqual(r, { rows: 1, sheets: ['Заказы ВК', 'Сводная ВК', 'Маршрути ВК'], target: 'test' });
  const ids = new Set(log.filter((x) => x[0] !== 'snapshot').map((x) => x[1]));
  assert.deepEqual([...ids], [TEST_EXPORT_SPREADSHEET_ID]);
  assert.ok(!ids.has(DIRECTIONS.bakery.spreadsheetId));
  assert.deepEqual(log.filter((x) => x[0] === 'meta').map((x) => x[2]), ['Заказы ВК', 'Сводная ВК', 'Маршрути ВК']);
  assert.equal(batches(log).length, 3);
});

test('вкладки нема - створюється (addSheet), потім пишеться', async () => {
  const { env, log } = makeEnv({ noSheets: true, target: fresh() });
  await rebuildBakeryReports(env, { force: true });
  assert.equal(batches(log).length, 6, '3 × (addSheet + запис)');
  assert.equal(batches(log)[0][2], 1);
});

test('немає замовлень за сьогодні - листи не чіпаємо', async () => {
  const { env, log } = makeEnv({ orders: [], target: fresh() });
  assert.deepEqual(await rebuildBakeryReports(env), { skipped: 'нема замовлень за сьогодні', rows: 0 });
  assert.equal(log.filter((x) => x[0] !== 'snapshot').length, 0);
});

test('без змін - пропуск; змінилось замовлення - пише; force - пише завжди', async () => {
  const { env, log, setOrders } = makeEnv({ target: fresh() });
  assert.equal((await rebuildBakeryReports(env)).sheets.length, 3);
  assert.deepEqual(await rebuildBakeryReports(env), { skipped: 'без змін', rows: 1 });
  assert.equal(batches(log).length, 3);
  setOrders([order('a', 2), order('b', 5, '2026-10-19T09:30:00+03:00')]);
  assert.equal((await rebuildBakeryReports(env)).rows, 2);
  assert.equal(batches(log).length, 6);
  assert.equal((await rebuildBakeryReports(env, { force: true })).sheets.length, 3);
  assert.equal(batches(log).length, 9);
});

test('збій Google на другому листі: помилка наверх, сигнатура не збережена - наступний запуск пише всі три знову', async () => {
  const { env, log } = makeEnv({ failOn: 2, target: fresh() });
  await assert.rejects(rebuildBakeryReports(env), /Google тайм-аут/);
  assert.equal(batches(log).length, 2);
  const r = await rebuildBakeryReports(env);
  assert.equal(r.sheets.length, 3);
  assert.equal(batches(log).length, 5);
});

test('вигрузка ВК + 5 замовлень поспіль = одна перебудова через 30 с; інші напрямки звітів не ставлять', async () => {
  const timers = [];
  const runs = [], exports = [];
  const queueReports = createExportQueue({ run: async (d) => { runs.push(d); }, delayMs: 30000, setTimer: (fn, ms) => timers.push({ fn, ms }) });
  const run = exportThenReports(async (dir) => { exports.push(dir); return { written: 1 }; }, queueReports);
  for (let i = 0; i < 5; i++) await run('bakery');
  await run('bread'); await run('veg');
  assert.deepEqual(exports, ['bakery', 'bakery', 'bakery', 'bakery', 'bakery', 'bread', 'veg']);
  assert.equal(timers.length, 1, 'один відкладений запуск');
  assert.equal(timers[0].ms, 30000);
  assert.deepEqual(runs, []);
  timers[0].fn(); await new Promise((r) => setImmediate(r));
  assert.deepEqual(runs, ['bakery']);
  await run('bakery');
  assert.equal(timers.length, 2, 'після запуску вікно відкривається знову');
});

test('вигрузка впала - звіти не ставляться в чергу', async () => {
  const timers = [];
  const queueReports = createExportQueue({ run: async () => {}, delayMs: 30000, setTimer: (fn, ms) => timers.push({ fn, ms }) });
  await assert.rejects(exportThenReports(async () => { throw new Error('boom'); }, queueReports)('bakery'), /boom/);
  assert.equal(timers.length, 0);
});

test('tick: результат звітів у відповіді; збій звітів не зупиняє вигрузку і листи', async () => {
  const base = { at: AT, data: { unmailedLate: async () => [] } };
  const exportAll = async () => ({ bakery: { written: 2, deleted: 0, skipped: 0 } });
  const ok = await tick({ ...base, rebuildReports: async () => ({ rows: 3, sheets: ['a'] }) }, exportAll);
  assert.deepEqual(ok.reports, { rows: 3, sheets: ['a'] });
  assert.equal(ok.export.bakery.written, 2);
  const bad = await tick({ ...base, rebuildReports: async () => { throw new Error('Google лежить'); } }, exportAll);
  assert.deepEqual(bad.reports, { error: 'Google лежить' });
  assert.equal(bad.export.bakery.written, 2);
  assert.deepEqual(bad.mail, { sent: 0, failed: 0, skipped: 0 });
  const none = await tick(base, exportAll);
  assert.equal('reports' in none, false);
});
