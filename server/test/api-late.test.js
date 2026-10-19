const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { apiRequestLate } = require('../src/api/submit');
const { createLate } = require('../src/late');
const { createMailer, LATE_MAIL, buildLateMail } = require('../src/mail');
const { approvePage } = require('../src/pages/approve');
const { createApp } = require('../src/app');
const { DIRECTIONS } = require('../src/directions');

const AT = new Date('2026-10-19T16:30:00+03:00');
const SECRET = 'unit-test-secret';
const late = createLate({ secret: SECRET, baseUrl: 'https://shop-orders.fly.dev' });
const STORE = { id: 'м харків вул бучми 32', label: 'Бучми, 32', code: '', edrpou: '', days: { veg: [], bakery: [] }, directions: ['bread', 'bakery'] };
const TEST_STORE = { ...STORE, id: 'test-a', label: 'Тест А' };

function makeEnv(over = {}) {
  const calls = { requested: [], approved: [], mails: [] };
  const data = {
    stores: async () => [STORE, TEST_STORE],
    settings: async () => ({}),
    directions: async () => DIRECTIONS,
    lateRows: async () => [],
    requestLate: async (...a) => { calls.requested.push(a); },
    approveLate: async (...a) => { calls.approved.push(a); },
    ...(over.data || {}),
  };
  const mailer = over.mailer || { sendLateMail: async (cfg, store, x) => { calls.mails.push([cfg.key, store.id, x.url]); return true; } };
  return { env: { at: over.at || AT, data, late, mailer }, calls };
}

// ---------- токен ----------
test('lateToken: HMAC-SHA256(dir|storeId|day), base64url, 24 символи; залежить від кожного поля і секрету', () => {
  const t = late.token('bakery', 'st', '2026-10-19');
  const want = crypto.createHmac('sha256', SECRET).update('bakery|st|2026-10-19').digest('base64url').slice(0, 24);
  assert.equal(t, want);
  assert.match(t, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(t, late.token('bread', 'st', '2026-10-19'));
  assert.notEqual(t, late.token('bakery', 'st2', '2026-10-19'));
  assert.notEqual(t, late.token('bakery', 'st', '2026-10-20'));
  assert.notEqual(t, createLate({ secret: 'other' }).token('bakery', 'st', '2026-10-19'));
});

test('late.verify: правильний підпис так, будь-яка зміна ні; без секрету завжди ні', () => {
  const s = late.token('bread', 'st', '2026-10-19');
  assert.equal(late.verify('bread', 'st', '2026-10-19', s), true);
  assert.equal(late.verify('bread', 'st', '2026-10-19', s.slice(0, 23) + 'x'), false);
  assert.equal(late.verify('bread', 'st', '2026-10-19', ''), false);
  assert.equal(late.verify('bread', 'st', '2026-10-19', undefined), false);
  assert.equal(late.verify('bread', 'st', '2026-10-19', s + 'x'), false);
  const none = createLate({ secret: '' });
  assert.equal(none.verify('bread', 'st', '2026-10-19', s), false);
  assert.throws(() => none.token('bread', 'st', '2026-10-19'), /LATE_SECRET/);
});

test('approveUrl: на shop-orders.fly.dev/ok з dir, st, d, s', () => {
  const u = new URL(late.approveUrl('bakery', 'м харків вул бучми 32', '2026-10-19'));
  assert.equal(u.origin + u.pathname, 'https://shop-orders.fly.dev/ok');
  assert.equal(u.searchParams.get('dir'), 'bakery');
  assert.equal(u.searchParams.get('st'), 'м харків вул бучми 32');
  assert.equal(u.searchParams.get('d'), '2026-10-19');
  assert.equal(u.searchParams.get('s'), late.token('bakery', 'м харків вул бучми 32', '2026-10-19'));
});

// ---------- лист ----------
test('LATE_MAIL: адресати як у LateRequest.gs', () => {
  assert.deepEqual(LATE_MAIL, { bread: 'svetlanalesakor@gmail.com', nbhz: 'svetlanalesakor@gmail.com', veg: 'svetlanalesakor@gmail.com', bakery: 'haikora1004@gmail.com' });
});

test('buildLateMail: тема, тіло і кнопка дослівно; екранування', () => {
  const store = { ...STORE, label: 'Бучми <b>"&"</b>' };
  const m = buildLateMail(DIRECTIONS.bakery, store, { url: 'https://x/ok?a=1&s=2', at: AT });
  assert.equal(m.to, 'haikora1004@gmail.com');
  assert.equal(m.subject, 'Дозвіл: Випічка і кулінарія - Бучми <b>"&"</b>');
  assert.ok(m.html.includes('Замовлення після дедлайну'));
  assert.ok(m.html.includes('Бучми &lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;'));
  assert.ok(m.html.includes('запит о 16:30:00, дедлайн був 13:00'));
  assert.ok(m.html.includes('href="https://x/ok?a=1&s=2"'));
  assert.ok(m.html.includes('ДОЗВОЛИТИ'));
  assert.ok(m.html.includes('Дозвіл відкриє прийом на <b>30 хвилин</b> і лише для цієї точки та цього напрямку. Потім знову закриється.<br>Нічого не робити - значить не дозволити.'));
});

test('mailer: надсилає через транспорт з ім’ям відправника; тестова точка -> лише тестовий адресат', async () => {
  const sent = [];
  const mailer = createMailer({ transport: { sendMail: async (o) => { sent.push(o); } }, user: 'me@example.com', testTo: 'me@example.com' });
  assert.equal(await mailer.sendLateMail(DIRECTIONS.bread, STORE, { url: 'u', at: AT }), true);
  assert.equal(sent[0].to, 'svetlanalesakor@gmail.com');
  assert.equal(sent[0].from, '"Замовлення Фемелі Маркет" <me@example.com>');
  assert.equal(sent[0].subject, 'Дозвіл: Хліб Рома - Бучми, 32');

  assert.equal(await mailer.sendLateMail(DIRECTIONS.bread, TEST_STORE, { url: 'u', at: AT }), true);
  assert.equal(sent[1].to, 'me@example.com', 'test- точки НІКОЛИ не пишуть закупницям');
  assert.equal(sent[1].subject, '[ТЕСТ] Дозвіл: Хліб Рома - Тест А');
});

test('mailer: тестова точка без тестового адресата - не надсилає; без адресата напрямку - false', async () => {
  const sent = [];
  const t = { sendMail: async (o) => { sent.push(o); } };
  const m1 = createMailer({ transport: t, user: 'me@example.com', testTo: '' });
  assert.equal(await m1.sendLateMail(DIRECTIONS.bread, TEST_STORE, { url: 'u', at: AT }), false);
  const m2 = createMailer({ transport: t, user: 'me@example.com', testTo: 'me@example.com', lateMail: { bread: '' } });
  assert.equal(await m2.sendLateMail(DIRECTIONS.bread, STORE, { url: 'u', at: AT }), false);
  assert.deepEqual(sent, []);
});

// ---------- requestLate ----------
test('requestLate: pending, запис у базу, лист із посиланням на цей сервер', async () => {
  const { env, calls } = makeEnv();
  const r = await apiRequestLate({ dir: 'bread', storeId: STORE.id }, env);
  assert.deepEqual(r, { status: 'pending', mailed: true, leftMin: 0 });
  assert.deepEqual(calls.requested, [['bread', STORE.id, '2026-10-19', AT]]);
  const [dir, st, url] = calls.mails[0];
  assert.deepEqual([dir, st], ['bread', STORE.id]);
  assert.equal(url, late.approveUrl('bread', STORE.id, '2026-10-19'));
});

test('requestLate: збій пошти не ламає запит (mailed:false)', async () => {
  const { env } = makeEnv({ mailer: { sendLateMail: async () => { throw new Error('smtp down'); } } });
  assert.deepEqual(await apiRequestLate({ dir: 'bread', storeId: STORE.id }, env), { status: 'pending', mailed: false, leftMin: 0 });
});

test('requestLate: дозвіл уже діє -> approved, без листа і без запису', async () => {
  const rows = [{ dir: 'bread', store_id: STORE.id, requested_at: '2026-10-19T16:10:00+03:00', approved_at: '2026-10-19T16:20:00+03:00' }];
  const { env, calls } = makeEnv({ data: { lateRows: async () => rows } });
  assert.deepEqual(await apiRequestLate({ dir: 'bread', storeId: STORE.id }, env), { status: 'approved', mailed: true, leftMin: 20 });
  assert.deepEqual([calls.requested.length, calls.mails.length], [0, 0]);
});

test('requestLate: помилки дослівно', async () => {
  const { env } = makeEnv();
  await assert.rejects(apiRequestLate({ dir: 'bread', storeId: 'нема' }, env), { message: 'Торгову точку не знайдено. Оновіть сторінку.' });
  await assert.rejects(apiRequestLate({ dir: 'nope', storeId: STORE.id }, env), /Невідомий напрямок: "nope"/);
});

// ---------- сторінка /ok ----------
const q = (dir, st, day, sig) => ({ dir, st, d: day, s: sig === undefined ? late.token(dir, st, day) : sig });

test('/ok: правильний підпис -> "Дозволено на 30 хв", запис approved', async () => {
  const { env, calls } = makeEnv();
  const r = await approvePage(q('bread', STORE.id, '2026-10-19'), env);
  assert.equal(r.status, 200);
  assert.ok(r.html.includes('<title>Дозволено на 30 хв</title>'));
  assert.ok(r.html.includes('<b>Хліб Рома</b><br>Бучми, 32<br><br>Продавець зможе відправити замовлення протягом хвилини.<br>Через 30 хвилин прийом закриється знову.'));
  assert.deepEqual(calls.approved, [['bread', STORE.id, '2026-10-19', AT]]);
});

test('/ok: параметр ok= як у старих листах Apps Script теж приймається', async () => {
  const { env, calls } = makeEnv();
  const r = await approvePage({ ok: 'bread', st: STORE.id, d: '2026-10-19', s: late.token('bread', STORE.id, '2026-10-19') }, env);
  assert.equal(r.status, 200);
  assert.equal(calls.approved.length, 1);
});

test('/ok: неправильний підпис -> 403 "Посилання недійсне", нічого не записано', async () => {
  const { env, calls } = makeEnv();
  for (const query of [q('bread', STORE.id, '2026-10-19', 'zzzz'), q('bread', STORE.id, '2026-10-19', ''), { dir: 'bread', st: STORE.id, d: '2026-10-19' },
    { ...q('bread', STORE.id, '2026-10-19'), st: 'інша' }, { ...q('bread', STORE.id, '2026-10-19'), dir: 'bakery' }, {}]) {
    const r = await approvePage(query, env);
    assert.equal(r.status, 403, JSON.stringify(query));
    assert.ok(r.html.includes('Не вийшло') && r.html.includes('Посилання недійсне'));
  }
  assert.equal(calls.approved.length, 0);
});

test('/ok: чужий день -> 400 з текстом Apps Script; невідомий напрямок з валідним підписом -> 400', async () => {
  const { env, calls } = makeEnv();
  const old = await approvePage(q('bread', STORE.id, '2026-10-18'), env);
  assert.equal(old.status, 400);
  assert.ok(old.html.includes('Посилання діє лише в день запиту. Попросіть продавця натиснути кнопку ще раз.'));
  const bad = await approvePage(q('nope', STORE.id, '2026-10-19'), env);
  assert.equal(bad.status, 400);
  assert.ok(bad.html.includes('Невідомий напрямок'));
  assert.equal(calls.approved.length, 0);
});

test('/ok: назва точки екранується; невідома точка показується як id', async () => {
  const evil = { ...STORE, id: 'evil', label: '<img src=x onerror=alert(1)>' };
  const { env } = makeEnv({ data: { stores: async () => [evil] } });
  const r = await approvePage(q('bread', 'evil', '2026-10-19'), env);
  assert.ok(r.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!r.html.includes('<img'));
  const unknown = await approvePage(q('bread', 'невідома', '2026-10-19'), env);
  assert.equal(unknown.status, 200);
  assert.ok(unknown.html.includes('<br>невідома<br>'));
});

test('GET /ok через сервер: 403 при поганому підписі, 200 при доброму', async () => {
  const { env } = makeEnv();
  const server = createApp({ api: async () => ({}), approve: (query) => approvePage(query, env) }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const bad = await fetch(`${base}/ok?dir=bread&st=x&d=2026-10-19&s=bad`);
    assert.equal(bad.status, 403);
    assert.match(bad.headers.get('content-type'), /text\/html/);
    const good = await fetch(`${base}/ok?` + new URLSearchParams(q('bread', STORE.id, '2026-10-19')));
    assert.equal(good.status, 200);
    assert.ok((await good.text()).includes('Дозволено на 30 хв'));
  } finally { await new Promise((r) => server.close(r)); }
});
