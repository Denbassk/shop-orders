const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

async function withServer(fn) {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

test('GET /health: ok, region з FLY_REGION, час ISO', async () => {
  process.env.FLY_REGION = 'fra';
  await withServer(async (base) => {
    const res = await fetch(base + '/health');
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.equal(j.region, 'fra');
    assert.ok(Math.abs(Date.parse(j.time) - Date.now()) < 5000);
  });
  delete process.env.FLY_REGION;
  await withServer(async (base) => {
    assert.equal((await (await fetch(base + '/health')).json()).region, null);
  });
});

test('POST /api: будь-яка дія поки "Невідома дія", конверт {ok:false,error}', async () => {
  await withServer(async (base) => {
    for (const [type, body] of [
      ['application/json', JSON.stringify({ action: 'bootstrap', payload: {} })],
      ['text/plain', JSON.stringify({ action: 'bootstrap', payload: {} })],   // як шле застосунок до Apps Script
      ['application/json', '{}'],
      ['text/plain', 'не json'],
    ]) {
      const res = await fetch(base + '/api', { method: 'POST', headers: { 'Content-Type': type }, body });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: false, error: 'Невідома дія' });
    }
    const empty = await fetch(base + '/api', { method: 'POST' });
    assert.deepEqual(await empty.json(), { ok: false, error: 'Невідома дія' });
  });
});

test('невідомий шлях - 404 JSON, без стеку', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { ok: false, error: 'Not found' });
  });
});
