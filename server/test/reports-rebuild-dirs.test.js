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
  const links = batches(log).flatMap((b) => b[2]).filter((q) => q.repeatCell && q.repeatCell.cell.userEnteredFormat.textFormat && q.repeatCell.cell.userEnteredFormat.textFormat.link).map((q) => q.repeatCell.cell.userEnteredFormat.textFormat.link.uri);
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
  assert.equal(r.bakery.rows, 0);
  assert.equal(r.bakery.sheets.length, 3, 'ВК без замовлень теж будується порожнім');
  assert.ok(r.bread.sheets);
  assert.match(r.veg.error, /Google тайм-аут/);
  assert.ok(r.nbhz.sheets);
  assert.deepEqual([...new Set(batches(t.log).map((b) => b[1]))], [TEST_EXPORT_SPREADSHEET_ID]);
});

test('невідомий напрямок', () => {
  assert.throws(() => rebuildReports('xxx', makeEnv().env), /невідомий напрямок/);
});

test('report_at: після успішної збірки викликається env.markReport(dir, at); пропуск «без змін» і збій запису - ні; збій markReport збірку не ламає', async () => {
  const calls = [];
  const t = makeEnv({ target: fresh(), orders: { veg: [order('a', [['Картопля', 10, 14.5]])] } });
  t.env.markReport = async (dir, at) => { calls.push([dir, at.toISOString()]); };
  await rebuildReports('veg', t.env);
  assert.deepEqual(calls, [['veg', AT.toISOString()]]);
  await rebuildReports('veg', t.env);
  assert.equal(calls.length, 1, 'без змін - час збирання не оновлюється');

  const bad = makeEnv({ target: fresh(), failDir: 'Замовлення Овочі', orders: { veg: [order('a', [['Картопля', 10, 14.5]])] } });
  bad.env.markReport = async (dir) => { calls.push(['bad', dir]); };
  await assert.rejects(rebuildReports('veg', bad.env), /Google тайм-аут/);
  assert.equal(calls.length, 1, 'збій Google - час не пишемо');

  const noisy = makeEnv({ target: fresh(), orders: { veg: [order('a', [['Картопля', 10, 14.5]])] } });
  noisy.env.markReport = async () => { throw new Error('база лежить'); };
  assert.ok((await rebuildReports('veg', noisy.env)).sheets, 'збій markReport не ламає збірку');
});

test('овочі: датовані копії «<лист> ДД.ММ.РРРР» - пишуться в день із замовленнями, лишаються наступного ранку, прибираються при скасуванні всього і через 7 днів', async () => {
  const t = makeEnv({ target: fresh(), existing: ['Зведена Овочі 11.10.2026', 'Замовлення Овочі 14.10.2026', 'Зведена Овочі (копія)'],
    orders: { veg: [order('a', [['Картопля', 10, 14.5]])] } });
  const r = await rebuildReports('veg', t.env);
  assert.deepEqual(r.sheets, ['Замовлення Овочі', 'Зведена Овочі'], 'основні листи як були');
  assert.deepEqual(r.dated.written, ['Замовлення Овочі 19.10.2026', 'Зведена Овочі 19.10.2026']);
  assert.deepEqual(r.dated.removed, ['Зведена Овочі 11.10.2026'], 'старше 7 днів - видалено; 6 днів і чужі назви - лишились');
  assert.ok(t.titles.has('Зведена Овочі 19.10.2026') && t.titles.has('Замовлення Овочі 19.10.2026'));
  assert.ok(texts(t.log).includes('Картопля'));

  // наступний ранок: замовлень на 20.10 нема - основні листи порожні з підказкою, копія 19.10 лишається
  t.orders.veg = [];
  t.titles.delete('Зведена Овочі 11.10.2026');
  t.log.length = 0;
  t.setAt(new Date('2026-10-20T07:00:00+03:00'));
  const r2 = await rebuildReports('veg', t.env);
  assert.deepEqual(r2.dated, { written: [], removed: [] });
  assert.ok(t.titles.has('Зведена Овочі 19.10.2026'));
  assert.ok(texts(t.log).includes('Замовлення попередніх днів - на листах «Зведена Овочі ДД.ММ.РРРР» (дата замовлення)'));
  assert.ok(texts(t.log).includes('Замовлення попередніх днів - на листах «Замовлення Овочі ДД.ММ.РРРР» (дата замовлення)'));
});

test('овочі: усі замовлення дня скасовано - датована копія цього дня видаляється; збій датованих листів не ламає основні', async () => {
  const t = makeEnv({ target: fresh(), orders: { veg: [order('a', [['Картопля', 10, 14.5]])] } });
  await rebuildReports('veg', t.env);
  t.orders.veg = [];
  const r = await rebuildReports('veg', t.env);
  assert.deepEqual(r.dated.removed.sort(), ['Замовлення Овочі 19.10.2026', 'Зведена Овочі 19.10.2026']);
  assert.ok(batches(t.log).some((b) => b[2].some((q) => q.deleteSheet)), 'deleteSheet надіслано');

  const bad = makeEnv({ target: fresh(), orders: { veg: [order('a', [['Картопля', 10, 14.5]])] } });
  bad.env.google.sheetList = async () => { throw new Error('Google 503'); };
  const r2 = await rebuildReports('veg', bad.env);
  assert.deepEqual(r2.sheets, ['Замовлення Овочі', 'Зведена Овочі']);
  assert.match(r2.datedError, /Google 503/);
});

test('овочі: уранці, поки за сьогодні нема замовлень, основні листи показують ВЧОРАШНІ (дата в заголовку); перше замовлення дня перемикає на сьогодні', async () => {
  const t = makeEnv({ target: fresh() });
  const byDay = { '2026-10-19': [order('a', [['Картопля', 10, 14.5]])], '2026-10-20': [] };
  t.env.data.reportSnapshot = async (dir, d) => ({ orders: dir === 'veg' ? (byDay[d] || []) : [], stores: STORES, orderStores: STORES, products: [] });

  t.setAt(new Date('2026-10-20T07:06:00+03:00'));                   // вівторок, ранок, замовлень ще нема
  const r = await rebuildReports('veg', t.env);
  assert.equal(r.reportDay, '2026-10-19');
  assert.equal(r.rows, 1);
  const tx = texts(t.log);
  assert.ok(tx.includes('Замовлення овочів - 19.10.2026'), 'заголовок - день замовлення');
  assert.ok(tx.includes('Картопля'));
  assert.ok(!tx.includes('Замовлень на сьогодні ще немає'));
  assert.equal(tx.filter((x) => x === 'ВЧОРАШНІ замовлення 19.10.2026 - доставка СЬОГОДНІ 20.10.2026. Нових замовлень ще немає').length, 2, 'червоне попередження на обох листах');
  assert.equal(r.dated, undefined, 'датовану копію вчора не переписуємо');
  assert.deepEqual(await rebuildReports('veg', t.env), { skipped: 'без змін', rows: 1 }, 'tick без змін не пише');

  byDay['2026-10-20'] = [order('c', [['Цибуля', 3, 19]], '2026-10-20T09:33:00+03:00')];
  t.log.length = 0;
  t.setAt(new Date('2026-10-20T09:34:00+03:00'));
  const r2 = await rebuildReports('veg', t.env);
  assert.equal(r2.reportDay, undefined);
  const tx2 = texts(t.log);
  assert.ok(tx2.includes('Замовлення овочів - 20.10.2026'));
  assert.ok(tx2.includes('Цибуля') && !tx2.includes('Картопля'));
});

test('овочі: позавчорашні замовлення не підставляються (лише вчора)', async () => {
  const t = makeEnv({ target: fresh() });
  t.env.data.reportSnapshot = async (dir, d) => ({ orders: dir === 'veg' && d === '2026-10-18' ? [order('a', [['Картопля', 10, 14.5]])] : [], stores: STORES, orderStores: STORES, products: [] });
  t.setAt(new Date('2026-10-20T07:06:00+03:00'));
  const r = await rebuildReports('veg', t.env);
  assert.equal(r.rows, 0);
  assert.equal(r.reportDay, undefined);
  assert.ok(texts(t.log).includes('Замовлень на сьогодні ще немає'));
});

test('овочі: вчорашні - лише до 12:00; о 12:00 без сьогоднішніх замовлень лист порожній (щоб не повезти вчорашнє вдруге)', async () => {
  const t = makeEnv({ target: fresh() });
  t.env.data.reportSnapshot = async (dir, d) => ({ orders: dir === 'veg' && d === '2026-10-19' ? [order('a', [['Картопля', 10, 14.5]])] : [], stores: STORES, orderStores: STORES, products: [] });
  t.setAt(new Date('2026-10-20T11:59:00+03:00'));
  assert.equal((await rebuildReports('veg', t.env)).reportDay, '2026-10-19');
  t.log.length = 0;
  t.setAt(new Date('2026-10-20T12:00:00+03:00'));
  const r = await rebuildReports('veg', t.env);
  assert.equal(r.reportDay, undefined);
  assert.equal(r.rows, 0);
  const tx = texts(t.log);
  assert.ok(tx.includes('Замовлення овочів - 20.10.2026') && tx.includes('Замовлень на сьогодні ще немає'));
  assert.ok(!tx.some((x) => /ВЧОРАШНІ|Картопля/.test(x)));
});
