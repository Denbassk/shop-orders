const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/rules');
const { createBuyerSheets, colName, trim } = require('../src/buyer/sheets');
const { createXlsx } = require('../src/buyer/xlsx');

const TABS = [
  { sheetId: 11, title: 'Заказы ВК', rowCount: 1000, columnCount: 26 },
  { sheetId: 12, title: 'Сводная ВК', rowCount: 500, columnCount: 10 },
  { sheetId: 21, title: 'Вивантаження 19.10.2026', rowCount: 100, columnCount: 30 },
  { sheetId: 22, title: 'Вивантаження 21.10.2026', rowCount: 100, columnCount: 30 },
  { sheetId: 23, title: 'Вивантаження 20.10.2026', rowCount: 100, columnCount: 30 },
  { sheetId: 24, title: 'Вивантаження 18.10.2026', rowCount: 100, columnCount: 30 },
  { sheetId: 25, title: 'Вивантаження старе', rowCount: 10, columnCount: 5 },
];
function fakeGoogle(values = {}) {
  const g = { calls: [], sheetList: async () => TABS, a1q: (s, r) => `'${s}'!${r}` };
  g.getValues = async (id, a1) => { g.calls.push(a1); return values[a1.slice(1, a1.indexOf("'!"))] || []; };
  return g;
}
const mk = (g) => createBuyerSheets({ google: g, sourceId: () => 'SS', now: () => 1000 });

test('colName і trim', () => {
  assert.deepEqual([0, 25, 26, 59].map(colName), ['A', 'Z', 'AA', 'BH']);
  const t = trim([['a', '', ''], ['', 'b'], ['', '', ''], []]);
  assert.equal(t.width, 2);
  assert.deepEqual(t.rows, [['a', ''], ['', 'b']]);
});

test('каталог ВК: є, немає, головний', async () => {
  const l = await mk(fakeGoogle()).list('bakery');
  assert.deepEqual(l.sheets.map((s) => s.key), ['orders', 'summary', 'routes']);
  assert.equal(l.sheets[2].missing, true);
  assert.equal(l.sheets[0].main, true);
  assert.equal(l.sheets[1].gid, 12);
});

test('НБХЗ: три останні дні, новіший - головний', async () => {
  const l = await mk(fakeGoogle()).list('nbhz');
  assert.deepEqual(l.sheets.map((s) => s.key), ['export:21.10.2026', 'export:20.10.2026', 'export:19.10.2026']);
  assert.deepEqual(l.sheets.map((s) => s.main), [true, false, false]);
});

test('read: головний лист за замовчуванням, кеш, fresh', async () => {
  const g = fakeGoogle({ 'Заказы ВК': [['Заказы ВК 21.10'], ['Точка', 'Товар', 'К-ть'], ['Сумська 1', 'Булка', '5', '']] });
  const s = mk(g);
  const d = await s.read('bakery');
  assert.equal(d.title, 'Заказы ВК');
  assert.equal(d.width, 3);
  assert.equal(g.calls[0], "'Заказы ВК'!A1:Z1000");
  await s.read('bakery', 'orders');
  assert.equal(g.calls.length, 1);
  await s.read('bakery', 'orders', { fresh: true });
  assert.equal(g.calls.length, 2);
});

test('xlsxUrl: gid листа; немає листа - помилка', async () => {
  const s = mk(fakeGoogle());
  assert.match((await s.xlsxUrl('bakery', 'summary')).url, /\/d\/SS\/export\?format=xlsx&gid=12$/);
  await assert.rejects(s.xlsxUrl('bakery', 'routes'), /не знайдено/);
});

test('createXlsx: назва файлу і сторінка входу', async () => {
  const at = new Date('2026-10-21T10:00:00Z');
  const ok = (type) => async () => ({ ok: true, status: 200, headers: { get: () => type }, arrayBuffer: async () => new ArrayBuffer(3) });
  const sheets = mk(fakeGoogle());
  const x = createXlsx({ sheets, token: async () => 't', fetchFn: ok('application/vnd.openxmlformats'), at: () => at });
  assert.equal((await x('nbhz', 'export:21.10.2026')).name, 'Вивантаження 21.10.2026.xlsx');
  assert.equal((await x('bakery', 'summary')).name, 'Сводная ВК ' + R.kyivNow(at).dmy + '.xlsx');
  const bad = createXlsx({ sheets, token: async () => 't', fetchFn: ok('text/html; charset=utf-8') });
  await assert.rejects(bad('bakery', 'orders'), /сторінку входу/);
});