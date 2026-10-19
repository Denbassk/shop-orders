const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonKey, nameKey, parseDays, parseStores, storeToRow,
  parseSheetProducts, parseNbhzProducts, readVegPrices, parseVegProducts,
} = require('../src/import/parse');
const { DIRECTIONS } = require('../src/directions');

// Рядки Довідника ТТ, діапазон A2:T (UNFORMATTED_VALUE: галочки - true/false).
// A active | B назва | C адреса | D обл.номер | E маршрут | F тип | G хліб | H випічка | I овочі
// J примітка | K адр.хліб | L адр.випічка | M адр.овочі | N НБХЗ | O маршрут НБХЗ | P адр.НБХЗ
// Q дні овочів | R дні випічки | S зона | T ЄДРПОУ
const REG_ROWS = [
  [true, 'Магазин Бучми', 'м. Харків вул. Бучми, 32', 'АХ1', 'Р1', 'Магазин', true, true, true, '',
    '', '', '', true, 'Н1', 'Бучми 32 нбхз', 'Пн, Ср', 'Пн, Вт, Ср, Чт, Пт', 'Салтовка', '45672783'],
  [false, 'Закрита точка', 'м. Харків вул. Закрита, 1', '', '', '', true, true, true, '',
    '', '', '', false, '', '', '', '', '', ''],
  [true, '', "м. Харків пр-т Байрона, 156", '', 'Р2', '', true, false, false, '',
    '', '', '', false, '', '', '', '', '', ''],
  // активна, але без жодного напрямку - loadStores_ її відкидає
  [true, 'Порожня', 'м. Харків вул. Порожня, 2', '', '', '', false, false, false, '',
    '', '', '', false, '', '', '', '', '', ''],
  // активна, але порожня адреса - відкидається
  [true, 'Без адреси', '  ', '', '', '', true, true, true],
];

test('canonKey: як у Registry.gs', () => {
  assert.equal(canonKey('м. Харків вул. Бучми, 32'), 'м харків вул бучми 32');
  assert.equal(canonKey("Пров. Іскринський, 19 В"), 'пров іскринський 19 в');
  assert.equal(canonKey("вул. Ім'я`1"), 'вул імя1');
});

test('parseDays: "Пн, Ср" -> [1, 3], порядок за днем тижня', () => {
  assert.deepEqual(parseDays('Пн, Ср'), [1, 3]);
  assert.deepEqual(parseDays('Ср, Нд'), [0, 3]);
  assert.deepEqual(parseDays(''), []);
  assert.deepEqual(parseDays(undefined), []);
});

test('parseStores: 5 рядків -> 2 точки, поля як у loadStores_', () => {
  const stores = parseStores(REG_ROWS);
  assert.equal(stores.length, 2);

  // сортування за label (uk): "Магазин Бучми" < "м. Харків пр-т Байрона, 156"? label порожній -> адреса
  const byId = Object.fromEntries(stores.map((s) => [s.id, s]));
  const buchma = byId['м харків вул бучми 32'];
  assert.deepEqual(buchma, {
    id: 'м харків вул бучми 32',
    label: 'Магазин Бучми',
    address: 'м. Харків вул. Бучми, 32',
    code: 'АХ1',
    route: 'Р1',
    type: 'Магазин',
    addrBread: 'м. Харків вул. Бучми, 32',
    addrBakery: 'м. Харків вул. Бучми, 32',
    addrVeg: 'м. Харків вул. Бучми, 32',
    addrNbhz: 'Бучми 32 нбхз',
    routeNbhz: 'Н1',
    zone: 'Салтовка',
    edrpou: '45672783',
    days: { veg: [1, 3], bakery: [1, 2, 3, 4, 5] },
    directions: ['bread', 'nbhz', 'bakery', 'veg'],
  });

  const bayron = byId[canonKey('м. Харків пр-т Байрона, 156')];
  assert.equal(bayron.label, 'м. Харків пр-т Байрона, 156', 'порожня назва -> адреса');
  assert.equal(bayron.type, 'Магазин', 'порожній тип -> Магазин');
  assert.deepEqual(bayron.directions, ['bread']);
  assert.deepEqual(bayron.days, { veg: [], bakery: [] });
  assert.equal(bayron.addrNbhz, bayron.address);
});

test('parseStores: сортування за label українською', () => {
  const rows = [
    [true, 'Яблуко', 'a1', '', '', '', true],
    [true, 'Арка', 'a2', '', '', '', true],
    [true, 'Їжа', 'a3', '', '', '', true],
  ];
  assert.deepEqual(parseStores(rows).map((s) => s.label), ['Арка', 'Їжа', 'Яблуко']);
});

test('storeToRow: рядок таблиці stores', () => {
  const [s] = parseStores([REG_ROWS[0]]);
  const row = storeToRow(s, 7);
  assert.equal(row.store_id, s.id);
  assert.equal(row.active, true);
  assert.equal(row.addr_nbhz, 'Бучми 32 нбхз');
  assert.equal(row.route_nbhz, 'Н1');
  assert.deepEqual(row.days, { veg: [1, 3], bakery: [1, 2, 3, 4, 5] });
  assert.deepEqual(row.directions, ['bread', 'nbhz', 'bakery', 'veg']);
  assert.equal(row.sort, 7);
});

// Лист "Ассортимент": A статус | B № / категорія | C штрихкод | D ціна | E номенклатура | F шт в ящику
test('parseSheetProducts: хліб - стоп, без ціни/штрихкоду, ящик', () => {
  const rows = [
    ['', 1, '4820000000011', 25.5, 'Батон', '10'],
    ['стоп', 2, '4820000000028', 30, 'Багет', '8'],
    ['', 3, '', 20, 'Без штрихкоду', ''],
    ['', 4, '4820000000042', 0, 'Без ціни', ''],
    ['', 5, '4820000000059', '18,40', 'Ціна рядком', ''],
    ['', 6, '4820000000066', 10, '', ''],
  ];
  const r = parseSheetProducts('bread', DIRECTIONS.bread, rows);
  const act = r.filter((p) => p.status === 'active');
  assert.deepEqual(act.map((p) => p.name), ['Батон', 'Ціна рядком']);
  assert.equal(act[1].price, 18.4);
  assert.equal(act[0].box, '10');
  const stop = r.filter((p) => p.status === 'stop');
  assert.deepEqual(stop.map((p) => p.name), ['Багет']);
  assert.equal(stop[0].id, '4820000000028');
  assert.equal(r.length, 3, 'невалідні (без штрихкоду/ціни) і без назви не потрапляють у базу');
});

test('parseSheetProducts: випічка - категорія і наявність, сортування за категорією', () => {
  const rows = [
    ['', 'Кулінарія', '111', 50, 'Вареники', 'нема'],
    ['', 'Випічка', '222', 20, 'Пиріжок', ''],
    ['', '', '333', 15, 'Булочка', ''],
  ];
  const r = parseSheetProducts('bakery', DIRECTIONS.bakery, rows);
  assert.deepEqual(r.map((p) => p.category), ['Випічка', 'Інше', 'Кулінарія']);
  assert.deepEqual(r.map((p) => p.name), ['Пиріжок', 'Булочка', 'Вареники']);
  assert.equal(r.find((p) => p.name === 'Вареники').availability, 'нема');
  assert.equal(r.find((p) => p.name === 'Пиріжок').availability, null);
});

test('parseNbhzProducts: 3 колонки, ціна 0, порядок рядків, стоп', () => {
  const rows = [
    ['', 1, 'Хліб Український'],
    ['стоп', 2, 'Батон Нарізний'],
    ['', 3, ''],
    ['', 4, 'Булка'],
  ];
  const r = parseNbhzProducts(rows);
  assert.deepEqual(r.map((p) => [p.name, p.status, p.price, p.barcode]), [
    ['Хліб Український', 'active', 0, ''],
    ['Булка', 'active', 0, ''],
    ['Батон Нарізний', 'stop', 0, ''],
  ]);
  assert.equal(r[0].id, 'хліб український');
  assert.deepEqual(r.map((p) => p.sort), [0, 1, 1000]);
});

test('readVegPrices: пара "назва | число" будь-де у таблиці', () => {
  const data = [
    ['Прайс', '', ''],
    ['Картопля', 12.5, 'Морква', '8,40'],
    ['12', 5, 'Ab', 3],
    ['Цибуля', 99999, 'Буряк', 7],
    ['Картопля', 99, '', ''],
  ];
  const p = readVegPrices(data);
  assert.equal(p['картопля'], 12.5, 'перше входження виграє');
  assert.equal(p['морква'], 8.4);
  assert.equal(p['буряк'], 7);
  assert.equal(p['цибуля'], undefined, '> 5000 відкидається');
  assert.equal(p['ab'], undefined, 'коротша за 3 символи');
});

test('parseVegProducts: дозволені з "Налаштування" + ціни з прайсу', () => {
  const settings = [
    ['Картопля', ''],
    ['Морква', 'стоп'],
    ['Буряк', ''],
    ['Буряк', ''],
    ['Без ціни', ''],
    ['', ''],
  ];
  const prices = { картопля: 12.5, морква: 8.4, буряк: 7 };
  const r = parseVegProducts(settings, prices);
  assert.deepEqual(r.map((p) => [p.name, p.status, p.price]), [
    ['Буряк', 'active', 7],
    ['Картопля', 'active', 12.5],
    ['Морква', 'stop', 8.4],
  ]);
  assert.equal(r[0].id, 'Буряк');
  assert.equal(r[0].barcode, '');
});

test('nameKey: як у Products.gs', () => {
  assert.equal(nameKey('  Хліб  "Український" (1 кг) '), 'хліб український 1 кг');
});

test('DIRECTIONS: статичний конфіг без функцій, 4 напрямки', () => {
  assert.deepEqual(Object.keys(DIRECTIONS), ['bread', 'nbhz', 'bakery', 'veg']);
  for (const d of Object.values(DIRECTIONS)) {
    for (const v of Object.values(d)) assert.notEqual(typeof v, 'function');
  }
  assert.equal(DIRECTIONS.bakery.spreadsheetId, '1THdB-b4JkXzAKsaVPw8DLrXATlycpFkTgolTmqCOXWo');
  assert.deepEqual(DIRECTIONS.bread.minOrderChanges, [{ from: '01.10.2026', value: 400 }]);
});
