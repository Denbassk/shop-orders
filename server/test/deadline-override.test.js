// Тимчасова зміна дедлайну прийому з пульту: settings.deadline_override = { dir: { deadline, from, to, at } }.
// Базовий дедлайн (directions.cfg.deadline) не змінюється; ефективний = override, поки сьогодні (Київ) у [from, to].
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECTIONS } = require('../src/directions');
const R = require('../src/rules');
const W = require('../src/admin/write');
const { createData } = require('../src/data');

const at = (iso) => new Date(iso);
const ov = (o = {}) => ({ deadline: '17:00', from: '2026-11-03', to: '2026-11-03', at: '2026-11-03T08:00:00.000Z', ...o });
const eff = (overrides, iso) => R.withDeadlineOverrides(DIRECTIONS, overrides, at(iso));
const passed = (overrides, iso, dir = 'bread') => R.deadlinePassed(dir, undefined, { at: at(iso), settings: {}, directions: eff(overrides, iso) });

// ---------- rules ----------
test('override: у діапазоні дедлайн = override, базовий лишається в baseDeadline', () => {
  const d = eff({ bread: ov() }, '2026-11-03T12:00:00+02:00').bread;
  assert.equal(d.deadline, '17:00');
  assert.equal(d.baseDeadline, '16:00');
  assert.deepEqual(d.deadlineOverride, { deadline: '17:00', from: '2026-11-03', to: '2026-11-03', active: true, at: '2026-11-03T08:00:00.000Z' });
  assert.equal(R.baseDeadlineOf(d), '16:00');
  assert.equal(DIRECTIONS.bread.deadline, '16:00', 'вхідний об\'єкт не мутується');
});

test('override: 16:30 при базових 16:00 і override 17:00 - ще відкрито, о 17:00 закрито', () => {
  assert.equal(passed({}, '2026-11-03T16:30:00+02:00'), true);                       // без override: закрито
  assert.equal(passed({ bread: ov() }, '2026-11-03T16:30:00+02:00'), false);
  assert.equal(passed({ bread: ov() }, '2026-11-03T16:59:00+02:00'), false);
  assert.equal(passed({ bread: ov() }, '2026-11-03T17:00:00+02:00'), true);
});

test('override: може бути й раніше за базовий', () => {
  assert.equal(passed({ bread: ov({ deadline: '15:00' }) }, '2026-11-03T15:00:00+02:00'), true);
  assert.equal(passed({}, '2026-11-03T15:00:00+02:00'), false);
});

test('override: діапазон кількох днів діє в усі дні, межі включно', () => {
  const o = { bread: ov({ from: '2026-11-03', to: '2026-11-05' }) };
  for (const day of ['03', '04', '05']) assert.equal(eff(o, `2026-11-${day}T12:00:00+02:00`).bread.deadline, '17:00', day);
  assert.equal(eff(o, '2026-11-06T12:00:00+02:00').bread.deadline, '16:00', 'після to - знову базовий');
});

test('override: межа дня за Києвом, не UTC (23:59 ще сьогодні, 00:00 вже завтра)', () => {
  const o = { bread: ov() };                                                        // лише 03.11
  assert.equal(eff(o, '2026-11-03T23:59:59+02:00').bread.deadline, '17:00');
  assert.equal(eff(o, '2026-11-04T00:00:00+02:00').bread.deadline, '16:00');
  assert.equal(eff(o, '2026-11-04T00:00:00+02:00').bread.deadlineOverride, undefined, 'минулий запис ігнорується повністю');
  const future = { bread: ov({ from: '2026-11-04', to: '2026-11-04' }) };
  assert.equal(eff(future, '2026-11-03T23:59:59+02:00').bread.deadline, '16:00', 'до from діє базовий');
  assert.equal(eff(future, '2026-11-04T00:00:00+02:00').bread.deadline, '17:00');
});

test('override: запланований (from попереду) видно в deadlineOverride з active=false', () => {
  const d = eff({ bread: ov({ from: '2026-11-05', to: '2026-11-06' }) }, '2026-11-03T12:00:00+02:00').bread;
  assert.equal(d.deadline, '16:00');
  assert.equal(d.deadlineOverride.active, false);
  assert.equal(d.deadlineOverride.from, '2026-11-05');
});

test('override: пошкоджений запис, невідомий напрямок, порожнє - нічого не ламають; чужі напрямки не чіпаються', () => {
  for (const bad of [null, 'x', 5, {}, ov({ deadline: '25:00' }), ov({ deadline: '9:00' }), ov({ from: 'вчора' }), ov({ from: '2026-11-04', to: '2026-11-03' })]) {
    const r = eff({ bread: bad, nope: ov() }, '2026-11-03T12:00:00+02:00');
    assert.equal(r.bread.deadline, '16:00', JSON.stringify(bad));
    assert.equal(r.bread.deadlineOverride, undefined);
    assert.equal(r.nope, undefined);
  }
  assert.equal(R.withDeadlineOverrides(DIRECTIONS, undefined, at('2026-11-03T12:00:00+02:00')), DIRECTIONS);
  assert.equal(R.withDeadlineOverrides(DIRECTIONS, null, at('2026-11-03T12:00:00+02:00')), DIRECTIONS);
  const r = eff({ bread: ov() }, '2026-11-03T12:00:00+02:00');
  assert.equal(r.nbhz, DIRECTIONS.nbhz);
  assert.deepEqual(Object.keys(r), Object.keys(DIRECTIONS), 'порядок напрямків збережено');
});

test('override: windowOpen / late_all працюють з ефективним дедлайном', () => {
  const iso = '2026-11-03T16:30:00+02:00';
  const ctx = (settings, overrides) => ({ at: at(iso), settings, directions: eff(overrides, iso) });
  assert.equal(R.windowOpen('bread', ctx({}, { bread: ov() })), true);
  assert.equal(R.windowOpen('bread', ctx({}, {})), false);
  assert.equal(R.windowOpen('bread', ctx({ late_all: { bread: '2026-11-03' } }, {})), true);
});

// ---------- data.directions() - єдине місце накладення ----------
function sbFake({ dirs, settings }) {
  const q = (rows) => ({ select() { return Promise.resolve({ data: rows, error: null }); } });
  return { from: (t) => (t === 'directions' ? q(dirs) : q(settings)) };
}
const ROWS = Object.entries(DIRECTIONS).map(([dir, cfg]) => ({ dir, cfg }));

test('data.directions(): накладає override з settings; база з БД і інші напрямки не змінюються', async () => {
  const t = at('2026-11-03T12:00:00+02:00').getTime();
  const a = await createData(sbFake({ dirs: ROWS, settings: [{ key: 'deadline_override', value: { bread: ov() } }] }), { now: () => t }).directions();
  assert.equal(a.bread.deadline, '17:00'); assert.equal(a.bread.baseDeadline, '16:00'); assert.equal(a.nbhz.deadline, '17:30');
  assert.equal(ROWS[0].cfg.deadline, '16:00');
  const none = await createData(sbFake({ dirs: ROWS, settings: [] }), { now: () => t }).directions();
  assert.equal(none.bread.deadline, '16:00'); assert.equal(none.bread.deadlineOverride, undefined);
});

test('data.directions(): кінець діапазону настає без перезапуску й без чекання кешу (накладення при кожному виклику)', async () => {
  let t = at('2026-11-03T23:59:58+02:00').getTime();
  const d = createData(sbFake({ dirs: ROWS, settings: [{ key: 'deadline_override', value: { bread: ov() } }] }), { now: () => t });
  assert.equal((await d.directions()).bread.deadline, '17:00');
  t = at('2026-11-04T00:00:03+02:00').getTime();                                    // +5 с: кеші settings (10 с) і напрямків (30 с) ще живі
  assert.equal((await d.directions()).bread.deadline, '16:00');
});

// ---------- admin: setDeadline / revertDeadline ----------
const AT = at('2026-11-03T16:30:00+02:00');
const DAY = '2026-11-03';
function mkEnv(set = {}, iso) {
  const st = { log: [], set };
  const env = {
    at: iso ? at(iso) : AT, log: () => {},
    data: { directions: async () => DIRECTIONS },
    adm: {
      adminLog: async (a, d) => { st.log.push([a, d]); },
      getSetting: async (k) => (k in st.set ? st.set[k] : null),
      setSetting: async (k, v) => { st.set[k] = v; },
    },
  };
  return { env, st };
}

test('setDeadline: лише сьогодні за замовчуванням (from=to=сьогодні), запис у settings і журнал', async () => {
  const { env, st } = mkEnv();
  const r = await W.admSetDeadline({ dir: 'bread', deadline: '17:00' }, env);
  assert.deepEqual(st.set.deadline_override, { bread: { deadline: '17:00', from: DAY, to: DAY, at: AT.toISOString() } });
  assert.deepEqual(r, { ok: true, dir: 'bread', title: DIRECTIONS.bread.title, deadline: '17:00', from: DAY, to: DAY, base: '16:00', active: true, closedNow: false });
  assert.deepEqual(st.log, [['Тимчасово змінено час прийому', DIRECTIONS.bread.title + ': 17:00 замість 16:00, 03.11']]);
});

test('setDeadline: діапазон дат; запис для іншого напрямку не затирається', async () => {
  const { env, st } = mkEnv({ deadline_override: { nbhz: ov({ deadline: '18:00', to: '2026-11-10' }) } });
  await W.admSetDeadline({ dir: 'bread', deadline: '17:00', from: '2026-11-04', to: '2026-11-06' }, env);
  assert.deepEqual(Object.keys(st.set.deadline_override).sort(), ['bread', 'nbhz']);
  assert.equal(st.set.deadline_override.bread.from, '2026-11-04');
  assert.equal(st.set.deadline_override.bread.to, '2026-11-06');
  assert.equal(st.set.deadline_override.nbhz.deadline, '18:00');
  assert.match(st.log[0][1], /04\.11 – 06\.11$/);
});

test('setDeadline: повторна зміна того ж напрямку замінює запис; база для журналу - прописана, а не попередній override', async () => {
  const { env, st } = mkEnv();
  const directions = R.withDeadlineOverrides(DIRECTIONS, { bread: ov() }, AT);
  env.data.directions = async () => directions;
  st.set.deadline_override = { bread: ov() };
  await W.admSetDeadline({ dir: 'bread', deadline: '18:00' }, env);
  assert.equal(st.set.deadline_override.bread.deadline, '18:00');
  assert.match(st.log[0][1], /18:00 замість 16:00/);
});

test('setDeadline: час уже минув -> closedNow=true (пульт попередить); «from» у минулому = від сьогодні', async () => {
  const { env, st } = mkEnv();
  const r = await W.admSetDeadline({ dir: 'bread', deadline: '16:00', from: '2026-11-01', to: '2026-11-04' }, env);
  assert.equal(r.closedNow, true);
  assert.equal(st.set.deadline_override.bread.from, DAY);
});

test('setDeadline: майбутній діапазон -> active=false, closedNow=false', async () => {
  const { env } = mkEnv();
  const r = await W.admSetDeadline({ dir: 'bread', deadline: '10:00', from: '2026-11-05', to: '2026-11-05' }, env);
  assert.equal(r.active, false); assert.equal(r.closedNow, false);
});

test('setDeadline: некоректне -> помилка до запису', async () => {
  for (const [p, re] of [
    [{ dir: 'bread', deadline: '25:00' }, /ГГ:ХХ/], [{ dir: 'bread', deadline: '9:00' }, /ГГ:ХХ/], [{ dir: 'bread', deadline: '' }, /ГГ:ХХ/],
    [{ dir: 'bread' }, /ГГ:ХХ/],
    [{ dir: 'bread', deadline: '17:00', from: 'abc' }, /Невірна дата/], [{ dir: 'bread', deadline: '17:00', to: '2026-13-40' }, /Невірна дата/],
    [{ dir: 'bread', deadline: '17:00', from: '2026-11-05', to: '2026-11-04' }, /раніше/],
    [{ dir: 'bread', deadline: '17:00', from: '2026-11-01', to: '2026-11-02' }, /минув/],
    [{ dir: 'bread', deadline: '17:00', from: '2026-11-03', to: '2027-03-03' }, /довший/],
    [{ dir: 'xx', deadline: '17:00' }, /Невідомий напрямок/], [{ dir: '__proto__', deadline: '17:00' }, /Невідомий напрямок/],
  ]) {
    const { env, st } = mkEnv();
    await assert.rejects(W.admSetDeadline(p, env), re, JSON.stringify(p));
    assert.equal(st.set.deadline_override, undefined); assert.equal(st.log.length, 0);
  }
});

test('setDeadline: при збереженні минулі й пошкоджені записи інших напрямків прибираються', async () => {
  const { env, st } = mkEnv({ deadline_override: { nbhz: ov({ from: '2026-10-01', to: '2026-10-02' }), veg: 'сміття', bakery: ov({ deadline: '14:00', to: '2026-11-09' }) } });
  await W.admSetDeadline({ dir: 'bread', deadline: '17:00' }, env);
  assert.deepEqual(Object.keys(st.set.deadline_override).sort(), ['bakery', 'bread']);
});

test('revertDeadline: прибирає лише свій напрямок, журнал; повторний виклик - нічого не пише в журнал', async () => {
  const { env, st } = mkEnv({ deadline_override: { bread: ov(), nbhz: ov({ deadline: '18:00' }) } });
  const info = { dir: 'bread', title: DIRECTIONS.bread.title, base: '16:00' };         // для пропозиції «сповістити продавців» у пульті
  assert.deepEqual(await W.admRevertDeadline({ dir: 'bread' }, env), { ok: true, reverted: true, ...info });
  assert.deepEqual(Object.keys(st.set.deadline_override), ['nbhz']);
  assert.deepEqual(st.log, [['Повернуто час прийому', DIRECTIONS.bread.title + ' - як у Довіднику']]);
  assert.deepEqual(await W.admRevertDeadline({ dir: 'bread' }, env), { ok: true, reverted: false, ...info });
  assert.equal(st.log.length, 1);
  await assert.rejects(W.admRevertDeadline({ dir: 'xx' }, env), /Невідомий напрямок/);
});

test('revertDeadline: після відкату ефективний дедлайн = прописаний', async () => {
  const { env, st } = mkEnv({ deadline_override: { bread: ov() } });
  await W.admRevertDeadline({ dir: 'bread' }, env);
  assert.equal(R.withDeadlineOverrides(DIRECTIONS, st.set.deadline_override, AT).bread.deadline, '16:00');
});

test('runtime: дії setDeadline / revertDeadline підключено, пульт читає напрямки без кешу', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8');
  assert.ok(src.includes('setDeadline: (p) => write.admSetDeadline(p, env())'));
  assert.ok(src.includes('revertDeadline: (p) => write.admRevertDeadline(p, env())'));
  assert.ok(/directions: \(\) => createData\(sb\)\.directions\(\)/.test(src));
});

// ---------- усі читачі бачать ефективний дедлайн ----------
const { apiBootstrap, apiRefresh, apiProducts } = require('../src/api/read');
const { admToday } = require('../src/admin/read');
const B = require('../src/buyer/api');

const withOv = R.withDeadlineOverrides(DIRECTIONS, { bread: ov() }, AT);          // 16:30: прописано 16:00, діє 17:00
const sellerEnv = (directions) => ({ at: AT, veg: { resolve: async (r) => r }, data: {
  stores: async () => [{ id: 's1', label: 'Т1', code: '1', edrpou: '', days: {}, directions: ['bread'] }],
  settings: async () => ({ app_version: 'v' }), directions: async () => directions, orderedToday: async () => ({}),
  lateRows: async () => [], products: async () => [{ id: '1', name: 'Хліб', price: 10, status: 'active', sort: 1 }] } });

test('продавець: bootstrap / refresh / products віддають ефективний дедлайн; закрито рахується з ним', async () => {
  const b = await apiBootstrap(sellerEnv(withOv));
  assert.equal(b.directions.bread.deadline, '17:00'); assert.equal(b.directions.bread.closed, false);
  const r = await apiRefresh({}, sellerEnv(withOv));
  assert.equal(r.deadlines.bread, '17:00'); assert.equal(r.closed.bread, false);
  assert.deepEqual(Object.keys(r.deadlines), Object.keys(r.closed), 'deadlines по тих самих напрямках, що й closed (без вимкнених)');
  const p = await apiProducts({ dir: 'bread', storeId: 's1' }, sellerEnv(withOv));
  assert.equal(p.deadline, '17:00'); assert.equal(p.closed, false); assert.equal(p.windowOpen, true);
  // без override - як було: о 16:30 закрито, дедлайн 16:00
  const q = await apiProducts({ dir: 'bread', storeId: 's1' }, sellerEnv(DIRECTIONS));
  assert.equal(q.deadline, '16:00'); assert.equal(q.closed, true);
  assert.equal((await apiRefresh({}, sellerEnv(DIRECTIONS))).deadlines.bread, '16:00');
});

test('пульт «Сегодня»: дедлайн ефективний, поруч прописаний і запис override, day; minLeft від ефективного', async () => {
  const env = (directions) => ({ at: AT, data: { stores: async () => [], settings: async () => ({}), directions: async () => directions, orderedToday: async () => ({}) } });
  const r = await admToday(env(withOv));
  const bread = r.dirs.find((d) => d.key === 'bread');
  assert.equal(r.day, DAY);
  assert.equal(bread.deadline, '17:00'); assert.equal(bread.baseDeadline, '16:00');
  assert.deepEqual(bread.deadlineOverride, { deadline: '17:00', from: DAY, to: DAY, active: true, at: '2026-11-03T08:00:00.000Z' });
  assert.equal(bread.closed, false); assert.equal(bread.minLeft, 30);
  const nb = r.dirs.find((d) => d.key === 'nbhz');
  assert.deepEqual([nb.deadline, nb.baseDeadline, nb.deadlineOverride], ['17:30', '17:30', null]);
  const plain = (await admToday(env(DIRECTIONS))).dirs.find((d) => d.key === 'bread');
  assert.deepEqual([plain.deadline, plain.baseDeadline, plain.deadlineOverride, plain.closed], ['16:00', '16:00', null, true]);
});

test('закупниця: info віддає ефективний дедлайн (не статичний), closed з ним, прописаний і діапазон', async () => {
  const env = (directions) => ({ at: AT, data: { directions: async () => directions }, adm: { getSetting: async () => ({}) } });
  const r = await B.buyerInfo('bread', env(withOv));
  assert.equal(r.deadline, '17:00'); assert.equal(r.closed, false); assert.equal(r.baseDeadline, '16:00');
  assert.deepEqual([r.deadlineTemp.from, r.deadlineTemp.to], [DAY, DAY]);
  const p = await B.buyerInfo('bread', env(DIRECTIONS));
  assert.equal(p.deadline, '16:00'); assert.equal(p.closed, true); assert.equal(p.deadlineTemp, null);
});

// ---------- відкритий екран продавця ----------
test('сайт продавця: автооновлення (refresh) підхоплює змінений дедлайн без перезавантаження - у напрямках і на екрані товарів', () => {
  const html = require('../scripts/build-front').build();
  const beat = html.slice(html.indexOf('function beat(){'), html.indexOf('function needReload(){'));
  assert.ok(beat.includes('if (d.deadlines)'), 'beat() читає d.deadlines');
  assert.ok(beat.includes('S.boot.directions[k].deadline = d.deadlines[k]'));
  assert.ok(beat.includes('S.prod.deadline = d.deadlines[S.prod.dir]'));
  assert.ok(beat.indexOf('d.deadlines') > beat.indexOf('d.closed[k]'), 'після оновлення closed');
});

// ---------- пульт: меню напрямка -> «Время приёма» ----------
test('пульт: пункт «Время приёма» у меню напрямка, екран deadline, дії setDeadline/revertDeadline через confirmSheet', () => {
  const html = require('../scripts/build-admin').build();
  const dir = html.slice(html.indexOf('function loadDir(k)'), html.indexOf('// ================= ГРАФИК ПО ТОЧКАМ'));
  assert.ok(dir.includes("item('Время приёма'"), 'пункт меню в «Управление приёмом»');
  assert.ok(dir.includes("go(\\'deadline\\',{dir:\\'' + k + '\\'})"));
  assert.ok(dir.includes('dlInfoHtml(x)'), 'шапка напрямка показує ефективний і прописаний дедлайн');
  // пометка - в ДЕЙСТВУЮЩЕМ экране «Сегодня» (тема admin-theme.html перекрывает loadToday з app/ui і малює картки сама)
  const today = html.slice(html.lastIndexOf('function loadToday()'));
  const card = today.slice(today.indexOf('<span class="m">до '), today.indexOf('<span class="m">до ') + 400);
  assert.ok(card.includes("(x.deadlineOverride && x.deadlineOverride.active ? ' (врем.)' : '')"), 'на картці «Сегодня» позначено тимчасовий дедлайн: ' + card);
  const tail = html.slice(html.indexOf('shop-orders: время приёма'));
  for (const s of ['function loadDeadline(', 'function askDeadlineApply(', 'function askDeadlineRevert(', "call('today')",
    "call('setDeadline'", "call('revertDeadline'", 'confirmSheet({', 'Только сегодня', 'По датам', 'Применить', 'Вернуть как в Довіднике',
    'Сейчас уже ', "S.screen === 'deadline'"]) assert.ok(tail.includes(s), s);
  assert.ok(!tail.includes('google.script'));
});
