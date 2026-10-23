// Сайт продавця: server/public/index.html збирається з app/ui/Index.html + WriteOff.html + логотип (Logo.gs) скриптом scripts/build-front.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { build, OUT, CALL_SNIPPET } = require('../scripts/build-front');
const { createApp } = require('../src/app');

const norm = (s) => s.replace(/\r\n/g, '\n');

test('збірка: скриптлетів Apps Script і google.script нема, WriteOff і логотип вбудовані', () => {
  const html = build();
  assert.ok(!html.includes('<?'), 'лишилась вставка <?');
  assert.ok(!html.includes('google.script'), 'лишився google.script');
  assert.ok(html.includes('function woStart') || html.includes('wo_seller'), 'WriteOff.html не вбудовано');
  assert.match(html, /<img class="logo" src="data:image\/png;base64,[A-Za-z0-9+\/=]{1000,}"/);
  assert.ok(html.includes('<title>Замовлення Фемелі Маркет</title>'));
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">/);
  assert.ok(html.includes(CALL_SNIPPET), 'call() = fetch-версія');
});

test('збережена сторінка = свіжа збірка (після зміни app/ui - node scripts/build-front.js)', () => {
  assert.equal(norm(fs.readFileSync(OUT, 'utf8')), norm(build()));
});

// call() із збірки у vm з підмінним fetch
function runCall({ fetchImpl, timeoutMs }) {
  const timers = [];
  const sandbox = { fetch: fetchImpl, AbortController, Promise, JSON, Error,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {}, CALL_TIMEOUT_MS: timeoutMs };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(CALL_SNIPPET, ctx);
  return { call: ctx.call, timers };
}
const jsonRes = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });

test('call(): POST /api, тіло {action,payload} як text/plain; ok -> data', async () => {
  let seen;
  const { call, timers } = runCall({ fetchImpl: async (url, o) => { seen = { url, o }; return jsonRes({ ok: true, data: { x: 1 } }); } });
  const d = await call('bootstrap');
  assert.deepEqual(JSON.parse(JSON.stringify(d)), { x: 1 });
  assert.equal(seen.url, '/api');
  assert.equal(seen.o.method, 'POST');
  assert.equal(seen.o.headers['Content-Type'], 'text/plain');
  assert.deepEqual(JSON.parse(seen.o.body), { action: 'bootstrap', payload: {} });
  assert.equal(timers[0].ms, 20000, 'тайм-аут 20 с');
});

test('call(): відповідь {ok:false,error} -> Error з текстом сервера', async () => {
  const { call } = runCall({ fetchImpl: async () => jsonRes({ ok: false, error: 'Вже сьогодні відправлено' }) });
  await assert.rejects(call('submitOrder', { a: 1 }), (e) => e.message === 'Вже сьогодні відправлено');
});

test('call(): мережа впала / 502 без JSON / тайм-аут -> «Сервер не відповідає, спробуйте ще раз»', async () => {
  const MSG = 'Сервер не відповідає, спробуйте ще раз';
  await assert.rejects(runCall({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }).call('x'), (e) => e.message === MSG);
  await assert.rejects(runCall({ fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new Error('не JSON'); } }) }).call('x'), (e) => e.message === MSG);
  // тайм-аут: fetch висить, поки не спрацює abort
  const hang = (url, o) => new Promise((_, rej) => { o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const r = runCall({ fetchImpl: hang });
  const p = r.call('x');
  r.timers[0].fn();
  await assert.rejects(p, (e) => e.message === MSG);
});

test('GET / -> сторінка продавця (HTML, без кешу); /health і /api не зачеплені', async () => {
  const srv = createApp({ api: async () => ({}) }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try {
    const base = 'http://127.0.0.1:' + srv.address().port;
    const r = await fetch(base + '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok((await r.text()).includes('Замовлення Фемелі Маркет'));
    assert.equal((await fetch(base + '/health')).status, 200);
  } finally { await new Promise((r) => srv.close(r)); }
});
