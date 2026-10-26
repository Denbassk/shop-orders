// Сирі замовлення ВК за день: файл з листа «_Сырые_Заказы_ВК» або «_Архів», дата з календаря на вкладці «Звіти».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rawReport } = require('../src/buyer/rawReport');
const { ReportError } = require('../src/buyer/woReport');
const { unzip } = require('../src/buyer/xlsxLocal');
const { buyerKey } = require('../src/buyer/link');
const { createApp } = require('../src/app');

const AT = new Date('2026-10-26T10:00:00+03:00');
const RAW = [
  ['Дата', 'Час', 'Адреса ТТ', 'Маршрут', 'Штрих-код', 'Номенклатура', 'Ціна', 'Кількість'],
  ['25.10.2026', '08:35:49', 'м. Харків пр-т Байрона, 138/1', 'Салтовка', '2984670079406', 'Кулінарія Салат <з> курячим філе та сиром 175г', '62', '2'],
  ['26.10.2026', '09:01:10', 'м. Харків вул. Амосова, 5А', 'ХБИ', '2984670066468', 'Випічка Пампушка з часником 300г', '37,5', '3'],
  ['26.10.2026', '09:05:00', 'м. Харків вул. Амосова, 5А', 'ХБИ', '2984670079406', 'Кулінарія Салат з курячим філе та сиром 175г', '62', '1'],
];
const ARCH = [
  ['Дата', 'Час', 'Адрес ТТ', 'Категорія', 'Штрих-код', 'Назва', 'Ціна', 'Кількість'],
  ['19.02.2026', '30.12.1899', 'м. Харків пр-т Байрона, 138/1', 'Випічка', '2984670066468', 'Випічка Пампушка з часником 300г', '37,5', '4'],
  ['20.02.2026', '30.12.1899', 'м. Харків вул. Роганська, 130/4', 'Випічка', '2984670066468', 'Випічка Пампушка з часником 300г', '37,5', '2'],
];
const read = (reads) => async (sheet) => { reads.push(sheet); return sheet === '_Архів' ? ARCH : RAW; };
const cells = (buf) => unzip(buf).find((f) => f.name === 'xl/worksheets/sheet1.xml').data.toString('utf8');

test('rawReport: день з сирого листа - лише його рядки, числа числами, спецсимволи екрануються, підсумок кількості', async () => {
  const reads = [];
  const f = await rawReport('bakery', { date: '2026-10-26' }, { at: AT, read: read(reads) });
  assert.equal(f.name, 'Сирі замовлення ВК 26.10.2026.xlsx');
  assert.deepEqual([f.rows, f.source], [2, 'raw']);
  assert.deepEqual(reads, ['_Сырые_Заказы_ВК'], 'архів не читаємо, якщо день є в сирому листі');
  const s = cells(f.buf);
  for (const t of ['Сирі замовлення · ', 'Дата: 26.10.2026', 'Маршрут', 'вул. Амосова, 5А', 'Пампушка з часником 300г', 'Разом: рядків 2']) assert.ok(s.includes(t), t);
  assert.ok(!s.includes('Байрона') && !/undefined|NaN/.test(s));
  const nums = [...s.matchAll(/<v>([^<]+)<\/v>/g)].map((m) => Number(m[1]));
  for (const v of [37.5, 3, 62, 1, 4]) assert.ok(nums.includes(v), String(v));
  const esc = cells((await rawReport('bakery', { date: '2026-10-25' }, { at: AT, read: read([]) })).buf);
  assert.ok(esc.includes('Салат &lt;з&gt; курячим'));
});

test('rawReport: старий день - з «_Архів» (шапка «Категорія», час 30.12.1899 не показуємо)', async () => {
  const reads = [];
  const f = await rawReport('bakery', { date: '2026-02-19' }, { at: AT, read: read(reads) });
  assert.deepEqual([f.rows, f.source], [1, 'arch']);
  assert.deepEqual(reads, ['_Сырые_Заказы_ВК', '_Архів']);
  const s = cells(f.buf);
  assert.ok(s.includes('Категорія') && s.includes('Байрона') && !s.includes('1899'));
});

test('rawReport: помилки для людини - немає даних, дата у майбутньому, невірна дата, не випічка', async () => {
  const d = { at: AT, read: read([]) };
  await assert.rejects(rawReport('bakery', { date: '2026-03-01' }, d), (e) => e instanceof ReportError && /немає/.test(e.message));
  await assert.rejects(rawReport('bakery', { date: '2026-10-27' }, d), /майбутньому/);
  await assert.rejects(rawReport('bakery', { date: '2026-13-01' }, d), /Невірна дата/);
  await assert.rejects(rawReport('bakery', {}, d), /Невірна дата/);
  await assert.rejects(rawReport('bread', { date: '2026-10-26' }, d), /лише у випічки/);
});

async function withApp(opts, fn) {
  const srv = createApp(opts).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try { await fn('http://127.0.0.1:' + srv.address().port); } finally { await new Promise((r) => srv.close(r)); }
}

test('http: GET /buyer/bakery/<ключ>/raw-report/bakery?date -> xlsx з назвою; чужий ключ/напрямок 404; ReportError 400; збій 502', async () => {
  const S = 'unit-secret', calls = [];
  let mode = 'ok';
  const buyerRawReport = async (dir, p) => {
    calls.push([dir, p]);
    if (mode === 'user') throw new ReportError('Сирих замовлень за 01.03.2026 немає');
    if (mode === 'boom') throw new Error('Google впав');
    return { name: 'Сирі замовлення ВК 26.10.2026.xlsx', buf: Buffer.from('PKraw') };
  };
  await withApp({ buyerLinkSecret: S, buyerRawReport }, async (b) => {
    const base = b + '/buyer/bakery/' + buyerKey('bakery', S) + '/raw-report/';
    let r = await fetch(base + 'bakery?date=2026-10-26');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /spreadsheetml/);
    assert.ok(r.headers.get('content-disposition').includes(encodeURIComponent('Сирі замовлення ВК 26.10.2026.xlsx')));
    assert.deepEqual(calls[0], ['bakery', { date: '2026-10-26' }]);
    assert.equal((await fetch(base + 'veg?date=2026-10-26')).status, 404);
    assert.equal((await fetch(b + '/buyer/bakery/' + buyerKey('hlib', S) + '/raw-report/bakery?date=2026-10-26')).status, 404);
    mode = 'user';
    r = await fetch(base + 'bakery?date=2026-03-01');
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'Сирих замовлень за 01.03.2026 немає');
    mode = 'boom';
    assert.equal((await fetch(base + 'bakery?date=2026-10-26')).status, 502);
  });
});

test('сторінка ВК: у «Звітах» кулінарії картка «Сирі замовлення за день» з календарем і кнопкою Excel', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  for (const s of ['function rawCard', 'id="rawDate"', 'function rawDownload', "'/raw-report/'", "S.dir === 'bakery') h += rawCard()"]) assert.ok(html.includes(s), s);
});
