const test = require('node:test');
const assert = require('node:assert/strict');

const { apiSubmitOrder } = require('../src/api/submit');
const { DIRECTIONS } = require('../src/directions');

const AT = new Date('2026-10-19T10:00:00+03:00');             // пн, всі напрямки відкриті
const AFTER_BREAD = new Date('2026-10-19T16:30:00+03:00');    // хліб (16:00) закрито, НБХЗ (17:30) ще ні
const STORE = 'test-a';

const prod = (dir, id, name, price, o = {}) => ({
  dir, id, barcode: dir === 'veg' ? '' : id, name, price, category: o.category || null,
  availability: null, box: null, status: o.status || 'active', sort: o.sort || 0,
});
const PRODUCTS = {
  bread: [prod('bread', '111', 'Батон', 100), prod('bread', '222', 'Багет', 50.5), prod('bread', '333', 'Стоп-хліб', 10, { status: 'stop' })],
  nbhz: [prod('nbhz', 'а', 'Хліб А', 0), prod('nbhz', 'б', 'Хліб Б', 0)],
  bakery: [prod('bakery', '777', 'Пиріжок', 20, { category: 'Випічка' })],
  veg: [prod('veg', 'Морква', 'Морква', 10), prod('veg', 'Буряк', 'Буряк', 20)],
};

function makeEnv(over = {}) {
  const calls = { tx: [], exports: [] };
  const data = {
    stores: async () => [
      { id: STORE, label: 'Тест А', code: '', edrpou: '', days: { veg: [], bakery: [] }, directions: ['bread', 'nbhz', 'bakery', 'veg'] },
      { id: 'test-only-bakery', label: 'Тест Б', code: '', edrpou: '', days: { veg: [], bakery: [] }, directions: ['bakery'] },
      { id: 'test-veg-tue', label: 'Тест В', code: '', edrpou: '', days: { veg: [2], bakery: [] }, directions: ['veg'] },
    ],
    settings: async () => ({ app_version: 'v', test_mode: false, dirs_off: [], late_all: {} }),
    directions: async () => DIRECTIONS,
    products: async (dir) => PRODUCTS[dir],
    lateRows: async () => [],
    hasOrderToday: async () => false,
    orderResult: async () => null,
    submitOrderTx: async (p) => {
      calls.tx.push(p);
      return { ok: true, duplicate: false, order_pk: 'x', is_addon: false, removed: 0, result: { ...p.result, removed: 0 } };
    },
    ...(over.data || {}),
  };
  const veg = over.veg || { resolve: async (rows) => rows.filter((r) => r.price > 0) };
  return { env: { at: over.at || AT, data, veg, queueExport: (d) => calls.exports.push(d) }, calls };
}

const submit = (payload, over) => { const { env, calls } = makeEnv(over); return apiSubmitOrder(payload, env).then((r) => ({ r, calls })); };
const base = (o = {}) => ({ dir: 'bread', storeId: STORE, orderId: 'o-1', items: [{ id: '111', qty: 5 }], ...o });
const rejects = (payload, message, over) => assert.rejects(submit(payload, over), { message });

// ---------- перевірки: порядок і тексти як в apiSubmitOrder_ ----------
test('невідома точка / напрямок', async () => {
  await rejects(base({ storeId: 'нема' }), 'Торгову точку не знайдено. Оновіть сторінку.');
  await assert.rejects(submit(base({ dir: 'nope' })), /Невідомий напрямок: "nope"\. Доступні: bread, nbhz, bakery, veg\./);
});

test('вимкнений напрямок', async () => {
  await rejects(base(), 'Напрямок "Хліб Рома" зараз вимкнено.',
    { data: { settings: async () => ({ dirs_off: ['bread'] }) } });
});

test('напрямок не цієї точки', async () => {
  await rejects(base({ storeId: 'test-only-bakery' }), 'Для цієї ТТ напрямок "Хліб Рома" не передбачений');
});

test('не той день (овочі, вівторок; пн)', async () => {
  await rejects(base({ dir: 'veg', storeId: 'test-veg-tue', items: [{ id: 'Морква', qty: 100 }] }),
    'Вибачте, не ваш день для замовлення. Ваші дні: вівторок.');
});

test('дедлайн з lateRequest: текст з кнопкою "Попросити дозвіл"', async () => {
  await rejects(base(), 'Прийом на "Хліб Рома" закрито (до 16:00). Натисніть "Попросити дозвіл" або зателефонуйте закупниці.', { at: AFTER_BREAD });
});

test('дедлайн без lateRequest: текст про телефон закупниці', async () => {
  const noLate = { ...DIRECTIONS, bread: { ...DIRECTIONS.bread, lateRequest: false } };
  await rejects(base(), 'Прийом замовлень на "Хліб Рома" на сьогодні закрито (до 16:00). Замовлення можна передати телефоном закупниці.',
    { at: AFTER_BREAD, data: { directions: async () => noLate } });
});

test('порожнє замовлення / немає items', async () => {
  await rejects(base({ items: [] }), 'Замовлення порожнє');
  await rejects(base({ items: undefined }), 'Замовлення порожнє');
});

test('items не масив / null-елементи: без падіння з TypeError', async () => {
  await rejects(base({ items: 'абв' }), 'Замовлення порожнє');
  await rejects(base({ items: { length: 3 } }), 'Замовлення порожнє');
  await rejects(base({ items: [null, undefined, 5, 'x'] }), 'Не розпізнано жодної позиції');
  const { r } = await submit(base({ items: [null, { id: '111', qty: 5 }] }));
  assert.equal(r.positions, 1);
});

test('> 500 позицій', async () => {
  const items = Array.from({ length: 501 }, () => ({ id: '111', qty: 1 }));
  await rejects(base({ items }), 'Занадто багато позицій');
  const ok = Array.from({ length: 500 }, () => ({ id: '111', qty: 1 }));
  const { r } = await submit(base({ items: ok }));
  assert.equal(r.positions, 500);
});

test('ціни лише з products: ціна з запиту ігнорується, stop-позиція не приймається', async () => {
  const { r, calls } = await submit(base({ items: [{ id: '111', qty: 4, price: 0.01 }, { id: '222', qty: 2, price: 999 }, { id: '333', qty: 99 }] }));
  assert.equal(r.total, 501);                                   // 4*100 + 2*50.5
  assert.equal(r.positions, 2);
  assert.deepEqual(calls.tx[0].lines.map((l) => [l.product_id, l.name, l.price, l.qty]), [['111', 'Батон', 100, 4], ['222', 'Багет', 50.5, 2]]);
});

test('qty: округлення до 0,001; нечислові/нульові/від’ємні пропускаються; > 5000 - помилка', async () => {
  const items = [{ id: '111', qty: '1.23456' }, { id: '222', qty: 'abc' }, { id: '111', qty: 0 }, { id: '111', qty: -3 }, { id: '222', qty: 5000 }];
  const { r, calls } = await submit(base({ items }));
  assert.deepEqual(calls.tx[0].lines.map((l) => l.qty), [1.235, 5000]);
  assert.equal(r.positions, 2);
  await rejects(base({ items: [{ id: '111', qty: 5000.001 }] }), 'Завелика кількість для "Батон"');
  await rejects(base({ items: [{ id: '222', qty: 1 }, { id: '111', qty: 6000 }] }), 'Завелика кількість для "Батон"');
  const { calls: c2 } = await submit(base({ items: [{ id: '222', qty: '2,5' }, { id: '111', qty: 5 }] }));
  assert.equal(c2.tx[0].lines[0].qty, 2, 'parseFloat як в Apps Script: "2,5" -> 2');
});

test('жодної позиції: невідомі id / нульова кількість', async () => {
  await rejects(base({ items: [{ id: 'нема', qty: 5 }] }), 'Не розпізнано жодної позиції');
  await rejects(base({ items: [{ id: '111', qty: 0 }] }), 'Не розпізнано жодної позиції');
  await rejects(base({ items: [{ id: '333', qty: 5 }] }), 'Не розпізнано жодної позиції');
});

test('мінімалка: minOrderOf з minOrderChanges; з 01.10 - 400, до - 350; овочі ×1.5 у тексті', async () => {
  await rejects(base({ items: [{ id: '111', qty: 1 }] }), 'Мінімальне замовлення 400 грн. Зараз 100 грн');
  await rejects(base({ items: [{ id: '111', qty: 1 }] }), 'Мінімальне замовлення 350 грн. Зараз 100 грн', { at: new Date('2026-09-30T12:00:00+03:00') });
  await rejects(base({ dir: 'veg', items: [{ id: 'Морква', qty: 10 }] }), 'Мінімальне замовлення 750 грн. Зараз 150 грн');
  // допуск 0,01 грн: 399.99 проходить, 399.98 - ні
  const p = (price) => ({ data: { products: async () => [prod('bread', '111', 'Батон', price)] } });
  await submit(base({ items: [{ id: '111', qty: 1 }] }), p(399.99));
  await rejects(base({ items: [{ id: '111', qty: 1 }] }), 'Мінімальне замовлення 400 грн. Зараз 399.98 грн', p(399.98));
});

const ALREADY = 'Замовлення на "Хліб Рома" для цієї ТТ вже сьогодні відправлено. Щоб змінити його, натисніть "Змінити замовлення".';

test('вже сьогодні відправлено: звичайна відправка (mode не replace) відхиляється з підказкою "Змінити замовлення"', async () => {
  const already = { data: { hasOrderToday: async () => true } };
  await rejects(base(), ALREADY, already);
  await rejects(base({ mode: 'add' }), ALREADY, already);          // старий екран з режимом "Дозамовити": добавок більше нема
  const noLate = { ...DIRECTIONS, bread: { ...DIRECTIONS.bread, lateRequest: false } };
  await rejects(base(), ALREADY, { data: { hasOrderToday: async () => true, directions: async () => noLate } });
});

test('порядок перевірок: дедлайн раніше за порожнє, порожнє раніше за "вже відправлено"', async () => {
  const already = { data: { hasOrderToday: async () => true } };
  await rejects(base({ items: [] }), 'Замовлення порожнє', already);
  await rejects(base({ items: [] }), 'Прийом на "Хліб Рома" закрито (до 16:00). Натисніть "Попросити дозвіл" або зателефонуйте закупниці.', { ...already, at: AFTER_BREAD });
});

// ---------- успіх ----------
test('успіх: ті самі поля відповіді, час і дата за Києвом, виклик транзакції, queueExport після запису', async () => {
  const { r, calls } = await submit(base({ items: [{ id: '111', qty: 5 }, { id: '222', qty: 1 }] }));
  assert.deepEqual(Object.keys(r).sort(), ['date', 'direction', 'ok', 'positions', 'removed', 'replaced', 'store', 'test', 'time', 'total']);
  assert.deepEqual(r, { ok: true, positions: 2, total: 550.5, time: '10:00:00', date: '19.10.2026', direction: 'Хліб Рома', store: 'Тест А', test: false, replaced: false, removed: 0 });
  const p = calls.tx[0];
  assert.deepEqual([p.order_id, p.dir, p.store_id, p.order_date, p.mode, p.approved, p.total], ['o-1', 'bread', STORE, '2026-10-19', 'new', false, 550.5]);
  assert.equal(p.lines.length, 2);
  assert.deepEqual(calls.exports, ['bread']);
});

test('test_mode з settings -> test:true', async () => {
  const { r } = await submit(base(), { data: { settings: async () => ({ test_mode: true }) } });
  assert.equal(r.test, true);
});

test('овочі: ціна з veg.resolve (на льоту), товар без ціни не приймається; total з markup', async () => {
  const veg = { resolve: async (rows) => rows.filter((r) => r.name === 'Морква').map((r) => ({ ...r, price: 30 })) };
  const { r, calls } = await submit(base({ dir: 'veg', items: [{ id: 'Морква', qty: 20 }, { id: 'Буряк', qty: 5 }] }), { veg });
  assert.deepEqual(calls.tx[0].lines.map((l) => [l.name, l.price, l.qty]), [['Морква', 30, 20]]);
  assert.equal(r.total, 900);                                    // 30*20*1.5
  assert.equal(calls.tx[0].total, 900);
});

test('orderId: обрізається до 60 символів; без нього - srv-…', async () => {
  const { calls } = await submit(base({ orderId: 'x'.repeat(80) }));
  assert.equal(calls.tx[0].order_id.length, 60);
  const { calls: c2 } = await submit(base({ orderId: undefined }));
  assert.match(c2.tx[0].order_id, /^srv-[0-9a-f-]{36}$/);
});

// ---------- дублі ----------
const SAVED = { ok: true, positions: 1, total: 500, time: '09:00:00', date: '19.10.2026', direction: 'Хліб Рома', store: 'Тест А', test: false, replaced: false, removed: 0 };

test('повтор order_id: збережена відповідь + duplicate:true, ще до перевірок (вимкнений напрямок, дедлайн)', async () => {
  const { r, calls } = await submit(base(), { at: AFTER_BREAD, data: { orderResult: async (id) => (id === 'o-1' ? SAVED : null), settings: async () => ({ dirs_off: ['bread'] }) } });
  assert.deepEqual(r, { ...SAVED, duplicate: true });
  assert.equal(calls.tx.length, 0);
  assert.deepEqual(calls.exports, []);
});

test('транзакція каже duplicate (гонка) -> та сама відповідь, без queueExport', async () => {
  const { r, calls } = await submit(base(), { data: { submitOrderTx: async () => ({ ok: true, duplicate: true, result: SAVED }) } });
  assert.deepEqual(r, { ...SAVED, duplicate: true });
  assert.deepEqual(calls.exports, []);
});

test('гонка: той самий order_id записався між orderResult і hasOrderToday -> duplicate, не "вже сьогодні"', async () => {
  let n = 0;
  const { r, calls } = await submit(base(), { data: {
    orderResult: async (id) => (id === 'o-1' && n++ > 0 ? SAVED : null),   // 1-й виклик - ще немає, 2-й - перша копія вже закомітилась
    hasOrderToday: async () => true,
  } });
  assert.deepEqual(r, { ...SAVED, duplicate: true });
  assert.equal(calls.tx.length, 0);
  assert.deepEqual(calls.exports, []);
});

test('чужий запис за сьогодні (інший order_id) -> "вже сьогодні відправлено"', async () => {
  await rejects(base(), ALREADY, { data: { hasOrderToday: async () => true } });
});

test('транзакція: конфлікт унікального індексу -> текст "вже сьогодні відправлено"', async () => {
  await rejects(base(), ALREADY, { data: { submitOrderTx: async () => ({ ok: false, reason: 'already' }) } });
});

test('помилка бази при записі - наверх як помилка, queueExport не викликано', async () => {
  const { env, calls } = makeEnv({ data: { submitOrderTx: async () => { throw new Error('submit_order_tx: connection reset'); } } });
  await assert.rejects(apiSubmitOrder(base(), env), { message: 'submit_order_tx: connection reset' });
  assert.deepEqual(calls.exports, []);
});

// ---------- дозвіл закупниці ----------
const lateRow = (o) => ({ dir: 'bread', store_id: STORE, requested_at: null, approved_at: null, ...o });
const approvedRows = (iso) => async () => [lateRow({ requested_at: iso, approved_at: iso })];

test('дозвіл: знімає дедлайн (16:30, хліб); першому замовленню за день (замовлення ще нема) знімає і мінімалку', async () => {
  const { r, calls } = await submit(base({ items: [{ id: '111', qty: 1 }] }), { at: AFTER_BREAD, data: { lateRows: approvedRows('2026-10-19T16:20:00+03:00') } });
  assert.equal(r.total, 100);                                     // менше 400, але це перше замовлення за дозволом
  assert.equal(calls.tx[0].mode, 'new');
});

test('дозвіл НЕ створює добавку: у транзакцію завжди approved:false (гонка дасть "вже відправлено", а не другий основний)', async () => {
  const { calls } = await submit(base(), { at: AFTER_BREAD, data: { lateRows: approvedRows('2026-10-19T16:20:00+03:00') } });
  assert.equal(calls.tx[0].approved, false);
});

test('дозвіл + замовлення вже є + звичайна відправка (не replace) -> відхилено; добавок нема', async () => {
  const over = { at: AFTER_BREAD, data: { lateRows: approvedRows('2026-10-19T16:20:00+03:00'), hasOrderToday: async () => true } };
  await rejects(base(), ALREADY, over);
  await rejects(base({ mode: 'add' }), ALREADY, over);
});

test('дозвіл діє 30 хв: на 29-й хвилині проходить, на 31-й знову закрито', async () => {
  const at = (hhmm) => new Date(`2026-10-19T${hhmm}:00+03:00`);
  const data = { lateRows: approvedRows('2026-10-19T16:20:00+03:00') };
  const { r } = await submit(base(), { data, at: at('16:49') });
  assert.equal(r.ok, true);
  await rejects(base(), 'Прийом на "Хліб Рома" закрито (до 16:00). Натисніть "Попросити дозвіл" або зателефонуйте закупниці.', { data, at: at('16:51') });
});

const REPLACED_TX = async (p) => ({ ok: true, duplicate: false, removed: 7, result: { ...p.result, removed: 7 } });

test('replace ДО дедлайну: без дозволу, замовлення вже є -> mode=replace, replaced:true, removed з транзакції', async () => {
  const { r, calls } = await submit(base({ mode: 'replace' }), { data: { hasOrderToday: async () => true, submitOrderTx: REPLACED_TX } });
  assert.deepEqual([r.replaced, r.removed], [true, 7]);
  assert.equal(calls.tx.length, 0, 'свій submitOrderTx замінено, у calls нічого');
  const { calls: c2 } = await submit(base({ mode: 'replace' }), { data: { hasOrderToday: async () => true } });
  assert.deepEqual([c2.tx[0].mode, c2.tx[0].approved], ['replace', false]);
  assert.deepEqual(c2.exports, ['bread'], 'заміна теж іде у вигрузку');
});

test('replace ПІСЛЯ дедлайну: без дозволу - дедлайн; з дозволом - заміна', async () => {
  const noPermit = { at: AFTER_BREAD, data: { hasOrderToday: async () => true } };
  await rejects(base({ mode: 'replace' }), 'Прийом на "Хліб Рома" закрито (до 16:00). Натисніть "Попросити дозвіл" або зателефонуйте закупниці.', noPermit);
  const withApproval = { at: AFTER_BREAD, data: { lateRows: approvedRows('2026-10-19T16:20:00+03:00'), hasOrderToday: async () => true, submitOrderTx: REPLACED_TX } };
  const { r } = await submit(base({ mode: 'replace' }), withApproval);
  assert.deepEqual([r.replaced, r.removed], [true, 7]);
});

test('replace, коли замовлення ще нема -> це звичайне перше замовлення (mode=new, replaced:false)', async () => {
  const { r, calls } = await submit(base({ mode: 'replace' }));
  assert.equal(calls.tx[0].mode, 'new');
  assert.equal(r.replaced, false);
});

test('replace: мінімалка діє і з дозволом (це повне замовлення, не добавка)', async () => {
  const over = { at: AFTER_BREAD, data: { lateRows: approvedRows('2026-10-19T16:20:00+03:00'), hasOrderToday: async () => true } };
  await rejects(base({ mode: 'replace', items: [{ id: '111', qty: 1 }] }), 'Мінімальне замовлення 400 грн. Зараз 100 грн', over);
  await rejects(base({ mode: 'replace', items: [{ id: '111', qty: 1 }] }), 'Мінімальне замовлення 400 грн. Зараз 100 грн', { data: { hasOrderToday: async () => true } });
});

test('late_all відкриває прийом після дедлайну, але не знімає мінімалку', async () => {
  const open = { at: AFTER_BREAD, data: { settings: async () => ({ late_all: { bread: '2026-10-19' } }) } };
  const { r } = await submit(base(), open);
  assert.equal(r.ok, true);
  await rejects(base({ items: [{ id: '111', qty: 1 }] }), 'Мінімальне замовлення 400 грн. Зараз 100 грн', open);
});

test('late_all: після дедлайну точки міняють замовлення самі (replace), без запиту дозволу; добавки нема', async () => {
  const open = { at: AFTER_BREAD, data: { settings: async () => ({ late_all: { bread: '2026-10-19' } }), hasOrderToday: async () => true } };
  const { calls } = await submit(base({ mode: 'replace' }), open);
  assert.equal(calls.tx[0].mode, 'replace');
  await rejects(base(), ALREADY, open);
});
