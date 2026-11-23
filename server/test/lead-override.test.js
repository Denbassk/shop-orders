// Тимчасовий строк доставки з пульту (20.11.2026, Рома возить на післязавтра): settings.lead_override = { dir: { days, from, to, at } }.
// Дата замовлення лишається днем подачі; продавець бачить «Доставка: вт 24.11». Без запису - як раніше (дати доставки нема).
const test = require('node:test');
const assert = require('node:assert/strict');
const { DIRECTIONS } = require('../src/directions');
const R = require('../src/rules');
const W = require('../src/admin/write');
const { build } = require('../scripts/build-front');
const { apiBootstrap, apiRefresh, apiProducts } = require('../src/api/read');
const { admToday } = require('../src/admin/read');

const at = (iso) => new Date(iso);
const AT = at('2026-11-22T10:00:00+02:00');           // неділя
const DAY = '2026-11-22';
const ov = (o = {}) => ({ days: 2, from: DAY, to: '', at: '2026-11-21T08:00:00.000Z', ...o });
const eff = (overrides, a = AT) => R.withLeadOverrides(DIRECTIONS, overrides, a);

// ---------- rules ----------
test('lead: стан запису - без кінця, діапазон, майбутній, минулий, пошкоджений', () => {
  assert.equal(R.leadOverrideState(ov(), DAY), 'active');
  assert.equal(R.leadOverrideState(ov({ to: '2026-12-31' }), '2026-12-31'), 'active');
  assert.equal(R.leadOverrideState(ov({ from: '2026-11-23' }), DAY), 'scheduled');
  assert.equal(R.leadOverrideState(ov({ from: '2026-11-01', to: '2026-11-21' }), DAY), 'expired');
  for (const bad of [null, 'x', ov({ days: 0 }), ov({ days: 8 }), ov({ days: 1.5 }), ov({ days: '2' }), ov({ from: '' }), ov({ to: 'abc' }), ov({ to: '2026-11-01' })])
    assert.equal(R.leadOverrideState(bad, DAY), 'bad', JSON.stringify(bad));
});

test('lead: активний запис -> leadDays і дата доставки; базовий об\'єкт не мутується; інші напрямки без змін', () => {
  const d = eff({ bread: ov() });
  assert.equal(d.bread.leadDays, 2);
  assert.deepEqual(d.bread.leadOverride, { days: 2, from: DAY, to: '', active: true, at: '2026-11-21T08:00:00.000Z' });
  assert.deepEqual(R.deliveryOf(d.bread, AT), { day: '2026-11-24', short: 'вт 24.11', full: 'вівторок, 24.11', days: 2 });
  assert.equal(DIRECTIONS.bread.leadDays, undefined);
  assert.equal(d.nbhz, DIRECTIONS.nbhz);
  assert.equal(R.deliveryOf(d.nbhz, AT), null);
  assert.equal(eff(undefined), DIRECTIONS);
});

test('lead: запланований - дати доставки ще нема, запис видно пульту; минулий - зникає', () => {
  const s = eff({ bread: ov({ from: '2026-11-23' }) }).bread;
  assert.equal(s.leadDays, undefined); assert.equal(s.leadOverride.active, false);
  assert.equal(R.deliveryOf(s, AT), null);
  assert.equal(eff({ bread: ov({ from: '2026-11-01', to: '2026-11-21' }) }), DIRECTIONS);
});

test('lead: дата доставки за київським днем, через межу місяця і року', () => {
  const c = { leadDays: 2 };
  assert.equal(R.deliveryOf(c, at('2026-11-29T23:30:00+02:00')).day, '2026-12-01');      // пізно ввечері - ще 29.11 за Києвом
  assert.equal(R.deliveryOf(c, at('2026-11-29T22:30:00Z')).day, '2026-12-02');           // 00:30 30.11 за Києвом
  assert.deepEqual(R.deliveryOf({ leadDays: 1 }, at('2026-12-31T12:00:00+02:00')), { day: '2027-01-01', short: 'пт 01.01', full: 'пʼятниця, 01.01', days: 1 });
});

// ---------- пульт: setLead / revertLead ----------
function mkEnv(set = {}) {
  const st = { log: [], set };
  const env = { at: AT, log: () => {}, data: { directions: async () => DIRECTIONS }, adm: {
    adminLog: async (a, d) => { st.log.push([a, d]); },
    getSetting: async (k) => (k in st.set ? st.set[k] : null),
    setSetting: async (k, v) => { st.set[k] = v; } } };
  return { env, st };
}

test('setLead: за замовчуванням від сьогодні без кінця, запис у settings і журнал', async () => {
  const { env, st } = mkEnv();
  const r = await W.admSetLead({ dir: 'bread', days: 2 }, env);
  assert.deepEqual(r, { ok: true, dir: 'bread', title: DIRECTIONS.bread.title, days: 2, from: DAY, to: '', active: true });
  assert.deepEqual(st.set.lead_override, { bread: { days: 2, from: DAY, to: '', at: AT.toISOString() } });
  assert.deepEqual(st.log, [['Тимчасово змінено строк доставки', DIRECTIONS.bread.title + ': через 2 дн., з 22.11 без кінця']]);
});

test('setLead: період, «з» у минулому = від сьогодні, майбутній - не активний; чужі минулі записи прибираються', async () => {
  const { env, st } = mkEnv({ lead_override: { nbhz: ov({ from: '2026-10-01', to: '2026-10-02' }), veg: 'сміття' } });
  const r = await W.admSetLead({ dir: 'bread', days: '3', from: '2026-11-01', to: '2026-11-30' }, env);
  assert.equal(r.from, DAY); assert.equal(r.days, 3);
  assert.deepEqual(Object.keys(st.set.lead_override), ['bread']);
  assert.match(st.log[0][1], /через 3 дн\., з 22\.11 по 30\.11$/);
  assert.equal((await W.admSetLead({ dir: 'bread', days: 2, from: '2026-11-25' }, env)).active, false);
});

test('setLead: некоректне -> помилка до запису', async () => {
  for (const [p, re] of [
    [{ dir: 'bread' }, /від 1 до 7/], [{ dir: 'bread', days: 0 }, /від 1 до 7/], [{ dir: 'bread', days: 8 }, /від 1 до 7/], [{ dir: 'bread', days: 1.5 }, /від 1 до 7/],
    [{ dir: 'bread', days: 2, from: 'abc' }, /Невірна дата/], [{ dir: 'bread', days: 2, to: '2026-13-40' }, /Невірна дата/],
    [{ dir: 'bread', days: 2, from: '2026-11-25', to: '2026-11-24' }, /раніше/],
    [{ dir: 'bread', days: 2, from: '2026-11-01', to: '2026-11-02' }, /минув/],
    [{ dir: 'xx', days: 2 }, /Невідомий напрямок/],
  ]) {
    const { env, st } = mkEnv();
    await assert.rejects(W.admSetLead(p, env), re, JSON.stringify(p));
    assert.equal(st.set.lead_override, undefined); assert.equal(st.log.length, 0);
  }
});

test('revertLead: прибирає свій напрямок; повторно - без журналу', async () => {
  const { env, st } = mkEnv({ lead_override: { bread: ov(), nbhz: ov({ days: 1 }) } });
  assert.deepEqual(await W.admRevertLead({ dir: 'bread' }, env), { ok: true, reverted: true, dir: 'bread', title: DIRECTIONS.bread.title });
  assert.deepEqual(Object.keys(st.set.lead_override), ['nbhz']);
  assert.equal(st.log.length, 1);
  assert.equal((await W.admRevertLead({ dir: 'bread' }, env)).reverted, false);
  assert.equal(st.log.length, 1);
});

// ---------- продавець і пульт бачать дату доставки ----------
const sellerEnv = (directions) => ({ at: AT, veg: { resolve: async (r) => r }, data: {
  stores: async () => [{ id: 's1', label: 'Т1', code: '1', edrpou: '', days: {}, directions: ['bread', 'nbhz'] }],
  settings: async () => ({ app_version: 'v' }), directions: async () => directions, orderedToday: async () => ({}),
  lateRows: async () => [], products: async () => [{ id: '1', name: 'Хліб', price: 10, status: 'active', sort: 1 }] } });

test('продавець: bootstrap / refresh / products віддають дату доставки лише напрямку зі строком', async () => {
  const d = eff({ bread: ov() });
  const b = await apiBootstrap(sellerEnv(d));
  assert.equal(b.directions.bread.delivery, 'вт 24.11'); assert.equal('delivery' in b.directions.nbhz, false);
  const r = await apiRefresh({}, sellerEnv(d));
  assert.deepEqual(r.deliveries, { bread: 'вт 24.11', nbhz: '', bakery: '', veg: '' });
  assert.equal((await apiProducts({ dir: 'bread', storeId: 's1' }, sellerEnv(d))).delivery, 'вівторок, 24.11');
  // без строку - відповіді як раніше, без нових полів (фікстури бойових відповідей)
  assert.equal('delivery' in (await apiProducts({ dir: 'bread', storeId: 's1' }, sellerEnv(DIRECTIONS))), false);
  assert.equal('delivery' in (await apiBootstrap(sellerEnv(DIRECTIONS))).directions.bread, false);
  assert.equal('deliveries' in (await apiRefresh({}, sellerEnv(DIRECTIONS))), false);
});

test('пульт «Сегодня»: запис строку і дата доставки', async () => {
  const env = (directions) => ({ at: AT, data: { stores: async () => [], settings: async () => ({}), directions: async () => directions, orderedToday: async () => ({}) } });
  const bread = (await admToday(env(eff({ bread: ov() })))).dirs.find((x) => x.key === 'bread');
  assert.equal(bread.leadOverride.days, 2); assert.equal(bread.delivery.short, 'вт 24.11');
  const plain = (await admToday(env(DIRECTIONS))).dirs.find((x) => x.key === 'bread');
  assert.deepEqual([plain.leadOverride, plain.delivery], [undefined, undefined]);
});

test('сайт продавця: плитка, банер над товарами, рядок після відправки і оновлення з refresh', () => {
  const html = build();
  assert.ok(html.includes("(d.delivery ? '<b>Доставка ' + esc(d.delivery) + '</b>' : esc(d.subtitle))"));
  assert.ok(html.includes("Замовлення на доставку: <b>' + esc(d.delivery) + '</b>"));
  assert.ok(html.includes("(r.delivery ? '<p><b>Доставка: ' + esc(r.delivery) + '</b></p>' : '')"));
  assert.ok(html.includes('S.boot.directions[k].delivery = d.deliveries[k]'));
});

// ---------- файл для Роми (23.11.2026): у колонці «Дата заказа» - день доставки ----------
const bread = require('../src/reports/bread');
const { serialOfDmy } = require('../src/reports/sheetsTypes');

test('звіт хліба: зі строком доставки колонка «Дата заказа» = день доставки, зведення і «Завантаження» з поміткою', () => {
  const stores = [{ id: 's1', label: 'Т1', code: '7', edrpou: '', addrBread: 'вул. Тест, 1', route: 'М1', directions: ['bread'], days: {} }];
  const rows = [['22.11.2026', 'М1', 'вул. Тест, 1', '482', 'Хліб', 10, 5]];
  const plain = bread.buildBreadReports(rows, { stores, now: AT });
  const withDl = bread.buildBreadReports(rows, { stores, now: AT, delivery: '24.11.2026' });
  const cellA = (plan) => plan.data.find((r) => typeof r[0] === 'number')[0];
  assert.equal(cellA(plain['Заказы']), serialOfDmy('22.11.2026'));
  assert.equal(cellA(withDl['Заказы']), serialOfDmy('24.11.2026'));
  assert.ok(withDl['Данные Заказов'].data.some((r) => String(r[0]).includes('доставка 24.11.2026')));
  assert.ok(!plain['Данные Заказов'].data.some((r) => String(r[0]).includes('доставка')));
  const dl = bread.breadDownloadPlan({ spreadsheetId: 'x', ordersGid: 1, now: AT, delivery: '24.11.2026' });
  assert.equal(dl.data[1][0], 'за 22.11.2026 · доставка 24.11.2026');
  assert.equal(bread.breadDownloadPlan({ spreadsheetId: 'x', ordersGid: 1, now: AT }).data[1][0], 'за 22.11.2026');
});

test('звіти хліба і ВК: кількість без формату «0.###» («3,» замість «3»); legacy - старий формат для звірки', () => {
  const stores = [{ id: 's1', label: 'Т1', code: '7', edrpou: '', addrBread: 'вул. Тест, 1', route: 'М1', directions: ['bread'], days: {} }];
  const rows = [['22.11.2026', 'М1', 'вул. Тест, 1', '482', 'Хліб', 10, 3]];
  // формати живуть у plan.apply(w): записуємо всі виклики w.* через Proxy
  const has = (plans) => Object.values(plans).some((pl) => {
    const calls = [];
    const w = new Proxy({}, { get: (t, k) => (...args) => { calls.push(args); return w; } });
    if (pl.apply) pl.apply(w);
    return JSON.stringify(calls).includes('0.###');
  });
  assert.equal(has(bread.buildBreadReports(rows, { stores, now: AT })), false);
  assert.equal(has(bread.buildBreadReports(rows, { stores, now: AT, legacy: true })), true);
  const bakery = require('../src/reports/bakery');
  assert.equal(has(bakery.buildBakeryReports([], { stores: [], products: [], now: AT })), false);
});
