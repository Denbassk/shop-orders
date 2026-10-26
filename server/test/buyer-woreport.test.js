// Звіт про списання ВК за день для друку: окремо по юрособі (Фемели Маркет, ЮА Маркет).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildDayReport, buildDayXlsx, dayReport, ReportError } = require('../src/buyer/woReport');
const { unzip } = require('../src/buyer/xlsxLocal');
const { buyerKey } = require('../src/buyer/link');
const { createApp } = require('../src/app');

const FEM = 'Фемели Маркет', UA = 'ЮА Маркет';
let n = 0;
const row = (over) => ({ id: 'd' + (++n), day: '2026-10-23', at: '2026-10-23', time: '10:00', store: 'Байрона, 138/1', code: '31',
  cat: 'Кулінарія', name: 'Салат Олів\'є 165г', qty: 1, price: 10, sum: 10, sum20: 12, seller: 'Фадеева', entity: FEM, ...over });

const ROWS = [
  row({ id: 'd-main', name: 'Салат А', qty: 2, price: 10.1, sum: 20.2, sum20: 24.24 }),
  row({ id: 'd-other-doc', name: 'Салат А', qty: 1, price: 10.1, sum: 10.1, sum20: 12.12, seller: 'Іванова', time: '12:30' }),   // той самий товар з іншої подачі
  row({ id: 'd-main', name: 'Хліб Козацький 500г', cat: 'Випічка', qty: 3, price: 12.38, sum: 37.14, sum20: 44.57 }),
  row({ store: 'Зернова, 6/5', code: '38', name: 'Салат А', qty: 1, price: 10.1, sum: 10.1, sum20: 12.12, seller: '' }),
  row({ entity: UA, store: 'Танкопія, 16', code: '12', name: 'Борщ 450г', qty: 2, price: 24, sum: 48, sum20: 57.6 }),
  row({ day: '2026-10-22', name: 'Вчорашній', qty: 5, price: 1, sum: 5, sum20: 6 }),
];

// ---------- збирання звіту ----------
test('звіт: лише обрані день і юрособа; групи по точках; однакові товари однієї точки злито; підсумки округлені до копійок', () => {
  const r = buildDayReport(ROWS, { entity: FEM, day: '2026-10-23' });
  assert.equal(r.entity, FEM);
  assert.equal(r.day, '2026-10-23');
  assert.deepEqual(r.stores.map((s) => s.store), ['Байрона, 138/1', 'Зернова, 6/5']);
  const b = r.stores[0];
  assert.equal(b.code, '31');
  assert.deepEqual(b.items.map((i) => [i.cat, i.name, i.qty, i.price, i.sum, i.sum20]), [
    ['Випічка', 'Хліб Козацький 500г', 3, 12.38, 37.14, 44.57],
    ['Кулінарія', 'Салат А', 3, 10.1, 30.3, 36.36],
  ]);
  assert.deepEqual([b.qty, b.sum, b.sum20], [6, 67.44, 80.93]);
  assert.deepEqual(b.sellers, ['Фадеева', 'Іванова']);
  assert.deepEqual(r.stores[1].sellers, []);
  assert.deepEqual(r.total, { qty: 7, sum: 77.54, sum20: 93.05, stores: 2, docs: 3 });
});

test('звіт: ЮА окремо від Фемели; інший день не потрапляє; порожньо -> null', () => {
  const ua = buildDayReport(ROWS, { entity: UA, day: '2026-10-23' });
  assert.deepEqual(ua.stores.map((s) => s.store), ['Танкопія, 16']);
  assert.deepEqual([ua.total.sum, ua.total.sum20, ua.total.qty], [48, 57.6, 2]);
  assert.equal(buildDayReport(ROWS, { entity: UA, day: '2026-10-22' }), null);
  assert.equal(buildDayReport([], { entity: FEM, day: '2026-10-23' }), null);
});

test('звіт: суми за 0.1+0.2 не дають 0.30000000000000004; позиції з різною ціною не зливаються', () => {
  const rows = [
    row({ name: 'X', qty: 1, price: 0.1, sum: 0.1, sum20: 0.12 }),
    row({ name: 'X', qty: 1, price: 0.2, sum: 0.2, sum20: 0.24 }),
    row({ name: 'Y', qty: 0.3, price: 0.1, sum: 0.03, sum20: 0.04 }),
    row({ name: 'Y', qty: 0.6, price: 0.1, sum: 0.06, sum20: 0.07 }),
  ];
  const r = buildDayReport(rows, { entity: FEM, day: '2026-10-23' });
  assert.equal(r.stores[0].items.length, 3);
  assert.equal(r.total.sum, 0.39);
  const y = r.stores[0].items.find((i) => i.name === 'Y');
  assert.equal(y.qty, 0.9);
});

// ---------- xlsx ----------
function parts(buf) {
  const files = unzip(buf);
  return Object.fromEntries(files.map((f) => [f.name, f.data.toString('utf8')]));
}

test('xlsx: коректний zip з потрібними частинами; заголовок, дата, юрособа, точки, підсумки, друк на A4 по ширині', () => {
  const r = buildDayReport(ROWS, { entity: FEM, day: '2026-10-23' });
  const p = parts(buildDayXlsx(r));
  for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml'])
    assert.ok(p[f], f);
  const s = p['xl/worksheets/sheet1.xml'];
  for (const t of ['Списання випічки і кулінарії', 'Юрособа: Фемели Маркет', 'Дата списання: 23.10.2026', 'Байрона, 138/1 · №31', 'Зернова, 6/5 · №38',
    'Подали: Фадеева, Іванова', 'Хліб Козацький 500г', 'Разом по точці', 'ВСЬОГО за день', 'Товар', 'Кількість', 'Собівартість', 'Сума з націнкою'])
    assert.ok(s.includes(t), t);
  assert.ok(!s.includes('Вчорашній') && !s.includes('Танкопія'));
  assert.ok(!/undefined|NaN/.test(s));
  assert.ok(s.includes('fitToPage="1"') && s.includes('fitToWidth="1"') && s.includes('fitToHeight="0"') && s.includes('paperSize="9"'));
  assert.ok(p['xl/workbook.xml'].includes('Фемели Маркет 23.10.2026'));
});

test('xlsx: числа - числами (не текстом), підсумки збігаються зі звітом; спецсимволи екрануються', () => {
  const rows = [row({ store: 'A & <B> "C"', name: 'Пиріг <мигдаль> & «мед»', qty: 2.5, price: 3.33, sum: 8.33, sum20: 9.99 })];
  const r = buildDayReport(rows, { entity: FEM, day: '2026-10-23' });
  const s = parts(buildDayXlsx(r))['xl/worksheets/sheet1.xml'];
  assert.ok(s.includes('A &amp; &lt;B&gt; &quot;C&quot; · №31'));
  assert.ok(s.includes('Пиріг &lt;мигдаль&gt; &amp; «мед»'));
  const nums = [...s.matchAll(/<c r="[A-Z]+\d+"(?: s="\d+")?><v>([^<]+)<\/v><\/c>/g)].map((m) => Number(m[1]));
  for (const v of [2.5, 3.33, 8.33, 9.99]) assert.ok(nums.includes(v), String(v));
  assert.ok(nums.every((v) => Number.isFinite(v)));
});

test('xlsx: індекси стилів у аркуші існують у styles.xml', () => {
  const r = buildDayReport(ROWS, { entity: FEM, day: '2026-10-23' });
  const p = parts(buildDayXlsx(r));
  const count = Number(p['xl/styles.xml'].match(/<cellXfs count="(\d+)"/)[1]);
  const used = [...p['xl/worksheets/sheet1.xml'].matchAll(/ s="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(used.length > 10);
  assert.ok(used.every((i) => i < count), `максимум ${Math.max(...used)} при ${count} стилях`);
  assert.equal((p['xl/styles.xml'].match(/<xf /g) || []).length, count + 1, 'cellStyleXfs 1 + cellXfs');
});

// ---------- dayReport: вибір даних, помилки ----------
const loadOk = (list, books = [FEM, UA]) => async (arch) => { loadOk.arch = arch; return { list, meta: { books, errors: [] } }; };
const AT = new Date('2026-10-23T14:00:00+03:00');

test('dayReport: файл за день і юрособою; назва українською; читає таблиці свіжо', async () => {
  let fresh;
  const f = await dayReport('bakery', { date: '2026-10-23', entity: UA }, { load: async (arch, fr) => { fresh = fr; return { list: ROWS, meta: { books: [FEM, UA], errors: [] } }; }, at: AT });
  assert.equal(f.name, 'Списання ВК ЮА Маркет 23.10.2026.xlsx');
  assert.equal(fresh, true);
  assert.ok(Buffer.isBuffer(f.buf) && f.buf.readUInt32LE(0) === 0x04034b50);
  assert.ok(parts(f.buf)['xl/worksheets/sheet1.xml'].includes('Танкопія, 16'));
});

test('dayReport: день старший за 31 день читає й архів', async () => {
  await dayReport('bakery', { date: '2026-10-23', entity: FEM }, { load: loadOk(ROWS), at: AT });
  assert.equal(loadOk.arch, false);
  await assert.rejects(dayReport('bakery', { date: '2026-08-01', entity: FEM }, { load: loadOk(ROWS), at: AT }), /немає/);
  assert.equal(loadOk.arch, true);
});

test('dayReport: помилки з людським текстом (ReportError)', async () => {
  const d = { load: loadOk(ROWS), at: AT };
  const bad = async (p, re, dir = 'bakery') => assert.rejects(dayReport(dir, p, d), (e) => e instanceof ReportError && re.test(e.message), JSON.stringify(p));
  await bad({ date: '2026-10-23', entity: FEM }, /лише у випічки/, 'veg');
  await bad({ date: '23.10.2026', entity: FEM }, /Невірна дата/);
  await bad({ date: '2026-02-30', entity: FEM }, /Невірна дата/);
  await bad({ date: '', entity: FEM }, /Невірна дата/);
  await bad({ date: '2026-10-24', entity: FEM }, /майбутн/);
  await bad({ date: '2026-10-23', entity: 'Хтось' }, /Невідома юрособа/);
  await bad({ date: '2026-10-23' }, /Невідома юрособа/);
  await bad({ date: '2026-10-21', entity: UA }, /Списань за 21\.10\.2026 по «ЮА Маркет» немає/);
});

test('dayReport: таблиці списань недоступні -> текст з причиною, не порожній файл', async () => {
  const d = { load: async () => ({ list: [], meta: { books: [FEM], errors: ['ЮА Маркет: немає доступу'] } }), at: AT };
  await assert.rejects(dayReport('bakery', { date: '2026-10-23', entity: UA }, d), (e) => e instanceof ReportError && /ЮА Маркет: немає доступу/.test(e.message));
});

// ---------- HTTP ----------
async function withApp(opts, fn) {
  const srv = createApp(opts).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try { await fn('http://127.0.0.1:' + srv.address().port); } finally { await new Promise((r) => srv.close(r)); }
}
const S = 'unit-secret';

test('http: GET /buyer/bakery/<ключ>/writeoff-report/bakery?date&entity -> xlsx з назвою; чужий напрямок і ключ 404; ReportError 400; збій 502', async () => {
  const calls = [];
  let mode = 'ok';
  const buyerWoReport = async (dir, p) => {
    calls.push([dir, p]);
    if (mode === 'user') throw new ReportError('Списань за 23.10.2026 по «ЮА Маркет» немає');
    if (mode === 'boom') throw new Error('Google впав');
    return { name: 'Списання ВК ЮА Маркет 23.10.2026.xlsx', buf: Buffer.from('PKwo') };
  };
  await withApp({ buyerLinkSecret: S, buyerWoReport }, async (b) => {
    const base = b + '/buyer/bakery/' + buyerKey('bakery', S) + '/writeoff-report/';
    const q = '?date=2026-10-23&entity=' + encodeURIComponent(UA);
    let r = await fetch(base + 'bakery' + q);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /spreadsheetml/);
    assert.ok(r.headers.get('content-disposition').includes(encodeURIComponent('Списання ВК ЮА Маркет 23.10.2026.xlsx')));
    assert.equal(await r.text(), 'PKwo');
    assert.deepEqual(calls[0], ['bakery', { date: '2026-10-23', entity: UA }]);
    assert.equal((await fetch(base + 'veg' + q)).status, 404);
    assert.equal((await fetch(b + '/buyer/bakery/' + buyerKey('hlib', S) + '/writeoff-report/bakery' + q)).status, 404);
    assert.equal((await fetch(b + '/buyer/hlib/' + buyerKey('hlib', S) + '/writeoff-report/bakery' + q)).status, 404);
    mode = 'user';
    r = await fetch(base + 'bakery' + q);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'Списань за 23.10.2026 по «ЮА Маркет» немає');
    mode = 'boom';
    r = await fetch(base + 'bakery' + q);
    assert.equal(r.status, 502);
  });
});

// ---------- сторінка закупниці ----------
test('сторінка ВК: на вкладці «Списання» блок «Звіт для друку» з датою і кнопками по юрособах; завантаження через сервер', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  for (const s of ['Звіт для друку', 'type="date"', "'/writeoff-report/'", 'function woDownload', 'woRepDate'])
    assert.ok(html.includes(s), s);
});

test('звіт: позиція без собівартості (ціна 0) позначена в таблиці, щоб бухгалтерія бачила', () => {
  const r = buildDayReport([row({ id: 'z1', name: 'Салат з курячим філе та ананасами 175г', qty: 2, price: 0, sum: 0, sum20: 0 })], { entity: FEM, day: '2026-10-23' });
  const cells = require('../src/buyer/woReport').sheetModel(r).flat().filter((c) => c.t).map((c) => c.t);
  assert.ok(cells.includes('Салат з курячим філе та ананасами 175г (без собівартості)'));
});

test('сторінка ВК: на вкладці «Списання» календар періоду «З - по» передає from/to у запит і не ховає пресети', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  for (const s of ['function woDateBox', 'id="woFrom"', 'id="woTo"', 'function woPick()', 'from: WO.from, to: WO.to', 'WO.archFrom'])
    assert.ok(html.includes(s), s);
});
