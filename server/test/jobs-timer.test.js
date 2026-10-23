// Власний таймер tick (src/jobs/timer.js): вікно 07:00-22:10 за Києвом, один спільний запуск, збій tick не валить сервер.
const test = require('node:test');
const assert = require('node:assert/strict');
const { inWindow, singleFlight, startTickTimer } = require('../src/jobs/timer');
const { createApp } = require('../src/app');

const at = (s) => new Date(s);   // жовтень 2026: Київ = UTC+3 (літній час до 25.10)

test('вікно: 06:59 - ні, 07:00 - так, 22:09 - так, 22:10 - ні; зимовий час (UTC+2) теж за Києвом', () => {
  assert.equal(inWindow(at('2026-10-23T06:59:00+03:00')), false);
  assert.equal(inWindow(at('2026-10-23T07:00:00+03:00')), true);
  assert.equal(inWindow(at('2026-10-23T22:09:00+03:00')), true);
  assert.equal(inWindow(at('2026-10-23T22:10:00+03:00')), false);
  assert.equal(inWindow(at('2026-11-10T07:00:00+02:00')), true);
  assert.equal(inWindow(at('2026-11-10T06:30:00+02:00')), false);
});

test('singleFlight: паралельні виклики ділять один запуск, після завершення - новий', async () => {
  let n = 0, release;
  const gate = new Promise((r) => { release = r; });
  const f = singleFlight(async () => { n++; await gate; return n; });
  const a = f(), b = f();
  release();
  assert.deepEqual([await a, await b], [1, 1]);
  assert.equal(n, 1);
  assert.equal(await singleFlight(async () => 7)(), 7);
  await f();
  assert.equal(n, 2);
});

test('таймер: у вікні запускає tick, поза вікном - ні; збій tick логується і не кидає; stop зупиняє', async () => {
  let calls = 0, cb = null, cleared = false, clock = at('2026-10-23T10:00:00+03:00'), fail = false;
  const logs = [];
  const t = startTickTimer({
    tick: async () => { calls++; if (fail) throw new Error('Google лежить'); return { ok: true }; },
    now: () => clock, log: { error: (m) => logs.push(m) }, firstRunMs: 0,
    setIntervalFn: (f) => { cb = f; return { unref() {} }; },
  });
  assert.equal(typeof cb, 'function');
  assert.deepEqual(await cb(), { ok: true });
  clock = at('2026-10-23T23:00:00+03:00');
  assert.deepEqual(await cb(), { skipped: 'поза вікном 07:00-22:10' });
  assert.equal(calls, 1);
  clock = at('2026-10-24T08:00:00+03:00'); fail = true;
  const r = await cb();
  assert.equal(r.error, 'Google лежить');
  assert.match(logs[0], /tick \(таймер\): Google лежить/);
  const orig = global.clearInterval; global.clearInterval = () => { cleared = true; };
  try { t.stop(); } finally { global.clearInterval = orig; }
  assert.equal(cleared, true);
});

test('перший запуск після старту планується через firstRunMs; без таймера INTERNAL_TICK сервер нічого не планує', () => {
  const planned = [];
  startTickTimer({ tick: async () => ({}), firstRunMs: 60000, setIntervalFn: () => ({ unref() {} }), setTimeoutFn: (f, ms) => { planned.push(ms); return { unref() {} }; } });
  assert.deepEqual(planned, [60000]);
});

test('POST /jobs/tick і таймер ділять один запуск: два паралельні запити - один tick', async () => {
  let n = 0, release;
  const gate = new Promise((r) => { release = r; });
  const app = createApp({ jobsSecret: 's3cret', tick: async () => { n++; await gate; return { exported: 0 }; } });
  const srv = app.listen(0);
  try {
    const url = 'http://127.0.0.1:' + srv.address().port + '/jobs/tick';
    const post = () => fetch(url, { method: 'POST', headers: { 'x-jobs-secret': 's3cret' } }).then((r) => r.json());
    const p1 = post(), p2 = post(), p3 = app.locals.tick();   // третій - «таймер»
    await new Promise((r) => setTimeout(r, 60));
    release();
    const [a, b] = await Promise.all([p1, p2]);
    await p3;
    assert.equal(a.ok && b.ok, true);
    assert.equal(n, 1);
  } finally { srv.close(); }
});
