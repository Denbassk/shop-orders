// Звіти овочів: «Замовлення Овочі» і «Зведена Овочі». Еталон - справжній app/VegReport.gs у vm (helpers/gas-sheetapp.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { runGas, newSheet, applyRequests, diffSheets } = require('./helpers/gas-sheetapp');
const { writerFor } = require('../src/reports/sheetWriter');
const V = require('../src/reports/veg');

const VEG_ID = '1HbvDCuMMJe7GI4zQyDxkyqVWahTPtWf5vNuMFLEXIC0';
const FILES = ['Config.gs', 'Address.gs', 'Registry.gs', 'VegDays.gs', 'Products.gs', 'VegReport.gs'];
const NOW = new Date('2026-10-19T18:12:44+03:00');       // понеділок
const TODAY = '19.10.2026';

const store = (id, label, addr, days, over = {}) => ({ id, label, address: addr, addrVeg: addr, directions: ['veg'], days: { veg: days, bakery: [] }, edrpou: '', ...over });
const STORES = [
  store('a', 'Амосова, 5А', 'м. Харків вул. Амосова, 5А', [1]),
  store('b', 'Байрона, 156', 'м. Харків пр-т Байрона, 156', [1], { edrpou: '45672783' }),
  store('c', 'Зубенка, 23', 'м. Харків вул. Зубенка, 23', [2]),                 // вівторок - сьогодні (пн) не їхній день
  store('d', 'Ювілейний, 67', 'м. Харків пр-т Ювілейний, 67', [1], { edrpou: '45672783' }),
  store('e', 'Гарібальді, 1', 'м. Харків вул. Гарібальді, 1', []),            // дні не задані - без обмежень
];
// дата | час | адреса | назва | ціна | кількість | сума
const ROWS = [
  [TODAY, '09:10:11', 'м. Харків вул. Амосова, 5А', 'Картопля', 14.5, 12, 174],
  [TODAY, '09:10:11', 'м. Харків вул. Амосова, 5А', 'Морква', 18, 3.5, 63],
  [TODAY, '09:10:11', 'м. Харків вул. Амосова, 5А', 'Буряк', 16.3, 2.333, 0],       // сума порожня -> ціна*к-ть
  [TODAY, '11:20:00', 'м. Харків пр-т Байрона, 156', 'Картопля', 14.5, 20, 290],
  [TODAY, '11:20:00', 'м. Харків пр-т Байрона, 156', 'Часник', 120, 0.5, 60],
  [TODAY, '12:00:00', 'м. Харків вул. Невідома, 5', 'Морква', 18, 1, 18],
];
const HEADER = ['Дата', 'Час', 'Адреса', 'Назва', 'Ціна', 'Кількість', 'Сума'];

function gasRun(rows, run) {
  return runGas({ files: FILES, stores: STORES, now: NOW, run, raw: { [VEG_ID]: { '_Сырые_Заказы_Овочі': [HEADER, ...rows] } } });
}
function ours(plan, sheetId = 7) {
  const w = writerFor({ properties: { sheetId, gridProperties: { rowCount: 1000, columnCount: 26 } } }, plan.data, plan.width);
  plan.apply(w);
  return applyRequests(newSheet('ours', sheetId), w.requests());
}
const show = (d) => d.slice(0, 12).map((x) => `${x.cell} ${x.prop}: gas=${x.gas} ours=${x.ours}`).join('\n');
const RUN = 'buildVegOrdersSheet_(vegTodayRows_()); buildVegSummarySheet_(vegTodayRows_());';

test('Замовлення Овочі + Зведена Овочі: значення і формати збігаються з VegReport.gs (ЮА, чужий день, невідома адреса)', () => {
  const gas = gasRun(ROWS, RUN);
  const plans = V.buildVegReports(V.normalizeRawRows(ROWS.map((r) => r.slice()), TODAY), { stores: STORES, now: NOW, legacy: true });
  for (const name of ['Замовлення Овочі', 'Зведена Овочі']) {
    const d = diffSheets(gas.sheet(VEG_ID, name), ours(plans[name]), { skip: new Set(['grid']) });
    assert.equal(d.length, 0, name + ':\n' + show(d));
  }
});

test('позначка ЮА: у назві ТТ із замовленням і в списку «ТТ без замовлень»; чужого дня точки в списку нема', () => {
  const plans = V.buildVegReports(V.normalizeRawRows(ROWS.map((r) => r.slice()), TODAY), { stores: STORES, now: NOW, legacy: true });
  const col = plans['Замовлення Овочі'].data.map((r) => r[0]);
  assert.ok(col.includes('м. Харків пр-т Байрона, 156 · ЮА'), 'ТТ із замовленням і ЮА');
  assert.ok(col.includes('   Ювілейний, 67 · ЮА'), 'без замовлення і ЮА');
  assert.ok(col.includes('   Гарібальді, 1'), 'без замовлення, не ЮА');
  assert.ok(!col.some((x) => /Зубенка/.test(x)), 'вівторкова точка в понеділок не показується');
  assert.ok(col.includes('ТТ без замовлень (2):'));
  assert.equal(plans['Замовлення Овочі'].data[1][0], 'ТТ із замовленнями: 3 з 4   (оновлено 18:12:44)');
});

test('порожній день: «Замовлень на сьогодні ще немає» в обох листах', () => {
  const gas = gasRun([], RUN);
  const plans = V.buildVegReports([], { stores: STORES, now: NOW, legacy: true });
  for (const name of ['Замовлення Овочі', 'Зведена Овочі']) {
    const d = diffSheets(gas.sheet(VEG_ID, name), ours(plans[name]), { skip: new Set(['grid']) });
    assert.equal(d.length, 0, name + ':\n' + show(d));
  }
});

test('normalizeRawRows: сьогодні, з назвою (D) і кількістю (F) > 0', () => {
  const raw = [
    [TODAY, '09:00:00', 'А', 'Морква', 18, '3,5', 63],
    ['18.10.2026', '09:00:00', 'А', 'Морква', 18, 1, 18],
    [TODAY, '09:00:00', 'А', '', 18, 1, 18],
    [TODAY, '09:00:00', 'А', 'Буряк', 18, 0, 0],
  ];
  assert.deepEqual(V.normalizeRawRows(raw, TODAY), [[TODAY, '09:00:00', 'А', 'Морква', 18, 3.5, 63]]);
});

test('постачальник (26.10.2026): «Сума, грн» перед «Кількість, кг»; кількість без формату 0.### («3,» не показується); значення ті самі, що в старому вигляді', () => {
  const rows = () => V.normalizeRawRows(ROWS.map((r) => r.slice()), TODAY);
  const neu = V.buildVegReports(rows(), { stores: STORES, now: NOW });
  const old = V.buildVegReports(rows(), { stores: STORES, now: NOW, legacy: true });
  for (const name of ['Замовлення Овочі', 'Зведена Овочі']) {
    const a = neu[name], b = old[name];
    assert.equal(a.data.length, b.data.length);
    a.data.forEach((row, i) => {
      const o = b.data[i];
      if (['№', 'Назва овочу'].includes(String(o[1])) || o[0] === '№') { assert.deepEqual(row.slice(3), ['Сума, грн', 'Кількість, кг']); return; }
      assert.deepEqual([row[0], row[1], row[2], row[3], row[4]], [o[0], o[1], o[2], o[4], o[3]], name + ' рядок ' + (i + 1));
    });
    const w = writerFor({ properties: { sheetId: 7, gridProperties: { rowCount: 1000, columnCount: 26 } } }, a.data, a.width);
    a.apply(w);
    const nf = w.requests().filter((q) => q.repeatCell && q.repeatCell.cell.userEnteredFormat.numberFormat)
      .map((q) => [q.repeatCell.range.startColumnIndex, q.repeatCell.cell.userEnteredFormat.numberFormat.pattern]);
    assert.ok(nf.length && nf.every(([c, p]) => p === '#,##0.00' && (c === 2 || c === 3)), name + ': формати ' + JSON.stringify(nf));
  }
});
