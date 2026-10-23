const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../src/rules');
const { createBuyerSheets, colName, trim } = require('../src/buyer/sheets');
const { createXlsx } = require('../src/buyer/xlsx');

const TABS = [
  { sheetId: 11, title: 'Заказы ВК', rowCount: 1000, columnCount: 26 },
  { sheetId: 12, title: 'Сводная ВК', rowCount: 500, columnCount: 10 },
  { sheetId: 13, title: 'Списания', rowCount: 200, columnCount: 8 },
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

test('каталог ВК: звіти (є/немає), службові - лише наявні', async () => {
  const l = await mk(fakeGoogle()).list('bakery');
  const rep = l.sheets.filter((s) => s.group === 'report');
  assert.deepEqual(rep.map((s) => s.key), ['orders', 'summary', 'routes']);
  assert.equal(rep[2].missing, true);
  assert.equal(rep[0].main, true);
  assert.equal(rep[1].gid, 12);
  assert.deepEqual(l.sheets.filter((s) => s.group === 'extra').map((s) => s.key), [], 'Списания в таблиці є, але на «Звіти» не показується - окрема вкладка');
});

test('НБХЗ: три останні дні, новіший - головний', async () => {
  const l = await mk(fakeGoogle()).list('nbhz');
  const ex = l.sheets.filter((s) => s.key.startsWith('export'));
  assert.deepEqual(ex.map((s) => s.key), ['export:21.10.2026', 'export:20.10.2026', 'export:19.10.2026']);
  assert.deepEqual(ex.map((s) => s.main), [true, false, false]);
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

test('сторінка: вкладка «Звіти» читає листи Google', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  assert.match(h, /call\('sheets'/);
  assert.match(h, /call\('sheet'/);
  assert.ok(h.includes("'?key=' + encodeURIComponent"));
});
test('вкладка «Звіти»: журнали (помилок, видалених), асортимент і списання не показуються ні в одному напрямку', () => {
  const { CATALOG } = require('../src/buyer/sheets');
  for (const [dir, list] of Object.entries(CATALOG)) {
    for (const c of list) {
      assert.ok(!['errors', 'deleted', 'assort', 'writeoffs'].includes(c.key), dir + ': ' + c.key);
      assert.ok(!/^_Лог|Журнал|Видалення|Ассортимент|Списания/.test(c.sheet || ''), dir + ': ' + c.sheet);
    }
  }
  assert.deepEqual(CATALOG.bakery.map((c) => c.key), ['orders', 'summary', 'routes', 'addr']);
});
