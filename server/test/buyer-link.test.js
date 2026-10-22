const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buyerKey, verifyBuyerKey, buyerLinks } = require('../src/buyer/link');
const { createApp } = require('../src/app');

const S = 'test-secret-1';
async function withApp(opts, fn) {
  const srv = createApp(opts).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try { await fn(base); } finally { await new Promise((r) => srv.close(r)); }
}
const post = (base, url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('ключ: 24 символи base64url; ключ ВК той самий, що й раніше (HMAC buyer|bakery)', () => {
  const k = buyerKey('bakery', S);
  assert.match(k, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(k, crypto.createHmac('sha256', S).update('buyer|bakery').digest('base64url').slice(0, 24));
  assert.notEqual(buyerKey('hlib', S), k);
  assert.notEqual(buyerKey('bakery', 'інший'), k);
});

test('посилання лише для двох закупниць: bakery і hlib; окремі bread/nbhz/veg недійсні', () => {
  assert.deepEqual(Object.keys(buyerLinks('http://x/', S)), ['bakery', 'hlib']);
  assert.equal(buyerLinks('http://x/', S).hlib, 'http://x/buyer/hlib/' + buyerKey('hlib', S));
  assert.equal(verifyBuyerKey('bakery', buyerKey('bakery', S), S), true);
  assert.equal(verifyBuyerKey('hlib', buyerKey('hlib', S), S), true);
  for (const d of ['bread', 'nbhz', 'veg']) assert.equal(verifyBuyerKey(d, buyerKey(d, S), S), false, d);
  assert.equal(verifyBuyerKey('hlib', buyerKey('bakery', S), S), false);
  assert.equal(verifyBuyerKey('bakery', buyerKey('bakery', S), ''), false);
});

test('http: сторінка лише за правильним посиланням, інакше 404', async () => {
  await withApp({ buyerLinkSecret: S, buyerApi: () => async () => ({ ok: true }) }, async (b) => {
    assert.equal((await fetch(b + '/buyer/hlib/' + buyerKey('hlib', S))).status, 200);
    assert.equal((await fetch(b + '/buyer/bakery/' + buyerKey('bakery', S))).status, 200);
    assert.equal((await fetch(b + '/buyer/bread/' + buyerKey('bread', S))).status, 404);
    assert.equal((await fetch(b + '/buyer/hlib/' + buyerKey('bakery', S))).status, 404);
    assert.equal((await fetch(b + '/buyer/hlib')).status, 404);
  });
});

test('http: напрямок лише зі свого списку; без dir -> перший; чужий -> 403, дія не виконується', async () => {
  const calls = [];
  const buyerApi = (dir) => async (action) => { calls.push(dir + ':' + action); return { ok: true, data: { dir }, ms: 1 }; };
  await withApp({ buyerLinkSecret: S, buyerApi }, async (b) => {
    const H = '/buyer/hlib/' + buyerKey('hlib', S) + '/api';
    const K = '/buyer/bakery/' + buyerKey('bakery', S) + '/api';
    let r = await post(b, H, { action: 'today', payload: { dir: 'veg' } });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).data, { dir: 'veg' });
    r = await post(b, H, { action: 'today' });
    assert.deepEqual((await r.json()).data, { dir: 'bread' });
    r = await post(b, H, { action: 'remove', payload: { dir: 'bakery', storeId: 's1' } });
    assert.equal(r.status, 403);
    r = await post(b, K, { action: 'remove', payload: { dir: 'veg', storeId: 's1' } });
    assert.equal(r.status, 403);
    r = await post(b, K, { action: 'today' });
    assert.deepEqual((await r.json()).data, { dir: 'bakery' });
    r = await post(b, '/buyer/hlib/' + buyerKey('bakery', S) + '/api', { action: 'today' });
    assert.equal(r.status, 404);
    assert.deepEqual(calls, ['veg:today', 'bread:today', 'bakery:today']);
  });
});

test('http: me - назва закупниці і її напрямки', async () => {
  await withApp({ buyerLinkSecret: S, buyerApi: () => async () => ({ ok: true }) }, async (b) => {
    const r = await (await post(b, '/buyer/hlib/' + buyerKey('hlib', S) + '/api', { action: 'me' })).json();
    assert.equal(r.ok, true);
    assert.deepEqual(r.data.dirs.map((d) => d.dir), ['bread', 'nbhz', 'veg']);
    assert.ok(r.data.dirs.every((d) => d.title));
    const k = await (await post(b, '/buyer/bakery/' + buyerKey('bakery', S) + '/api', { action: 'me' })).json();
    assert.deepEqual(k.data.dirs.map((d) => d.dir), ['bakery']);
  });
});

test('http: Excel через сервер - файл, назва українською; чужий напрямок 404; збій -> 502 з текстом', async () => {
  const name = 'Овочі 21.10.2026.xlsx';
  let fail = false;
  const buyerXlsx = async (dir) => { if (fail) throw new Error('Звіт ще не зібрано'); return { name, buf: Buffer.from('PK' + dir) }; };
  await withApp({ buyerLinkSecret: S, buyerXlsx }, async (b) => {
    const base = b + '/buyer/hlib/' + buyerKey('hlib', S) + '/xlsx/';
    let r = await fetch(base + 'veg');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /spreadsheetml/);
    assert.ok(r.headers.get('content-disposition').includes(encodeURIComponent(name)));
    assert.equal(await r.text(), 'PKveg');
    assert.equal((await fetch(base + 'bakery')).status, 404);
    assert.equal((await fetch(b + '/buyer/hlib/' + buyerKey('bakery', S) + '/xlsx/veg')).status, 404);
    fail = true;
    r = await fetch(base + 'veg');
    assert.equal(r.status, 502);
    assert.equal((await r.json()).error, 'Звіт ще не зібрано');
  });
});

test('http: BUYER_LINK_SECRET не задано -> усі посилання 404', async () => {
  await withApp({ buyerLinkSecret: '', buyerApi: () => async () => ({ ok: true }) }, async (b) => {
    assert.equal((await fetch(b + '/buyer/bakery/' + buyerKey('bakery', ''))).status, 404);
    assert.equal((await post(b, '/buyer/hlib/' + buyerKey('hlib', '') + '/api', { action: 'me' })).status, 404);
  });
});

test('сторінка: ключ з адреси (третій сегмент)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  assert.ok(html.includes("location.pathname.split('/')[3]"));
});