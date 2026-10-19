// Вигрузка НБХЗ для заводу: лист «Вивантаження дд.мм.рррр» (матриця ТТ × асортимент) і лист «Завантаження» з посиланням на xlsx.
// Еталон - справжній app/Nbhz.gs (buildNbhzExport, writeExportLinkSheet_) у vm з підмінним SpreadsheetApp.
// Ширини двох перших колонок і висоту шапки Google рахує сам (autoResize) - вони порівнюються окремою перевіркою формули.
const test = require('node:test');
const assert = require('node:assert/strict');

const { runGas, newSheet, applyRequests, diffSheets } = require('./helpers/gas-sheetapp');
const { writerFor } = require('../src/reports/sheetWriter');
const N = require('../src/reports/nbhz');

const NBHZ_ID = '1ShyjK-P3xpe1ROsUPJwfpIzcNylgt05u_7r7ws6iHaY';
const FILES = ['Config.gs', 'Address.gs', 'Registry.gs', 'VegDays.gs', 'Products.gs', 'Nbhz.gs', 'Export.gs'];
const NOW = new Date('2026-10-19T17:41:05+03:00');
const TODAY = '19.10.2026';
const NAME = 'Вивантаження ' + TODAY;

const store = (id, label, over = {}) => ({ id, label, address: 'м. Харків вул. ' + label, directions: ['nbhz'], days: { veg: [], bakery: [] }, edrpou: '', ...over });
const STORES = [
  store('s1', 'Роганська, 130/4', { addrNbhz: 'Роганская130', routeNbhz: 'Рогань' }),
  store('s2', 'Роганська, 148', { addrNbhz: 'Роганская 148', routeNbhz: 'Рогань', edrpou: '45672783' }),
  store('s3', 'Салтівське Шосе, 264 В', { addrNbhz: 'Салтівське шосе 264в', routeNbhz: 'Салтовка 3' }),
  store('s4', 'Кінна, 7', { addrNbhz: '', routeNbhz: 'Салтовка 3' }),
  store('s5', 'Дубль s1', { addrNbhz: 'Роганская130', routeNbhz: 'Інший' }),         // той самий ключ адреси - пропускається
  store('s6', 'Без НБХЗ', { addrNbhz: 'Інша 1', routeNbhz: 'Рогань', directions: ['bread'] }),
];
const NAMES = ['Батон Дорожній 0,400г', 'Батон Класичний 0,350г', 'Хліб Пшеничний 0,700г', 'Хліб Житній 0,500г', 'Булка Гарна'];
// products у формі БД; 'Хліб Житній' - стоп (у вивантаженні немає)
const PRODUCTS = NAMES.map((name, i) => ({ dir: 'nbhz', name, barcode: '', status: name === 'Хліб Житній 0,500г' ? 'stop' : 'active', sort: i }));
const GAS_PRODUCTS = PRODUCTS.filter((p) => p.status !== 'stop').map((p) => ({ id: p.name.toLowerCase(), barcode: '', name: p.name, price: 0 }));
// дата | маршрут | адреса | штрихкод | назва | ціна | кількість
const ROWS = [
  [TODAY, 'Рогань', 'Роганская130', '', 'Батон Дорожній 0,400г', 0, 10],
  [TODAY, 'Рогань', 'Роганская130', '', 'Хліб Пшеничний 0,700г', 0, 4.5],
  [TODAY, 'Рогань', 'Роганская130', '', 'Батон Дорожній 0,400г', 0, 2],               // добавка: сума по клітинці
  [TODAY, 'Рогань', 'Роганская 148', '', 'Хліб Пшеничний 0,700г', 0, 6],
  [TODAY, 'X', 'Невідома, 5', '', 'Батон Дорожній 0,400г', 0, 1],                    // точки нема в Довіднику - новий рядок
  [TODAY, 'Рогань', 'Роганская130', '', 'Хліб Житній 0,500г', 0, 3],                   // стоп - пропускається
  [TODAY, 'Рогань', 'Роганская130', '', 'Нема такого', 0, 3],                          // не в асортименті - пропускається
  ['18.10.2026', 'Рогань', 'Роганская130', '', 'Булка Гарна', 0, 9],                  // не сьогодні
];
const HEADER = ['Дата', 'Маршрут', 'Адреса', 'Штрихкод', 'Назва', 'Ціна', 'Кількість'];

const gasRun = (rows, stores = STORES, products = GAS_PRODUCTS) => runGas({ files: FILES, stores, products, now: NOW, run: 'buildNbhzExport()',
  raw: { [NBHZ_ID]: { '_Сырые_Заказы_НБХЗ': [HEADER, ...rows] } } });
function ours(plan, sheetId = 7) {
  const w = writerFor({ properties: { sheetId, gridProperties: { rowCount: 1000, columnCount: 26 } } }, plan.data, plan.width);
  plan.apply(w);
  return applyRequests(newSheet('ours', sheetId), w.requests());
}
const show = (d) => d.slice(0, 14).map((x) => `${x.cell} ${x.prop}: gas=${x.gas} ours=${x.ours}`).join('\n');
// Google сам рахує ширину колонок A:B і висоту шапки (autoResize)
const AUTO = { skipDim: (name, i) => (name === 'colW' && (i === '1' || i === '2')) || (name === 'rowH' && i === '1') };

test('вигрузка: значення і формати листа «Вивантаження» збігаються з Nbhz.gs (рядки без замовлень і колонки без замовлень вирізані)', () => {
  const gas = gasRun(ROWS);
  const rows = N.normalizeRawRows(ROWS.map((r) => r.slice()), TODAY);
  const exp = N.buildNbhzExport(rows, { stores: STORES, products: PRODUCTS, now: NOW });
  assert.equal(exp.name, NAME);
  const d = diffSheets(gas.sheet(NBHZ_ID, NAME), ours(exp.plan), AUTO);
  assert.equal(d.length, 0, '\n' + show(d));
  assert.equal(exp.stats.nRows, 3, 'Рогань×2 + Невідома');
});

test('вигрузка: ЮА - позначка після адреси; порядок рядків: маршрут, адреса; колонки - порядок асортименту без «стоп»', () => {
  const rows = N.normalizeRawRows(ROWS.map((r) => r.slice()), TODAY);
  const { plan } = N.buildNbhzExport(rows, { stores: STORES, products: PRODUCTS, now: NOW });
  assert.deepEqual(plan.data[0], ['Маршрут', 'Адрес Магазина', 'Батон Дорожній 0,400г', 'Хліб Пшеничний 0,700г']);
  assert.deepEqual(plan.data.slice(1).map((r) => r.slice(0, 2)), [['Рогань', 'Роганская 148 · ЮА'], ['Рогань', 'Роганская130'], ['X', 'Невідома, 5']]);
  assert.deepEqual(plan.data.slice(1).map((r) => r.slice(2)), [[0, 6], [12, 4.5], [1, 0]]);
});

test('порожній день: «Замовлень на … немає» і лист «Завантаження»', () => {
  const gas = gasRun([]);
  const exp = N.buildNbhzExport([], { stores: STORES, products: PRODUCTS, now: NOW });
  assert.equal(exp.empty, true);
  const d = diffSheets(gas.sheet(NBHZ_ID, NAME), ours(exp.plan), AUTO);
  assert.equal(d.length, 0, '\n' + show(d));
});

test('багато колонок (>26): літери колонок AA.., сітка листа обрізана до розміру даних', () => {
  const names = Array.from({ length: 30 }, (_, i) => 'Позиція ' + String(i + 1).padStart(2, '0'));
  const prods = names.map((name, i) => ({ dir: 'nbhz', name, barcode: '', status: 'active', sort: i }));
  const gasProds = names.map((name) => ({ id: name.toLowerCase(), barcode: '', name, price: 0 }));
  const rows = names.map((n, i) => [TODAY, 'Рогань', 'Роганская130', '', n, 0, i + 1]);
  const gas = gasRun(rows, STORES, gasProds);
  const exp = N.buildNbhzExport(N.normalizeRawRows(rows.map((r) => r.slice()), TODAY), { stores: STORES, products: prods, now: NOW });
  const g = gas.sheet(NBHZ_ID, NAME), o = ours(exp.plan);
  assert.equal(o.maxCols, 32);
  assert.equal(o.maxRows, 2);
  const d = diffSheets(g, o, AUTO);
  assert.equal(d.length, 0, '\n' + show(d));
});

test('лист «Завантаження»: HYPERLINK на xlsx вигрузки за gid, текст, ширина, сітка прихована', () => {
  const gas = gasRun(ROWS);
  const gid = gas.sheet(NBHZ_ID, NAME).id;
  const plan = N.nbhzLinkPlan({ spreadsheetId: NBHZ_ID, gid, now: NOW });
  const d = diffSheets(gas.sheet(NBHZ_ID, 'Завантаження'), ours(plan, 9), { skip: new Set(['grid']) });
  assert.equal(d.length, 0, '\n' + show(d));
  assert.equal(plan.sheetIndex, 0);
});

test('ширини, які рахує Google: A = min(max(auto+14, 96), 170), B = min(max(auto+14, 170), 300), шапка >= 48', () => {
  const gas = gasRun(ROWS);
  const g = gas.sheet(NBHZ_ID, NAME);                    // у моку auto-ширина = 100, висота = 21
  const dims = N.nbhzAutoDims({ col1: 100, col2: 100, row1: 21 });
  assert.deepEqual([dims.col1, dims.col2, dims.row1], [g.colW[1], g.colW[2], g.rowH[1]]);
  assert.deepEqual([N.nbhzAutoDims({ col1: 300, col2: 400, row1: 90 })].map((x) => [x.col1, x.col2, x.row1])[0], [170, 300, 90]);
  assert.deepEqual([N.nbhzAutoDims({ col1: 20, col2: 20, row1: 30 })].map((x) => [x.col1, x.col2, x.row1])[0], [96, 170, 48]);
});

test('fuzzyKey: рос/укр написання однакові (и/і/ы, е/є, ь, ґ/г)', () => {
  assert.equal(N.fuzzyKey('Нескорених 33'), N.fuzzyKey('Нескореных 33'));
  assert.equal(N.fuzzyKey('Салтівське шосе 264в'), N.fuzzyKey('Салтiвське шосе 264в'));
  assert.equal(N.fuzzyKey('Ґрунтова 1'), N.fuzzyKey('Грунтова 1'));
  assert.equal(N.fuzzyKey('Центральна площа 4'), N.fuzzyKey('Центральна площа 4'));
  assert.notEqual(N.fuzzyKey('Нескорених 33'), N.fuzzyKey('Нескорених 34'));
});

test('normalizeRawRows: лише сьогодні, кількість числом', () => {
  const raw = [[TODAY, 'М', 'А', '', 'Хліб', 0, '2,5'], ['18.10.2026', 'М', 'А', '', 'Хліб', 0, 1]];
  assert.deepEqual(N.normalizeRawRows(raw, TODAY), [[TODAY, 'М', 'А', '', 'Хліб', 0, 2.5]]);
});
