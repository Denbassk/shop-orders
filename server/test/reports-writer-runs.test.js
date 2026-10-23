// Несмежні блоки рядків: кожен блок отримує свій формат (rowRuns + fmt), нічого не втрачається.
const test = require('node:test');
const assert = require('node:assert/strict');
const { writerFor, rowRuns } = require('../src/reports/sheetWriter');
const { modelOfPlan } = require('../src/reports/planModel');
const V = require('../src/reports/veg');

test('rowRuns: сусідні рядки склеюються, несмежні блоки лишаються окремими', () => {
  assert.deepEqual(rowRuns([5, 6, 7, 10, 11, 20, 30, 31]), [[5, 7], [10, 11], [20, 20], [30, 31]]);
  assert.deepEqual(rowRuns([]), []);
});

test('fmt по несмежних рядках: формат є в КОЖНОМУ блоці', () => {
  const data = Array.from({ length: 40 }, (_, i) => [i, i, i]);
  const w = writerFor({ properties: { sheetId: 1, gridProperties: { rowCount: 1000, columnCount: 26 } } }, data, 3);
  const rows = [3, 4, 5, 12, 13, 25, 33, 34, 35];
  w.fmt(rows, 'C', 'C', { num: '#,##0.00', halign: 'center' });
  const reqs = w.requests().filter((q) => q.repeatCell);
  assert.equal(reqs.length, 4, 'чотири блоки');
  assert.deepEqual(reqs.map((q) => [q.repeatCell.range.startRowIndex + 1, q.repeatCell.range.endRowIndex]), [[3, 5], [12, 13], [25, 25], [33, 35]]);
});

test('овочі: кожен рядок позицій, РАЗОМ по ТТ і підсумок має числові формати у кількох ТТ (несмежні блоки)', () => {
  const st = (id, a) => ({ id, label: a, address: a, addrVeg: a, directions: ['veg'], days: { veg: [], bakery: [] }, edrpou: '' });
  const stores = ['А 1', 'Б 2', 'В 3', 'Г 4'].map((a, i) => st('s' + i, a));
  const rows = [];
  stores.forEach((s, i) => { for (let j = 0; j < 3; j++) rows.push(['19.10.2026', '10:00:00', s.address, 'Овоч ' + j, 10 + j, 2 + i, (10 + j) * (2 + i)]); });
  const plans = V.buildVegReports(rows, { stores, now: new Date('2026-10-19T12:00:00+03:00') });
  const plan = plans['Замовлення Овочі'], m = modelOfPlan(plan);
  const kinds = { price: 0, qty: 0, sum: 0, totQty: 0, totSum: 0 };
  plan.data.forEach((row, i) => {
    const r = i + 1, c = (n) => (m.cells[r + ',' + n] || {}).nf;
    if (typeof row[0] === 'number') { assert.equal(c(3), '#,##0.00', 'ціна, рядок ' + r); assert.equal(c(4), '0.###'); assert.equal(c(5), '#,##0.00'); kinds.price++; }
    if (row[0] === 'РАЗОМ по ТТ:') { assert.equal(c(4), '0.###'); assert.equal(c(5), '#,##0.00'); kinds.totQty++; }
    if (row[0] === 'ЗАГАЛЬНИЙ ПІДСУМОК') { assert.equal(c(4), '0.###'); assert.equal(c(5), '#,##0.00'); kinds.totSum++; }
  });
  assert.deepEqual(kinds, { price: 12, qty: 0, sum: 0, totQty: 4, totSum: 1 });
});
