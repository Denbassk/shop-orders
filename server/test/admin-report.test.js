// Пульт, крок 3в: admReport_, admXlsxUrl_/admSheetUrl_, reportAt_ (app/Admin.gs), текст findStore_.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { admReport, admStore, reportAtOf } = require('../src/admin/read');
const { createLinks } = require('../src/admin/links');
const { createAdminData } = require('../src/admin/data');
const { DIRECTIONS } = require('../src/directions');

const AT = new Date('2026-10-20T10:30:00+03:00');
const target = { mode: 'test', spreadsheetId: () => 'TEST_ID' };
const U = 'https://docs.google.com/spreadsheets/d/';

test('links: лист звіту напрямку -> xlsx з gid (0 теж), НБХЗ - лист дня; нема листа/збій/невідомий -> порожньо', async () => {
  const asked = [];
  const l = createLinks({ target, at: () => AT, sheetIdOf: async (id, name) => { asked.push([id, name]); return name === 'Заказы' ? 0 : name === 'Вивантаження 20.10.2026' ? 77 : null; } });
  assert.equal(await l.sheetUrl('bread'), U + 'TEST_ID/edit');
  assert.equal(await l.xlsx('bread'), U + 'TEST_ID/export?format=xlsx&gid=0');
  assert.equal(await l.xlsx('nbhz'), U + 'TEST_ID/export?format=xlsx&gid=77');
  assert.equal(await l.xlsx('veg'), '');
  assert.equal(await l.xlsx('zzz'), '');
  assert.deepEqual(asked.map((a) => a[1]), ['Заказы', 'Вивантаження 20.10.2026', 'Замовлення Овочі']);
  const bad = createLinks({ target, at: () => AT, sheetIdOf: async () => { throw new Error('x'); } });
  assert.equal(await bad.xlsx('bakery'), '');
  const live = createLinks({ target: { mode: 'live', spreadsheetId: (d) => DIRECTIONS[d].spreadsheetId }, at: () => AT, sheetIdOf: async (id, name) => (name === 'Заказы ВК' ? 5 : null) });
  assert.equal(await live.xlsx('bakery'), U + DIRECTIONS.bakery.spreadsheetId + '/export?format=xlsx&gid=5');
});

test('reportAtOf: сьогодні -> HH:mm за Києвом, інший день/порожньо/сміття -> ""', () => {
  assert.equal(reportAtOf('2026-10-20T07:05:00Z', AT), '10:05');
  assert.equal(reportAtOf('2026-10-19T20:59:00Z', AT), '');
  assert.equal(reportAtOf('', AT), ''); assert.equal(reportAtOf(null, AT), ''); assert.equal(reportAtOf('abc', AT), '');
});

function env(over = {}) {
  const calls = { rebuild: [], log: [], set: [] };
  return { at: AT, calls,
    data: { directions: async () => DIRECTIONS },
    adm: { setReportAt: async (d, iso) => { calls.set.push([d, iso]); }, adminLog: async (a, d) => { calls.log.push([a, d]); } },
    rebuild: async (dir, o) => { calls.rebuild.push([dir, o]); return { rows: 3 }; },
    links: { xlsx: async (d) => 'X-' + d }, ...over };
}

test('report: перебудова з force, час збирання, журнал «Зібрано звіт» + назва, відповідь {at, xlsx}', async () => {
  const e = env();
  assert.deepEqual(await admReport({ dir: 'veg' }, e), { at: '10:30', xlsx: 'X-veg' });
  assert.deepEqual(e.calls.rebuild, [['veg', { force: true }]]);
  assert.deepEqual(e.calls.set, [['veg', AT.toISOString()]]);
  assert.deepEqual(e.calls.log, [['Зібрано звіт', 'Овочі і фрукти']]);
});

test('report: невідомий/порожній напрямок -> помилка без перебудови; збій перебудови -> помилка без журналу', async () => {
  const e = env();
  await assert.rejects(admReport({ dir: 'zzz' }, e), /Невідомий напрямок/);
  await assert.rejects(admReport({}, e), /Невідомий напрямок/);
  assert.equal(e.calls.rebuild.length, 0);
  const f = env({ rebuild: async () => { throw new Error('Google лежить'); } });
  await assert.rejects(admReport({ dir: 'bread' }, f), /Google лежить/);
  assert.equal(f.calls.log.length, 0); assert.equal(f.calls.set.length, 0);
});

test('report: збій журналу/часу збирання не ламає звіт (adminLog_ і markReport_ ковтають помилку)', async () => {
  const e = env({ adm: { setReportAt: async () => { throw new Error('a'); }, adminLog: async () => { throw new Error('b'); } }, links: undefined });
  assert.deepEqual(await admReport({ dir: 'nbhz' }, e), { at: '10:30', xlsx: '' });
});

test('store: нема точки -> текст findStore_ дослівно', async () => {
  const e = { at: AT, data: { stores: async () => [], settings: async () => ({}), directions: async () => DIRECTIONS, orderedToday: async () => ({}) }, adm: { dayOrders: async () => [] } };
  await assert.rejects(admStore({ storeId: 'x' }, e), { message: 'Торгову точку не знайдено. Оновіть сторінку.' });
});

function fakeSb(respond) {
  const calls = [];
  const sb = { from(table) {
    const q = { table, ops: [] }; calls.push(q);
    const b = new Proxy({}, { get(_, k) {
      if (k === 'then') return (res, rej) => Promise.resolve(respond(q)).then(res, rej);
      return (...a) => { q.ops.push([k, ...a]); return b; };
    } });
    return b;
  } };
  return { sb, calls };
}
const has = (q, op, ...a) => q.ops.some((o) => o[0] === op && JSON.stringify(o.slice(1, 1 + a.length)) === JSON.stringify(a));

test('admin/data: reportAts (settings report_at_*), setReportAt (upsert), adminLog (insert у admin_log)', async () => {
  const { sb, calls } = fakeSb((q) => (q.ops.some((o) => o[0] === 'select')
    ? { data: [{ key: 'report_at_bread', value: '2026-10-20T07:05:00.000Z' }, { key: 'report_at_veg', value: 'x' }], error: null }
    : { data: null, error: null }));
  const d = createAdminData(sb);
  assert.deepEqual(await d.reportAts(), { bread: '2026-10-20T07:05:00.000Z', veg: 'x' });
  assert.equal(calls[0].table, 'settings'); assert.ok(has(calls[0], 'like', 'key', 'report_at_%'));
  await d.setReportAt('bread', 'ISO');
  assert.deepEqual(calls[1].ops.find((o) => o[0] === 'upsert')[1], { key: 'report_at_bread', value: 'ISO' });
  await d.adminLog('Зібрано звіт', 'Хліб Рома');
  assert.equal(calls[2].table, 'admin_log');
  assert.deepEqual(calls[2].ops.find((o) => o[0] === 'insert')[1], { action: 'Зібрано звіт', details: 'Хліб Рома' });
});

test('runtime пульта: report, посилання, перебудова звітів, reportAt підключені', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/admin/runtime.js'), 'utf8');
  assert.match(src, /report: \(p\) => read\.admReport\(p,/);
  assert.match(src, /createLinks\(/);
  assert.match(src, /rebuildReports\(dir, reportEnv\(\), o\)/);
  assert.match(src, /reportAt: /);
});