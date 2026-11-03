// Сервісне повідомлення продавцям: settings.service_notice = [{ id, text, dir ('' = усі), until ('yyyy-MM-dd HH:MM' за Києвом), modal, at }].
// Пульт створює і вимикає (admin/notices.js), сайт продавця показує банер угорі і, за потреби, одноразове вікно; віддається в bootstrap і refresh.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DIRECTIONS } = require('../src/directions');
const N = require('../src/notices');
const A = require('../src/admin/notices');
const { apiBootstrap, apiRefresh } = require('../src/api/read');

const at = (iso) => new Date(iso);
const AT = at('2026-11-03T11:00:00+02:00');                 // 03.11 11:00 за Києвом
const n1 = (o = {}) => ({ id: 'a1', text: 'Прийом «Хліб Рома» сьогодні до 13:45', dir: 'bread', until: '2026-11-03 23:59', modal: false, at: '2026-11-03T08:41:00.000Z', ...o });

// ---------- src/notices.js ----------
test('stamp: час за Києвом у форматі, що порівнюється як рядок; діє, поки stamp < until (межа виключна)', () => {
  assert.equal(N.stamp(AT), '2026-11-03 11:00');
  assert.equal(N.stamp(at('2026-11-03T23:30:00Z')), '2026-11-04 01:30');                // 01:30 уже наступного дня за Києвом
  const n = n1({ until: '2026-11-03 13:45' });
  assert.equal(N.isActive(n, at('2026-11-03T13:44:59+02:00')), true);
  assert.equal(N.isActive(n, at('2026-11-03T13:45:00+02:00')), false);
  assert.equal(N.isActive(n, at('2026-11-04T09:00:00+02:00')), false);
});

test('isActive / activeList: пошкоджені записи, не масив, порожнє - ігноруються без помилок', () => {
  for (const bad of [null, 'x', 5, {}, n1({ until: '' }), n1({ until: '03.11 12:00' }), n1({ text: '' }), n1({ text: 42 }), n1({ id: '' })]) assert.equal(N.isActive(bad, AT), false, JSON.stringify(bad));
  assert.deepEqual(N.activeList(undefined, AT), []); assert.deepEqual(N.activeList({ a: 1 }, AT), []);
  const list = [n1(), n1({ id: 'old', until: '2026-11-02 23:59' }), 'сміття'];
  assert.deepEqual(N.activeList(list, AT).map((x) => x.id), ['a1']);
});

test('forSeller: лише діючі, тільки поля id/text/dir/modal (без at/until)', () => {
  const r = N.forSeller([n1({ modal: true }), n1({ id: 'old', until: '2026-11-03 10:00' })], AT);
  assert.deepEqual(r, [{ id: 'a1', text: 'Прийом «Хліб Рома» сьогодні до 13:45', dir: 'bread', modal: true }]);
  assert.deepEqual(N.forSeller(null, AT), []);
});

test('parseUntil: «T» -> пробіл, лише yyyy-MM-dd HH:MM; інакше порожньо', () => {
  assert.equal(N.parseUntil('2026-11-03T23:59'), '2026-11-03 23:59');
  assert.equal(N.parseUntil(' 2026-11-03 23:59 '), '2026-11-03 23:59');
  for (const bad of ['', null, undefined, '2026-11-03', '2026-13-03 10:00', '2026-11-03 25:00', 'завтра', 5]) assert.equal(N.parseUntil(bad), '', String(bad));
});

// ---------- admin/notices.js ----------
function mkEnv(set = {}, iso) {
  const st = { log: [], set };
  const env = { at: iso ? at(iso) : AT, log: () => {},
    adm: {
      adminLog: async (a, d) => { st.log.push([a, d]); },
      getSetting: async (k) => (k in st.set ? st.set[k] : null),
      setSetting: async (k, v) => { st.set[k] = v; },
    } };
  return { env, st };
}
const add = (p, env) => A.admNoticeAdd({ text: 'Тест', dir: '', until: '2026-11-03T23:59', ...p }, env);

test('noticeAdd: зберігає в settings.service_notice (текст обрізано, until нормалізовано), id, журнал дослівно', async () => {
  const { env, st } = mkEnv();
  const r = await add({ text: '  Прийом «Хліб Рома» сьогодні до 13:45  ', dir: 'bread', modal: true }, env);
  const id = AT.getTime().toString(36);
  assert.deepEqual(r, { ok: true, id });
  assert.deepEqual(st.set.service_notice, [{ id, text: 'Прийом «Хліб Рома» сьогодні до 13:45', dir: 'bread', until: '2026-11-03 23:59', modal: true, at: AT.toISOString() }]);
  assert.deepEqual(st.log, [['Додано повідомлення продавцям', DIRECTIONS.bread.title + ': Прийом «Хліб Рома» сьогодні до 13:45 (до 03.11 23:59, з вікном)']]);
});

test('noticeAdd: «усім» (dir порожній або "all"), modal за замовчуванням false; кілька повідомлень зберігаються за порядком', async () => {
  const { env, st } = mkEnv();
  await add({ text: 'Перше', dir: 'all' }, env);
  await add({ text: 'Друге' }, mkEnv(st.set, '2026-11-03T11:00:01+02:00').env);
  assert.deepEqual(st.set.service_notice.map((x) => [x.text, x.dir, x.modal]), [['Перше', '', false], ['Друге', '', false]]);
  assert.match(st.log[0][1], /^Усі продавці: Перше \(до 03\.11 23:59\)$/);
});

test('noticeAdd: помилки до запису (текст, напрямок, час), нічого не змінено', async () => {
  for (const [p, re] of [
    [{ text: '' }, /Введіть текст/], [{ text: '   ' }, /Введіть текст/], [{ text: 'я'.repeat(301) }, /до 300/],
    [{ dir: 'xx' }, /Невідомий напрямок/], [{ dir: '__proto__' }, /Невідомий напрямок/],
    [{ until: '' }, /Невірний час/], [{ until: 'завтра' }, /Невірний час/],
    [{ until: '2026-11-03T10:59' }, /минув/], [{ until: '2026-11-03T11:00' }, /минув/],
    [{ until: '2026-12-05T10:00' }, /31/],
  ]) {
    const { env, st } = mkEnv();
    await assert.rejects(add(p, env), re, JSON.stringify(p));
    assert.equal(st.set.service_notice, undefined); assert.equal(st.log.length, 0);
  }
  const { env, st } = mkEnv();
  await add({ until: '2026-12-04T23:59' }, env);                                         // рівно сьогодні + 31 день - можна
  assert.equal(st.set.service_notice.length, 1);
});

test('noticeAdd: не більше 5 діючих одночасно; минулі й пошкоджені записи при збереженні випадають і місце звільняють', async () => {
  const live = (i) => n1({ id: 'l' + i, until: '2026-11-04 12:00' });
  const { env, st } = mkEnv({ service_notice: [live(1), live(2), live(3), live(4), live(5)] });
  await assert.rejects(add({}, env), /не більше 5/);
  assert.equal(st.set.service_notice.length, 5);
  const e2 = mkEnv({ service_notice: [live(1), n1({ id: 'old', until: '2026-11-02 12:00' }), 'сміття', live(2), live(3), live(4)] });
  await add({}, e2.env);
  assert.equal(e2.st.set.service_notice.length, 5, 'old і сміття прибрані (звільнили місце), 4 діючі + нове = 5');
  assert.ok(!e2.st.set.service_notice.some((x) => x.id === 'old'));
});

test('noticeOff: прибирає лише своє повідомлення, журнал; повторно - нічого не пише в журнал', async () => {
  const { env, st } = mkEnv({ service_notice: [n1({ id: 'a1' }), n1({ id: 'b2', text: 'Інше', dir: '' })] });
  assert.deepEqual(await A.admNoticeOff({ id: 'a1' }, env), { ok: true, off: true });
  assert.deepEqual(st.set.service_notice.map((x) => x.id), ['b2']);
  assert.deepEqual(st.log, [['Вимкнено повідомлення продавцям', DIRECTIONS.bread.title + ': Прийом «Хліб Рома» сьогодні до 13:45']]);
  assert.deepEqual(await A.admNoticeOff({ id: 'a1' }, env), { ok: true, off: false });
  assert.equal(st.log.length, 1);
  await assert.rejects(A.admNoticeOff({}, env), /Невідоме повідомлення/);
});

test('noticeList: лише діючі, з назвою напрямку, now/day для екрана; порожньо, якщо нічого нема', async () => {
  const { env } = mkEnv({ service_notice: [n1({ id: 'x', dir: '' }), n1({ id: 'old', until: '2026-11-03 09:00' }), n1({ id: 'y', modal: true })] });
  const r = await A.admNoticeList({}, env);
  assert.deepEqual([r.now, r.day, r.max], ['2026-11-03 11:00', '2026-11-03', 5]);
  assert.deepEqual(r.notices.map((x) => [x.id, x.dirTitle, x.modal, x.until]), [['x', 'Усі продавці', false, '2026-11-03 23:59'], ['y', DIRECTIONS.bread.title, true, '2026-11-03 23:59']]);
  assert.deepEqual((await A.admNoticeList({}, mkEnv().env)).notices, []);
});

test('runtime: дії noticeList / noticeAdd / noticeOff підключено до пульту', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8');
  for (const s of ['noticeList: (p) => notices.admNoticeList(p, env())', 'noticeAdd: (p) => notices.admNoticeAdd(p, env())', 'noticeOff: (p) => notices.admNoticeOff(p, env())']) assert.ok(src.includes(s), s);
});

// ---------- bootstrap / refresh ----------
const sellerEnv = (service_notice) => ({ at: AT, veg: { resolve: async (r) => r }, data: {
  stores: async () => [{ id: 's1', label: 'Т1', code: '1', edrpou: '', days: {}, directions: ['bread'] }],
  settings: async () => ({ app_version: 'v', service_notice }), directions: async () => DIRECTIONS, orderedToday: async () => ({}), lateRows: async () => [] } });

test('продавець: bootstrap і refresh віддають лише діючі повідомлення (id, text, dir, modal); без повідомлень - порожній масив', async () => {
  const list = [n1({ modal: true }), n1({ id: 'old', until: '2026-11-03 10:00' })];
  const want = [{ id: 'a1', text: 'Прийом «Хліб Рома» сьогодні до 13:45', dir: 'bread', modal: true }];
  assert.deepEqual((await apiBootstrap(sellerEnv(list))).notices, want);
  assert.deepEqual((await apiRefresh({}, sellerEnv(list))).notices, want);
  assert.deepEqual((await apiBootstrap(sellerEnv(undefined))).notices, []);
  assert.deepEqual((await apiRefresh({}, sellerEnv(undefined))).notices, []);
});

// ---------- сайт продавця: scripts/front-notice.js у vm ----------
const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'front-notice.js'), 'utf8');
function sandbox({ notices = [], store = null, dir = null, storage = {}, storageBroken = false, directions = { bread: {}, nbhz: {}, veg: {} } } = {}) {
  const els = { nbox: { innerHTML: '' } };
  const document = {
    createElement: () => ({ id: '', className: '', innerHTML: '', parentNode: null, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } }),
    body: { appendChild(n) { n.parentNode = document.body; els[n.id] = n; }, removeChild(n) { delete els[n.id]; n.parentNode = null; } },
  };
  const localStorage = storageBroken
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = v; } };
  const ctx = { document, localStorage, S: { boot: { notices, directions }, store, dir },
    el: (id) => els[id] || null, esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), JSON, Object, Array };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, els, storage };
}
const nt = (o = {}) => ({ id: 'a1', text: 'Прийом хліба до 13:45', dir: '', modal: false, ...o });
const click = (node, className) => node.listeners.click({ target: className ? { className } : node });

test('банер: усі повідомлення на екрані вибору точки; екранування HTML, переноси рядків', () => {
  const s = sandbox({ notices: [nt({ text: 'Рядок 1\nРядок <b>2</b>' }), nt({ id: 'b', dir: 'bread', text: 'Лише хліб' })] });
  s.ctx.renderNotices();
  const h = s.els.nbox.innerHTML;
  assert.ok(h.includes('Рядок 1<br>Рядок &lt;b>2&lt;/b>'), h);
  assert.ok(h.includes('Лише хліб'), 'напрямкове видно, поки точку не обрано');
  assert.equal((h.match(/class="nbn"/g) || []).length, 2);
});

test('банер: напрямкове - лише точкам з цим напрямком (або на екрані цього напрямку); вимкнений напрямок не показується', () => {
  const list = [nt({ id: 'all' }), nt({ id: 'br', dir: 'bread', text: 'Хліб' }), nt({ id: 'vg', dir: 'veg', text: 'Овочі' })];
  const a = sandbox({ notices: list, store: { id: 's', directions: ['bread'] } }); a.ctx.renderNotices();
  assert.ok(a.els.nbox.innerHTML.includes('Хліб') && !a.els.nbox.innerHTML.includes('Овочі') && a.els.nbox.innerHTML.includes('Прийом хліба'));
  const b = sandbox({ notices: list, store: { id: 's', directions: ['nbhz'] } }); b.ctx.renderNotices();
  assert.ok(!b.els.nbox.innerHTML.includes('Хліб') && !b.els.nbox.innerHTML.includes('Овочі'));
  const c = sandbox({ notices: list, directions: { bread: {} } }); c.ctx.renderNotices();          // veg вимкнено (нема в bootstrap.directions)
  assert.ok(c.els.nbox.innerHTML.includes('Хліб') && !c.els.nbox.innerHTML.includes('Овочі'));
});

test('банер: порожньо - контейнер очищується (повідомлення вимкнули без перезавантаження); без #nbox - тихо', () => {
  const s = sandbox({ notices: [nt()] }); s.ctx.renderNotices();
  assert.ok(s.els.nbox.innerHTML);
  s.ctx.S.boot.notices = []; s.ctx.renderNotices();
  assert.equal(s.els.nbox.innerHTML, '');
  delete s.els.nbox; assert.doesNotThrow(() => s.ctx.renderNotices());
  assert.doesNotThrow(() => sandbox({ notices: undefined }).ctx.renderNotices());
});

test('вікно: лише для modal і лише раз; «Зрозуміло» запам\'ятовує id на пристрої; наступне - по одному', () => {
  const { ctx, els, storage } = sandbox({ notices: [nt({ id: 'm1', modal: true, text: 'Перше' }), nt({ id: 'm2', modal: true, text: 'Друге' }), nt({ id: 'p', text: 'Без вікна' })] });
  ctx.renderNotices();
  assert.ok(els['ntc-ov'] && els['ntc-ov'].innerHTML.includes('Перше') && !els['ntc-ov'].innerHTML.includes('Друге'));
  ctx.renderNotices(); ctx.renderNotices();                                         // перемальовування екрана не дублює вікно
  assert.equal(Object.keys(els).filter((k) => k === 'ntc-ov').length, 1);
  click(els['ntc-ov'], 'rem-go ntc-ok');
  assert.deepEqual(JSON.parse(storage.fm_notice_seen), ['m1']);
  assert.ok(els['ntc-ov'] && els['ntc-ov'].innerHTML.includes('Друге'), 'після першого - друге');
  click(els['ntc-ov'], 'rem-go ntc-ok');
  assert.equal(els['ntc-ov'], undefined);
  ctx.renderNotices(); assert.equal(els['ntc-ov'], undefined, 'бачили - більше не показується');
  assert.deepEqual(JSON.parse(storage.fm_notice_seen), ['m1', 'm2']);
});

test('вікно: клік мимо кнопки не закриває; по затемненню закриває; новий запуск на тому ж пристрої не повторює', () => {
  const a = sandbox({ notices: [nt({ id: 'm1', modal: true })] }); a.ctx.renderNotices();
  const node = a.els['ntc-ov'];
  click(node, 'rem-box ntc-box'); assert.ok(a.els['ntc-ov']);
  node.listeners.click({ target: node }); assert.equal(a.els['ntc-ov'], undefined);
  const again = sandbox({ notices: [nt({ id: 'm1', modal: true })], storage: a.storage }); again.ctx.renderNotices();
  assert.equal(again.els['ntc-ov'], undefined);
  const fresh = sandbox({ notices: [nt({ id: 'm9', modal: true })], storage: a.storage }); fresh.ctx.renderNotices();
  assert.ok(fresh.els['ntc-ov'], 'нове повідомлення - нове вікно');
});

test('вікно: localStorage заблоковано - працює, «бачили» тримається до перезавантаження; вікно не показується поверх нагадування', () => {
  const { ctx, els } = sandbox({ notices: [nt({ id: 'm1', modal: true })], storageBroken: true });
  ctx.renderNotices(); assert.ok(els['ntc-ov']);
  click(els['ntc-ov'], 'rem-go ntc-ok'); ctx.renderNotices();
  assert.equal(els['ntc-ov'], undefined);
  const busy = sandbox({ notices: [nt({ id: 'm1', modal: true })] });
  busy.els['rem-ov'] = { id: 'rem-ov' };
  busy.ctx.renderNotices(); assert.equal(busy.els['ntc-ov'], undefined, 'поки відкрито інше вікно - чекаємо');
});

// ---------- збірка ----------
test('збірка сайту продавця: контейнер #nbox між шапкою і #wrap, стилі, код front-notice.js, перемальовування банера на кожному екрані і в автооновленні', () => {
  const html = require('../scripts/build-front').build();
  assert.ok(html.indexOf('id="nbox"') > html.indexOf('class="hdr"') && html.indexOf('id="nbox"') < html.indexOf('id="wrap"'));
  assert.ok(html.includes('function renderNotices()') && html.includes('.nbn{'));
  for (const f of ['screenStore', 'openStore', 'drawProd']) assert.ok(html.includes("'" + f + "'"), f);
  const beat = html.slice(html.indexOf('function beat(){'), html.indexOf('function needReload(){'));
  assert.ok(beat.includes('if (d.notices)') && beat.includes('S.boot.notices = d.notices') && beat.includes('renderNotices()'));
  const start = html.slice(html.indexOf('function start(){'), html.indexOf('function fail(e)'));
  assert.ok(start.includes('S.boot = d;'));
  assert.ok(!html.includes('google.script'));
});

// ---------- пульт ----------
test('пульт: «Сообщение продавцам» у швидких діях, екран notice (список, форма, вимкнення), пропозиція повідомлення після зміни/відкату дедлайну', () => {
  const html = require('../scripts/build-admin').build();
  // кнопка - в ДЕЙСТВУЮЩЕМ экране «Сегодня»: тема (admin-theme.html) перекрывает loadToday з app/ui, і саме вона малює ряд кнопок
  const today = html.slice(html.lastIndexOf('function loadToday()'));
  const start = today.search(/<div class="atools[^"]*">/);
  const row = today.slice(start, today.indexOf('</div>', start));
  assert.ok(row.includes("<button class=\"achip\" onclick=\"go(\\'notice\\',{})\">Сообщение продавцам</button>"), 'кнопка в ряду быстрых действий на экране «Сегодня»: ' + row);
  assert.ok(row.includes('График по точкам') && row.includes('Здоровье системы') && row.includes('Журнал действий'), 'прежние кнопки на месте');
  const tail = html.slice(html.indexOf('shop-orders: сообщения продавцам'));
  for (const s of ['function loadNotices(', 'function askNoticeAdd(', 'function askNoticeOff(', 'function offerNotice(', "call('noticeList'", "call('noticeAdd'", "call('noticeOff'",
    'confirmSheet({', 'Опубликовать', 'Выключить', 'Показать окном', 'Всем продавцам', "S.screen === 'notice'", 'Сообщить продавцам']) assert.ok(tail.includes(s), s);
  const dl = html.slice(html.indexOf('function askDeadlineApply('), html.indexOf('// экран deadline'));
  assert.ok(dl.includes('offerNotice('), 'після зміни дедлайну');
});
