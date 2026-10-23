// Архів вигрузок НБХЗ (Export.gs: archiveOldNbhzExports): копія -> перейменування -> звірка -> видалення оригіналу.
const test = require('node:test');
const assert = require('node:assert/strict');
const { archiveOldExports, archiveDaily, exportDayNum } = require('../src/reports/nbhzArchive');

// Таблиці в памʼяті: id -> [{ sheetId, title, values }]
function fakeGoogle(books, { corruptCopy = false } = {}) {
  const log = [];
  let next = 900;
  const find = (id, sheetId) => books[id].find((s) => s.sheetId === sheetId);
  const byTitle = (id, title) => books[id].find((s) => s.title === title);
  return {
    log,
    sheetList: async (id) => books[id].map((s) => ({ sheetId: s.sheetId, title: s.title })),
    getValues: async (id, range) => { const t = range.match(/^'(.*)'!/)[1].replace(/''/g, "'"); return (byTitle(id, t) || { values: [] }).values; },
    copySheetTo: async (id, sheetId, dest) => {
      const src = find(id, sheetId);
      const copy = { sheetId: next++, title: 'Копія аркуша ' + src.title, values: corruptCopy ? src.values.slice(1) : src.values.map((r) => r.slice()) };
      books[dest].push(copy); log.push(['copy', src.title, dest]);
      return { sheetId: copy.sheetId, title: copy.title };
    },
    batchUpdate: async (id, reqs) => {
      reqs.forEach((q) => {
        if (q.updateSheetProperties) { find(id, q.updateSheetProperties.properties.sheetId).title = q.updateSheetProperties.properties.title; log.push(['rename', q.updateSheetProperties.properties.title]); }
        if (q.deleteSheet) { const i = books[id].findIndex((s) => s.sheetId === q.deleteSheet.sheetId); log.push(['delete', id, books[id][i].title]); books[id].splice(i, 1); }
      });
      return {};
    },
  };
}
const sheet = (sheetId, title, values = [['Маршрут', 'Адрес'], ['Рогань', 'Роганская130']]) => ({ sheetId, title, values });
const DAY = '2026-10-19';

test('exportDayNum: лише «Вивантаження дд.мм.рррр»', () => {
  assert.ok(exportDayNum('Вивантаження 16.10.2026') > 0);
  assert.equal(exportDayNum('Вивантаження 1.1.2026'), null);
  assert.equal(exportDayNum('Вивантаження'), null);
  assert.equal(exportDayNum('Завантаження'), null);
  assert.equal(exportDayNum('Копія Вивантаження 16.10.2026'), null);
});

test('переносить листи старші за 2 дні (сьогодні, вчора і позавчора лишаються); порядок: копія, назва, звірка, видалення', async () => {
  const books = {
    work: [sheet(1, 'Завантаження'), sheet(2, 'Вивантаження 19.10.2026'), sheet(3, 'Вивантаження 18.10.2026'), sheet(4, 'Вивантаження 17.10.2026'),
      sheet(5, 'Вивантаження 16.10.2026'), sheet(6, 'Вивантаження 10.10.2026'), sheet(7, 'Вивантаження')],
    arc: [sheet(50, 'Лист1', [])],
  };
  const google = fakeGoogle(books);
  const r = await archiveOldExports({ google, spreadsheetId: 'work', archiveId: 'arc', day: DAY });
  assert.deepEqual([r.moved, r.total, r.failed.length], [2, 2, 0]);
  assert.deepEqual(books.work.map((s) => s.title), ['Завантаження', 'Вивантаження 19.10.2026', 'Вивантаження 18.10.2026', 'Вивантаження 17.10.2026', 'Вивантаження']);
  assert.deepEqual(books.arc.map((s) => s.title), ['Вивантаження 10.10.2026', 'Вивантаження 16.10.2026'], 'старіший перший; порожній стартовий лист прибрано');
  const ops = google.log.map((x) => x[0]);
  assert.deepEqual(ops.slice(0, 3), ['copy', 'rename', 'delete'], 'копія -> перейменування -> видалення оригіналу');
});

test('ім\'я вже зайняте в архіві - додається (2), старе не видаляється', async () => {
  const books = { work: [sheet(5, 'Вивантаження 16.10.2026')], arc: [sheet(60, 'Вивантаження 16.10.2026')] };
  const r = await archiveOldExports({ google: fakeGoogle(books), spreadsheetId: 'work', archiveId: 'arc', day: DAY });
  assert.equal(r.moved, 1);
  assert.deepEqual(books.arc.map((s) => s.title), ['Вивантаження 16.10.2026', 'Вивантаження 16.10.2026 (2)']);
  assert.equal(books.work.length, 0);
});

test('копія не збіглася (рядків менше) - оригінал лишається, невірна копія прибирається, помилка в звіті', async () => {
  const books = { work: [sheet(5, 'Вивантаження 16.10.2026')], arc: [sheet(50, 'Лист1', [])] };
  const r = await archiveOldExports({ google: fakeGoogle(books, { corruptCopy: true }), spreadsheetId: 'work', archiveId: 'arc', day: DAY });
  assert.equal(r.moved, 0);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].error, /копія не збіглася/);
  assert.deepEqual(books.work.map((s) => s.title), ['Вивантаження 16.10.2026']);
  assert.deepEqual(books.arc.map((s) => s.title), ['Лист1'], 'невірної копії в архіві нема');
});

test('таблицю-архів не задано - нічого не чіпаємо', async () => {
  const books = { work: [sheet(5, 'Вивантаження 16.10.2026')] };
  const google = fakeGoogle(books);
  const r = await archiveOldExports({ google, spreadsheetId: 'work', archiveId: '', day: DAY });
  assert.match(r.skipped, /NBHZ_ARCHIVE_SPREADSHEET_ID/);
  assert.equal(r.total, 1);
  assert.equal(google.log.length, 0);
  assert.equal(books.work.length, 1);
});

test('нема що переносити - лише читання списку листів', async () => {
  const books = { work: [sheet(2, 'Вивантаження 19.10.2026')], arc: [] };
  const google = fakeGoogle(books);
  assert.deepEqual(await archiveOldExports({ google, spreadsheetId: 'work', archiveId: 'arc', day: DAY }), { moved: 0, total: 0, failed: [] });
  assert.equal(google.log.length, 0);
});

test('раз на день: другий виклик того ж дня нічого не робить; збій не кидає виняток і не ставить позначку', async () => {
  const books = { w1: [sheet(5, 'Вивантаження 16.10.2026')], a1: [sheet(50, 'Лист1', [])] };
  const google = fakeGoogle(books);
  const r1 = await archiveDaily({ google, spreadsheetId: 'w1', archiveId: 'a1', day: DAY });
  assert.equal(r1.moved, 1);
  const r2 = await archiveDaily({ google, spreadsheetId: 'w1', archiveId: 'a1', day: DAY });
  assert.match(r2.skipped, /вже перевірено/);
  const bad = { sheetList: async () => { throw new Error('Google лежить'); } };
  const r3 = await archiveDaily({ google: bad, spreadsheetId: 'w2', archiveId: 'a2', day: DAY });
  assert.deepEqual(r3, { error: 'Google лежить' });
  const r4 = await archiveDaily({ google: bad, spreadsheetId: 'w2', archiveId: 'a2', day: DAY });
  assert.deepEqual(r4, { error: 'Google лежить' }, 'після збою — повтор');
});
