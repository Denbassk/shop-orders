const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { apiRequestLate } = require('../src/api/submit');
const { createLate } = require('../src/late');
const { createMailer, LATE_MAIL, buildLateMail } = require('../src/mail');
const { approvePage, approveForm } = require('../src/pages/approve');
const { createApp } = require('../src/app');
const { DIRECTIONS } = require('../src/directions');

const AT = new Date('2026-10-19T16:30:00+03:00');
const SECRET = 'unit-test-secret';
const late = createLate({ secret: SECRET, baseUrl: 'https://shop-orders.fly.dev' });
const STORE = { id: 'м харків вул бучми 32', label: 'Бучми, 32', code: '', edrpou: '', days: { veg: [], bakery: [] }, directions: ['bread', 'bakery'] };
const TEST_STORE = { ...STORE, id: 'test-a', label: 'Тест А' };

function makeEnv(over = {}) {
  const calls = { requested: [], approved: [], mails: [], mailed: [], bg: [] };
  const data = {
    stores: async () => [STORE, TEST_STORE],
    settings: async () => ({}),
    directions: async () => DIRECTIONS,
    lateRows: async () => [],
    requestLate: async (...a) => { calls.requested.push(a); },
    approveLate: async (...a) => { calls.approved.push(a); },
    markLateMailed: async (...a) => { calls.mailed.push(a); },
    ...(over.data || {}),
  };
  const mailer = over.mailer || { recipient: () => 'x@example.com', sendLateMail: async (cfg, store, x) => { calls.mails.push([cfg.key, store.id, x.url]); return true; } };
  return { env: { at: over.at || AT, data, late, mailer, defer: (p) => { calls.bg.push(p); } }, calls };
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
const settle = (calls) => Promise.allSettled(calls.bg);

test('requestLate: pending, запис у базу; лист іде у фоні, mailed_at ставиться після успіху', async () => {
  const { env, calls } = makeEnv();
  const r = await apiRequestLate({ dir: 'bread', storeId: STORE.id }, env);
  assert.deepEqual(r, { status: 'pending', mailed: true, leftMin: 0 });
  assert.deepEqual(calls.requested, [['bread', STORE.id, '2026-10-19', AT]]);
  assert.equal(calls.bg.length, 1, 'лист поставлено у фон');
  await settle(calls);
  const [dir, st, url] = calls.mails[0];
  assert.deepEqual([dir, st], ['bread', STORE.id]);
  assert.equal(url, late.approveUrl('bread', STORE.id, '2026-10-19'));
  assert.deepEqual(calls.mailed.map((m) => m.slice(0, 3)), [['bread', STORE.id, '2026-10-19']]);
});

test('requestLate: відповідь не чекає на пошту (SMTP висить - відповідь одразу)', async () => {
  const never = new Promise(() => {});
  const { env, calls } = makeEnv({ mailer: { recipient: () => 'x@example.com', sendLateMail: () => never } });
  const r = await Promise.race([apiRequestLate({ dir: 'bread', storeId: TEST_STORE.id }, env), new Promise((res) => setTimeout(() => res('TIMEOUT'), 500))]);
  assert.deepEqual(r, { status: 'pending', mailed: true, leftMin: 0 });
  assert.equal(calls.mailed.length, 0);
});

test('requestLate: збій SMTP логується, mailed_at НЕ ставиться (довідправить tick), відповідь не ламається', async () => {
  const errs = [];
  const orig = console.error; console.error = (m) => errs.push(String(m));
  try {
    const { env, calls } = makeEnv({ mailer: { recipient: () => 'x@example.com', sendLateMail: async () => { throw new Error('smtp down'); } } });
    assert.deepEqual(await apiRequestLate({ dir: 'bread', storeId: STORE.id }, env), { status: 'pending', mailed: true, leftMin: 0 });
    await settle(calls);
    assert.deepEqual(calls.mailed, []);
    assert.ok(errs.some((e) => e.includes('smtp down')), errs.join('|'));
  } finally { console.error = orig; }
});

test('requestLate: немає адресата / пошта не налаштована -> mailed:false, у фон нічого', async () => {
  const { env, calls } = makeEnv({ mailer: { recipient: () => '', sendLateMail: async () => false } });
  assert.deepEqual(await apiRequestLate({ dir: 'bread', storeId: STORE.id }, env), { status: 'pending', mailed: false, leftMin: 0 });
  assert.equal(calls.bg.length, 0);
});

test('requestLate: sendLateMail повернув false -> mailed_at не ставиться', async () => {
  const { env, calls } = makeEnv({ mailer: { recipient: () => 'x@example.com', sendLateMail: async () => false } });
  await apiRequestLate({ dir: 'bread', storeId: STORE.id }, env);
  await settle(calls);
  assert.deepEqual(calls.mailed, []);
});

test('requestLate: дозвіл уже діє -> approved, без листа і без запису', async () => {
  const rows = [{ dir: 'bread', store_id: STORE.id, requested_at: '2026-10-19T16:10:00+03:00', approved_at: '2026-10-19T16:20:00+03:00' }];
  const { env, calls } = makeEnv({ data: { lateRows: async () => rows } });
  assert.deepEqual(await apiRequestLate({ dir: 'bread', storeId: STORE.id }, env), { status: 'approved', mailed: true, leftMin: 20 });
  assert.deepEqual([calls.requested.length, calls.bg.length], [0, 0]);
});

test('requestLate ДО дедлайну: відмова, нічого не записано і не надіслано (замовлення міняють самі)', async () => {
  const { env, calls } = makeEnv({ at: new Date('2026-10-19T10:00:00+03:00') });
  await assert.rejects(apiRequestLate({ dir: 'bread', storeId: STORE.id }, env),
    { message: 'Прийом на "Хліб Рома" відкритий до 16:00 - дозвіл не потрібен. Замовлення можна змінити самостійно.' });
  assert.deepEqual([calls.requested.length, calls.bg.length], [0, 0]);
});

test('requestLate: після ручного відкриття прийому (late_all) теж відмова - дозвіл не потрібен', async () => {
  const { env, calls } = makeEnv({ data: { settings: async () => ({ late_all: { bread: '2026-10-19' } }) } });
  await assert.rejects(apiRequestLate({ dir: 'bread', storeId: STORE.id }, env), /дозвіл не потрібен/);
  assert.equal(calls.requested.length, 0);
});

test('requestLate: запит уже чекає (pending) -> той самий статус, без другого запису і без другого листа', async () => {
  const rows = [{ dir: 'bread', store_id: STORE.id, requested_at: '2026-10-19T16:20:00+03:00', approved_at: null }];
  const { env, calls } = makeEnv({ data: { lateRows: async () => rows } });
  assert.deepEqual(await apiRequestLate({ dir: 'bread', storeId: STORE.id }, env), { status: 'pending', mailed: true, leftMin: 0 });
  assert.deepEqual([calls.requested.length, calls.bg.length], [0, 0]);
});

test('requestLate: запит старший за LATE_Q_TTL_MIN (120 хв) - новий запит і новий лист', async () => {
  const rows = [{ dir: 'bread', store_id: STORE.id, requested_at: '2026-10-19T14:00:00+03:00', approved_at: null }];
  const { env, calls } = makeEnv({ data: { lateRows: async () => rows } });
  await apiRequestLate({ dir: 'bread', storeId: STORE.id }, env);
  assert.equal(calls.requested.length, 1);
  assert.equal(calls.bg.length, 1);
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

test('/ok: повторний клік, поки дозвіл діє, НЕ продовжує вікно - запису нема, показано, скільки лишилось', async () => {
  const rows = [{ dir: 'bread', store_id: STORE.id, requested_at: '2026-10-19T16:10:00+03:00', approved_at: '2026-10-19T16:20:00+03:00' }];
  const { env, calls } = makeEnv({ data: { lateRows: async () => rows } });
  const r = await approvePage(q('bread', STORE.id, '2026-10-19'), env);
  assert.equal(r.status, 200);
  assert.ok(r.html.includes('<title>Вже дозволено</title>') && r.html.includes('ще 20 хв'), r.html);
  assert.deepEqual(calls.approved, []);
});

test('/ok: дозвіл, що вже спливув, видається знову', async () => {
  const rows = [{ dir: 'bread', store_id: STORE.id, requested_at: '2026-10-19T15:00:00+03:00', approved_at: '2026-10-19T15:10:00+03:00' }];
  const { env, calls } = makeEnv({ data: { lateRows: async () => rows } });
  const r = await approvePage(q('bread', STORE.id, '2026-10-19'), env);
  assert.ok(r.html.includes('<title>Дозволено на 30 хв</title>'));
  assert.equal(calls.approved.length, 1);
});

const CURRENT = [{ product_id: '1', name: 'Батон', price: 100, qty: 3 }, { product_id: '2', name: 'Багет', price: 50, qty: 2 }];

test('/ok (форма) і лист: показують, що точка вже замовила - позиції і сума', async () => {
  const { env } = makeEnv({ data: { activeOrderLines: async () => CURRENT } });
  const f = await approveForm(q('bread', STORE.id, '2026-10-19'), env);
  assert.ok(f.html.includes('Зараз замовлено: <b>2 поз., 400 грн</b>'), f.html);
  const m = buildLateMail(DIRECTIONS.bread, STORE, { url: 'u', at: AT, current: { positions: 2, total: 400 } });
  assert.ok(m.html.includes('Зараз замовлено: <b>2 поз., 400 грн</b>'));
  const none = buildLateMail(DIRECTIONS.bread, STORE, { url: 'u', at: AT });
  assert.ok(!none.html.includes('Зараз замовлено'));
});

test('/ok (форма): без замовлення за день або при збої читання - рядка нема, форма все одно є', async () => {
  const empty = makeEnv({ data: { activeOrderLines: async () => [] } });
  assert.ok(!(await approveForm(q('bread', STORE.id, '2026-10-19'), empty.env)).html.includes('Зараз замовлено'));
  const orig = console.error; console.error = () => {};
  try {
    const broken = makeEnv({ data: { activeOrderLines: async () => { throw new Error('db down'); } } });
    const r = await approveForm(q('bread', STORE.id, '2026-10-19'), broken.env);
    assert.equal(r.status, 200);
    assert.ok(r.html.includes('<form') && !r.html.includes('Зараз замовлено'));
  } finally { console.error = orig; }
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

test('/ok: назва точки екранується', async () => {
  const evil = { ...STORE, id: 'evil', label: '<img src=x onerror=alert(1)>' };
  const { env } = makeEnv({ data: { stores: async () => [evil] } });
  const r = await approvePage(q('bread', 'evil', '2026-10-19'), env);
  assert.ok(r.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!r.html.includes('<img'));
});

test('/ok: точки з підписом нема в stores -> 400 і late_requests не створюється (GET і POST)', async () => {
  const { env, calls } = makeEnv();
  const query = q('bread', 'невідома', '2026-10-19');          // підпис правильний, точки в базі немає
  const post = await approvePage(query, env);
  assert.equal(post.status, 400);
  assert.ok(post.html.includes('Точку не знайдено'));
  const get = await approveForm(query, env);
  assert.equal(get.status, 400);
  assert.ok(!get.html.includes('<form'));
  assert.deepEqual(calls.approved, []);
});

test('/ok: базу точок не прочитано -> 500, дозвіл не видається', async () => {
  const { env, calls } = makeEnv({ data: { stores: async () => { throw new Error('stores: timeout'); } } });
  const r = await approvePage(q('bread', STORE.id, '2026-10-19'), env);
  assert.equal(r.status, 500);
  assert.deepEqual(calls.approved, []);
});

test('GET /ok (форма): показує кнопку "Дозволити" з прихованими полями, дозвіл НЕ видає', async () => {
  const { env, calls } = makeEnv();
  const r = await approveForm(q('bakery', STORE.id, '2026-10-19'), env);
  assert.equal(r.status, 200);
  assert.ok(r.html.includes('<form method="post" action="/ok">'));
  const sig = late.token('bakery', STORE.id, '2026-10-19');
  for (const [k, v] of [['dir', 'bakery'], ['st', STORE.id], ['d', '2026-10-19'], ['s', sig]])
    assert.ok(r.html.includes('<input type="hidden" name="' + k + '" value="' + v + '">'), k);
  assert.ok(r.html.includes('Дозволити') && r.html.includes('Бучми, 32') && r.html.includes('Випічка і кулінарія'));
  assert.ok(!r.html.includes('Дозволено на'));
  assert.deepEqual(calls.approved, []);
});

test('GET /ok (форма): поганий підпис 403, чужий день 400, ok= як у старих листах - форма з dir', async () => {
  const { env, calls } = makeEnv();
  assert.equal((await approveForm(q('bread', STORE.id, '2026-10-19', 'zzzz'), env)).status, 403);
  assert.equal((await approveForm({}, env)).status, 403);
  assert.equal((await approveForm(q('bread', STORE.id, '2026-10-18'), env)).status, 400);
  const old = await approveForm({ ok: 'bread', st: STORE.id, d: '2026-10-19', s: late.token('bread', STORE.id, '2026-10-19') }, env);
  assert.equal(old.status, 200);
  assert.ok(old.html.includes('name="dir" value="bread"'));
  assert.deepEqual(calls.approved, []);
});

test('/ok через сервер: GET не міняє нічого, POST міняє, POST з поганим підписом 403', async () => {
  const { env, calls } = makeEnv();
  const app = createApp({ api: async () => ({}), approve: (query) => approvePage(query, env), approveForm: (query) => approveForm(query, env) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const params = new URLSearchParams(q('bread', STORE.id, '2026-10-19'));
    const badGet = await fetch(`${base}/ok?dir=bread&st=x&d=2026-10-19&s=bad`);
    assert.equal(badGet.status, 403);
    assert.match(badGet.headers.get('content-type'), /text\/html/);

    const get = await fetch(`${base}/ok?` + params);
    assert.equal(get.status, 200);
    const page = await get.text();
    assert.ok(page.includes('<form method="post"') && !page.includes('Дозволено на 30 хв'));
    assert.equal(calls.approved.length, 0, 'GET не видає дозвіл (поштовий сканер відкриває посилання)');

    const badPost = await fetch(`${base}/ok`, { method: 'POST', headers: form, body: new URLSearchParams(q('bread', STORE.id, '2026-10-19', 'badbadbadbadbadbadbadbad')) });
    assert.equal(badPost.status, 403);
    assert.equal(calls.approved.length, 0);

    const post = await fetch(`${base}/ok`, { method: 'POST', headers: form, body: params });
    assert.equal(post.status, 200);
    assert.ok((await post.text()).includes('Дозволено на 30 хв'));
    assert.equal(calls.approved.length, 1);
  } finally { await new Promise((r) => server.close(r)); }
});

// ---------- довідправка (jobs/tick) ----------
test('resendLateMails: невідправлені pending -> лист + mailed_at; точку без пари в Довіднику пропускає', async () => {
  const { resendLateMails } = require('../src/jobs');
  const sent = [], marked = [];
  const rows = [
    { dir: 'bread', store_id: STORE.id, req_date: '2026-10-19', requested_at: '2026-10-19T16:20:00+03:00' },
    { dir: 'bakery', store_id: 'нема такої', req_date: '2026-10-19', requested_at: '2026-10-19T16:20:00+03:00' },
  ];
  const env = {
    at: AT, late,
    data: { stores: async () => [STORE], directions: async () => DIRECTIONS, unmailedLate: async () => rows,
      markLateMailed: async (...a) => { marked.push(a); } },
    mailer: { recipient: () => 'x@example.com', sendLateMail: async (cfg, store, x) => { sent.push([cfg.key, store.id, x.url]); return true; } },
  };
  assert.deepEqual(await resendLateMails(env), { sent: 1, failed: 0, skipped: 1 });
  assert.equal(sent[0][2], late.approveUrl('bread', STORE.id, '2026-10-19'));
  assert.deepEqual(marked.map((m) => m.slice(0, 3)), [['bread', STORE.id, '2026-10-19']]);
});

test('resendLateMails: збій SMTP -> failed, mailed_at не ставиться', async () => {
  const { resendLateMails } = require('../src/jobs');
  const marked = [];
  const orig = console.error; console.error = () => {};
  try {
    const env = {
      at: AT, late,
      data: { stores: async () => [STORE], directions: async () => DIRECTIONS, markLateMailed: async (...a) => { marked.push(a); },
        unmailedLate: async () => [{ dir: 'bread', store_id: STORE.id, req_date: '2026-10-19', requested_at: '2026-10-19T16:20:00+03:00' }] },
      mailer: { recipient: () => 'x@example.com', sendLateMail: async () => { throw new Error('smtp down'); } },
    };
    assert.deepEqual(await resendLateMails(env), { sent: 0, failed: 1, skipped: 0 });
    assert.deepEqual(marked, []);
  } finally { console.error = orig; }
});

