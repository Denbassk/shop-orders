// Пульт, крок 3б: admDirStores_, admStore_, admLogRead_ (app/Admin.gs) - з бази замість сирого листа.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { admDirStores, admStore, admLogRead } = require('../src/admin/read');
const { createAdminData } = require('../src/admin/data');

const AT = new Date('2026-10-20T10:30:00+03:00');           // вівторок
const DIRS = {
  bread: { key: 'bread', title: 'Хліб', unit: 'шт', deadline: '16:00' },
  veg: { key: 'veg', title: 'Овочі', unit: 'кг', deadline: '18:00', orderDays: true },
};
const S1 = { id: 's1', label: 'Бучми, 32', address: 'Бучми, 32', code: '101', route: 'R1', zone: 'Z1', edrpou: '44413718', directions: ['bread', 'veg'], days: { veg: [2] } };
const S2 = { id: 's2', label: 'Астрономічна, 44', address: 'Астрономічна, 44', code: '202', route: 'R2', zone: '', edrpou: '45672783', directions: ['bread', 'veg'], days: { veg: [3] } };
const S3 = { id: 's3', label: 'Героїв Праці, 7', address: 'Героїв Праці, 7', code: '303', route: '', zone: '', edrpou: '', directions: ['veg'], days: { veg: [] } };
const ORD = {
  bread: [{ id: 'o1', store_id: 's2', created_at: '2026-10-20T06:00:00Z', lines: [{ id: 11, line_no: 1, name: 'Батон', qty: '3' }, { id: 12, line_no: 2, name: 'Хліб', qty: 2.5 }] }],
  veg: [
    { id: 'o2', store_id: 's1', created_at: '2026-10-20T05:10:00Z', lines: [{ id: 21, line_no: 1, name: 'Картопля', qty: 0.1 }] },
    { id: 'o3', store_id: 's1', created_at: '2026-10-20T06:45:00Z', lines: [{ id: 31, line_no: 1, name: 'Цибуля', qty: 0.2 }, { id: 32, line_no: 2, name: 'Морква', qty: 1 }] },
    { id: 'o4', store_id: 's3', created_at: '2026-10-20T07:00:00Z', lines: [{ id: 41, line_no: 1, name: 'Буряк', qty: 2 }] }],
};
function env({ at = AT, late = [], links } = {}) {
  return { at, links,
    data: { stores: async () => [S1, S2, S3], settings: async () => ({}), directions: async () => DIRS,
      orderedToday: async () => ({ bread: new Set(['s2']), veg: new Set(['s1', 's3']) }),
      lateRows: async (dir, id) => late.filter((r) => r.dir === dir && r.store_id === id) },
    adm: { dayOrders: async (dir, day) => { assert.equal(day, '2026-10-20'); return ORD[dir] || []; }, logRows: async () => [] } };
}

test('dirStores bread: done/wait, n = рядки, qty сума, без часу для хліба', async () => {
  const r = await admDirStores({ dir: 'bread' }, env());
  assert.deepEqual([r.dir, r.title, r.unit, r.byDays, r.dow, r.xlsx, r.sheetUrl], ['bread', 'Хліб', 'шт', false, 'вторник', '', '']);
  assert.deepEqual(r.done, [{ id: 's2', label: 'Астрономічна, 44', ua: true, code: '202', route: 'R2', n: 2, qty: 5.5, time: '', days: 'каждый день', next: '', dayOk: true }]);
  assert.deepEqual(r.wait, [{ id: 's1', label: 'Бучми, 32', ua: false, code: '101', route: 'R1', n: 0, qty: 0, time: '', days: 'каждый день', next: '', dayOk: true }]);
  assert.deepEqual(r.off, []);
});

test('dirStores veg: час останнього замовлення (Київ), done за часом спадно, не їхній день - off, qty до 0,001', async () => {
  const v = await admDirStores({ dir: 'veg' }, env());
  assert.deepEqual(v.done.map((x) => [x.id, x.n, x.qty, x.time]), [['s3', 1, 2, '10:00'], ['s1', 3, 1.3, '09:45']]);
  assert.deepEqual(v.off.map((x) => [x.id, x.days, x.next, x.dayOk]), [['s2', 'Ср', 'завтра', false]]);
  assert.equal(v.wait.length, 0); assert.equal(v.byDays, true);
});

test('dirStores: посилання з env.links, збій посилання -> порожньо; невідомий напрямок - помилка', async () => {
  const a = await admDirStores({ dir: 'bread' }, env({ links: { xlsx: async (d) => 'X-' + d, sheetUrl: async () => { throw new Error('нема'); } } }));
  assert.equal(a.xlsx, 'X-bread'); assert.equal(a.sheetUrl, '');
  await assert.rejects(admDirStores({ dir: 'zzz' }, env()), /Невідомий напрямок/);
});

test('store: рядки (row = id рядка в базі), сума, marked, dayOk, графік, дозвіл (lateLeft)', async () => {
  const r = await admStore({ storeId: 's1', dir: 'veg' }, env({ late: [{ dir: 'veg', store_id: 's1', requested_at: '2026-10-20T07:15:00Z', approved_at: '2026-10-20T07:20:00Z' }] }));
  assert.deepEqual(r.rows, [{ row: 21, name: 'Картопля', qty: 0.1 }, { row: 31, name: 'Цибуля', qty: 0.2 }, { row: 32, name: 'Морква', qty: 1 }]);
  assert.deepEqual([r.qty, r.firstRow, r.marked, r.dayOk, r.closed, r.lateLeft], [1.3, 21, true, true, false, 20]);
  assert.deepEqual([r.id, r.label, r.ua, r.code, r.route, r.zone, r.dir, r.dirTitle, r.unit, r.today, r.sheet], ['s1', 'Бучми, 32', false, '101', 'R1', 'Z1', 'veg', 'Овочі', 'кг', '20.10.2026', '']);
  assert.deepEqual(r.directions, ['bread', 'veg']);
  assert.deepEqual(r.schedule, [
    { dir: 'bread', title: 'Хліб', deadline: '16:00', days: 'каждый день', today: true, next: '' },
    { dir: 'veg', title: 'Овочі', deadline: '18:00', days: 'Вт', today: true, next: 'в вторник' }]);
});

test('store: напрямок за замовчуванням - перший точки; після дедлайну closed; без замовлень - порожньо; нема точки - помилка', async () => {
  const b = await admStore({ storeId: 's2' }, env({ at: new Date('2026-10-20T16:30:00+03:00') }));
  assert.deepEqual([b.dir, b.closed, b.marked, b.rows.length, b.qty, b.lateLeft], ['bread', true, true, 2, 5.5, 0]);
  const c = await admStore({ storeId: 's1', dir: 'bread' }, env());
  assert.deepEqual([c.rows, c.qty, c.firstRow, c.marked], [[], 0, 0, false]);
  await assert.rejects(admStore({ storeId: 'nope' }, env()));
});

test('log: 30 останніх, нові першими, час Києва dd.MM.yyyy HH:mm', async () => {
  const e = env();
  e.adm.logRows = async (n) => { assert.equal(n, 30); return [
    { at: '2026-10-20T07:05:00Z', action: 'Зібрано звіт', details: 'Хліб' },
    { at: '2026-10-19T21:30:00Z', action: 'Вимкнено напрямок', details: null }]; };
  assert.deepEqual(await admLogRead(e), [
    { when: '20.10.2026 10:05', what: 'Зібрано звіт', details: 'Хліб' },
    { when: '20.10.2026 00:30', what: 'Вимкнено напрямок', details: '' }]);
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

test('admin/data: dayOrders - активні напрямку за день за created_at, рядки за line_no; logRows - нові першими', async () => {
  const { sb, calls } = fakeSb((q) => (q.table === 'orders'
    ? { data: [{ id: 'o1', store_id: 's1', created_at: 'x', order_lines: [{ id: 2, line_no: 2 }, { id: 1, line_no: 1 }] }], error: null }
    : { data: [{ at: 'a' }], error: null }));
  const d = createAdminData(sb);
  const o = await d.dayOrders('veg', '2026-10-20');
  assert.deepEqual(o[0].lines.map((l) => l.id), [1, 2]);
  assert.equal('order_lines' in o[0], false);
  assert.ok(has(calls[0], 'eq', 'dir', 'veg')); assert.ok(has(calls[0], 'eq', 'order_date', '2026-10-20'));
  assert.ok(has(calls[0], 'eq', 'status', 'active')); assert.ok(has(calls[0], 'order', 'created_at'));
  assert.deepEqual(await d.logRows(30), [{ at: 'a' }]);
  assert.equal(calls[1].table, 'admin_log');
  assert.ok(has(calls[1], 'order', 'at', { ascending: false })); assert.ok(has(calls[1], 'limit', 30));
  const bad = createAdminData(fakeSb(() => ({ data: null, error: { message: 'down' } })).sb);
  await assert.rejects(bad.dayOrders('veg', 'x'), /down/);
});

test('runtime пульта: dirStores, store, log підключені, createAdminData', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/admin/runtime.js'), 'utf8');
  assert.match(src, /dirStores: \(p\) => read\.admDirStores\(p,/);
  assert.match(src, /store: \(p\) => read\.admStore\(p,/);
  assert.match(src, /log: \(\) => read\.admLogRead\(/);
  assert.match(src, /createAdminData\(sb\)/);
});