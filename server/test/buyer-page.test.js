const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = path.join(__dirname, '..', 'public', 'buyer', 'index.html');
const html = () => fs.readFileSync(PAGE, 'utf8');

test('сторінка закупниці: fetch /buyer/<dir>/api з cookie, усі дії, без Apps Script', () => {
  const h = html();
  for (const s of ["'/buyer/' + DIR + '/' + KEY + '/api'", "credentials: 'same-origin'", "call('today'", "call('remove'", "call('editOrder'",
    "call('products'", "call('setProduct'", "action: 'login'", "'/buyer/' + DIR + '/logout'"]) assert.ok(h.includes(s), s);
  assert.ok(!h.includes('google.script'));
});

test('сторінка закупниці: тексти DeleteSheet.gs, усе з бази - через esc()', () => {
  const h = html();
  for (const s of ['Замовили сьогодні', '⏳ Видаляю замовлення: ', '❌ Не вдалось видалити: ', 'function esc(']) assert.ok(h.includes(s), s);
  assert.ok(!/\$\{\s*[a-z]\.(label|name|sub|barcode)\s*\}/.test(h), 'дані без esc');
  // HTML збирається лише в рядках з '<'; confirm/toast - простий текст (textContent), там esc не потрібен
  const htmlLines = h.split('\n').filter((l) => l.includes('<')).join('\n');
  assert.ok(!/'\s*\+\s*[a-z]\.(label|name|sub|barcode|category|availability)\s*\+/.test(htmlLines), 'дані без esc');
  assert.ok(h.includes('m.textContent = t'), 'toast - через textContent');
});

const appMod = require('../src/app');
const createApp = appMod.createApp || appMod;
async function withApp(fn) {
  const srv = createApp({}).listen(0);
  await new Promise((r) => srv.once('listening', r));
  try { await fn('http://127.0.0.1:' + srv.address().port); }
  finally { if (srv.closeAllConnections) srv.closeAllConnections(); srv.close(); }
}

test('GET /buyer/bakery без ключа -> 404 (сторінка лише за секретним посиланням)', async () => {
  await withApp(async (base) => {
    for (const u of ['/buyer/bakery', '/buyer/bakery/']) { const r = await fetch(base + u); assert.equal(r.status, 404, u); await r.text(); }
  });
});
test('GET /buyer/xxx -> 404', async () => {
  await withApp(async (base) => { assert.equal((await fetch(base + '/buyer/xxx')).status, 404); });
});