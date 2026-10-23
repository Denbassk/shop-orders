'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const X = require('../src/buyer/xlsxLocal');

const STY = '<styleSheet><numFmts count="3"><numFmt numFmtId="164" formatCode="0.###"/><numFmt numFmtId="165" formatCode="#,##0.00"/><numFmt numFmtId="166" formatCode="#,##0.###"/></numFmts><fills><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills></styleSheet>';
const SHEET = '<worksheet><cols><col min="1" max="1" width="40"/></cols><mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells><sheetData><row r="1"><c r="A1" s="3" t="s"><v>0</v></c></row></sheetData></worksheet>';
const googleXlsx = () => X.zip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'xl/styles.xml', data: STY }, { name: 'xl/worksheets/sheet1.xml', data: SHEET }]);
const get = (files, n) => files.find((x) => x.name === n).data.toString('utf8');

test('xlsxLocal: crc32 і назви колонок', () => {
  assert.equal(X.crc32(Buffer.from('123456789')), 0xCBF43926);
  assert.equal(X.colName(0), 'A'); assert.equal(X.colName(26), 'AA');
});

test('xlsxLocal: fixStyles - лише формати з крапкою без обовʼязкових знаків після неї', () => {
  const r = X.fixStyles(STY);
  assert.equal(r.n, 2);
  assert.doesNotMatch(r.xml, /0\.###/);
  assert.match(r.xml, /numFmtId="164" formatCode="General"/);
  assert.match(r.xml, /numFmtId="165" formatCode="#,##0\.00"/);
  assert.match(r.xml, /numFmtId="166" formatCode="General"/);
  assert.match(r.xml, /FFFFFF00/);
});

test('xlsxLocal: unzip читає zip через центральний каталог', () => {
  const files = X.unzip(googleXlsx());
  assert.deepEqual(files.map((x) => x.name), ['[Content_Types].xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
  assert.equal(get(files, 'xl/worksheets/sheet1.xml'), SHEET);
});

test('xlsxLocal: fetchFor - файл Google, оформлення як було, «0.###» -> General, лист не читаємо', async () => {
  const src = googleXlsx(); const seen = [];
  const sheets = { read: async () => { throw new Error('лист не мав читатись'); } };
  const f = X.fetchFor(sheets, 'bakery', 'routes', async (u, o) => { seen.push([u, o]); return new Response(src, { status: 200, headers: { 'content-type': X.CT, 'content-length': String(src.length) } }); });
  const res = await f('https://docs.google.com/x/export?format=xlsx&gid=1', { headers: { Authorization: 'Bearer t' } });
  assert.equal(res.ok, true); assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), X.CT);
  assert.equal(seen.length, 1); assert.equal(seen[0][1].headers.Authorization, 'Bearer t');
  const files = X.unzip(Buffer.from(await res.arrayBuffer()));
  assert.match(get(files, 'xl/styles.xml'), /numFmtId="164" formatCode="General"/);
  assert.match(get(files, 'xl/styles.xml'), /#,##0\.00/);
  assert.equal(get(files, 'xl/worksheets/sheet1.xml'), SHEET);
});

test('xlsxLocal: сторінка входу Google - як є (xlsx.js покаже помилку)', async () => {
  const f = X.fetchFor({}, 'bread', 'orders', async () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const res = await f('U', {});
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(await res.text(), '<html>login</html>');
});

test('xlsxLocal: помилка Google (403) - та сама відповідь', async () => {
  const orig = new Response('no', { status: 403 });
  const f = X.fetchFor({}, 'bread', 'orders', async () => orig);
  assert.equal(await f('U', {}), orig);
});

test('xlsxLocal: зламаний zip - файл як є, без падіння', async () => {
  const bad = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(40)]);
  const f = X.fetchFor({}, 'veg', 'orders', async () => new Response(bad, { status: 200, headers: { 'content-type': X.CT } }));
  const res = await f('U', {});
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bad);
});

test('xlsxLocal: підключено в runtime через fetchFn, BUYER_XLSX=google вимикає', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8');
  assert.match(s, /require\('\.\.\/buyer\/xlsxLocal'\)\.fetchFor\(buyerSheets/);
  assert.match(s, /BUYER_XLSX === 'google'/);
});