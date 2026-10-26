const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/api/writeoff');
const { createApi } = require('../src/api');

const AT = new Date('2026-10-19T10:00:00+03:00');
const STORE = { id: 'test-a', label: 'Тест А', code: '1', edrpou: '', directions: ['bakery'] };
const prod = (id, cost, o = {}) => ({ dir: 'bakery', id, barcode: id, name: 'Товар ' + id, price: 99, category: 'Випічка', status: 'active', cost, sort: 0, ...o });

function makeEnv(over = {}) {
  const calls = { tx: [], exports: [], logs: [], deleted: [], since: [] };
  const data = {
    stores: async () => [STORE],
    settings: async () => ({ wo_books: { '44413718': { id: 'B1' } } }),
    products: async () => [prod('1', 10), prod('2', 0.05)],
    woResult: async () => null,
    submitWriteoffTx: async (p) => { calls.tx.push(p); return { ok: true, duplicate: false, result: p.result }; },
    woDocsOfStore: async (sid, since) => { calls.since.push(since); return []; },
    woFind: async () => null,
    woMarkDeleted: async (id) => { calls.deleted.push(id); return true; },
    adminLog: async (a, t) => { calls.logs.push([a, t]); },
    ...(over.data || {}),
  };
  return { env: { at: over.at || AT, data, queueWoExport: (k) => calls.exports.push(k) }, calls };
}
const SUB = (o = {}) => ({ docId: 'doc12345', storeId: 'test-a', date: '19.10.2026', seller: 'Іваненко', items: [{ id: '1', qty: 1 }], ...o });

test('+20%: amount_plus = Сумма × 1.2 з округленням до копійки', async () => {
  const { env, calls } = makeEnv();
  await W.apiWoSubmit(SUB({ items: [{ id: '1', qty: 3 }, { id: '2', qty: 7 }] }), env);
  assert.deepEqual(calls.tx[0].lines.map((l) => [l.amount, l.amount_plus]), [[30, 36], [0.35, 0.42]]);
  assert.equal(W.WO_MARKUP, 0.20);
});

test('успіх: payload транзакції, duplicate:false, вигрузка поставлена в чергу', async () => {
  const { env, calls } = makeEnv();
  const r = await W.apiWoSubmit(SUB(), env);
  assert.deepEqual(r, { docId: 'doc12345', store: 'Тест А', woDate: '19.10.2026', seller: 'Іваненко', positions: 1, qty: 1, total: 10, time: '10:00', date: '19.10.2026', duplicate: false });
  const p = calls.tx[0];
  assert.deepEqual([p.doc_id, p.store_id, p.edrpou, p.wo_date, p.submitted_at], ['doc12345', 'test-a', '44413718', '2026-10-19', AT.toISOString()]);
  assert.equal('duplicate' in p.result, false, 'збережена відповідь - без duplicate, як oid_wo_');
  assert.deepEqual(calls.exports, ['wo']);
});

test('повтор: woResult -> збережена + duplicate:true, без транзакції і вигрузки', async () => {
  const saved = { docId: 'doc12345', total: 5 };
  const { env, calls } = makeEnv({ data: { woResult: async () => saved } });
  assert.deepEqual(await W.apiWoSubmit(SUB(), env), { ...saved, duplicate: true });
  assert.equal(calls.tx.length, 0);
  assert.deepEqual(calls.exports, []);
});

test('гонка: транзакція каже duplicate -> її відповідь, без вигрузки', async () => {
  const saved = { docId: 'doc12345', total: 7 };
  const { env, calls } = makeEnv({ data: { submitWriteoffTx: async () => ({ ok: true, duplicate: true, result: saved }) } });
  assert.deepEqual(await W.apiWoSubmit(SUB(), env), { ...saved, duplicate: true });
  assert.deepEqual(calls.exports, []);
});

test('151 різних товарів -> "Забагато позицій в одному списанні"; 150 - проходить', async () => {
  const many = Array.from({ length: 151 }, (_, i) => prod('p' + i, 1));
  const { env } = makeEnv({ data: { products: async () => many } });
  await assert.rejects(W.apiWoSubmit(SUB({ items: many.map((p) => ({ id: p.id, qty: 1 })) }), env), { message: 'Забагато позицій в одному списанні' });
  const r = await W.apiWoSubmit(SUB({ items: many.slice(0, 150).map((p) => ({ id: p.id, qty: 1 })) }), env);
  assert.equal(r.positions, 150);
});

test('items не масив -> "Не вибрано жодного товару" (без TypeError)', async () => {
  const { env } = makeEnv();
  await assert.rejects(W.apiWoSubmit(SUB({ items: 'abc' }), env), { message: 'Не вибрано жодного товару' });
});

test('wo_deadline з settings: текст і закриття за ним', async () => {
  const { env } = makeEnv({ at: new Date('2026-10-19T12:30:00+03:00'), data: { settings: async () => ({ wo_deadline: '12:00', wo_books: { '44413718': { id: 'B1' } } }) } });
  await assert.rejects(W.apiWoSubmit(SUB({ docId: 'doc99999' }), env), { message: 'Прийом списань на сьогодні закрито о 12:00. Подати можна завтра до 12:00.' });
});

test('woMine: вікно 31 день - since = сьогодні мінус 31', async () => {
  const { env, calls } = makeEnv();
  const r = await W.apiWoMine({ storeId: 'test-a' }, env);
  assert.deepEqual(calls.since, ['2026-09-18']);
  assert.deepEqual(r, { docs: [], closed: false, deadline: '13:00', keepDays: 31, total: 0, month: 0 });
});

test('woDelete: паралельне видалення (UPDATE не зачепив рядок) -> "не знайдено", без журналу', async () => {
  const w = { id: 'pk', doc_id: 'doc12345', store_id: 'test-a', store_label: 'Тест А', wo_date: '2026-10-19',
    submitted_at: '2026-10-19T06:30:00Z', lines: [{ line_no: 1, amount: 5 }] };
  const { env, calls } = makeEnv({ data: { woFind: async () => w, woMarkDeleted: async () => false } });
  await assert.rejects(W.apiWoDelete({ storeId: 'test-a', docId: 'doc12345' }, env), { message: 'Списання не знайдено - можливо, його вже видалили' });
  assert.deepEqual(calls.logs, []);
});

test('woDelete: помилка журналу не скасовує видалення; вигрузка в черзі', async () => {
  const w = { id: 'pk', doc_id: 'doc12345', store_id: 'test-a', store_label: 'Тест А', wo_date: '2026-10-19',
    submitted_at: '2026-10-19T06:30:00Z', lines: [{ line_no: 1, amount: 5 }, { line_no: 2, amount: 2.5 }] };
  const { env, calls } = makeEnv({ data: { woFind: async () => w, adminLog: async () => { throw new Error('db'); } } });
  const r = await W.apiWoDelete({ storeId: 'test-a', docId: 'doc12345' }, env);
  assert.deepEqual(r, { removed: 2, total: 7.5, date: '19.10.2026', store: 'Тест А' });
  assert.deepEqual(calls.deleted, ['pk']);
  assert.deepEqual(calls.exports, ['wo']);
});

test('/api: woProducts, woSubmit, woMine, woDelete маршрутизуються; помилка - конверт ok:false', async () => {
  const { env } = makeEnv();
  const api = createApi(() => env, () => {});
  for (const a of ['woProducts', 'woSubmit', 'woMine']) {
    const r = await api(a, a === 'woSubmit' ? SUB() : { storeId: 'test-a' });
    assert.equal(r.ok, true, a + ': ' + r.error);
  }
  assert.deepEqual(await api('woDelete', { storeId: 'test-a', docId: 'x' }), { ok: false, error: 'Невірний ID списання' });
  assert.deepEqual(await api('woMine', null), { ok: false, error: 'Торгову точку не знайдено. Оновіть сторінку.' });
});

test('buildWoProducts: увесь асортимент (і «стоп», і без собівартості - з ціною 0, назва в noCost); costCol=false - за продажною, без «стоп»', () => {
  const rows = [prod('1', 10, { status: 'stop' }), prod('2', null), prod('3', 0, { status: 'stop' })];
  const all = W.buildWoProducts(rows);
  assert.deepEqual(all.products.map((p) => [p.id, p.price]), [['1', 10], ['2', 0], ['3', 0]]);
  assert.deepEqual(all.noCost, ['Товар 2', 'Товар 3']);
  assert.deepEqual(W.buildWoProducts(rows, false).products.map((p) => [p.id, p.price]), [['2', 99]]);
});

test('woSubmit: позицію без собівартості (як «Салат з курячим філе та ананасами») можна списати - рядок з сумою 0', async () => {
  const salad = prod('7', null, { status: 'stop', name: 'Салат з курячим філе та ананасами 175г' });
  const { env, calls } = makeEnv({ data: { products: async () => [prod('1', 10), salad] } });
  const list = await W.apiWoProducts({ storeId: 'test-a' }, env);
  assert.ok(list.products.some((p) => p.id === '7'), 'у списку продавця');
  const r = await W.apiWoSubmit(SUB({ items: [{ id: '7', qty: 2 }] }), env);
  assert.equal(r.total, 0);
  assert.deepEqual(calls.tx[0].lines.map((l) => [l.name, l.qty, l.price, l.amount, l.amount_plus]), [['Салат з курячим філе та ананасами 175г', 2, 0, 0, 0]]);
});
