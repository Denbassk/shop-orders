// Відстеження сервісних повідомлень: які магазини побачили баннер і хто натиснув «Зрозуміло» (таблиця service_notice_ack).
// Телефон шле noticeSeen (api/notice.js), пульт показує «Побачили N з M» і список «Не бачили» (admin/notices.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DIRECTIONS } = require('../src/directions');
const { createData } = require('../src/data');
const { createAdminData } = require('../src/admin/data');
const { createApi } = require('../src/api/index');
const A = require('../src/admin/notices');

const at = (iso) => new Date(iso);
const AT = at('2026-11-03T11:00:00+02:00');
const n1 = (o = {}) => ({ id: 'a', text: 'Для всіх', dir: '', until: '2026-11-03 23:59', modal: false, at: '2026-11-03T08:00:00.000Z', ...o });

// ---------- міграція (статична перевірка; базу не чіпає - застосовує власник) ----------
const MIG = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261103000001_service_notice_ack.sql');
const mig = () => fs.readFileSync(MIG, 'utf8').replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();

test('міграція: service_notice_ack (повідомлення, магазин) - ключ, seen_at/ack_at, RLS без політик, закрита від anon/authenticated, без drop', () => {
  const s = mig();
  assert.match(s, /create table public\.service_notice_ack \(/);
  for (const c of ['notice_id text not null', 'store_id text not null', 'seen_at timestamptz not null default now()', 'ack_at timestamptz', 'primary key \\(notice_id, store_id\\)']) assert.match(s, new RegExp(c), c);
  assert.match(s, /alter table public\.service_notice_ack enable row level security/);
  assert.match(s, /revoke all on public\.service_notice_ack from anon, authenticated/);
  assert.doesNotMatch(s, /create policy|drop |truncate|delete from/);
});

// ---------- слой даних ----------
function fakeSb(respond = () => ({ data: [], error: null })) {
  const calls = [];
  return { calls, from(table) {
    const q = { table, ops: [] }; calls.push(q);
    const b = new Proxy({}, { get(_, k) {
      if (k === 'then') return (ok, bad) => Promise.resolve(respond(q)).then(ok, bad);
      return (...a) => { q.ops.push([k, ...a]); return b; };
    } });
    return b;
  } };
}
const op = (q, name) => q.ops.find((o) => o[0] === name);

test('data.noticeSeen: upsert (повідомлення, магазин) БЕЗ перезапису першого seen_at; порожній список - без запиту', async () => {
  const sb = fakeSb();
  const d = createData(sb, { now: () => AT.getTime() });
  await d.noticeSeen('s1', ['a', 'b']);
  assert.equal(sb.calls[0].table, 'service_notice_ack');
  assert.deepEqual(op(sb.calls[0], 'upsert').slice(1), [[{ notice_id: 'a', store_id: 's1' }, { notice_id: 'b', store_id: 's1' }], { onConflict: 'notice_id,store_id', ignoreDuplicates: true }]);
  await d.noticeSeen('s1', []);
  assert.equal(sb.calls.length, 1);
});

test('data.noticeAcked: upsert з ack_at = зараз (seen_at не чіпається, якщо рядок є); порожній список - без запиту', async () => {
  const sb = fakeSb();
  const d = createData(sb, { now: () => AT.getTime() });
  await d.noticeAcked('s1', ['a']);
  assert.deepEqual(op(sb.calls[0], 'upsert').slice(1), [[{ notice_id: 'a', store_id: 's1', ack_at: AT.toISOString() }], { onConflict: 'notice_id,store_id' }]);
  await d.noticeAcked('s1', []);
  assert.equal(sb.calls.length, 1);
  await assert.rejects(createData(fakeSb(() => ({ data: null, error: { message: 'down' } })), { now: () => 0 }).noticeSeen('s1', ['a']), /service_notice_ack: down/);
});

test('adm.noticeAcks: рядки по списку повідомлень; порожній список - [] без запиту', async () => {
  const sb = fakeSb(() => ({ data: [{ notice_id: 'a', store_id: 's1', seen_at: '2026-11-03T08:00:00Z', ack_at: null }], error: null }));
  const adm = createAdminData(sb);
  assert.deepEqual(await adm.noticeAcks(['a', 'b']), [{ notice_id: 'a', store_id: 's1', seen_at: '2026-11-03T08:00:00Z', ack_at: null }]);
  assert.equal(sb.calls[0].table, 'service_notice_ack');
  assert.deepEqual(op(sb.calls[0], 'in').slice(1), ['notice_id', ['a', 'b']]);
  assert.deepEqual(await adm.noticeAcks([]), []);
  assert.equal(sb.calls.length, 1);
});

// ---------- /api noticeSeen ----------
const STORES = [
  { id: 's1', label: 'Зернова, 6/5', code: '10', route: '1', directions: ['bread', 'nbhz'] },
  { id: 's2', label: 'Байрона, 138/1', code: '11', route: '2', directions: ['nbhz'] },
  { id: 's3', label: 'Амосова, 5А', code: '12', route: '1', directions: ['bread'] },
  { id: 'test-1', label: 'Тестова', code: '', route: '', directions: ['bread'] },
];
function apiEnv(notices, st = { seen: [], acked: [] }) {
  const env = { at: AT, data: {
    stores: async () => STORES, settings: async () => ({ service_notice: notices }),
    noticeSeen: async (...a) => { st.seen.push(a); }, noticeAcked: async (...a) => { st.acked.push(a); } } };
  return { env, st, api: createApi(() => env, () => {}) };
}
const NOTICES = [n1(), n1({ id: 'b', dir: 'bread', modal: true }), n1({ id: 'v', dir: 'veg' }), n1({ id: 'old', until: '2026-11-03 10:00' })];

test('noticeSeen: лише діючі повідомлення, що стосуються цього магазину (усі + його напрямки); чужі, минулі й невідомі відкидаються', async () => {
  const { api, st } = apiEnv(NOTICES);
  const r = await api('noticeSeen', { storeId: 's1', seen: ['a', 'b', 'v', 'old', 'zzz', 5, null], acked: [] });
  assert.deepEqual(r, { ok: true, data: { seen: 2, acked: 0 } });
  assert.deepEqual(st.seen, [['s1', ['a', 'b']]]);
  assert.deepEqual(st.acked, []);
});

test('noticeSeen: підтвердження («Зрозуміло») теж фіксує «побачив»; acked лише для відповідних повідомлень', async () => {
  const { api, st } = apiEnv(NOTICES);
  const r = await api('noticeSeen', { storeId: 's3', seen: [], acked: ['b', 'v'] });
  assert.deepEqual(r.data, { seen: 1, acked: 1 });
  assert.deepEqual(st.seen, [['s3', ['b']]]);
  assert.deepEqual(st.acked, [['s3', ['b']]]);
});

test('noticeSeen: невідомий магазин, не масиви, порожнє - тихо {0,0}, нічого не пишеться; не більше 20 id за раз', async () => {
  for (const p of [{ storeId: 'nope', seen: ['a'] }, { storeId: 's1' }, { storeId: 's1', seen: 'a', acked: {} }, {}, { storeId: 's1', seen: [] }]) {
    const { api, st } = apiEnv(NOTICES);
    const r = await api('noticeSeen', p);
    assert.deepEqual(r, { ok: true, data: { seen: 0, acked: 0 } }, JSON.stringify(p));
    assert.deepEqual([st.seen.length, st.acked.length], [0, 0]);
  }
  const many = Array.from({ length: 30 }, (_, i) => n1({ id: 'm' + i }));
  const { api, st } = apiEnv(many);
  await api('noticeSeen', { storeId: 's1', seen: many.map((n) => n.id) });
  assert.equal(st.seen[0][1].length, 20);
});

test('noticeSeen: збій бази - помилка в конверті (телефон її проковтне), api не падає', async () => {
  const { env } = apiEnv(NOTICES);
  env.data.noticeSeen = async () => { throw new Error('down'); };
  const logs = [];
  const r = await createApi(() => env, (m) => logs.push(m))('noticeSeen', { storeId: 's1', seen: ['a'] });
  assert.equal(r.ok, false); assert.match(r.error, /down/); assert.equal(logs.length, 1);
});

// ---------- пульт: статистика ----------
const acks = (rows) => rows.map(([notice_id, store_id, seen_at, ack_at]) => ({ notice_id, store_id, seen_at, ack_at: ack_at || null }));
function pult(list, rows) {
  const st = { asked: [] };
  const env = { at: AT, log: () => {}, data: { stores: async () => STORES },
    adm: { getSetting: async () => list, setSetting: async () => {}, adminLog: async () => {}, noticeAcks: async (ids) => { st.asked.push(ids); return acks(rows); } } };
  return { env, st };
}
const ROWS = [
  ['a', 's1', '2026-11-03T08:00:00+00:00', '2026-11-03T08:05:00+00:00'],
  ['a', 's2', '2026-11-03T08:30:00+00:00'],
  ['a', 'test-1', '2026-11-03T08:31:00+00:00'],              // тестова точка - не рахується
  ['b', 's1', '2026-11-03T08:10:00+00:00'],
  ['b', 's2', '2026-11-03T08:40:00+00:00'],                  // у s2 нема bread - не рахується
];

test('noticeList: «побачили / підтвердили з усіх» по кожному повідомленню; лише магазини з цим напрямком; тестові не рахуються', async () => {
  const { env, st } = pult([n1({ modal: true }), n1({ id: 'b', dir: 'bread', text: 'Хліб' })], ROWS);
  const r = await A.admNoticeList({}, env);
  assert.deepEqual(r.notices.map((n) => [n.id, n.total, n.seen, n.acked]), [['a', 3, 2, 1], ['b', 2, 1, 0]]);
  assert.deepEqual(st.asked, [['a', 'b']], 'один запит на всі діючі повідомлення');
});

test('noticeList: без повідомлень - без запиту до бази підтверджень', async () => {
  const { env, st } = pult([], ROWS);
  assert.deepEqual((await A.admNoticeList({}, env)).notices, []);
  assert.equal(st.asked.length, 0);
});

test('noticeWho: один список магазинів за адресою (uk): статус none / seen / ack, номер, маршрут, час «побачив» за Києвом', async () => {
  const { env } = pult([n1({ modal: true })], ROWS);
  const r = await A.admNoticeWho({ id: 'a' }, env);
  assert.deepEqual([r.id, r.total, r.seen, r.acked, r.modal, r.dirTitle], ['a', 3, 2, 1, true, 'Усі продавці']);
  assert.deepEqual(r.rows, [
    { id: 's3', label: 'Амосова, 5А', code: '12', route: '1', status: 'none', seenAt: '' },
    { id: 's2', label: 'Байрона, 138/1', code: '11', route: '2', status: 'seen', seenAt: '03.11 10:30' },
    { id: 's1', label: 'Зернова, 6/5', code: '10', route: '1', status: 'ack', seenAt: '03.11 10:00' },
  ]);
  assert.equal(r.missing, undefined); assert.equal(r.seenList, undefined);          // замість двох окремих списків - один rows
});

test('noticeWho: напрямкове - знаменник лише магазини з напрямком; невідоме/минуле повідомлення - помилка', async () => {
  const { env } = pult([n1({ id: 'b', dir: 'bread' }), n1({ id: 'old', until: '2026-11-03 09:00' })], ROWS);
  const r = await A.admNoticeWho({ id: 'b' }, env);
  assert.deepEqual([r.total, r.seen, r.dirTitle], [2, 1, DIRECTIONS.bread.title]);
  assert.deepEqual(r.rows.map((x) => [x.id, x.status]), [['s3', 'none'], ['s1', 'seen']]);          // s2 (лише НБХЗ) і test-1 у списку нема
  await assert.rejects(A.admNoticeWho({ id: 'zzz' }, env), /Невідоме повідомлення/);
  await assert.rejects(A.admNoticeWho({ id: 'old' }, env), /Невідоме повідомлення/);
  await assert.rejects(A.admNoticeWho({}, env), /Невідоме повідомлення/);
});

test('runtime: дія noticeWho підключена; /api: noticeSeen', () => {
  const rt = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8');
  assert.ok(rt.includes('noticeWho: (p) => notices.admNoticeWho(p, env())'));
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'index.js'), 'utf8').includes("case 'noticeSeen'"));
});

// ---------- сайт продавця: відправка «побачив / підтвердив» (scripts/front-notice.js у vm) ----------
const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'front-notice.js'), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));
function sandbox({ notices = [], store = null, mine = null, storage = {}, storageBroken = false, hidden = false, callImpl } = {}) {
  const els = { nbox: { innerHTML: '' } }, calls = [];
  const document = { hidden,
    createElement: () => ({ id: '', className: '', innerHTML: '', parentNode: null, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } }),
    body: { appendChild(n) { n.parentNode = document.body; els[n.id] = n; }, removeChild(n) { delete els[n.id]; n.parentNode = null; } } };
  const localStorage = storageBroken ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = v; } };
  const ctx = { document, localStorage, S: { boot: { notices, directions: { bread: {}, nbhz: {}, veg: {} } }, store, dir: null },
    el: (id) => els[id] || null, esc: (s) => String(s), JSON, Object, Array, Promise,
    myStore: () => mine,
    call: (action, payload) => { calls.push([action, JSON.parse(JSON.stringify(payload))]); return callImpl ? callImpl(action, payload) : Promise.resolve({}); } };
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return { ctx, els, calls, storage };
}
const nt = (o = {}) => ({ id: 'a', text: 'Текст', dir: '', modal: false, ...o });
const S1 = { id: 's1', directions: ['bread', 'nbhz'] };
const click = (node, className) => node.listeners.click({ target: className ? { className } : node });

test('відправка: баннер побачено - шле noticeSeen для відомого магазину один раз (перемальовування не повторює)', async () => {
  const { ctx, calls } = sandbox({ notices: [nt()], store: S1 });
  ctx.renderNotices(); ctx.renderNotices();                       // дві перемальовки до відповіді - один запит
  await tick(); ctx.renderNotices(); await tick();
  assert.deepEqual(calls, [['noticeSeen', { storeId: 's1', seen: ['a'], acked: [] }]]);
});

test('відправка: магазин невідомий - мовчить; з\'явився (обрали або запам\'ятаний телефоном myStore) - тоді шле', async () => {
  const a = sandbox({ notices: [nt()] }); a.ctx.renderNotices(); await tick();
  assert.equal(a.calls.length, 0);
  a.ctx.S.store = S1; a.ctx.renderNotices(); await tick();
  assert.equal(a.calls.length, 1);
  const b = sandbox({ notices: [nt()], mine: S1 }); b.ctx.renderNotices(); await tick();
  assert.deepEqual(b.calls, [['noticeSeen', { storeId: 's1', seen: ['a'], acked: [] }]]);
});

test('відправка: повідомлення не для напрямків магазину не рахується (банер на екрані вибору точки видно всім, а «побачив» - лише адресату)', async () => {
  const { ctx, calls } = sandbox({ notices: [nt(), nt({ id: 'v', dir: 'veg' })], mine: S1 });
  ctx.renderNotices(); await tick();
  assert.deepEqual(calls[0][1].seen, ['a']);
});

test('відправка: вкладка прихована - не шле; збій мережі - не позначає відправленим, наступне перемальовування повторить', async () => {
  const h = sandbox({ notices: [nt()], store: S1, hidden: true }); h.ctx.renderNotices(); await tick();
  assert.equal(h.calls.length, 0);
  let fail = true;
  const f = sandbox({ notices: [nt()], store: S1, callImpl: () => (fail ? Promise.reject(new Error('net')) : Promise.resolve({})) });
  f.ctx.renderNotices(); await tick(); await tick();
  fail = false; f.ctx.renderNotices(); await tick();
  assert.equal(f.calls.length, 2);
});

test('відправка: «Зрозуміло» шле acked разом із seen; один раз; якщо магазин ще невідомий - піде, коли з\'явиться', async () => {
  const { ctx, els, calls } = sandbox({ notices: [nt({ modal: true })], store: S1 });
  ctx.renderNotices(); await tick();
  assert.deepEqual(calls[0][1], { storeId: 's1', seen: ['a'], acked: [] });
  click(els['ntc-ov'], 'rem-go ntc-ok'); await tick();
  assert.deepEqual(calls[1][1], { storeId: 's1', seen: [], acked: ['a'] });
  ctx.renderNotices(); await tick();
  assert.equal(calls.length, 2, 'вже повідомлено');
  const late = sandbox({ notices: [nt({ modal: true })] });
  late.ctx.renderNotices(); click(late.els['ntc-ov'], 'rem-go ntc-ok'); await tick();
  assert.equal(late.calls.length, 0);
  late.ctx.S.store = S1; late.ctx.renderNotices(); await tick();
  assert.deepEqual(late.calls, [['noticeSeen', { storeId: 's1', seen: ['a'], acked: ['a'] }]]);
});

test('відправка: «вже повідомили» живе на пристрої (новий запуск не повторює); localStorage заблоковано - до перезавантаження', async () => {
  const a = sandbox({ notices: [nt()], store: S1 }); a.ctx.renderNotices(); await tick();
  assert.equal(a.calls.length, 1);
  const again = sandbox({ notices: [nt()], store: S1, storage: a.storage }); again.ctx.renderNotices(); await tick();
  assert.equal(again.calls.length, 0);
  const other = sandbox({ notices: [nt()], store: { id: 's9', directions: [] }, storage: a.storage }); other.ctx.renderNotices(); await tick();
  assert.equal(other.calls.length, 1, 'інший магазин на тому ж телефоні - окремий запис');
  const b = sandbox({ notices: [nt()], store: S1, storageBroken: true }); b.ctx.renderNotices(); await tick(); b.ctx.renderNotices(); await tick();
  assert.equal(b.calls.length, 1);
});

// ---------- збірка / пульт ----------
test('пульт: у списку «Увидели N из M», кнопка «Кто не видел», екран noticewho зі списками «Не видели / Видели»', () => {
  const html = require('../scripts/build-admin').build();
  const tail = html.slice(html.indexOf('shop-orders: сообщения продавцам'));
  for (const s of ['function loadNoticeWho(', "call('noticeWho'", "S.screen === 'noticewho'", 'Увидели', 'Не видели', 'Подтвердили', 'Кто не видел', "go('noticewho'",
    'function nwDraw(', 'function nwFilter(', 'Адрес, № или маршрут', 'class="atiles nwt"', 'Не видел', 'Подтвердил', 'nwbar']) assert.ok(tail.includes(s), s);
  assert.ok(!tail.includes('seenList') && !tail.includes('r.missing'), 'клієнт бере єдиний rows');
});

test('noticeList: таблиці підтверджень нема (міграцію не застосовано) або база не відповіла - список відкривається без цифр, а не падає', async () => {
  const { env } = pult([n1()], ROWS);
  env.adm.noticeAcks = async () => { throw new Error('relation "service_notice_ack" does not exist'); };
  const r = await A.admNoticeList({}, env);
  assert.deepEqual(r.notices.map((n) => [n.id, n.total, n.seen, n.acked]), [['a', null, null, null]]);
});

test('noticeWho: адреси сортуються з числовим порядком будинків (34, 70, 106, а не 106, 34, 70)', async () => {
  const st = ['Павлова, 106', 'Павлова, 34', 'Павлова, 70', 'Павлова, 5А'].map((label, i) => ({ id: 'p' + i, label, code: '', route: '', directions: ['bread'] }));
  const env = { at: AT, log: () => {}, data: { stores: async () => st },
    adm: { getSetting: async () => [n1()], setSetting: async () => {}, adminLog: async () => {}, noticeAcks: async () => [] } };
  const r = await A.admNoticeWho({ id: 'a' }, env);
  assert.deepEqual(r.rows.map((x) => x.label), ['Павлова, 5А', 'Павлова, 34', 'Павлова, 70', 'Павлова, 106']);
});
