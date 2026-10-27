// Транзакція submit_order_tx на справжній базі. Лише тестові точки (store_id 'test-…'), після тестів прибираємо.
// Без SUPABASE_URL / SERVICE_ROLE_KEY тести пропускаються.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const { loadEnv } = require('../src/env');
loadEnv();
const HAVE_DB = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const opts = { skip: HAVE_DB ? false : 'нема SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY' };

const { apiSubmitOrder } = require('../src/api/submit');
const { DIRECTIONS } = require('../src/directions');

const AT = new Date('2026-10-19T10:00:00+03:00');
const AFTER_BREAD = new Date('2026-10-19T16:30:00+03:00');
const RUN = randomUUID().slice(0, 8);
const store = (n) => `test-db-${RUN}-${n}`;

let sb, realData;
if (HAVE_DB) {
  sb = require('../src/db').supabase();
  realData = require('../src/data').createData(sb);
}

const prod = (id, name, price) => ({ dir: 'bread', id, barcode: id, name, price, category: null, availability: null, box: null, status: 'active', sort: 0 });

function env(storeId, over = {}) {
  return {
    at: over.at || AT,
    queueExport: () => {},
    veg: { resolve: async (r) => r },
    data: {
      stores: async () => [{ id: storeId, label: 'Тест БД', code: '', edrpou: '', days: { veg: [], bakery: [] }, directions: ['bread'] }],
      settings: async () => ({ test_mode: true }),
      directions: async () => DIRECTIONS,
      products: async () => [prod('111', 'Батон', 100), prod('222', 'Багет', 150)],
      lateRows: async () => over.lateRows || [],
      hasOrderToday: realData.hasOrderToday,
      orderResult: realData.orderResult,
      submitOrderTx: realData.submitOrderTx,
    },
  };
}
const items = [{ id: '111', qty: 3 }, { id: '222', qty: 2 }];       // 600 грн, 2 рядки
const send = (storeId, orderId, extra = {}, e = env(storeId)) =>
  apiSubmitOrder({ dir: 'bread', storeId, orderId, items, ...extra }, e);

async function orders(storeId) {
  const { data, error } = await sb.from('orders').select('*, order_lines(*)').eq('store_id', storeId).order('created_at');
  if (error) throw new Error(error.message);
  return data;
}

test.after(async () => {
  if (HAVE_DB) await sb.from('orders').delete().like('store_id', `test-db-${RUN}-%`);
});

test('БД: звичайна відправка пише orders + order_lines (qty, ціни з products)', opts, async () => {
  const s = store('plain');
  const r = await send(s, `${RUN}-p1`);
  assert.deepEqual([r.ok, r.positions, r.total, r.replaced, r.removed, r.test], [true, 2, 600, false, 0, true]);
  const o = await orders(s);
  assert.equal(o.length, 1);
  assert.deepEqual([o[0].status, o[0].is_addon, o[0].dir, o[0].order_date, Number(o[0].total), o[0].exported_at], ['active', false, 'bread', '2026-10-19', 600, null]);
  assert.deepEqual(o[0].order_lines.sort((a, b) => a.line_no - b.line_no).map((l) => [l.line_no, l.product_id, l.name, Number(l.price), Number(l.qty)]),
    [[1, '111', 'Батон', 100, 3], [2, '222', 'Багет', 150, 2]]);
  assert.deepEqual(o[0].result, { ...r });
});

test('БД: повтор order_id -> duplicate:true і та сама відповідь, нового запису немає', opts, async () => {
  const s = store('dup');
  const first = await send(s, `${RUN}-d1`);
  const again = await send(s, `${RUN}-d1`);
  assert.deepEqual(again, { ...first, duplicate: true });
  assert.equal((await orders(s)).length, 1);
});

test('БД: два паралельні submitOrder різних order_id однієї точки -> рівно один ok', opts, async () => {
  const s = store('par');
  const res = await Promise.allSettled([send(s, `${RUN}-a`), send(s, `${RUN}-b`)]);
  const ok = res.filter((x) => x.status === 'fulfilled'), bad = res.filter((x) => x.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].reason.message, 'Замовлення на "Хліб Рома" для цієї ТТ вже сьогодні відправлено. Щоб змінити його, натисніть "Змінити замовлення".');
  const o = await orders(s);
  assert.equal(o.length, 1);
  assert.equal(o[0].order_lines.length, 2);
});

test('БД: 6 паралельних відправок -> рівно одне активне замовлення', opts, async () => {
  const s = store('par6');
  const res = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => send(s, `${RUN}-n${i}`)));
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
  const o = await orders(s);
  assert.equal(o.filter((x) => x.status === 'active').length, 1);
  assert.equal(o.length, 1);
});

test('БД: паралельний повтор того самого order_id -> обидва ok, один запис', opts, async () => {
  const s = store('par-same');
  const res = await Promise.all([send(s, `${RUN}-same`), send(s, `${RUN}-same`)]);
  assert.ok(res.every((r) => r.ok));
  assert.equal((await orders(s)).length, 1);
});

test('БД: з дозволом друга звичайна відправка (не replace) відхиляється - добавок (is_addon) більше не створюється', opts, async () => {
  const s = store('addon');
  await send(s, `${RUN}-o1`);
  const lateRows = [{ dir: 'bread', store_id: s, requested_at: '2026-10-19T16:20:00+03:00', approved_at: '2026-10-19T16:20:00+03:00' }];
  await assert.rejects(send(s, `${RUN}-o2`, {}, env(s, { at: AFTER_BREAD, lateRows })), /Змінити замовлення/);
  const o = await orders(s);
  assert.deepEqual(o.map((x) => [x.status, x.is_addon]), [['active', false]]);
});

test('БД: до дедлайну replace без дозволу - старе cancelled, нове active', opts, async () => {
  const s = store('repl-early');
  await send(s, `${RUN}-e1`);
  const r = await send(s, `${RUN}-e2`, { mode: 'replace', items: [{ id: '222', qty: 3 }] });          // 450 грн: мінімалка (400) діє і на заміну
  assert.deepEqual([r.ok, r.replaced, r.removed], [true, true, 2]);
  const o = await orders(s);
  assert.deepEqual(o.map((x) => [x.status, x.is_addon]), [['cancelled', false], ['active', false]]);
});

test('БД: replace з дозволом - старе cancelled, removed = рядки старого, нове active', opts, async () => {
  const s = store('repl');
  await send(s, `${RUN}-r1`);
  const lateRows = [{ dir: 'bread', store_id: s, requested_at: '2026-10-19T16:20:00+03:00', approved_at: '2026-10-19T16:20:00+03:00' }];
  const r = await send(s, `${RUN}-r2`, { mode: 'replace', items: [{ id: '111', qty: 7 }] }, env(s, { at: AFTER_BREAD, lateRows }));
  assert.deepEqual([r.ok, r.replaced, r.removed, r.positions, r.total], [true, true, 2, 1, 700]);
  const o = await orders(s);
  assert.deepEqual(o.map((x) => [x.status, x.is_addon, x.order_lines.length]), [['cancelled', false, 2], ['active', false, 1]]);
  const old = o[0];
  assert.ok(Date.parse(old.changed_at) >= Date.parse(old.created_at), 'changed_at оновлено для вигрузки (Task 5)');
});

test('БД: replace, коли замовлення ще нема - це звичайне перше замовлення (replaced:false, removed:0)', opts, async () => {
  const s = store('repl0');
  const lateRows = [{ dir: 'bread', store_id: s, requested_at: '2026-10-19T16:20:00+03:00', approved_at: '2026-10-19T16:20:00+03:00' }];
  const r = await send(s, `${RUN}-z1`, { mode: 'replace' }, env(s, { at: AFTER_BREAD, lateRows }));
  assert.deepEqual([r.ok, r.replaced, r.removed], [true, false, 0]);
});

test('БД: "вже сьогодні" без дозволу - відмова до запису; скасоване замовлення не рахується', opts, async () => {
  const s = store('already');
  await send(s, `${RUN}-x1`);
  await assert.rejects(send(s, `${RUN}-x2`), /вже сьогодні відправлено/);
  await sb.from('orders').update({ status: 'cancelled' }).eq('store_id', s);
  const r = await send(s, `${RUN}-x3`);
  assert.equal(r.ok, true);
});
