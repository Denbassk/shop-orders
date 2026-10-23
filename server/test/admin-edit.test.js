const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECTIONS } = require('../src/directions');
const W = require('../src/admin/write');
const { createAdminData } = require('../src/admin/data');

const AT = new Date('2026-10-20T10:00:00+03:00');
const DAY = '2026-10-20';
const T = DIRECTIONS.bread.title;
const STALE = (n) => ({ message: 'Рядок «' + n + '» змінився з моменту відкриття. Оновіть екран.' });
const LINES = () => [
  { id: 11, order_pk: 'o1', name: 'Батон', qty: 5 },
  { id: 12, order_pk: 'o1', name: 'Хліб', qty: 3 },
  { id: 21, order_pk: 'o2', name: 'Булка', qty: 2 },
];
function mkEnv(lines = LINES(), { failId } = {}) {
  const st = { log: [], q: [], set: [], del: [], touch: null, read: 0 };
  const env = { at: AT, log: () => {},
    data: { stores: async () => [{ id: 's1', label: 'Магазин 1' }] },
    adm: {
      adminLog: async (a, d) => { st.log.push([a, d]); },
      dayStoreLines: async (...a) => { st.read++; st.readArgs = a; return lines; },
      setLineQty: async (...a) => { st.set.push(a); return a[0] !== failId; },
      deleteLine: async (...a) => { st.del.push(a); return a[0] !== failId; },
      touchOrders: async (ids, emptied) => { st.touch = [ids, emptied]; },
    },
    queueExport: (d) => st.q.push(d) };
  return { env, st };
}
function fakeSb(responses) {
  const calls = [];
  return { calls, from(table) {
    const c = { table, ops: [] }; calls.push(c);
    const b = new Proxy({}, { get(_, k) {
      if (k === 'then') { const r = responses.shift() || { data: [], error: null }; return (ok, bad) => Promise.resolve(r).then(ok, bad); }
      return (...a) => { c.ops.push([k, ...a]); return b; };
    } });
    return b;
  } };
}

test('editOrder: зміна і прибирання рядка, журнал дослівно, вигрузка в черзі', async () => {
  const { env, st } = mkEnv();
  const r = await W.admEditOrder({ storeId: 's1', dir: 'bread', changes: [
    { row: 11, name: 'Батон', oldQty: 5, qty: 7 }, { row: 12, name: 'Хліб', oldQty: 3, qty: 0 }] }, env);
  assert.deepEqual(r, { changed: 2, left: 2 });
  assert.deepEqual(st.readArgs, ['bread', 's1', DAY]);
  assert.deepEqual(st.set, [[11, 5, 7]]);
  assert.deepEqual(st.del, [[12, 3]]);
  assert.deepEqual(st.touch, [['o1'], []]);
  assert.deepEqual(st.q, ['bread']);
  assert.deepEqual(st.log, [['Змінено замовлення', T + ' / Магазин 1: Батон: 5 → 7; Хліб: прибрано (було 3)']]);
});

test('editOrder: без змін -> «Змін немає», база не читається', async () => {
  const { env, st } = mkEnv();
  await assert.rejects(W.admEditOrder({ storeId: 's1', dir: 'bread', changes: [{ row: 11, name: 'Батон', oldQty: 5, qty: 5 }] }, env), { message: 'Змін немає' });
  await assert.rejects(W.admEditOrder({ storeId: 's1', dir: 'bread' }, env), { message: 'Змін немає' });
  assert.equal(st.read, 0);
});

test('editOrder: перевірки рядка/кількості - тексти як в AdminTools.gs', async () => {
  const { env, st } = mkEnv();
  const go = (changes, dir = 'bread') => W.admEditOrder({ storeId: 's1', dir, changes }, env);
  await assert.rejects(go([{ row: 'x', name: 'Батон', oldQty: 5, qty: 1 }]), { message: 'Невірний рядок' });
  await assert.rejects(go([{ row: 11, name: 'Батон', oldQty: 5, qty: 7 }, { row: 11, name: 'Батон', oldQty: 5, qty: 8 }]), { message: 'Рядок 11 указано двічі' });
  await assert.rejects(go([{ row: 11, name: 'Батон', oldQty: 5, qty: -1 }]), { message: 'Невірна кількість: Батон' });
  await assert.rejects(go([{ row: 11, name: 'Батон', oldQty: 5, qty: 1.5 }]), { message: 'Кількість має бути цілою: Батон' });
  await assert.rejects(go([{ row: 11, name: 'Батон', oldQty: 5, qty: 1 }], 'xx'), { message: 'Невідомий напрямок: "xx"' });
  await assert.rejects(W.admEditOrder({ storeId: 'nope', dir: 'bread', changes: [] }, env), { message: 'Торгову точку не знайдено. Оновіть сторінку.' });
  assert.equal(st.read, 0);
});

test('editOrder: овочі - дробова кількість, округлення до 0,001', async () => {
  const { env, st } = mkEnv();
  await W.admEditOrder({ storeId: 's1', dir: 'veg', changes: [{ row: 11, name: 'Батон', oldQty: 5, qty: 1.2345 }] }, env);
  assert.deepEqual(st.set, [[11, 5, 1.235]]);
});

test('editOrder: рядка нема / назва чи стара кількість інші -> помилка, нічого не записано', async () => {
  const { env, st } = mkEnv();
  const go = (c) => W.admEditOrder({ storeId: 's1', dir: 'bread', changes: [c] }, env);
  await assert.rejects(go({ row: 99, name: 'X', oldQty: 1, qty: 2 }), { message: 'Рядок «X» вже не на місці. Оновіть екран.' });
  await assert.rejects(go({ row: 11, name: 'Інше', oldQty: 5, qty: 2 }), STALE('Інше'));
  await assert.rejects(go({ row: 11, name: 'Батон', oldQty: 4, qty: 2 }), STALE('Батон'));
  assert.equal(st.set.length + st.del.length, 0); assert.equal(st.touch, null); assert.equal(st.q.length, 0);
});

test('editOrder: усе прибрано -> left 0, замовлення скасовуються, приписка в журналі; видалення знизу вгору', async () => {
  const { env, st } = mkEnv();
  const r = await W.admEditOrder({ storeId: 's1', dir: 'bread', changes: [
    { row: 11, name: 'Батон', oldQty: 5, qty: 0 }, { row: 12, name: 'Хліб', oldQty: 3, qty: 0 }, { row: 21, name: 'Булка', oldQty: 2, qty: 0 }] }, env);
  assert.deepEqual(r, { changed: 3, left: 0 });
  assert.deepEqual(st.del.map((d) => d[0]), [21, 12, 11]);
  assert.deepEqual(st.touch.map((a) => a.slice().sort()), [['o1', 'o2'], ['o1', 'o2']]);
  assert.equal(st.log[0][1], T + ' / Магазин 1: Булка: прибрано (було 2); Хліб: прибрано (було 3); Батон: прибрано (було 5) - замовлення порожнє, позначку знято');
});

test('editOrder: паралельна зміна посеред запису -> помилка, але вже записане позначено для вигрузки', async () => {
  const { env, st } = mkEnv(LINES(), { failId: 12 });
  await assert.rejects(W.admEditOrder({ storeId: 's1', dir: 'bread', changes: [
    { row: 11, name: 'Батон', oldQty: 5, qty: 6 }, { row: 12, name: 'Хліб', oldQty: 3, qty: 4 }] }, env), STALE('Хліб'));
  assert.deepEqual(st.touch, [['o1'], []]);
  assert.deepEqual(st.q, ['bread']);
  assert.equal(st.log.length, 0);
});

test('data: dayStoreLines / setLineQty / deleteLine - запити і умова на стару кількість', async () => {
  const sb = fakeSb([
    { data: [{ id: 'o1', order_lines: [{ id: 11, name: 'Батон', qty: '5.000' }] }], error: null },
    { data: [{ id: 11 }], error: null },
    { data: [], error: null },
  ]);
  const a = createAdminData(sb);
  assert.deepEqual(await a.dayStoreLines('bread', 's1', DAY), [{ id: 11, order_pk: 'o1', name: 'Батон', qty: 5 }]);
  assert.deepEqual(sb.calls[0].ops.filter((o) => o[0] === 'eq'),
    [['eq', 'dir', 'bread'], ['eq', 'store_id', 's1'], ['eq', 'order_date', DAY], ['eq', 'status', 'active']]);
  assert.equal(await a.setLineQty(11, 5, 7), true);
  const u = sb.calls[1];
  assert.equal(u.table, 'order_lines');
  assert.deepEqual(u.ops.find((o) => o[0] === 'update')[1], { qty: 7 });
  assert.ok(u.ops.some((o) => o[0] === 'eq' && o[1] === 'qty' && o[2] === 5));
  assert.equal(await a.deleteLine(12, 3), false);
  assert.ok(sb.calls[2].ops.some((o) => o[0] === 'delete'));
});

test('data: touchOrders - changed_at для змінених, cancelled для порожніх; нічого -> без запитів', async () => {
  const sb = fakeSb([]);
  const a = createAdminData(sb);
  await a.touchOrders(['o1', 'o2'], ['o2']);
  assert.equal(sb.calls.length, 2);
  const u1 = sb.calls[0].ops.find((o) => o[0] === 'update')[1];
  assert.ok(u1.changed_at && !u1.status);
  assert.deepEqual(sb.calls[0].ops.find((o) => o[0] === 'in'), ['in', 'id', ['o1']]);
  assert.equal(sb.calls[1].ops.find((o) => o[0] === 'update')[1].status, 'cancelled');
  assert.deepEqual(sb.calls[1].ops.find((o) => o[0] === 'in'), ['in', 'id', ['o2']]);
  const sb2 = fakeSb([]);
  await createAdminData(sb2).touchOrders([], []);
  assert.equal(sb2.calls.length, 0);
});

test('batch: лише дозволені читання, не більше 8, чужі -> not allowed', async () => {
  const call = async (a, p) => ({ ok: true, data: a + JSON.stringify(p) });
  const calls = [{ a: 'today' }, { a: 'cancelOrder' }, null, { a: 'store', p: { storeId: 's1' } },
    { a: 'log' }, { a: 'log' }, { a: 'log' }, { a: 'log' }, { a: 'log' }];
  const r = await W.admBatch({ calls }, call);
  assert.equal(r.length, 8);
  assert.deepEqual(r[0], { ok: true, data: 'today{}' });
  assert.deepEqual(r[1], { ok: false, error: 'not allowed' });
  assert.deepEqual(r[2], { ok: false, error: 'not allowed' });
  assert.deepEqual(r[3], { ok: true, data: 'store{"storeId":"s1"}' });
  assert.deepEqual(await W.admBatch({}, call), []);
});

test('runtime: editOrder і batch підключені; restore/dup не переносяться', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/admin/runtime.js'), 'utf8');
  assert.ok(src.includes('editOrder:')); assert.ok(src.includes('batch:'));
  for (const a of ['restoreScan:', 'restoreApply:', 'dupScan:', 'dupApply:', 'clearMark:']) assert.ok(!src.includes(a), a);
});