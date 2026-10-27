// data.activeOrderLines: зведення активних замовлень пари за день на підмінному Supabase (справжню базу не чіпає).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createData } = require('../src/data');

function fakeSb(rows) {
  const calls = [];
  const sb = { from(table) {
    const q = { table, ops: [] }; calls.push(q);
    const b = new Proxy({}, { get(_, k) {
      if (k === 'then') return (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej);
      return (...a) => { q.ops.push([k, ...a]); return b; };
    } });
    return b;
  } };
  return { sb, calls };
}
const has = (q, op, ...a) => q.ops.some((o) => o[0] === op && JSON.stringify(o.slice(1, 1 + a.length)) === JSON.stringify(a));

test('activeOrderLines: фільтр по парі, дню і status=active; рядки основного замовлення і добавки зведені за товаром', async () => {
  const rows = [
    { is_addon: false, order_lines: [{ line_no: 2, product_id: '222', name: 'Багет', price: '50.50', qty: '2.000' }, { line_no: 1, product_id: '111', name: 'Батон', price: '100', qty: '5.000' }] },
    { is_addon: true, order_lines: [{ line_no: 1, product_id: '111', name: 'Батон', price: '100', qty: '1.500' }, { line_no: 2, product_id: '333', name: 'Булка', price: '10', qty: '1' }] },
  ];
  const { sb, calls } = fakeSb(rows);
  const lines = await createData(sb).activeOrderLines('bread', 'st-1', '2026-10-26');
  assert.deepEqual(lines, [
    { product_id: '111', name: 'Батон', price: 100, qty: 6.5 },
    { product_id: '222', name: 'Багет', price: 50.5, qty: 2 },
    { product_id: '333', name: 'Булка', price: 10, qty: 1 },
  ]);
  const q = calls[0];
  assert.equal(q.table, 'orders');
  assert.ok(has(q, 'eq', 'dir', 'bread') && has(q, 'eq', 'store_id', 'st-1') && has(q, 'eq', 'order_date', '2026-10-26') && has(q, 'eq', 'status', 'active'));
});

test('activeOrderLines: замовлення нема -> []; помилка бази - наверх', async () => {
  assert.deepEqual(await createData(fakeSb([]).sb).activeOrderLines('bread', 's', '2026-10-26'), []);
  const bad = { from: () => ({ select() { return this; }, eq() { return this; }, order() { return Promise.resolve({ data: null, error: { message: 'boom' } }); } }) };
  await assert.rejects(createData(bad).activeOrderLines('bread', 's', '2026-10-26'), { message: 'orders: boom' });
});
