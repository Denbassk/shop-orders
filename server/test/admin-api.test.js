// /admin/api: конверт adminApi (app/Admin.gs), вхід з cookie, лічильник спроб у settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { createAuth, hashPassword } = require('../src/admin/auth');
const { createAdminApi } = require('../src/admin/index');
const { createSbFails } = require('../src/admin/fails');

function fakeSb(respond) {
  const calls = [];
  const sb = { from(table) {
    const q = { table, ops: [] }; calls.push(q);
    const b = new Proxy({}, { get(_, k) {
      if (k === 'then') return (res, rej) => Promise.resolve(respond(q)).then(res, rej);
      return (...a) => { q.ops.push([k, ...a]); return b; };
    } });
    return b;
  } };
  return { sb, calls };
}
const op = (q, name) => q.ops.find((o) => o[0] === name);

test('диспетчер: невідома дія -> «Невідома дія: x», успіх -> {ok,data,ms}', async () => {
  const api = createAdminApi({ ping: async (p) => ({ pong: p.x }) }, { log: () => {} });
  const a = await api('nope', {});
  assert.equal(a.ok, false); assert.equal(a.error, 'Невідома дія: nope'); assert.equal(typeof a.ms, 'number');
  const b = await api('ping', { x: 7 });
  assert.equal(b.ok, true); assert.deepEqual(b.data, { pong: 7 }); assert.equal(typeof b.ms, 'number');
  assert.equal((await api('toString')).error, 'Невідома дія: toString');
  assert.deepEqual((await api('ping')).data, { pong: undefined });
});

test('диспетчер: помилка дії логується, AUTH - ні', async () => {
  const logs = [];
  const api = createAdminApi({ bad: async () => { throw new Error('збій'); }, auth: async () => { throw new Error('AUTH'); } }, { log: (m) => logs.push(m) });
  assert.equal((await api('bad')).error, 'збій');
  assert.equal((await api('auth')).error, 'AUTH');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^adminApi bad: /);
});

test('лічильник спроб у settings: ключ admin_fail:<роль>', async () => {
  const { sb, calls } = fakeSb((q) => (op(q, 'select') ? { data: [{ value: { n: 2, ts: 5 } }], error: null } : { data: null, error: null }));
  const f = createSbFails(sb);
  assert.deepEqual(await f.get('admin'), { n: 2, ts: 5 });
  assert.equal(calls[0].table, 'settings');
  assert.deepEqual(op(calls[0], 'eq').slice(1), ['key', 'admin_fail:admin']);
  await f.set('buyer:bread', { n: 1, ts: 7 });
  assert.deepEqual(op(calls[1], 'upsert')[1], { key: 'admin_fail:buyer:bread', value: { n: 1, ts: 7 } });
  await f.del('admin');
  assert.ok(op(calls[2], 'delete'));
  assert.deepEqual(op(calls[2], 'eq').slice(1), ['key', 'admin_fail:admin']);
  const e = createSbFails(fakeSb(() => ({ data: [], error: null })).sb);
  assert.equal(await e.get('admin'), undefined);
  const bad = createSbFails(fakeSb(() => ({ data: null, error: { message: 'down' } })).sb);
  await assert.rejects(bad.get('admin'), /down/);
});

async function withApp(fn, seen = []) {
  const adminAuth = createAuth({ secret: 's3cret', hashes: { admin: hashPassword('2468', 'salt0001') } });
  const adminApi = createAdminApi({ ping: async (p) => { seen.push(p); return { pong: p.x }; } }, { log: () => {} });
  const srv = createApp({ adminAuth, adminApi }).listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const base = 'http://127.0.0.1:' + srv.address().port;
  const post = (body, headers = {}) => fetch(base + '/admin/api', { method: 'POST',
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try { await fn({ base, post, seen }); } finally { srv.close(); }
}
const cookieOf = (res) => String(res.headers.get('set-cookie') || '');

test('без cookie -> AUTH, дія не викликається', async () => {
  await withApp(async ({ post, seen }) => {
    const r = await (await post({ action: 'ping', payload: { x: 1 } })).json();
    assert.equal(r.ok, false); assert.equal(r.error, 'AUTH');
    assert.equal(seen.length, 0);
  });
});

test('не JSON -> 415', async () => {
  await withApp(async ({ base }) => {
    const res = await fetch(base + '/admin/api', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"action":"login","payload":{"pin":"2468"}}' });
    assert.equal(res.status, 415);
    assert.equal(cookieOf(res), '');
  });
});

test('невірний PIN -> «Невірний PIN», cookie немає', async () => {
  await withApp(async ({ post }) => {
    const res = await post({ action: 'login', payload: { pin: '0000' } });
    const r = await res.json();
    assert.equal(r.error, 'Невірний PIN');
    assert.equal(cookieOf(res), '');
  });
});

test('вхід: cookie adm HttpOnly; Secure; SameSite=Strict; Path=/admin; токена в тілі нема; з cookie дія працює', async () => {
  await withApp(async ({ post }) => {
    const res = await post({ action: 'login', payload: { pin: '2468' } });
    const r = await res.json();
    assert.equal(r.ok, true); assert.deepEqual(r.data, {});
    assert.equal(JSON.stringify(r).includes('eyJ'), false);
    const c = cookieOf(res);
    assert.match(c, /^adm=eyJ/);
    assert.match(c, /HttpOnly/i); assert.match(c, /Secure/i); assert.match(c, /SameSite=Strict/i); assert.match(c, /Path=\/admin/i);
    assert.match(c, /Max-Age=43200/i);
    const r2 = await (await post({ action: 'ping', payload: { x: 5 } }, { cookie: c.split(';')[0] })).json();
    assert.equal(r2.ok, true); assert.deepEqual(r2.data, { pong: 5 });
  });
});

test('cookie з чужим підписом -> AUTH', async () => {
  await withApp(async ({ post, seen }) => {
    const forged = jwt.sign({ role: 'admin' }, 'other', { expiresIn: 3600 });
    const r = await (await post({ action: 'ping' }, { cookie: 'adm=' + forged })).json();
    assert.equal(r.error, 'AUTH');
    assert.equal(seen.length, 0);
  });
});

test('POST /admin/logout стирає cookie', async () => {
  await withApp(async ({ base }) => {
    const res = await fetch(base + '/admin/logout', { method: 'POST' });
    assert.equal(res.status, 200);
    assert.match(cookieOf(res), /^adm=;/);
    assert.match(cookieOf(res), /Path=\/admin/i);
  });
});