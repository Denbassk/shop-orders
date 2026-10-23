// Екрани «Списання» пульта на базі (замість Apps Script admWo*_): плашка, статистика, картка точки, видалення, режим «відкрито».
const test = require('node:test');
const assert = require('node:assert/strict');
const WO = require('../src/admin/writeoffs');

const AT = new Date('2026-10-23T14:00:00+03:00');
const line = (n, name, qty, amount, over = {}) => ({ line_no: n, product_id: 'p' + n, barcode: 'bc-' + name, category: 'Випічка', name, qty, price: amount / qty, amount, ...over });
const wo = (id, store, day, at, total, lines, over = {}) => ({ id: 'pk-' + id, doc_id: id, store_id: store, store_label: 'Точка ' + store, store_code: '1' + store, edrpou: '44413718',
  wo_date: day, seller: 'Оля', total, submitted_at: at, lines, ...over });
const ROWS = [
  wo('aaaaaaaa1', 's1', '2026-10-23', '2026-10-23T08:30:00+03:00', 150, [line(1, 'Круасан', 5, 100), line(2, 'Булка', 2, 50)]),
  wo('aaaaaaaa2', 's2', '2026-10-23', '2026-10-23T09:10:00+03:00', 40, [line(1, 'Круасан', 2, 40)], { edrpou: '45672783' }),
  wo('aaaaaaaa3', 's1', '2026-10-20', '2026-10-20T08:00:00+03:00', 60, [line(1, 'Булка', 3, 60)]),
  wo('aaaaaaaa4', 's1', '2026-09-30', '2026-09-30T08:00:00+03:00', 500, [line(1, 'Булка', 30, 500)]),
];
const STORES = [
  { id: 's1', label: 'Точка s1', code: '1s1', edrpou: '', directions: ['bakery'] },
  { id: 's2', label: 'Точка s2', code: '1s2', edrpou: '45672783', directions: ['bakery'] },
  { id: 's3', label: 'Точка s3', code: '1s3', edrpou: '', directions: ['bakery'] },
  { id: 's4', label: 'Без випічки', code: '1s4', edrpou: '', directions: ['bread'] },
];
function mkEnv(over = {}) {
  const calls = { deleted: [], log: [], settings: [] };
  const settings = { wo_books: { 44413718: { id: 'B1', name: 'ЄДРПОУ 44413718' }, 45672783: { id: 'B2', name: 'ЄДРПОУ 45672783' } }, ...over.settings };
  return { calls, env: {
    at: over.at || AT,
    data: {
      settings: async () => settings,
      stores: async () => STORES,
      products: async () => [{ id: 'p1', name: 'Круасан', barcode: 'b1', cost: 20, price: 30, sort: 1, status: 'active' }, { id: 'p2', name: 'Без ціни', barcode: '', cost: 0, price: 10, sort: 2 }],
      woRange: async (from, to) => ROWS.filter((w) => w.wo_date >= from && w.wo_date <= to),
      woFind: async (id) => ROWS.find((w) => w.doc_id === id) || null,
      woMarkDeleted: async (id) => { calls.deleted.push(id); return true; },
      adminLog: async (a, d) => { calls.log.push([a, d]); },
    },
    adm: { setSetting: async (k, v) => { calls.settings.push([k, v]); settings[k] = v; } },
    queueWoExport: (k) => calls.log.push(['queue', k]),
  } };
}

test('woBrief: сьогодні - документи/точки/сума за днем подання, місяць - від 1-го числа; не-випічка не рахується', async () => {
  const { env } = mkEnv();
  const b = await WO.admWoBrief(env);
  assert.deepEqual([b.todayDocs, b.todayStores, b.todaySum, b.monthSum, b.books], [2, 2, 190, 250, 2]);
  assert.equal(b.closed, true, 'після дедлайну приймання закрите');
  assert.equal(b.openedAll, false);
  assert.match(b.deadline, /^\d\d:\d\d$/);
});

test('woStats: за місяць - сума, рядки, продукти, точки, мовчазні точки, ЄДРПОУ без таблиці', async () => {
  const { env } = mkEnv({ settings: { wo_books: { 44413718: { id: 'B1', name: 'Фемелі' } } } });
  const s = await WO.admWoStats({ period: 'month' }, env);
  assert.equal(s.total, 250);
  assert.equal(s.docs, 3);
  assert.deepEqual(s.stores.map((x) => [x.id, x.sum, x.docs]), [['s1', 210, 2], ['s2', 40, 1]]);
  assert.deepEqual(s.products.map((x) => [x.name, x.sum]), [['Круасан', 140], ['Булка', 110]]);
  assert.deepEqual(s.silent, ['Точка s3']);
  assert.deepEqual(s.missing, [{ edrpou: '45672783', stores: ['Точка s2'] }]);
  assert.deepEqual([s.costCol, s.prodCount, s.noCost], [true, 1, ['Без ціни']]);
  assert.equal(s.from, '01.10.2026');
  assert.equal(s.to, '23.10.2026');
  const ent = await WO.admWoStats({ period: 'month', edrpou: '45672783' }, mkEnv().env);
  assert.deepEqual([ent.total, ent.stores.length], [40, 1]);
  assert.equal((await WO.admWoStats({ period: 'prev' }, mkEnv().env)).total, 500, 'минулий місяць');
});

test('woStore: документи точки з позиціями і ЄДРПОУ, сума за період', async () => {
  const { env } = mkEnv();
  const d = await WO.admWoStore({ period: 'month', storeId: 's1' }, env);
  assert.equal(d.total, 210);
  assert.equal(d.docs.length, 2);
  assert.deepEqual(d.docs[0].items.map((i) => i.name), ['Круасан', 'Булка']);
  assert.equal(d.docs[0].edrpou, '44413718');
  assert.equal(d.bookUrl, 'https://docs.google.com/spreadsheets/d/B1/edit');
});

test('woDelete: без дедлайну, пишемо журнал і ставимо вигрузку; невідомий ID - помилка', async () => {
  const { env, calls } = mkEnv();
  const r = await WO.admWoDelete({ docId: 'aaaaaaaa3' }, env);
  assert.deepEqual([r.removed, r.total, r.date], [1, 60, '20.10.2026']);
  assert.deepEqual(calls.deleted, ['pk-aaaaaaaa3']);
  assert.ok(calls.log.some((x) => x[0] === 'Видалено списання (пульт)') && calls.log.some((x) => x[0] === 'queue'));
  await assert.rejects(WO.admWoDelete({ docId: 'zzzzzzzz9' }, env), /не найдено/);
  await assert.rejects(WO.admWoDelete({ docId: 'x' }, env), /Невірний ID/);
});

test('woOpen: «відкрити до кінця дня» ставить wo_late = сьогодні, плашка бачить openedAll і приймання відкрите', async () => {
  const { env, calls } = mkEnv();
  const r = await WO.admWoOpen({ on: true }, env);
  assert.deepEqual(calls.settings, [['wo_late', '23.10.2026']]);
  assert.deepEqual([r.closed, r.openedAll], [false, true]);
  const off = await WO.admWoOpen({ on: false }, env);
  assert.deepEqual([off.closed, off.openedAll], [true, false]);
});

test('woArchive/woSetup: архів не потрібен; setup - помилка з ЄДРПОУ без таблиці, інакше нічого не створює', async () => {
  await assert.rejects(WO.admWoArchive(), /Архів не потрібен/);
  const ok = await WO.admWoSetup({}, mkEnv().env);
  assert.deepEqual(ok.map((x) => [x.edrpou, x.created]), [['44413718', false], ['45672783', false]]);
  await assert.rejects(WO.admWoSetup({}, mkEnv({ settings: { wo_books: { 44413718: { id: 'B1' } } } }).env), /45672783/);
});
