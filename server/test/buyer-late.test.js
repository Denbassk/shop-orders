const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const people = require('../src/buyer/people');
const api = require('../src/buyer/api');
const { createXlsx } = require('../src/buyer/xlsx');
const { dayLateOf } = require('../src/buyer/data');

const AT = new Date('2026-10-21T10:00:00+03:00');
const DAY = '2026-10-21';
const stores = [{ id: 's1', label: 'Сумська 1' }, { id: 's2', label: 'Акад. Павлова 5' }, { id: 's3', label: 'Героїв 7' }];

test('people: дві закупниці; dirOf - лише свої напрямки, без dir - перший', () => {
  assert.deepEqual(Object.keys(people.BUYERS), ['bakery', 'hlib']);
  assert.deepEqual(people.BUYERS.hlib.dirs, ['bread', 'nbhz', 'veg']);
  assert.equal(people.dirOf('hlib', 'veg'), 'veg');
  assert.equal(people.dirOf('hlib', undefined), 'bread');
  assert.equal(people.dirOf('hlib', 'bakery'), null);
  assert.equal(people.dirOf('bakery', ''), 'bakery');
  assert.equal(people.dirOf('bread', 'bread'), null);
  assert.equal(people.dirOf('__proto__', 'bread'), null);
});

test('late: запити дозволу за сьогодні замість листа; чекають - першими; дозвіл діє 30 хв', async () => {
  let asked;
  const env = { at: AT, data: { stores: async () => stores }, adm: { dayLate: async (dir, day) => { asked = [dir, day]; return [
    { store_id: 's1', status: 'approved', requested_at: '2026-10-21T06:40:00Z', approved_at: '2026-10-21T06:45:00Z' },
    { store_id: 's2', status: 'pending', requested_at: '2026-10-21T06:55:00Z', approved_at: null },
    { store_id: 's3', status: 'approved', requested_at: '2026-10-21T05:00:00Z', approved_at: '2026-10-21T05:10:00Z' },
  ]; } } };
  const r = await api.buyerLate('bakery', env);
  assert.deepEqual(asked, ['bakery', DAY]);
  assert.equal(r.pending, 1);
  assert.deepEqual(r.list.map((x) => [x.label, x.status, x.time, x.leftMin]), [
    ['Акад. Павлова 5', 'pending', '09:55', 0],
    ['Сумська 1', 'approved', '09:40', 15],
    ['Героїв 7', 'expired', '08:00', 0],
  ]);
  await assert.rejects(api.buyerLate('xxx', env), /Невідомий напрямок/);
});

test('info: дедлайн, закрито за розкладом, прийом усім сьогодні, час звіту', async () => {
  const mk = (at, lateAll) => ({ at, adm: { getSetting: async (k) => (k === 'late_all' ? lateAll : null) }, reportAt: async () => '09:41' });
  let r = await api.buyerInfo('bakery', mk(AT, { bakery: DAY }));
  assert.equal(r.deadline, '13:00');
  assert.equal(r.closed, false);
  assert.equal(r.openAll, true);
  assert.equal(r.reportAt, '09:41');
  assert.equal(r.hasAvailability, true);
  r = await api.buyerInfo('bakery', mk(new Date('2026-10-21T13:05:00+03:00'), { bakery: '2026-10-20' }));
  assert.equal(r.closed, true);
  assert.equal(r.openAll, false);
  r = await api.buyerInfo('veg', mk(AT, null));
  assert.equal(r.openAll, false);
  assert.equal(r.hasAvailability, false);
});

test('xlsx: файл листа звіту через сервісний акаунт (Bearer), назва з датою; нема листа / збій Google -> помилка', async () => {
  let seen;
  const fetchFn = async (url, o) => { seen = [url, o.headers.Authorization]; return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([80, 75]).buffer }; };
  const x = createXlsx({ links: { xlsx: async (d) => (d === 'veg' ? 'https://docs/x' : '') }, token: async () => 'T', fetchFn, at: () => AT, titleOf: () => 'Овочі' });
  const f = await x('veg');
  assert.deepEqual(seen, ['https://docs/x', 'Bearer T']);
  assert.equal(f.name, 'Овочі 21.10.2026.xlsx');
  assert.equal(f.buf.toString(), 'PK');
  await assert.rejects(x('bread'), /Звіт ще не зібрано/);
  const bad = createXlsx({ links: { xlsx: async () => 'u' }, token: async () => 'T', fetchFn: async () => ({ ok: false, status: 403 }), at: () => AT, titleOf: () => 'x' });
  await assert.rejects(bad('veg'), /403/);
});

test('dayLate: late_requests напрямку за день', async () => {
  const q = [];
  const chain = { select(s) { q.push(['select', s]); return chain; }, eq(a, b) { q.push(['eq', a, b]); return chain; },
    then(res, rej) { return Promise.resolve({ data: [{ store_id: 's1' }], error: null }).then(res, rej); } };
  const sb = { from(t) { q.push(['from', t]); return chain; } };
  const rows = await dayLateOf(sb)('veg', DAY);
  assert.deepEqual(rows, [{ store_id: 's1' }]);
  assert.deepEqual(q[0], ['from', 'late_requests']);
  assert.ok(q.some((x) => x[0] === 'eq' && x[1] === 'dir' && x[2] === 'veg'));
  assert.ok(q.some((x) => x[0] === 'eq' && x[1] === 'req_date' && x[2] === DAY));
});

test('runtime: нові дії закупниці підключені; adm.dayLate; buyerXlsx', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8');
  for (const s of ['buyer.buyerInfo(dir', 'buyer.buyerLate(dir', 'write.admOpenStore({ ...(p || {}), dir }', 'write.admOpenAll({ dir }',
    'write.admCloseAll({ dir }', 'read.admReport({ dir }', 'adm.dayLate =', 'buyerXlsx']) assert.ok(src.includes(s), s);
});