// Звіти хліба (Рома): «Заказы», «Данные Заказов» і лист «Завантаження».
// Еталон - справжній app/BreadReport.gs + app/Export.gs у vm з підмінним SpreadsheetApp (helpers/gas-sheetapp.js).
// Порівнюються модель комірок (значення, формати, рамки), ширини колонок і закріплення: те, що зробив би Apps Script,
// проти того, що дають наші batchUpdate-запити.
const test = require('node:test');
const assert = require('node:assert/strict');

const { runGas, newSheet, applyRequests, diffSheets } = require('./helpers/gas-sheetapp');
const { writerFor } = require('../src/reports/sheetWriter');
const B = require('../src/reports/bread');
const { looseFor } = require('../src/reports/shadow');

const BREAD_ID = '1QJca7XlvZbIWfEIyxBxC64dSD6RkrlWoZOSmem2tix4';
const FILES = ['Config.gs', 'Address.gs', 'Registry.gs', 'VegDays.gs', 'Products.gs', 'BreadReport.gs', 'Export.gs'];
const NOW = new Date('2026-10-19T15:42:17+03:00');
const TODAY = '19.10.2026';

const store = (id, label, addr, code, over = {}) => ({ id, label, address: addr, code, addrBread: addr, directions: ['bread'], days: { veg: [], bakery: [] }, edrpou: '', ...over });
const STORES = [
  store('a', 'Амосова, 5А', 'м. Харків вул. Амосова, 5А', '101'),
  store('b', 'Байрона, 156', 'м. Харків пр-т Байрона, 156', '102', { edrpou: '45672783' }),
  store('c', 'Зубенка, 23', 'м. Харків вул. Зубенка, 23', '103'),
  store('d', 'Ювілейний, 67', 'м. Харків пр-т Ювілейний, 67', '104'),
  store('e', 'Без хліба', 'м. Харків вул. Інша, 1', '105', { directions: ['veg'] }),
];
// робочі рядки: дата | маршрут | коротка адреса | штрихкод | назва | ціна | кількість
const ROWS = [
  [TODAY, 'Харьков-17', 'Амосова, 5а', '4820000000002', 'Хліб Біла Паляниця 650г', 20, 5],
  [TODAY, 'Харьков-17', 'Амосова, 5а', '4820000000001', 'Батон Нарізний 400г', 17.5, 10],
  [TODAY, 'Харьков-17', 'Амосова, 5а', '5482000000003', 'Багет Французький', 25, 1.5],
  [TODAY, 'Харьков-22', 'Байрона, 156', '4820000000001', 'Батон Нарізний 400г', 17.5, 4],
  [TODAY, 'Харьков-17', 'Зубенка, 23', '4820000000002', 'Хліб Біла Паляниця 650г', 20, 3],
  [TODAY, 'Харьков-22', 'Невідома, 9', '4820000000002', 'Хліб Біла Паляниця 650г', 20, 2],
  [TODAY, 'Харьков-22', 'Байрона, 156', '4820000000002', 'Хліб Біла Паляниця 650г', 20, 2],
];
const HEADER = ['Отметка времени', 'Маршрут', 'Штрих-код', 'Магазин', 'Название', 'Цена', 'Кол-во'];

function gasRun(rows, run, extra = {}) {
  return runGas({ files: FILES, stores: STORES, now: NOW, run, raw: { [BREAD_ID]: { '_Сырые_Заказы': [HEADER, ...rows] } }, ...extra });
}
// наша модель листа за планом
function ours(plan, sheetId = 7) {
  const w = writerFor({ properties: { sheetId, gridProperties: { rowCount: 1000, columnCount: 26 } } }, plan.data, plan.width);
  plan.apply(w);
  return applyRequests(newSheet('ours', sheetId), w.requests());
}
const show = (d) => d.slice(0, 12).map((x) => `${x.cell} ${x.prop}: gas=${x.gas} ours=${x.ours}`).join('\n');

test('Заказы + Данные Заказов: значення і формати збігаються з BreadReport.gs (різні маршрути, ЄДРПОУ, невідома адреса)', () => {
  const gas = gasRun(ROWS, 'buildBreadOrdersSheet_(breadTodayRows_()); buildBreadSummarySheet_(breadTodayRows_());');
  const plans = B.buildBreadReports(B.normalizeRawRows(ROWS.map((r) => r.slice()), TODAY), { stores: STORES, now: NOW });
  for (const name of ['Заказы', 'Данные Заказов']) {
    const d = diffSheets(gas.sheet(BREAD_ID, name), ours(plans[name]), { skip: new Set(['grid']), loose: looseFor('bread')(name) });
    assert.equal(d.length, 0, name + ':\n' + show(d));
  }
});

test('Заказы: ЄДРПОУ за замовчуванням і своє (ЮА), код ТТ з Довідника, невідомої адреси - порожній код', () => {
  const plans = B.buildBreadReports(B.normalizeRawRows(ROWS.map((r) => r.slice()), TODAY), { stores: STORES, now: NOW });
  const data = plans['Заказы'].data;
  const sep = data.filter((r) => r[0] === '' && (r[6] !== '' || r[7] !== ''));
  assert.deepEqual(sep.map((r) => [r[6], r[7]]), [['44413718', '101'], ['44413718', '103'], ['45672783', '102'], ['44413718', '']]);
});

test('порожній день: «Замовлень на … немає» в обох листах', () => {
  const gas = gasRun([], 'buildBreadOrdersSheet_(breadTodayRows_()); buildBreadSummarySheet_(breadTodayRows_());');
  const plans = B.buildBreadReports([], { stores: STORES, now: NOW });
  for (const name of ['Заказы', 'Данные Заказов']) {
    const d = diffSheets(gas.sheet(BREAD_ID, name), ours(plans[name]), { skip: new Set(['grid']) });
    assert.equal(d.length, 0, name + ':\n' + show(d));
  }
  assert.equal(plans['Заказы'].data[1][0], 'Замовлень на 19.10.2026 немає');
});

test('normalizeRawRows: лише сьогодні, з назвою і кількістю > 0, кількість числом', () => {
  const raw = [
    [TODAY, 'М', 'А', '1', 'Хліб', 10, '2,5'],
    ['18.10.2026', 'М', 'А', '1', 'Хліб', 10, 1],
    [TODAY, 'М', 'А', '1', '', 10, 1],
    [TODAY, 'М', 'А', '1', 'Хліб', 10, 0],
  ];
  assert.deepEqual(B.normalizeRawRows(raw, TODAY), [[TODAY, 'М', 'А', '1', 'Хліб', 10, 2.5]]);
});

test('«Завантаження»: повний лист (посилання на xlsx «Заказы» і «Данные Заказов» за gid) і лише штамп О9', () => {
  const gasFull = runGas({ files: FILES, stores: STORES, now: NOW, props: {}, raw: {},
    run: `(function () { var ss = SpreadsheetApp.openById('${BREAD_ID}'); ss.insertSheet('Заказы'); ss.insertSheet('Данные Заказов'); writeBreadDownloadSheet_(false); })()` });
  const sheets = gasFull.books[BREAD_ID].sheets;
  const plan = B.breadDownloadPlan({ spreadsheetId: BREAD_ID, ordersGid: sheets['Заказы'].id, summaryGid: sheets['Данные Заказов'].id, now: NOW, full: true });
  const d = diffSheets(sheets['Завантаження'], ours(plan, 9), { skip: new Set(['grid']) });
  assert.equal(d.length, 0, show(d));

  // штамп: лист вже є і дата збережена -> оновлюється лише комірка A9
  const gasStamp = runGas({ files: FILES, stores: STORES, now: new Date('2026-10-19T15:47:00+03:00'), props: { bread_link_date: TODAY }, raw: {},
    run: `(function () { var ss = SpreadsheetApp.openById('${BREAD_ID}'); ss.insertSheet('Заказы'); ss.insertSheet('Данные Заказов'); ss.insertSheet('Завантаження'); writeBreadDownloadSheet_(false); })()` });
  const stampModel = applyRequests(newSheet('x', 9), B.breadDownloadStampRequests(9, new Date('2026-10-19T15:47:00+03:00')));
  assert.equal(stampModel.cells['9,1'].v, 'Звіт перезібрано о 15:47');
  assert.equal(gasStamp.sheet(BREAD_ID, 'Завантаження').cells['9,1'].v, stampModel.cells['9,1'].v);
  assert.deepEqual(Object.keys(stampModel.cells), ['9,1'], 'інші комірки не чіпаються');
});

test('ведучі нулі штрихкоду і номера ТТ зберігаємо текстом (Apps Script setValues + «@» їх, найімовірніше, зʼїдає - навмисна відмінність)', () => {
  const st = [store('z', 'Зубенка, 23', 'м. Харків вул. Зубенка, 23', '0103')];
  const rows = [[TODAY, 'Харьков-17', 'Зубенка, 23', '0482000000003', 'Хліб', 20, 1]];
  const { Заказы: orders, 'Данные Заказов': summary } = B.buildBreadReports(rows, { stores: st, now: NOW });
  assert.equal(orders.data[1][7], '0103');
  assert.equal(orders.data[2][3], '0482000000003');
  assert.equal(summary.data.find((r) => r[1] === 'Хліб' && r[0] === '0482000000003')[0], '0482000000003', 'у нижньому блоці рядок лишається текстом, бо число змінило б запис');
});

test('допуск число/текст у штрихкодах зведення вузький: лише колонка A «Данные Заказов», цифри мають збігатися', () => {
  const loose = looseFor('bread')('Данные Заказов');
  assert.equal(looseFor('bread')('Заказы'), null);
  assert.equal(looseFor('veg')('Данные Заказов'), null);
  assert.equal(loose('16,1', 'v', 4820000000001, '4820000000001', {}, {}), true);
  assert.equal(loose('16,1', 'v', 4820000000001, '4820000000002', {}, {}), false, 'інші цифри - розбіжність');
  assert.equal(loose('16,3', 'v', 14, '14', {}, {}), false, 'інші колонки - строго');
  assert.equal(loose('16,1', 'bg', '#fff', '#000', {}, {}), false, 'колір - строго');
});
