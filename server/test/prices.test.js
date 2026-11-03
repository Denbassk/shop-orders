// Спільна перевірка цін (0…100000, округлення до 0.01) і розрахунок масової зміни. Те саме використовують setProduct/addProduct закупниці і пульт.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../src/prices');

const P3 = [
  { id: 'a', name: 'Батон', price: 20 },
  { id: 'b', name: 'Хліб Дарницький', price: 19.99 },
  { id: 'c', name: 'Булка без ціни', price: 0 },
  { id: 'd', name: 'Багет', price: 33 },
];
const plan = (mode, value, list = P3) => P.planPriceChange(list, mode, value);
const pairs = (r) => r.rows.map((x) => [x.id, x.old, x.new]);

test('parseMoney: кома, пробіли, межі 0…100000, округлення до копійки; усе інше - NaN', () => {
  assert.equal(P.parseMoney('12,5'), 12.5);
  assert.equal(P.parseMoney(' 7 '), 7);
  assert.equal(P.parseMoney(0), 0);
  assert.equal(P.parseMoney('100000'), 100000);
  assert.equal(P.parseMoney('2.499'), 2.5);
  assert.equal(P.parseMoney('0.004'), 0);
  for (const bad of ['', '  ', null, undefined, 'abc', -1, '-0.01', '100001', Infinity, NaN, '1e999']) assert.ok(Number.isNaN(P.parseMoney(bad)), String(bad));
  assert.equal(P.MONEY_MAX, 100000);
});

test('planPriceChange: на відсоток - округлення до 0.01, позиції без ціни пропускаються й повідомляються', () => {
  const r = plan('pct', '5');
  assert.deepEqual(pairs(r), [['a', 20, 21], ['b', 19.99, 20.99], ['d', 33, 34.65]]);
  assert.deepEqual(r.skipped, [{ id: 'c', name: 'Булка без ціни', reason: 'без ціни' }]);
  assert.deepEqual(pairs(plan('pct', '10')).map((x) => x[2]), [22, 21.99, 36.3]);
  assert.deepEqual(pairs(plan('pct', '-50', [P3[0], P3[3]])).map((x) => x[2]), [10, 16.5]);
  assert.deepEqual(pairs(plan('pct', '33,3', [P3[0]])), [['a', 20, 26.66]]);
});

test('planPriceChange: на суму (в т.ч. мінус, кома); без ціни не чіпає навіть «+»', () => {
  assert.deepEqual(pairs(plan('sum', '2,5')), [['a', 20, 22.5], ['b', 19.99, 22.49], ['d', 33, 35.5]]);
  assert.deepEqual(pairs(plan('sum', '-3')), [['a', 20, 17], ['b', 19.99, 16.99], ['d', 33, 30]]);
  assert.equal(plan('sum', '1').skipped.length, 1);
});

test('planPriceChange: рядки без зміни після округлення не потрапляють у результат', () => {
  const r = plan('pct', '1', [{ id: 'x', name: 'Копійка', price: 0.01 }, { id: 'y', name: 'Батон', price: 20 }]);
  assert.deepEqual(pairs(r), [['y', 20, 20.2]]);
});

test('planPriceChange: помилки до будь-якого розрахунку', () => {
  assert.throws(() => plan('x', '5'), { message: 'Невірний спосіб зміни' });
  for (const bad of ['', 'abc', null, undefined]) assert.throws(() => plan('pct', bad), { message: 'Невірне значення' }, String(bad));
  assert.throws(() => plan('pct', '0'), { message: 'Змін немає' });
  assert.throws(() => plan('sum', '0,00'), { message: 'Змін немає' });
  assert.throws(() => plan('pct', '-96'), /від -95 до 500/);
  assert.throws(() => plan('pct', '501'), /від -95 до 500/);
  assert.throws(() => plan('sum', '100001'), /не більше 100000/);
  assert.throws(() => plan('sum', '-100001'), /не більше 100000/);
});

test('planPriceChange: ціна вийшла за 0…100000 - помилка з назвою, нічого не повертається частково', () => {
  assert.throws(() => plan('sum', '-25'), { message: 'Ціна «Батон» вийде за межі 0…100000' });
  assert.throws(() => plan('pct', '500', [{ id: 'z', name: 'Золото', price: 90000 }]), { message: 'Ціна «Золото» вийде за межі 0…100000' });
  assert.throws(() => plan('sum', '-20'), { message: 'Ціна «Хліб Дарницький» вийде за межі 0…100000' });   // Батон 20-20=0 дозволено, а 19.99-20 < 0
});

test('planPriceChange: рівно 0 після зміни дозволено (знижка до нуля) - це не вихід за межі', () => {
  assert.deepEqual(pairs(plan('sum', '-20', [{ id: 'a', name: 'Батон', price: 20 }])), [['a', 20, 0]]);
});

test('fmtChange: текст для журналу', () => {
  assert.equal(P.fmtChange('pct', '5'), '+5%');
  assert.equal(P.fmtChange('pct', '-3,5'), '-3.5%');
  assert.equal(P.fmtChange('sum', '2,5'), '+2.5 грн');
  assert.equal(P.fmtChange('sum', '-3'), '-3 грн');
});

test('без дублювання: межа 100000 лише в src/prices.js; setProduct/addProduct закупниці і пульт беруть parseMoney', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
  assert.ok(!/\b100000\b/.test(read('buyer', 'api.js')), 'buyer/api.js без власної межі');
  assert.ok(!/\b100000\b/.test(read('admin', 'assortment.js')), 'admin/assortment.js без власної межі');
  assert.ok(/\b100000\b/.test(read('prices.js')) || /MONEY_MAX = 100000/.test(read('prices.js')));
  assert.ok(read('buyer', 'api.js').includes("require('../prices')"));
  assert.ok(read('admin', 'assortment.js').includes("require('../prices')"));
});
