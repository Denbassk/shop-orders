// import-today: сьогоднішні рядки з БОЙОВИХ сирих листів -> orders/order_lines у базі (щоб не було дублів при переключенні і щоб
// звіти/пульт з бази збігалися з листами). Чистий планувальник planImport: що вставити, замінити, скасувати.
const test = require('node:test');
const assert = require('node:assert/strict');
const { planImport, importOrderId } = require('../src/import/today');

const DAY = '2026-10-22';
const NOW = new Date('2026-10-22T14:00:00Z');
const st = (id, label, over = {}) => ({ id, label, address: 'м. Харків вул. ' + label, addrBread: 'м. Харків вул. ' + label, addrBakery: 'м. Харків вул. ' + label,
  addrVeg: 'м. Харків вул. ' + label, addrNbhz: '', directions: ['bread', 'bakery', 'veg', 'nbhz'], ...over });
const STORES = [st('a', 'Амосова, 5А'), st('b', 'Байрона, 156'), st('n', 'Роганська, 130/4', { addrNbhz: 'Роганская130' })];
const PRODUCTS = {
  bread: [{ id: '4820001', barcode: '4820001', name: 'Хліб Паляниця' }],
  bakery: [{ id: '4821111', barcode: '4821111', name: 'Пампушка' }],
  veg: [{ id: 'Картопля', barcode: '', name: 'Картопля' }],
  nbhz: [{ id: 'батон дорожній', barcode: '', name: 'Батон Дорожній' }],
};
const hm = (h, m) => (h * 60 + m) / 1440;
// дані з листа: рядки робочого формату {dir, addr, time, barcode, name, price, qty}
const row = (dir, addr, name, qty, o = {}) => ({ dir, addr, time: o.time || '', barcode: o.barcode || '', name, price: o.price == null ? 10 : o.price, qty });

test('importOrderId: стабільний ключ імпорту за день, напрямок і точку', () => {
  assert.equal(importOrderId(DAY, 'bread', 'a'), 'import-2026-10-22-bread-a');
});

test('нові групи: одне замовлення на (точка, напрямок), рядки по порядку, total, product_id з products, exported_at = changed_at', () => {
  const p = planImport({ day: DAY, now: NOW, stores: STORES, products: PRODUCTS, existing: [], rows: [
    row('bread', 'Амосова, 5а', 'Хліб Паляниця', 5, { barcode: '4820001', price: 20 }), row('bread', 'Амосова, 5а', 'Невідомий хліб', 2, { barcode: '999', price: 15 }),
    row('bakery', 'м. Харків вул. Байрона, 156', 'Пампушка', 3, { barcode: '4821111', price: 12.5, time: '10:40' }),
    row('veg', 'м. Харків вул. Амосова, 5А', 'Картопля', 12.5, { price: 14, time: '12:00' }),
    row('nbhz', 'Роганская130', 'Батон Дорожній', 4),
  ] });
  assert.equal(p.inserts.length, 4);
  const bread = p.inserts.find((x) => x.dir === 'bread');
  assert.deepEqual([bread.store_id, bread.order_id, bread.status, bread.total, bread.order_date], ['a', 'import-2026-10-22-bread-a', 'active', 130, DAY]);
  assert.deepEqual(bread.lines.map((l) => [l.line_no, l.product_id, l.barcode, l.name, l.qty, l.price]),
    [[1, '4820001', '4820001', 'Хліб Паляниця', 5, 20], [2, '999', '999', 'Невідомий хліб', 2, 15]], 'невідомий товар - product_id = штрихкод');
  assert.equal(bread.exported_at, bread.changed_at, 'вже є в листі - вигрузка не дублює');
  const bk = p.inserts.find((x) => x.dir === 'bakery');
  assert.equal(bk.created_at, '2026-10-22T10:40:00+03:00', 'час з листа (ВК/овочі)');
  assert.equal(p.inserts.find((x) => x.dir === 'nbhz').store_id, 'n');
  assert.equal(p.inserts.find((x) => x.dir === 'veg').lines[0].product_id, 'Картопля');
  assert.deepEqual([p.updates.length, p.cancels.length, p.skipped.length], [0, 0, 0]);
});

test('адреса, якої нема в точках, - у unmatched, не в замовленнях', () => {
  const p = planImport({ day: DAY, now: NOW, stores: STORES, products: PRODUCTS, existing: [], rows: [row('bread', 'Невідома, 9', 'Хліб Паляниця', 1, { barcode: '4820001' })] });
  assert.equal(p.inserts.length, 0);
  assert.deepEqual(p.unmatched, [{ dir: 'bread', addr: 'Невідома, 9' }]);
});

test('вже імпортоване без змін - пропуск; рядки змінились - заміна рядків; рядків у листі нема - скасування', () => {
  const base = { day: DAY, now: NOW, stores: STORES, products: PRODUCTS };
  const same = { order_id: 'import-2026-10-22-bread-a', pk: 'p1', status: 'active', dir: 'bread', store_id: 'a', lines: [{ line_no: 1, barcode: '4820001', name: 'Хліб Паляниця', qty: 5, price: 20 }] };
  const r1 = [row('bread', 'Амосова, 5а', 'Хліб Паляниця', 5, { barcode: '4820001', price: 20 })];
  assert.deepEqual([planImport({ ...base, existing: [same], rows: r1 }).skipped.length, planImport({ ...base, existing: [same], rows: r1 }).inserts.length], [1, 0]);
  const r2 = [row('bread', 'Амосова, 5а', 'Хліб Паляниця', 7, { barcode: '4820001', price: 20 })];
  const upd = planImport({ ...base, existing: [same], rows: r2 }).updates;
  assert.equal(upd.length, 1);
  assert.deepEqual([upd[0].pk, upd[0].total, upd[0].lines[0].qty], ['p1', 140, 7]);
  const can = planImport({ ...base, existing: [same], rows: [] }).cancels;
  assert.deepEqual(can.map((x) => x.pk), ['p1']);
});

test('замовлення з бази, створене НЕ імпортом (справжнє від продавця), планувальник не чіпає: ні заміни, ні скасування, ні дубля', () => {
  const real = { order_id: 'o-real-1', pk: 'p9', status: 'active', dir: 'bread', store_id: 'a', lines: [{ line_no: 1, barcode: '4820001', name: 'Хліб Паляниця', qty: 1, price: 20 }] };
  const p = planImport({ day: DAY, now: NOW, stores: STORES, products: PRODUCTS, existing: [real],
    rows: [row('bread', 'Амосова, 5а', 'Хліб Паляниця', 5, { barcode: '4820001', price: 20 })] });
  assert.deepEqual([p.inserts.length, p.updates.length, p.cancels.length], [0, 0, 0]);
  assert.deepEqual(p.skipped.map((x) => x.reason), ['у базі вже є справжнє замовлення']);
  const p2 = planImport({ day: DAY, now: NOW, stores: STORES, products: PRODUCTS, existing: [real], rows: [] });
  assert.equal(p2.cancels.length, 0);
});
