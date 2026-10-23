// Золотий тест звітів ВК. Фікстура bakery-2026-10-19.json знята з бойової таблиці ВК ОДНИМ запитом values.batchGet
// (scripts/snapshot-bakery.js): сирі рядки за день + значення «Заказы ВК», «Сводная ВК», «Маршрути ВК», які побудував Apps Script.
// Додатково звіряємо batchUpdate-запити (формати, ширини, об'єднання, заливка) з тим, що формує справжній .gs у vm.
const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../src/rules');
const { writerFor } = require('../src/reports/sheetWriter');
const B = require('../src/reports/bakery');
const { runBakeryGas, valuesOfRequests } = require('./helpers/bakery-oracle');
const fx = require('./fixtures/bakery-2026-10-19.json');

const SHEETS = [B.BAKERY_ORDERS_SHEET, B.BAKERY_SUMMARY_SHEET, B.BAKERY_ROUTE_SHEET];

// час «оновлено» кожного листа - з самого звіту Apps Script (він береться з new Date() у момент збирання)
const stampOf = (name) => (fx.reports[name][name === 'Заказы ВК' ? 1 : 0][0].match(/оновлено (\d\d:\d\d:\d\d)/) || [])[1];
const dateAt = (hms) => [3, 2].map((h) => new Date(`2026-10-19T${hms}+0${h}:00`)).find((d) => R.kyivNow(d).time === hms);
const nowBy = Object.fromEntries(SHEETS.map((n) => [n, dateAt(stampOf(n))]));

const dmy = fx.day;
const rows = B.normalizeRawRows(fx.raw, dmy);
const build = (r = rows, over = {}) => B.buildBakeryReports(r, { stores: fx.stores, products: fx.products, nowBy, ...over });

// Google віддає рядки без хвостових порожніх клітинок і без порожніх рядків наприкінці
function trim(grid) {
  const out = grid.map((r) => { const x = r.slice(); while (x.length && (x[x.length - 1] === '' || x[x.length - 1] == null)) x.pop(); return x; });
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}

const metaOf = (sheetId) => ({ properties: { sheetId, gridProperties: { rowCount: 1000, columnCount: 26 } }, conditionalFormats: [] });
const SHEET_IDS = { 'Заказы ВК': 101, 'Сводная ВК': 102, 'Маршрути ВК': 103 };
// через JSON: об'єкти з vm мають інший Object.prototype, deepStrictEqual відрізнив би їх навіть при рівному змісті
const json = (x) => JSON.parse(JSON.stringify(x));
const requestsOf = (plan, name) => { const w = writerFor(metaOf(SHEET_IDS[name]), plan.data, plan.width); plan.apply(w); return json(w.requests()); };

// ---------- фікстура ----------
test('фікстура: знята після останнього сирого рядка (звіти свіжі), усі три звіти непорожні', () => {
  const hm = (v) => { const m = Math.round((v - Math.floor(v)) * 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const lastRaw = fx.raw.map((r) => hm(r[1])).sort().pop();
  for (const n of SHEETS) {
    assert.ok(stampOf(n) > lastRaw + ':59', `${n}: «оновлено» ${stampOf(n)} має бути пізніше за останній сирий рядок ${lastRaw}`);
    assert.ok(fx.reports[n].length > 10, n + ' непорожній');
  }
  assert.ok(Date.parse(fx.takenAt) > nowBy['Заказы ВК'].getTime(), 'знімок зроблено після збирання звітів');
  assert.equal(rows.length, fx.raw.length, 'усі сирі рядки робочі (назва і кількість > 0)');
});

// ---------- значення комірок ----------
for (const name of SHEETS) {
  test(`золотий: «${name}» - ті самі значення в тих самих комірках, що побудував Apps Script`, () => {
    const got = trim(build()[name].data);
    const want = trim(fx.reports[name]);
    assert.equal(got.length, want.length, 'кількість рядків');
    for (let i = 0; i < want.length; i++) assert.deepEqual(got[i], want[i], `${name}, рядок ${i + 1}`);
  });
}

test('золотий: порядок точок, позицій і зон збігається (рядок за рядком, три звіти)', () => {
  const b = build();
  const col = (name, c) => trim(b[name].data).map((r) => r[c]);
  assert.deepEqual(col('Заказы ВК', 0), trim(fx.reports['Заказы ВК']).map((r) => r[0]));
  assert.deepEqual(col('Сводная ВК', 0), trim(fx.reports['Сводная ВК']).map((r) => r[0]));
  assert.deepEqual(col('Маршрути ВК', 3), trim(fx.reports['Маршрути ВК']).map((r) => r[3]));   // зони
  assert.deepEqual(col('Маршрути ВК', 0), trim(fx.reports['Маршрути ВК']).map((r) => r[0]));   // точки
});

// ---------- запити Sheets API: формати, заливка, ширини, заморозка ----------
for (const name of SHEETS) {
  test(`формати: batchUpdate «${name}» на фікстурі - один в один як у Apps Script (vm)`, () => {
    const gas = runBakeryGas({ rows, stores: fx.stores, products: fx.products, nowBy });
    const ours = requestsOf(build()[name], name);
    assert.ok(gas[name], 'Apps Script у vm записав лист');
    assert.equal(ours.length, gas[name].length, 'кількість запитів');
    assert.deepEqual(ours, json(gas[name]));
    assert.deepEqual(json(trim(valuesOfRequests(gas[name]))), trim(fx.reports[name]), 'vm-еталон теж збігається з бойовим звітом');
  });
}

test('формати: ключові властивості (жирність, заливка, ширини, заморозка) присутні', () => {
  const o = requestsOf(build()['Заказы ВК'], 'Заказы ВК');
  const has = (f) => o.some(f);
  assert.ok(has((r) => r.repeatCell && r.repeatCell.cell.userEnteredFormat.textFormat && r.repeatCell.cell.userEnteredFormat.textFormat.bold === true));
  assert.ok(has((r) => r.repeatCell && JSON.stringify(r.repeatCell.cell.userEnteredFormat.backgroundColor) === JSON.stringify({ red: 0x15 / 255, green: 0x65 / 255, blue: 0xC0 / 255 })));
  assert.deepEqual(o.filter((r) => r.updateDimensionProperties && r.updateDimensionProperties.range.dimension === 'COLUMNS').map((r) => r.updateDimensionProperties.properties.pixelSize), [50, 420, 90, 120]);
  assert.ok(has((r) => r.updateSheetProperties && r.updateSheetProperties.properties.gridProperties.frozenRowCount === 4));
  assert.ok(has((r) => r.unmergeCells), 'об\'єднання комірок знімаються перед записом');
  const rt = requestsOf(build()['Маршрути ВК'], 'Маршрути ВК');
  assert.ok(rt.some((r) => r.updateBorders), 'маршрути з рамками');
});

// ---------- порівняння з Apps Script на вигаданих вхідних (крайні випадки) ----------
const row = (addr, zone, bc, name, price, qty) => [dmy, '09:00', addr, zone, bc, name, price, qty];
const NOW = dateAt('10:15:30');
function same(rowsIn, over = {}, label = '') {
  const input = { rows: rowsIn, stores: over.stores || fx.stores, products: over.products || fx.products, nowBy: over.nowBy || Object.fromEntries(SHEETS.map((n) => [n, over.now || NOW])) };
  const gas = runBakeryGas(input);
  const ours = B.buildBakeryReports(rowsIn, { stores: input.stores, products: input.products, nowBy: input.nowBy });
  for (const n of SHEETS) assert.deepEqual(requestsOf(ours[n], n), json(gas[n]), `${label}: ${n}`);
  return ours;
}
const A1 = fx.stores.find((s) => s.directions.includes('bakery'));
const bakeryProds = fx.products.filter((p) => p.barcode);

test('Apps Script ↔ Node: порожній день (немає рядків)', () => { same([], {}, 'порожньо'); });

test('Apps Script ↔ Node: невідома адреса, категорія «Інше», зона з колонки D, алиас «валентиновская50», дубль позицій', () => {
  const p0 = bakeryProds[0], p1 = bakeryProds[bakeryProds.length - 1];
  same([
    row('валентиновская50', '', p0.barcode, p0.name, 10.5, 2),
    row('Невідома вул, 1', 'Центр', '000', 'Дивний товар', 7, 1.5),
    row('Невідома вул, 1', '', '000', 'Кулінарія без каталогу', 7, 3),
    row(A1.addrBakery, 'Салтовка', p1.barcode, p1.name, 33.33, 3),
    row(A1.addrBakery, 'Салтовка', p1.barcode, p1.name, 33.33, 4),     // добавка: та сама позиція ще раз
    row(A1.addrBakery, 'Салтовка', '', 'Випічка ручна', 12, 1),
    row('Грозненская', '', '', 'Щось без штрихкоду', 0.1, 3),
    row('Невідома вул, 1', 'Новые дома', '', 'Інше', 0.2, 0.1),
  ], {}, 'крайні');
});

test('Apps Script ↔ Node: субота (кулінарія не працює) - «N з M» рахує лише ТТ з робочим днем', () => {
  const sat = new Date('2026-10-24T11:00:00+03:00');
  const p0 = bakeryProds[0];
  const out = same([row(A1.addrBakery, 'Салтовка', p0.barcode, p0.name, 10, 2)], { now: sat }, 'субота');
  assert.match(out['Заказы ВК'].data[1][0], /^ТТ із замовленнями: 1 з \d+ /);
});

test('Apps Script ↔ Node: категорії лише з назви (products порожні)', () => {
  same([row(A1.addrBakery, 'Салтовка', '1', 'Кулінарія Х', 5, 1), row(A1.addrBakery, 'Салтовка', '2', 'Випічка Y', 6, 2)], { products: [] }, 'без каталогу');
});

// ---------- рядки з бази ----------
test('bakeryRowsFromOrders: формат сирого рядка вигрузки (адреса ВК, зона, штрихкод без апострофа), порядок за часом', () => {
  const st = { ...A1, id: 'a1', addrBakery: 'м. Харків вул. Тест, 1', zone: 'Центр' };
  const orders = [
    { store_id: 'a1', created_at: '2026-10-19T09:30:00+03:00', lines: [{ line_no: 2, barcode: '222', name: 'Випічка Б', price: '10', qty: '2' }, { line_no: 1, barcode: '111', name: 'Випічка А', price: '5.5', qty: '1.5' }] },
    { store_id: 'a1', created_at: '2026-10-19T08:00:00+03:00', lines: [{ line_no: 1, barcode: '333', name: 'Кулінарія В', price: 1, qty: 1 }] },
    { store_id: 'нема', created_at: '2026-10-19T08:00:00+03:00', lines: [{ line_no: 1, barcode: '1', name: 'Х', price: 1, qty: 1 }] },
  ];
  const got = B.bakeryRowsFromOrders(orders, [st], '2026-10-19');
  assert.deepEqual(got, [
    ['19.10.2026', '08:00', 'м. Харків вул. Тест, 1', 'Центр', '333', 'Кулінарія В', 1, 1],
    ['19.10.2026', '09:30', 'м. Харків вул. Тест, 1', 'Центр', '111', 'Випічка А', 5.5, 1.5],
    ['19.10.2026', '09:30', 'м. Харків вул. Тест, 1', 'Центр', '222', 'Випічка Б', 10, 2],
  ]);
});
