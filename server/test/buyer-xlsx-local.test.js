'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const X = require('../src/buyer/xlsxLocal');

function unzip(buf) {
  const out = {}; let p = 0;
  while (p + 4 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const crc = buf.readUInt32LE(p + 14), cs = buf.readUInt32LE(p + 18), nl = buf.readUInt16LE(p + 26), xl = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nl).toString('utf8');
    const raw = zlib.inflateRawSync(buf.subarray(p + 30 + nl + xl, p + 30 + nl + xl + cs));
    assert.equal(X.crc32(raw), crc, 'crc ' + name);
    out[name] = raw.toString('utf8'); p += 30 + nl + xl + cs;
  }
  return out;
}

test('xlsxLocal: crc32 і назви колонок', () => {
  assert.equal(X.crc32(Buffer.from('123456789')), 0xCBF43926);
  assert.equal(X.colName(0), 'A'); assert.equal(X.colName(25), 'Z'); assert.equal(X.colName(26), 'AA');
});

test('xlsxLocal: «3,» -> число 3; коди і штрихкоди - текстом; адреси не чіпаємо', () => {
  assert.deepEqual(X.toCell('3,'), { n: 3 });
  assert.deepEqual(X.toCell('366'), { n: 366 });
  assert.deepEqual(X.toCell('2,5'), { n: 2.5, money: false });
  assert.deepEqual(X.toCell('4 510,00'), { n: 4510, money: true });
  assert.deepEqual(X.toCell('4\u00a0510,00'), { n: 4510, money: true });
  assert.deepEqual(X.toCell('4820017291873'), { s: '4820017291873' });
  assert.deepEqual(X.toCell('44413718'), { s: '44413718' });
  assert.deepEqual(X.toCell('0123'), { s: '0123' });
  assert.deepEqual(X.toCell('Бучми, 32'), { s: 'Бучми, 32' });
  assert.deepEqual(X.toCell('21.10.2026'), { s: '21.10.2026' });
  assert.equal(X.toCell(''), null); assert.equal(X.toCell(null), null);
  assert.deepEqual(X.toCell(7), { n: 7 });
  assert.deepEqual(X.toCell({ v: '82,' }), { n: 82 });
});

test('xlsxLocal: справжній xlsx - 6 частин, шапка і РАЗОМ жирні, без «3,», екранування', () => {
  const buf = X.buildXlsx([['Товар', 'Кіл-ть', 'Сума'], ['Булка <&> "А"', '3,', '4 510,00'], ['РАЗОМ', '366,', '9 020,00'], ['Штрихкод', '4820017291873']], 'Заказы ВК');
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const z = unzip(buf);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(z[n], n);
  const sh = z['xl/worksheets/sheet1.xml'];
  assert.match(z['xl/workbook.xml'], /name="Заказы ВК"/);
  assert.match(sh, /<c r="A1" s="1" t="inlineStr">/);
  assert.match(sh, /<c r="B2"><v>3<\/v><\/c>/);
  assert.match(sh, /<c r="C2" s="2"><v>4510<\/v><\/c>/);
  assert.match(sh, /<c r="B3" s="1"><v>366<\/v><\/c>/);
  assert.match(sh, /<c r="C3" s="3"><v>9020<\/v><\/c>/);
  assert.match(sh, /Булка &lt;&amp;&gt; &quot;А&quot;/);
  assert.match(sh, /<c r="B4" t="inlineStr"><is><t xml:space="preserve">4820017291873<\/t>/);
  assert.match(sh, /state="frozen"/);
  assert.doesNotMatch(sh, /\d,<\/t>/);
});

test('xlsxLocal: назва листа без заборонених символів і не довша за 31', () => {
  assert.equal(X.sheetName('a/b:c'), 'a b c');
  assert.equal(X.sheetName('x'.repeat(40)).length, 31);
  assert.equal(X.sheetName(''), 'Звіт');
});

test('xlsxLocal: форма даних листа - масив, {rows}, {header, rows}, {values}', () => {
  assert.deepEqual(X.pickRows([['a'], ['b']]), [['a'], ['b']]);
  assert.deepEqual(X.pickRows({ rows: [['b']] }), [['b']]);
  assert.deepEqual(X.pickRows({ header: ['a'], rows: [['b']] }), [['a'], ['b']]);
  assert.deepEqual(X.pickRows({ values: [['a']] }), [['a']]);
  assert.throws(() => X.pickRows({ foo: 1 }), /невідома форма/);
});

test('xlsxLocal: fetchFor - свіжий лист, відповідь як від Google (xlsx, 200)', async () => {
  const calls = [];
  const sheets = { read: async (dir, key, o) => { calls.push([dir, key, o]); return { title: 'Сводная ВК', rows: [['Товар', 'Кіл-ть'], ['Булка', '82,']] }; } };
  const f = X.fetchFor(sheets, 'bakery', 'summary', async () => { throw new Error('Google не мав викликатись'); });
  const res = await f('https://docs.google.com/x/export?format=xlsx&gid=1', {});
  assert.equal(res.ok, true); assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), X.CT);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  assert.match(unzip(buf)['xl/worksheets/sheet1.xml'], /<v>82<\/v>/);
  assert.deepEqual(calls, [['bakery', 'summary', { fresh: true }]]);
});

test('xlsxLocal: не вдалось зібрати - качаємо в Google як раніше', async () => {
  const sheets = { read: async () => { throw new Error('нема листа'); } };
  const seen = [];
  const f = X.fetchFor(sheets, 'bread', 'orders', async (u) => { seen.push(u); return { ok: true, status: 200 }; });
  const res = await f('URL', {});
  assert.deepEqual(seen, ['URL']); assert.equal(res.ok, true);
});

test('xlsxLocal: підключено в runtime через fetchFn, BUYER_XLSX=google вимикає', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8');
  assert.match(s, /require\('\.\.\/buyer\/xlsxLocal'\)\.fetchFor\(buyerSheets/);
  assert.match(s, /BUYER_XLSX === 'google'/);
});