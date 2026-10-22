// import-reference: випічка читається з шапкою до Z (собівартість за заголовком), settings для списань.
// Google підмінено через require.cache - мережі і бази немає.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DIRECTIONS } = require('../src/directions');

const calls = [];
const HEAD = ['Статус', 'Категория', 'Штрихкод', 'Цена', 'Номенклатура', 'Наличие', 'Себестоимость'];
const stub = {
  a1q: (t, r) => `'${t}'!${r}`,
  firstSheetTitle: async () => 'Прайс',
  getValues: async (id, range) => {
    calls.push([id, range]);
    if (id === DIRECTIONS.bakery.spreadsheetId) return [HEAD, ['', 'Хліб', '482001', '25', 'Булка', 'є', '12,3']];
    if (range.includes('Налаштування')) return [['Картопля', '']];
    if (id === DIRECTIONS.veg.priceSpreadsheetId) return [['Картопля', 20]];
    return [];
  },
};
const gp = require.resolve(path.join(__dirname, '..', 'src', 'google'));
require.cache[gp] = { id: gp, filename: gp, loaded: true, exports: stub };
const IR = require('../scripts/import-reference');

test('випічка: діапазон A1:Z, шапка не стає товаром, cost з колонки «Себестоимость»', async () => {
  const data = await IR.readAll();
  const bk = calls.find(([id]) => id === DIRECTIONS.bakery.spreadsheetId);
  assert.match(bk[1], /!A1:Z$/);
  assert.equal(data.products.bakery.length, 1);
  assert.equal(data.products.bakery[0].name, 'Булка');
  assert.equal(data.products.bakery[0].cost, 12.3);
  assert.equal(data.warnings.length, 0);
});

test('хліб - як раніше (A2:F, без cost)', async () => {
  calls.length = 0;
  await IR.readAll();
  const br = calls.find(([id, r]) => id === DIRECTIONS.bread.spreadsheetId && r.includes('Ассортимент'));
  assert.match(br[1], /!A2:F$/);
});

test('settings за замовчуванням: wo_books {} і wo_late "" (заповнює власник; ignoreDuplicates не затре)', () => {
  assert.deepEqual(IR.DEFAULT_SETTINGS.wo_books, {});
  assert.equal(IR.DEFAULT_SETTINGS.wo_late, '');
});