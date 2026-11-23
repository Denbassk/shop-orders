// Excel «Каталог списань»: уся номенклатура ВК з ціною і ціною +20%, незалежно від того, списували позицію чи ні.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCatalog, catalogReport } = require('../src/buyer/woCatalog');
const { ReportError } = require('../src/buyer/woReport');
const { unzip } = require('../src/buyer/xlsxLocal');
const { buyerKey } = require('../src/buyer/link');
const { createApp } = require('../src/app');

const AT = new Date('2026-11-23T10:00:00Z');
const parts = (buf) => Object.fromEntries(unzip(buf).map((f) => [f.name, f.data.toString('utf8')]));
const DATA = {
  stores: [{ id: '31', label: 'Байрона, 138/1' }, { id: '38', label: 'Зернова, 6/5' }],
  products: [
    { id: '3', name: 'Салат Олів’є', barcode: '4820000000003', category: 'Кулінарія', cost: 50, stop: false, access: { mode: 'all', stores: [] } },
    { id: '1', name: 'Хліб', barcode: '', category: 'Випічка', cost: 10, stop: true, access: { mode: 'only', stores: ['31'] } },
    { id: '2', name: 'Борщ', barcode: '', category: 'Кулінарія', cost: 0, stop: false, access: { mode: 'except', stores: ['38', '99'] } },
    { id: '4', name: 'Булка 1/3', barcode: '', category: 'Випічка', cost: 3.33, stop: false, access: { mode: 'all', stores: [] } },
    { id: '5', name: '  ', category: 'Випічка', cost: 5 },
  ],
};

test('каталог: усі позиції (і стоп, і без собівартості), ціна +20% як у списанні, сортування категорія → назва', () => {
  const r = buildCatalog(DATA);
  assert.deepEqual([r.total, r.noCost, r.stop], [4, 1, 1], 'позиція без назви відкидається');
  assert.deepEqual(r.items.map((x) => x.name), ['Булка 1/3', 'Хліб', 'Борщ', 'Салат Олів’є']);
  const by = Object.fromEntries(r.items.map((x) => [x.name, x]));
  assert.deepEqual([by['Хліб'].price, by['Хліб'].price20, by['Хліб'].stop], [10, 12, true]);
  assert.deepEqual([by['Булка 1/3'].price, by['Булка 1/3'].price20], [3.33, 4], '3.33 × 1.2 = 3.996 → 4.00 (та сама формула woPlus, що в списанні)');
  assert.deepEqual([by['Борщ'].price, by['Борщ'].price20, by['Борщ'].noCost], [0, 0, true]);
  assert.equal(by['Хліб'].access, 'лише: Байрона, 138/1');
  assert.equal(by['Борщ'].access, 'усім, крім: Зернова, 6/5, 99', 'невідома точка - показується код, не падає');
  assert.equal(by['Салат Олів’є'].access, 'усім');
});

test('каталог: xlsx - числа числами, без собівартості ціни порожні й позначено, немає undefined/NaN, стилі існують', async () => {
  const f = await catalogReport('bakery', {}, { load: async () => DATA, at: AT });
  assert.equal(f.name, 'Каталог списань ВК 23.11.2026.xlsx');
  const p = parts(f.buf);
  const sh = p['xl/worksheets/sheet1.xml'];
  assert.ok(p['xl/workbook.xml'].includes('name="Каталог"'));
  for (const t of ['Каталог списань випічки і кулінарії', 'Ціна, грн', 'Ціна з націнкою, грн', 'Категорія', 'Штрихкод', 'Доступ по точках', 'Позицій: 4 (зі статусом «стоп»: 1) · без собівартості: 1',
    'Хліб', 'Борщ', 'немає собівартості', 'стоп', 'активна', '4820000000003'])
    assert.ok(sh.includes(t), t);
  assert.ok(!/undefined|NaN/.test(sh));
  const nums = [...sh.matchAll(/<c r="[A-Z]+\d+"(?: s="\d+")?><v>([^<]+)<\/v><\/c>/g)].map((m) => Number(m[1]));
  for (const n of [10, 12, 3.33, 4, 50, 60]) assert.ok(nums.includes(n), 'число ' + n);
  const count = Number(p['xl/styles.xml'].match(/<cellXfs count="(\d+)"/)[1]);
  assert.ok([...sh.matchAll(/ s="(\d+)"/g)].every((m) => Number(m[1]) < count));
  assert.ok(sh.includes('<pane ySplit="5"'));
});

test('каталог: лише випічка; порожній асортимент - помилка для людини; без джерела - збій', async () => {
  await assert.rejects(catalogReport('veg', {}, { load: async () => DATA }), (e) => e instanceof ReportError && /лише у випічки/.test(e.message));
  await assert.rejects(catalogReport('bakery', {}, { load: async () => ({ products: [], stores: [] }) }), (e) => e instanceof ReportError && /немає позицій/.test(e.message));
  await assert.rejects(catalogReport('bakery', {}, {}), (e) => !(e instanceof ReportError));
});

async function withApp(opts, fn) {
  const srv = createApp(opts).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try { await fn('http://127.0.0.1:' + srv.address().port); } finally { await new Promise((r) => srv.close(r)); }
}

test('http: GET /buyer/bakery/<ключ>/writeoff-catalog/bakery -> xlsx; чужий напрямок і ключ 404; ReportError 400; збій 502', async () => {
  const S = 'unit-secret';
  let mode = 'ok';
  const buyerWoCatalog = async (dir) => {
    if (mode === 'user') throw new ReportError('В асортименті немає позицій');
    if (mode === 'boom') throw new Error('база впала');
    return { name: 'Каталог списань ВК 23.11.2026.xlsx', buf: Buffer.from('PKcat') };
  };
  await withApp({ buyerLinkSecret: S, buyerWoCatalog }, async (b) => {
    const base = b + '/buyer/bakery/' + buyerKey('bakery', S) + '/';
    let r = await fetch(base + 'writeoff-catalog/bakery');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /spreadsheetml/);
    assert.ok(r.headers.get('content-disposition').includes(encodeURIComponent('Каталог списань ВК 23.11.2026.xlsx')));
    assert.equal(await r.text(), 'PKcat');
    assert.equal((await fetch(base + 'writeoff-catalog/veg')).status, 404);
    assert.equal((await fetch(b + '/buyer/bakery/' + buyerKey('hlib', S) + '/writeoff-catalog/bakery')).status, 404);
    mode = 'user';
    assert.equal((await fetch(base + 'writeoff-catalog/bakery')).status, 400);
    mode = 'boom';
    assert.equal((await fetch(base + 'writeoff-catalog/bakery')).status, 502);
  });
});

test('http: без opts.buyerWoCatalog каталог бере позиції з дії products закупниці (buyerApi)', async () => {
  const S = 'unit-secret';
  const seen = [];
  const buyerApi = () => async (action, payload) => { seen.push(action); return { ok: true, data: DATA, ms: 0 }; };
  await withApp({ buyerLinkSecret: S, buyerApi }, async (b) => {
    const r = await fetch(b + '/buyer/bakery/' + buyerKey('bakery', S) + '/writeoff-catalog/bakery');
    assert.equal(r.status, 200);
    assert.deepEqual(seen, ['products']);
    assert.ok(parts(Buffer.from(await r.arrayBuffer()))['xl/worksheets/sheet1.xml'].includes('Борщ'));
  });
});

test('сторінка ВК: на вкладці «Списання» кнопка «Каталог цін» тягне /writeoff-catalog/', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  for (const t of ['function woCatalogDl', "'/writeoff-catalog/'", 'onclick="woCatalogDl()"', 'Усі позиції: ціна і ціна з націнкою'])
    assert.ok(html.includes(t), t);
});
