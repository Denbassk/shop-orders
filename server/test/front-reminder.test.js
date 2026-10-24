// Нагадування продавцю в застосунку (scripts/front-overlay.html, скрипт): спливаюче вікно за 60/30 хв до дедлайну, якщо напрямок не замовлено.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('../scripts/build-front');

const html = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'front-overlay.html'), 'utf8');
const SRC = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function sandbox() {
  const store = {}, opened = [], appended = [];
  const el = (tag) => ({ tag, id: '', className: '', innerHTML: '', listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, querySelector() { return null; }, parentNode: null });
  const doc = { hidden: false, body: { appendChild(e) { e.parentNode = doc.body; appended.push(e); doc.cur = e; }, removeChild() { doc.cur = null; } },
    createElement: el, getElementById: (id) => (id === 'rem-ov' ? doc.cur : null), addEventListener() {} };
  const ctx = { window: {}, document: doc, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    setTimeout() { return 0; }, setInterval() { return 0; }, Intl, JSON, Date,
    S: { boot: null, store: null, screen: 'store', dir: null }, openStore: (s) => opened.push(['store', s.id]), openDir: (k) => opened.push(['dir', k]) };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, rem: ctx.window.__fmRem, store, opened, appended, doc };
}
const DIRS = { bread: { title: 'Хліб Рома', deadline: '16:00', color: '#8D6E63', closed: false }, nbhz: { title: 'Хліб НБХЗ', deadline: '17:30', color: '#5D4037', closed: false } };
const mkStore = (over = {}) => ({ id: 's1', label: 'Амосова, 5А', directions: ['bread', 'nbhz'], ordered: { bread: false, nbhz: false }, dayOk: { bread: true, nbhz: true }, ...over });
const min = (h, m) => h * 60 + m;
const plain = (x) => JSON.parse(JSON.stringify(x));          // результат з vm-контексту -> звичайні об'єкти для deepEqual

test('minutesLeft і час за Києвом', () => {
  const { rem } = sandbox();
  assert.equal(rem.minutesLeft('16:00', min(15, 5)), 55);
  assert.equal(rem.minutesLeft('', 10), null);
  assert.equal(rem.kyivMin(new Date('2026-10-23T15:05:00+03:00')), min(15, 5));
});

test('due: за 55 хв - поріг 60; за 25 хв - обидва пороги в одному вікні; замовлене, закрите, чужий день і далекий дедлайн - ні', () => {
  const { rem } = sandbox();
  const s = mkStore();
  const a = rem.due(s, DIRS, min(15, 5), {}, null);
  assert.deepEqual(plain(a.map((x) => [x.dir, x.left, x.keys.length])), [['bread', 55, 1]]);
  const b = rem.due(s, DIRS, min(15, 35), {}, null);
  assert.deepEqual(plain(b.map((x) => [x.dir, x.left, x.keys.length])), [['bread', 25, 2]]);
  assert.equal(rem.due(s, DIRS, min(14, 30), {}, null).length, 0, 'далеко до дедлайну');
  assert.equal(rem.due(mkStore({ ordered: { bread: true, nbhz: false } }), DIRS, min(15, 5), {}, null).length, 0);
  assert.equal(rem.due(s, { ...DIRS, bread: { ...DIRS.bread, closed: true } }, min(15, 5), {}, null).length, 0);
  assert.equal(rem.due(mkStore({ dayOk: { bread: false, nbhz: true } }), DIRS, min(15, 5), {}, null).length, 0);
  assert.equal(rem.due(s, DIRS, min(16, 1), {}, null).length, 0, 'після дедлайну');
  assert.equal(rem.due(s, DIRS, min(15, 5), {}, 'bread').length, 0, 'напрямок, який зараз оформлюють, не нагадуємо');
  assert.deepEqual(plain(rem.due(s, DIRS, min(15, 5), { 's1|bread|60': 1 }, null)), [], 'поріг уже показували');
  const two = rem.due(s, DIRS, min(17, 10), {}, null);
  assert.deepEqual(plain(two.map((x) => x.dir)), ['nbhz'], 'хліб уже після 16:00 - лише НБХЗ');
});

test('check: показує вікно один раз на поріг, друге вікно за 30 хв, кнопка «Замовити» відкриває точку й напрямок', () => {
  const sb = sandbox();
  sb.ctx.S.boot = { today: '23.10.2026', stores: [mkStore()], directions: DIRS };
  sb.ctx.S.store = sb.ctx.S.boot.stores[0];
  const first = sb.rem.check({ nowMin: min(15, 5) });
  assert.equal(first.length, 1);
  assert.equal(sb.appended.length, 1);
  const box = sb.appended[0].innerHTML;
  assert.ok(box.includes('Не забули про замовлення?') && box.includes('Хліб Рома') && box.includes('ще 55 хв') && box.includes('Амосова, 5А'));
  assert.equal(sb.rem.check({ nowMin: min(15, 6) }), null, 'вікно вже відкрите');
  sb.doc.cur = null;                                                              // закрили
  assert.equal(sb.rem.check({ nowMin: min(15, 6) }), null, 'поріг 60 уже показували');
  const second = sb.rem.check({ nowMin: min(15, 35) });
  assert.equal(second.length, 1);
  assert.ok(sb.appended[1].innerHTML.includes('Лишилось менше пів години'));
  // клік по «Замовити»
  sb.appended[1].listeners.click({ target: { className: 'rem-go', getAttribute: (a) => (a === 'data-dir' ? 'bread' : null) } });
  assert.deepEqual(plain(sb.opened), [['store', 's1'], ['dir', 'bread']]);
  const saved = JSON.parse(sb.store.fm_rem);
  assert.equal(saved.day, '23.10.2026');
  assert.deepEqual(Object.keys(saved.seen).sort(), ['s1|bread|30', 's1|bread|60']);
});

test('check: нова доба скидає показані пороги; вкладка у фоні, немає точки або даних - мовчить; екран товарів того ж напрямку - не заважає', () => {
  const sb = sandbox();
  assert.equal(sb.rem.check({ nowMin: min(15, 5) }), null, 'S.boot ще немає');
  sb.ctx.S.boot = { today: '23.10.2026', stores: [mkStore()], directions: DIRS };
  assert.equal(sb.rem.check({ nowMin: min(15, 5) }), null, 'точку не обрано');
  sb.ctx.S.store = sb.ctx.S.boot.stores[0];
  sb.doc.hidden = true;
  assert.equal(sb.rem.check({ nowMin: min(15, 5) }), null, 'вкладка у фоні');
  sb.doc.hidden = false;
  sb.ctx.S.screen = 'prod'; sb.ctx.S.dir = 'bread';
  assert.equal(sb.rem.check({ nowMin: min(15, 5) }), null, 'саме цей напрямок зараз оформлюють');
  sb.ctx.S.screen = 'dir';
  assert.equal(sb.rem.check({ nowMin: min(15, 5) }).length, 1);
  sb.doc.cur = null;
  sb.ctx.S.boot.today = '24.10.2026';
  assert.equal(sb.rem.check({ nowMin: min(15, 5) }).length, 1, 'наступного дня знову нагадуємо');
});

test('збірка сайту: нагадування вбудоване, скрипти цілі, нічого не відправляє (лише openStore/openDir на кнопку)', () => {
  const out = build();
  assert.ok(out.includes('window.__fmRem') && out.includes('.rem-ov{'));
  const re = /<script>([\s\S]*?)<\/script>/g; let m, n = 0;
  while ((m = re.exec(out))) { n++; assert.doesNotThrow(() => new Function(m[1]), 'скрипт №' + n); }
  assert.ok(!/call\(['"]submitOrder/.test(SRC), 'нагадування не відправляє замовлень');
});
