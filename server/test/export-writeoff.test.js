// Вигрузка списань у лист «Списания»: підмінний Google (лист у пам'яті) і підмінна база.
const test = require('node:test');
const assert = require('node:assert/strict');
const { exportWriteoffs, woRow } = require('../src/export/writeoff');
const { TEST_EXPORT_SPREADSHEET_ID } = require('../src/export/target');

const serial = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh, mm) / 86400000 + 25569;

function makeGoogle(initial = [['ID']], { failFormat = false } = {}) {
  const rows = initial.map((r) => r.slice());
  const calls = [];
  return {
    rows, calls,
    a1q: (t, r) => `'${t}'!${r}`,
    async getValues(id, a1) { calls.push(['get', id, a1]); return rows.map((r) => [r[0] == null ? '' : r[0]]); },
    async sheetIdOf(id, t) { calls.push(['sheetId', id, t]); return 77; },
    async appendValues(id, a1, vals) {
      calls.push(['append', id, a1, vals]);
      const first = rows.length + 1;
      vals.forEach((v) => rows.push(v.slice()));
      return { updates: { updatedRange: `'Списания'!A${first}:N${rows.length}` } };
    },
    async batchUpdate(id, reqs) {
      calls.push(['batch', id, reqs]);
      if (failFormat && reqs.some((q) => q.repeatCell)) throw new Error('timeout of 30000ms exceeded');
      reqs.forEach((q) => {
        if (q.deleteDimension) { const { startIndex, endIndex } = q.deleteDimension.range; rows.splice(startIndex, endIndex - startIndex); }
      });
      return {};
    },
  };
}

function makeData(docs, settings = {}) {
  const pending = docs.slice();
  const marks = [];
  return {
    marks, pending,
    async woExportSnapshot() { return pending.slice(); },
    async woMarkExported(items) {
      marks.push(...items);
      items.forEach((it) => { const i = pending.findIndex((w) => w.id === it.id); if (i >= 0) pending.splice(i, 1); });
    },
    async settings() { return settings; },
  };
}
const env = (g, d, o = {}) => ({ google: g, data: d, mode: 'test', log: () => {}, ...o });

const W = (o = {}) => ({
  id: 'u1', doc_id: 'abc12345', store_id: 'st1', store_label: 'Бучми, 32', store_code: '12', edrpou: '44413718',
  wo_date: '2026-10-19', seller: 'Іваненко', total: 24.6,
  submitted_at: '2026-10-19T09:15:00+00:00', changed_at: '2026-10-19T09:15:00+00:00', deleted_at: null,
  lines: [{ line_no: 1, product_id: '482001', barcode: '482001', category: 'Хліб', name: 'Булка', qty: 2, price: 12.3, amount: 24.6, amount_plus: 29.52 }],
  ...o,
});
const ids = (g) => g.rows.map((r) => String(r[0]).replace(/^'/, ''));

test('живе списання -> 14 колонок як apiWoSubmit_, дата/час числами, текст з апострофом; формат як w01 (186-193); позначка', async () => {
  const g = makeGoogle(); const d = makeData([W()]);
  const out = await exportWriteoffs(env(g, d));
  assert.deepEqual(out['44413718'], { deleted: 0, appended: 1, marked: 1 });
  const ap = g.calls.find((c) => c[0] === 'append');
  assert.equal(ap[1], TEST_EXPORT_SPREADSHEET_ID);
  assert.equal(ap[2], "'Списания'!A1");
  assert.deepEqual(ap[3], [["'abc12345", serial(2026, 10, 19, 12, 15), serial(2026, 10, 19, 12), "'Бучми, 32", "'12",
    "'Хліб", "'482001", "'Булка", 2, 12.3, 24.6, 29.52, "'Іваненко", "'st1"]]);
  const fmt = g.calls.filter((c) => c[0] === 'batch').pop()[2].map((q) => q.repeatCell);
  assert.deepEqual(fmt.map((r) => [r.range.startColumnIndex, r.range.endColumnIndex, r.cell.userEnteredFormat.numberFormat.pattern,
    r.range.startRowIndex, r.range.endRowIndex, r.range.sheetId]), [
    [0, 1, '@', 1, 2, 77], [1, 2, 'dd.MM.yyyy HH:mm', 1, 2, 77], [2, 3, 'dd.MM.yyyy', 1, 2, 77], [4, 6, '@', 1, 2, 77],
    [6, 7, '@', 1, 2, 77], [8, 9, '0.###', 1, 2, 77], [9, 12, '0.00', 1, 2, 77], [12, 13, '@', 1, 2, 77]]);
  assert.deepEqual(d.marks, [{ id: 'u1', changed_at: W().changed_at }]);
});

test('вбитий прогін: ID уже в листі -> не дописується, позначка ставиться', async () => {
  const g = makeGoogle([['ID'], ['abc12345']]); const d = makeData([W()]);
  const out = await exportWriteoffs(env(g, d));
  assert.equal(out['44413718'].appended, 0);
  assert.equal(g.calls.some((c) => c[0] === 'append'), false);
  assert.equal(d.marks.length, 1);
});

test('видалене -> усі рядки з цим ID знизу вгору одним шматком, інші не чіпані', async () => {
  const g = makeGoogle([['ID'], ['zzz11111'], ['abc12345'], ['abc12345'], ['yyy22222']]);
  const d = makeData([W({ deleted_at: '2026-10-19T09:30:00+00:00', changed_at: '2026-10-19T09:30:00+00:00' })]);
  const out = await exportWriteoffs(env(g, d));
  assert.deepEqual(out['44413718'], { deleted: 2, appended: 0, marked: 1 });
  assert.deepEqual(ids(g), ['ID', 'zzz11111', 'yyy22222']);
  const del = g.calls.find((c) => c[0] === 'batch')[2];
  assert.deepEqual(del, [{ deleteDimension: { range: { sheetId: 77, dimension: 'ROWS', startIndex: 2, endIndex: 4 } } }]);
});

test('видалене і ніколи не вигружене -> лист не змінюється, лише позначка', async () => {
  const g = makeGoogle([['ID'], ['zzz11111']]);
  const d = makeData([W({ deleted_at: '2026-10-19T09:30:00+00:00' })]);
  await exportWriteoffs(env(g, d));
  assert.equal(g.calls.some((c) => c[0] === 'batch' || c[0] === 'append'), false);
  assert.equal(d.marks.length, 1);
});

test('видалили і подали знову з тим самим ID -> старі рядки геть, нові дописано', async () => {
  const g = makeGoogle([['ID'], ['abc12345']]);
  const d = makeData([W({ id: 'u1', deleted_at: '2026-10-19T09:30:00+00:00' }), W({ id: 'u2', submitted_at: '2026-10-19T09:40:00+00:00' })]);
  await exportWriteoffs(env(g, d));
  assert.deepEqual(ids(g), ['ID', 'abc12345']);
  assert.equal(g.rows[1][1], serial(2026, 10, 19, 12, 40));
  assert.deepEqual(d.marks.map((m) => m.id).sort(), ['u1', 'u2']);
});

test('видаляються всі рядки даних -> спершу запасний рядок (як insertRowsAfter у woDeleteDoc_)', async () => {
  const g = makeGoogle([['ID'], ['abc12345']]);
  const d = makeData([W({ deleted_at: '2026-10-19T09:30:00+00:00' })]);
  await exportWriteoffs(env(g, d));
  const reqs = g.calls.find((c) => c[0] === 'batch')[2];
  assert.deepEqual(reqs[0], { appendDimension: { sheetId: 77, dimension: 'ROWS', length: 1 } });
  assert.ok(reqs[1].deleteDimension);
});

test('live: таблиця з settings.wo_books за ЄДРПОУ (порожнє = 44413718); немає таблиці -> помилка, без позначки, інші вигружені', async () => {
  const g = makeGoogle();
  const d = makeData([W({ edrpou: '' }), W({ id: 'u3', doc_id: 'ua000001', edrpou: '45672783' }), W({ id: 'u4', doc_id: 'xx000001', edrpou: '12345678' })],
    { wo_books: { 44413718: { id: 'BOOK-FM' }, 45672783: { id: 'BOOK-UA' } } });
  const out = await exportWriteoffs(env(g, d, { mode: 'live' }));
  assert.match(out['12345678'].error, /немає таблиці списань/);
  assert.deepEqual(g.calls.filter((c) => c[0] === 'append').map((c) => c[1]).sort(), ['BOOK-FM', 'BOOK-UA']);
  assert.deepEqual(d.marks.map((m) => m.id).sort(), ['u1', 'u3']);
});

test('нічого невигруженого -> до Google не звертаємось', async () => {
  const g = makeGoogle(); const d = makeData([]);
  assert.deepEqual(await exportWriteoffs(env(g, d)), {});
  assert.equal(g.calls.length, 0);
});

test('збій формату після запису -> позначка все одно (інакше наступний прогін не допише і формат не повторить), лог', async () => {
  const logs = [];
  const g = makeGoogle([['ID']], { failFormat: true }); const d = makeData([W()]);
  await exportWriteoffs(env(g, d, { log: (m) => logs.push(m) }));
  assert.equal(d.marks.length, 1);
  assert.match(logs.join('\n'), /формат списань/);
});

test('два прогони одночасно -> мʼютекс, рядки не дублюються', async () => {
  const g = makeGoogle(); const d = makeData([W()]);
  await Promise.all([exportWriteoffs(env(g, d)), exportWriteoffs(env(g, d))]);
  assert.equal(g.calls.filter((c) => c[0] === 'append').length, 1);
  assert.equal(g.rows.length, 2);
});

test('woRow: текст, що починається з =, не стає формулою; порожнє - порожнє', () => {
  const r = woRow(W({ seller: '=HYPERLINK("x")', store_code: '' }), W().lines[0]);
  assert.equal(r[12], "'=HYPERLINK(\"x\")");
  assert.equal(r[4], '');
});