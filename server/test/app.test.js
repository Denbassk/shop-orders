const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createApi } = require('../src/api');

async function withServer(opts, fn) {
  const server = createApp(opts).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

test('GET /health: ok, region з FLY_REGION, час ISO', async () => {
  process.env.FLY_REGION = 'fra';
  await withServer({ api: async () => ({}) }, async (base) => {
    const res = await fetch(base + '/health');
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.equal(j.region, 'fra');
    assert.ok(Math.abs(Date.parse(j.time) - Date.now()) < 5000);
  });
  delete process.env.FLY_REGION;
  await withServer({ api: async () => ({}) }, async (base) => {
    assert.equal((await (await fetch(base + '/health')).json()).region, null);
  });
});

test('POST /api: тіло як doPost - JSON з будь-яким Content-Type; сміття -> порожнє тіло', async () => {
  const seen = [];
  const api = async (action, payload) => { seen.push([action, payload]); return { ok: true, data: 1 }; };
  await withServer({ api }, async (base) => {
    for (const [type, body] of [
      ['application/json', JSON.stringify({ action: 'bootstrap', payload: { a: 1 } })],
      ['text/plain', JSON.stringify({ action: 'refresh', payload: { b: 2 } })],
      ['text/plain', 'не json'],
      ['application/json', 'null'],
    ]) {
      const res = await fetch(base + '/api', { method: 'POST', headers: { 'Content-Type': type }, body });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, data: 1 });
    }
    await fetch(base + '/api', { method: 'POST' });
  });
  assert.deepEqual(seen, [['bootstrap', { a: 1 }], ['refresh', { b: 2 }], [undefined, undefined], [undefined, undefined], [undefined, undefined]]);
});

test('невідомий шлях - 404 JSON, без стеку', async () => {
  await withServer({ api: async () => ({}) }, async (base) => {
    const res = await fetch(base + '/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { ok: false, error: 'Not found' });
  });
});

test('диспетчер: невідома дія як в Apps Script, помилка дії -> {ok:false,error}', async () => {
  const api = createApi(() => ({}), () => {});
  assert.deepEqual(await api('foo', {}), { ok: false, error: 'Невідома дія: foo' });
  assert.deepEqual(await api(undefined), { ok: false, error: 'Невідома дія: undefined' });
  // Task 8: дії списань маршрутизуються; порожній payload -> перша перевірка apiWoSubmit_ (WriteOff.gs)
  assert.deepEqual(await api('woSubmit', {}), { ok: false, error: 'Оновіть сторінку і спробуйте ще раз' });
  // bootstrap з зламаним оточенням -> конверт з помилкою, а не падіння
  const bad = await api('bootstrap', {});
  assert.equal(bad.ok, false);
  assert.equal(typeof bad.error, 'string');
});
