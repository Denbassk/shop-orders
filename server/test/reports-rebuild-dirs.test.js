// Перебудова звітів хліба, овочів і НБХЗ з бази: ціль, порожній день, лист «Завантаження», ніч, архів, збій одного напрямку.
const test = require('node:test');
const assert = require('node:assert/strict');

const { rebuildReports, rebuildAllReports } = require('../src/reports/rebuild');
const { resolveTarget, TEST_EXPORT_SPREADSHEET_ID } = require('../src/export/target');
const { DIRECTIONS } = require('../src/directions');

const day = (d) => `2026-10-${d}`;
const AT = new Date('2026-10-19T17:45:00+03:00');                  // понеділок
const store = (id, label, over = {}) => ({ id, label, address: 'м. Харків вул. ' + label, code: id.toUpperCase(), edrpou: '', route: 'Харьков-17', routeNbhz: 'Рогань',
  addrBread: 'м. Харків вул. ' + label, addrVeg: 'м. Харків вул. ' + label, addrNbhz: 'Адр' + id, addrBakery: '', zone: '', directions: ['bread', 'veg', 'nbhz'],
  days: { veg: [1], bakery: [] }, ...over });
const STORES = [store('a', 'Амосова, 5А'), store('b', 'Байрона, 156', { edrpou: '45672783' }), store('c', 'Вівторкова, 1', { days: { veg: [2], bakery: [] } })];
const order = (storeId, lines, at = '2026-10-19T09:00:00+03:00') => ({ store_id: storeId, order_date: '2026-10-19', created_at: at,
  lines: lines.map(([name, qty, price = 20, barcode = '482000000000' + name.length], i) => ({ line_no: i + 1, name, qty, price, barcode })) });

let seq = 0;
function makeEnv(over = {}) {
  const log = [];
  const titles = new Map((over.existing || []).map((t, i) => [t, 50 + i]));
  let next = 100;
  const orders = over.orders || {};
  const products = over.products || { bread: [], veg: [], nbhz: [{ name: 'Батон', status: 'active' }, { name: 'Хліб', status: 'active' }, { name: 'Стоп', status: 'stop' }] };
  const env = {
    at: over.at || AT,
    target: over.target || fresh(),
    archive: over.archive,
    data: { reportSnapshot: async (dir, d) => { log.push(['snapshot', dir, d]); return { orders: orders[dir] || [], stores: STORES, orderStores: STORES, products: products[dir] || [] }; } },
    google: {
      sheetMeta: async (id, name) => (titles.has(name) ? { properties: { sheetId: titles.get(name), title: name, gridProperties: { rowCount: 1000, columnCount: 26 } } } : null),
      sheetList: async () => [...titles].map(([title, sheetId]) => ({ sheetId, title })),
      sheetDims: async (id, name) => { log.push(['dims', id, name]); return { col1: 100, col2: 100, row1: 21 }; },
      batchUpdate: async (id, reqs) => {
        log.push(['batch', id, reqs]);
        const add = reqs[0] && reqs[0].addSheet;
        if (over.failDir && add && add.properties.title === over.failDir) throw new Error('Google тайм-аут');
        if (add) { const sid = next++; titles.set(add.properties.title, sid); return { replies: [{ addSheet: { properties: { sheetId: sid, title: add.properties.title } } }] }; }
        return { replies: [] };
      },
      getValues: async () => [],
    },
  };
  return { env, log, titles, orders, setAt: (d) => { env.at = d; } };
}
const fresh = () => { const id = 'ss-fresh-' + (++seq); return { mode: 'test', spreadsheetId: () => id }; };
const batches = (log) => log.filter((x) => x[0] === 'batch');
const texts = (log) => batches(log).flatMap((b) => b[2]).flatMap((q) => (q.updateCells && q.updateCells.rows ? q.updateCells.rows : []))
  .flatMap((r) => r.values || []).map((c) => c.userEnteredValue && (c.userEnteredValue.stringValue || c.userEnteredValue.formulaValue)).filter(Boolean);

test('хліб: «Заказы», «Данные Заказов» і «Завантаження» з посиланнями на gid цих листів', async () => {
  const { env, log } = makeEnv({ target: fresh(), orders: { bread: [order('a', [['Батон', 5]])] } });
  const r = await rebuildReports('bread', env);
  assert.deepEqual(r.sheets, ['Заказы', 'Данные Заказов', 'Завантаження']);
  const adds = batches(log).filter((b) => b[2][0].addSheet).map((b) => b[2][0].addSheet.properties);
  assert.deepEqual(adds.map((p) => p.title), ['Заказы', 'Данные Заказов', 'Завантаження']);
  assert.equal(adds[2].index, 0, 'лист «Завантаження» першим');
  const links = batches(log).flatMap((b) => b[2]).filter((q) => q.updateCells && q.updateCells.fields === 'textFormatRuns').map((q) => q.updateCells.rows[0].values[0].textFormatRuns[0].format.link.uri);
  assert.deepEqual(links.map((u) => u.replace(/^.*gid=/, '')), ['100', '101'], 'gid «Заказы» і «Данные Заказов»');
  assert.ok(texts(log).includes('Звіт перезібрано о 17:45'));
});

test('хліб: повторна збірка того ж дня оновлює лише комірку A9 «Завантаження»; наступного дня лист пишеться повністю', async () => {
  const t = makeEnv({ target: fresh(), orders: { bread: [order('a', [['Батон', 5]])] } });
  await rebuildReports('bread', t.env);
  const n1 = batches(t.log).length;
  t.orders.bread = [order('a', [['Батон', 5]]), order('b', [['Хліб', 2]], '2026-10-19T10:00:00+03:00')];
  t.setAt(new Date('2026-10-19T17:50:00+03:00'));
  const r = await rebuildReports('bread', t.env);
  assert.equal(r.rows, 2);
  const last = batches(t.log).slice(n1).pop()[2];
  assert.equal(last.length, 1);
  assert.equal(last[0].updateCells.start.rowIndex, 8);
  assert.equal(last[0].updateCells.rows[0].values[0].userEnteredValue.stringValue, 'Звіт перезібрано о 17:50');

  // наступного дня - повний лист
  t.orders.bread = [{ ...order('a', [['Батон', 1]]), order_date: '2026-10-20', created_at: '2026-10-20T09:00:00+03:00' }];
  t.setAt(new Date('2026-10-20T09:30:00+03:00'));
  await rebuildReports('bread', t.env);
  const lastBatch = batches(t.log).pop()[2];
  assert.ok(lastBatch.length > 5, 'повний запис листа «Завантаження»');
});

test('хліб/овочі/НБХЗ: нема замовлень - будується «Замовлень на … немає» (не пропуск), потім «без змін»; видалений лист - перебудова', async () => {
  for (const dir of ['bread', 'veg', 'nbhz']) {
    const t = makeEnv({ target: fresh() });
    const r1 = await rebuildReports(dir, t.env);
    assert.equal(r1.rows, 0, dir);
    assert.ok(r1.sheets.length >= 2, dir);
    assert.ok(texts(t.log).some((x) => /Замовлень на (19\.10\.2026|сьогодні ще) немає|Замовлень на сьогодні ще немає/.test(x)), dir + ': «немає»');
    assert.deepEqual(await rebuildReports(dir, t.env), { skipped: 'без змін', rows: 0 }, dir);
    t.titles.delete(r1.sheets[0]);
    const r3 = await rebuildReports(dir, t.env);
    assert.ok(r3.sheets, dir + ': лист видалили - перебудова');
  }
});

test('овочі: точка чужого дня (вівторок у понеділок) не в списку; ЮА позначена', async () => {
  const t = makeEnv({ target: fresh(), orders: { veg: [order('a', [['Картопля', 10, 14.5]])] } });
  const r = await rebuildReports('veg', t.env);
  assert.deepEqual(r.sheets, ['Замовлення Овочі', 'Зведена Овочі']);
  const tx = texts(t.log);
  assert.ok(tx.includes('ТТ без замовлень (1):'));
  assert.ok(tx.includes('   Байрона, 156 · ЮА'));
  assert.ok(!tx.some((x) => /Вівторкова/.test(x)));
});

test('НБХЗ: вигрузка і «Завантаження НБХЗ» (у тестовій таблиці; у бойовій - «Завантаження») з gid листа вигрузки', async () => {
  const t = makeEnv({ target: fresh(), orders: { nbhz: [order('a', [['Батон', 10]])] } });
  const r = await rebuildReports('nbhz', t.env);
  assert.deepEqual(r.sheets, ['Вивантаження 19.10.2026', 'Завантаження НБХЗ']);
  const formula = texts(t.log).find((x) => x.startsWith('=HYPERLINK'));
  assert.match(formula, /export\?format=xlsx&gid=100"/);
  const dims = t.log.filter((x) => x[0] === 'dims');
  assert.equal(dims.length, 1, 'ширини A:B — другий етап');
  const widths = batches(t.log).flatMap((b) => b[2]).filter((q) => q.updateDimensionProperties && q.updateDimensionProperties.range.endIndex === 1 && q.updateDimensionProperties.range.dimension === 'COLUMNS');
  assert.equal(widths[0].updateDimensionProperties.properties.pixelSize, 114);

  const live = makeEnv({ target: { mode: 'live', spreadsheetId: (d) => DIRECTIONS[d].spreadsheetId }, orders: { nbhz: [order('a', [['Батон', 10]])] } });
  const r2 = await rebuildReports('nbhz', live.env);
  assert.deepEqual(r2.sheets, ['Вивантаження 19.10.2026', 'Завантаження']);
  assert.ok(batches(live.log).every((b) => b[1] === DIRECTIONS.nbhz.spreadsheetId), 'бойова ціль: таблиця НБХЗ');
});

test('НБХЗ: вночі (до 6:00 і після 20:59) не будує, ручний запуск (force) - будує', async () => {
  const t = makeEnv({ target: fresh(), at: new Date('2026-10-19T02:10:00+03:00'), orders: { nbhz: [] } });
  assert.deepEqual(await rebuildReports('nbhz', t.env), { skipped: 'ніч', rows: 0 });
  assert.equal(batches(t.log).length, 0);
  const late = makeEnv({ target: fresh(), at: new Date('2026-10-19T21:00:00+03:00') });
  assert.equal((await rebuildReports('nbhz', late.env)).skipped, 'ніч');
  const ok = makeEnv({ target: fresh(), at: new Date('2026-10-19T20:59:00+03:00') });
  assert.ok((await rebuildReports('nbhz', ok.env)).sheets);
  assert.ok((await rebuildReports('nbhz', t.env, { force: true })).sheets);
});

test('НБХЗ: старі листи вигрузки йдуть в архів перед збіркою нового; без id архіву - лишаються', async () => {
  const copies = [];
  const t = makeEnv({ target: fresh(), existing: ['Вивантаження 14.10.2026', 'Вивантаження 18.10.2026'], archive: { spreadsheetId: 'arc-1' } });
  t.env.google.copySheetTo = async (id, sheetId, dest) => { copies.push([sheetId, dest]); return { sheetId: 900, title: 'Копія' }; };
  const calls = [];
  t.env.google.getValues = async (id, range) => { calls.push(range); return [['x']]; };
  const r = await rebuildReports('nbhz', t.env);
  assert.deepEqual(copies, [[50, 'arc-1']], 'тільки 14.10 (5 днів), 18.10 лишається');
  assert.deepEqual([r.archive.moved, r.archive.total, r.archive.failed.length], [1, 1, 0]);
  const noArc = makeEnv({ target: fresh(), existing: ['Вивантаження 14.10.2026'] });
  const r2 = await rebuildReports('nbhz', noArc.env);
  assert.match(r2.archive.skipped, /NBHZ_ARCHIVE_SPREADSHEET_ID/);
});

test('rebuildAllReports: збій одного напрямку не зупиняє інші; ціль test пише лише в тестову таблицю', async () => {
  const t = makeEnv({ target: resolveTarget('test'), failDir: 'Замовлення Овочі',
    orders: { bakery: [], bread: [order('a', [['Батон', 5]])], veg: [order('a', [['Картопля', 10, 14.5]])], nbhz: [order('a', [['Батон', 10]])] } });
  const r = await rebuildAllReports(t.env);
  assert.deepEqual(Object.keys(r), ['bakery', 'bread', 'veg', 'nbhz']);
  assert.equal(r.bakery.skipped, 'нема замовлень за сьогодні');
  assert.ok(r.bread.sheets);
  assert.match(r.veg.error, /Google тайм-аут/);
  assert.ok(r.nbhz.sheets);
  assert.deepEqual([...new Set(batches(t.log).map((b) => b[1]))], [TEST_EXPORT_SPREADSHEET_ID]);
});

test('невідомий напрямок', () => {
  assert.throws(() => rebuildReports('xxx', makeEnv().env), /невідомий напрямок/);
});
