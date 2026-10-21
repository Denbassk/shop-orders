const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECTIONS } = require('../src/directions');
const { buyerKey, verifyBuyerKey, buyerLinks } = require('../src/buyer/link');
const { createApp } = require('../src/app');

const SECRET = 'test-secret-1';

async function withApp(opts, fn) {
  const srv = createApp(opts).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try { await fn(base); } finally {
    if (srv.closeAllConnections) srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
}

test('ключ посилання: 24 символи base64url, свій для напрямку і секрету', () => {
  const k = buyerKey('bakery', SECRET);
  assert.match(k, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(buyerKey('bakery', SECRET), k);
  assert.notEqual(buyerKey('bread', SECRET), k);
  assert.notEqual(buyerKey('bakery', 'other'), k);
  assert.equal(verifyBuyerKey('bakery', k, SECRET), true);
  assert.equal(verifyBuyerKey('bread', k, SECRET), false);
  assert.equal(verifyBuyerKey('bakery', k.slice(0, 23), SECRET), false);
  assert.equal(verifyBuyerKey('bakery', k, ''), false);
  assert.equal(verifyBuyerKey('xxx', buyerKey('xxx', SECRET), SECRET), false);
  const links = buyerLinks('https://x.dev/', SECRET);
  assert.deepEqual(Object.keys(links).sort(), Object.keys(DIRECTIONS).sort());
  assert.equal(links.bakery, 'https://x.dev/buyer/bakery/' + k);
});

test('http: сторінка лише за правильним посиланням, інакше 404', async () => {
  await withApp({ buyerApi: () => async () => ({ ok: true }), buyerLinkSecret: SECRET }, async (base) => {
    const k = buyerKey('bakery', SECRET);
    let r = await fetch(base + '/buyer/bakery/' + k);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(await r.text(), /<html/i);
    for (const u of ['/buyer/bakery', '/buyer/bakery/', '/buyer/bakery/' + k.slice(1) + 'x', '/buyer/bread/' + k, '/buyer/xxx/' + buyerKey('xxx', SECRET)]) {
      r = await fetch(base + u); assert.equal(r.status, 404, u); await r.text();
    }
  });
});

test('http: дії за посиланням без PIN і cookie; чужий/невірний ключ -> 404, дія не виконується', async () => {
  const calls = [];
  const buyerApi = (dir) => async (action, payload) => { calls.push([dir, action, payload]); return { ok: true, data: { dir }, ms: 0 }; };
  await withApp({ buyerApi, buyerLinkSecret: SECRET }, async (base) => {
    const post = (u, body, ct = 'application/json') => fetch(base + u, { method: 'POST', headers: { 'content-type': ct }, body: JSON.stringify(body) });
    const k = buyerKey('bakery', SECRET);
    let r = await post('/buyer/bakery/' + k + '/api', { action: 'today', payload: {} });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, data: { dir: 'bakery' }, ms: 0 });
    assert.deepEqual(calls, [['bakery', 'today', {}]]);
    for (const u of ['/buyer/bread/' + k + '/api', '/buyer/bakery/' + k.slice(1) + 'x/api', '/buyer/bakery/api']) {
      r = await post(u, { action: 'remove', payload: { storeId: '1' } });
      assert.equal(r.status, 404, u); await r.text();
    }
    assert.equal(calls.length, 1);
    r = await post('/buyer/bakery/' + k + '/api', { action: 'today' }, 'text/plain');
    assert.equal(r.status, 415); await r.text();
  });
});

test('http: BUYER_LINK_SECRET не задано -> усі посилання 404', async () => {
  await withApp({ buyerApi: () => async () => ({ ok: true }), buyerLinkSecret: '' }, async (base) => {
    const r = await fetch(base + '/buyer/bakery/' + buyerKey('bakery', ''));
    assert.equal(r.status, 404); await r.text();
  });
});

test('сторінка: ключ з адреси, API /buyer/<dir>/<ключ>/api, вікно PIN приховане', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  assert.ok(h.includes("const KEY = location.pathname.split('/')[3]"));
  assert.ok(h.includes("const API = '/buyer/' + DIR + '/' + KEY + '/api'"));
  assert.ok(h.includes('#login,[onclick*="logout"]{display:none!important}'));
});