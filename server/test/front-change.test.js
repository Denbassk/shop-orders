// Сайт продавця: зміна відправленого замовлення (scripts/front-change.js + правки build-front.js). Добавок нема, лише заміна.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('../scripts/build-front');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'front-change.js'), 'utf8');

function sandbox({ callImpl } = {}) {
  const alerts = [], calls = [], drawn = [];
  const els = {};
  const ctx = {
    S: { screen: 'prod', dir: 'bakery', store: { id: 'st-1' }, cart: {}, mode: 'new', edit: false, editInfo: null,
      prod: { products: [{ id: 'a' }, { id: 'b' }], hidePrice: false } },
    el: (id) => els[id] || null, esc: (s) => String(s).replace(/</g, '&lt;'), money: (n) => String(n),
    alert: (m) => alerts.push(m), drawProd: () => drawn.push(JSON.stringify(ctx.S.cart)),
    call: (action, payload) => { calls.push([action, payload]); return callImpl ? callImpl(action, payload) : Promise.resolve({}); },
    Promise, JSON, Object, Array,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, alerts, calls, drawn, els };
}
const prod = (o) => ({ canRequestLate: false, alreadyOrdered: false, windowOpen: true, lateRequest: 'none', deadline: '13:00', hidePrice: false, ...o });
const plain = (x) => JSON.parse(JSON.stringify(x));          // об'єкти з vm-контексту -> звичайні для deepEqual

// ---------- збірка ----------
test('збірка: режимів "Дозамовити/Переробити все" і mode=add нема, є зміна замовлення; усі <script> компілюються', () => {
  const html = build();
  for (const gone of ['Дозамовити', 'Переробити все', "S.mode='add'", 'function setMode', 'добавку?']) assert.ok(!html.includes(gone), gone);
  for (const here of ['function startEdit(', 'function cancelEdit(', 'var head = replaceHead();', 'var html = lateBoxHtml(S.prod);',
    "S.mode='new'; S.edit=false;", '!n||low||sendLocked()', '!d.windowOpen', 'var min = S.prod.minOrder || 0;']) assert.ok(html.includes(here), here);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 2);
  scripts.forEach((s, i) => assert.doesNotThrow(() => new vm.Script(s), 'script #' + i));
});

test('збірка: правка падає, а не мовчить, якщо Index.html змінився (немає місця для заміни)', () => {
  const orig = fs.readFileSync;
  fs.readFileSync = function (p, ...a) {
    const r = orig.call(this, p, ...a);
    return String(p).endsWith('Index.html') ? String(r).replace('function injectLate(){', 'function injectLate2(){') : r;
  };
  try { assert.throws(() => build(), /lateHtml\/injectLate|місце правки/); } finally { fs.readFileSync = orig; }
});

// ---------- плашка ----------
test('lateHtml: прийом закрито -> кнопка "Попросити дозвіл" (текст залежить від того, чи є замовлення)', () => {
  const { ctx } = sandbox();
  const closed = ctx.lateHtml(prod({ canRequestLate: true, windowOpen: false }));
  assert.ok(closed.includes('Прийом на сьогодні закрито (до 13:00)') && closed.includes('Щоб відправити замовлення') && closed.includes('askLate()'));
  const changing = ctx.lateHtml(prod({ canRequestLate: true, windowOpen: false, alreadyOrdered: true }));
  assert.ok(changing.includes('Щоб змінити замовлення') && changing.includes('askLate()'));
  assert.equal(ctx.lateHtml(prod({ canRequestLate: false })), '');
});

test('lateHtml: дозвіл діє / запит чекає; жодних режимів "Дозамовити"', () => {
  const { ctx } = sandbox();
  const ok = ctx.lateHtml(prod({ canRequestLate: true, windowOpen: false, alreadyOrdered: true, lateRequest: 'approved', lateLeftMin: 20 }));
  assert.ok(ok.includes('дозволила змінити замовлення') && ok.includes('<b>20 хв</b>'));
  assert.ok(!ok.includes('modes') && !ok.includes('Дозамовити') && !ok.includes('onclick'));
  const pend = ctx.lateHtml(prod({ canRequestLate: true, windowOpen: false, alreadyOrdered: true, lateRequest: 'pending' }));
  assert.ok(pend.includes('Запит надіслано закупниці') && pend.includes('"Змінити замовлення"') && !pend.includes('askLate'));
  assert.ok(ctx.lateHtml(prod({ canRequestLate: true, windowOpen: false, lateRequest: 'pending', lateMailed: false })).includes('зателефонуйте закупниці'));
});

test('changeHtml: кнопка "Змінити замовлення" лише коли замовлення є і змінювати можна (прийом відкритий або дозвіл)', () => {
  const { ctx } = sandbox();
  assert.ok(ctx.changeHtml(prod({ alreadyOrdered: true })).includes('startEdit()'));                      // до дедлайну, без запиту
  assert.ok(ctx.changeHtml(prod({ alreadyOrdered: true, windowOpen: false, lateRequest: 'approved' })).includes('startEdit()'));
  assert.equal(ctx.changeHtml(prod({ alreadyOrdered: true, windowOpen: false })), '', 'після дедлайну без дозволу змінювати не можна');
  assert.equal(ctx.changeHtml(prod({ alreadyOrdered: false })), '', 'замовлення нема - нема що міняти');
});

test('changeHtml у режимі зміни: було N поз. на X грн, повна заміна, "Скасувати зміну"', () => {
  const { ctx } = sandbox();
  ctx.S.edit = true; ctx.S.editInfo = { positions: 4, total: 695.9 };
  const h = ctx.changeHtml(prod({ alreadyOrdered: true }));
  assert.ok(h.includes('було <b>4 поз., 695.9 грн</b>') && h.includes('повністю замінюється') && h.includes('cancelEdit()'));
  assert.ok(!h.includes('startEdit'));
  assert.ok(ctx.changeHtml(prod({ alreadyOrdered: true, hidePrice: true })).includes('було <b>4 поз.</b>'));
});

test('sendLocked: замовлення є -> відправка лише в режимі зміни і поки змінювати можна; замовлення нема -> серверний locked', () => {
  const { ctx } = sandbox();
  const set = (d, edit) => { ctx.S.prod = prod({ products: [], ...d }); ctx.S.edit = !!edit; return ctx.sendLocked(); };
  assert.equal(set({ alreadyOrdered: true, locked: true }, false), true, 'є замовлення, зміну не почато');
  assert.equal(set({ alreadyOrdered: true, locked: true }, true), false, 'до дедлайну, режим зміни: серверний locked=true НЕ блокує');
  assert.equal(set({ alreadyOrdered: true, locked: false, windowOpen: false, lateRequest: 'approved' }, true), false, 'після дедлайну з дозволом');
  assert.equal(set({ alreadyOrdered: true, locked: false, windowOpen: false, lateRequest: 'none' }, true), true, 'дозвіл спливув під час зміни');
  assert.equal(set({ alreadyOrdered: false, locked: false }, false), false, 'перше замовлення, прийом відкритий');
  assert.equal(set({ alreadyOrdered: false, locked: true, windowOpen: false }, false), true, 'прийом закрито, дозволу нема');
});

test('lateBoxHtml: обидві частини через розрив; порожньо, коли нічого показувати', () => {
  const { ctx } = sandbox();
  const both = ctx.lateBoxHtml(prod({ canRequestLate: true, windowOpen: false, alreadyOrdered: true, lateRequest: 'approved', lateLeftMin: 5 }));
  assert.ok(both.includes('дозволила') && both.includes('startEdit()') && both.includes('<br><br>'));
  assert.equal(ctx.lateBoxHtml(prod()), '');
});

// ---------- дії ----------
test('startEdit: бере поточне замовлення З СЕРВЕРА, підставляє лише наявні в екрані позиції, вмикає replace', async () => {
  const r = { positions: 3, total: 125, items: [{ id: 'a', qty: 3 }, { id: 'zzz', qty: 9 }, { id: 'b', qty: 1.5 }], gone: [] };
  const { ctx, calls, drawn } = sandbox({ callImpl: async () => r });
  await ctx.startEdit();
  assert.deepEqual(plain(calls), [['currentOrder', { dir: 'bakery', storeId: 'st-1' }]]);
  assert.deepEqual(plain(ctx.S.cart), { a: 3, b: 1.5 });
  assert.deepEqual(plain([ctx.S.edit, ctx.S.mode, ctx.S.editInfo]), [true, 'replace', { positions: 3, total: 125 }]);
  assert.equal(drawn.length, 1);
});

test('startEdit: зниклі з асортименту позиції показуються продавцю; помилка сервера - alert і кнопка знову активна', async () => {
  const ok = sandbox({ callImpl: async () => ({ positions: 2, total: 10, items: [{ id: 'a', qty: 1 }], gone: [{ name: 'Стара', qty: 2 }] }) });
  await ok.ctx.startEdit();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(ok.alerts[0].includes('Стара × 2') && ok.alerts[0].includes('не потраплять'));

  const bad = sandbox({ callImpl: () => Promise.reject(new Error('Замовлення на сьогодні не знайдено. Оновіть сторінку.')) });
  const btn = { disabled: false, textContent: 'Змінити замовлення' };
  bad.els.chgbtn = btn;
  await bad.ctx.startEdit();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(bad.alerts, ['Замовлення на сьогодні не знайдено. Оновіть сторінку.']);
  assert.deepEqual([btn.disabled, btn.textContent, bad.ctx.S.edit], [false, 'Змінити замовлення', false]);
});

test('cancelEdit: кошик порожній, режим знову звичайний', () => {
  const { ctx, drawn } = sandbox();
  Object.assign(ctx.S, { edit: true, mode: 'replace', cart: { a: 1 }, editInfo: { positions: 1, total: 1 } });
  ctx.cancelEdit();
  assert.deepEqual(plain([ctx.S.edit, ctx.S.mode, ctx.S.editInfo, Object.keys(ctx.S.cart).length, drawn.length]), [false, 'new', null, 0, 1]);
});

test('replaceHead: лише в режимі заміни; показує, що саме замінюється', () => {
  const { ctx } = sandbox();
  assert.equal(ctx.replaceHead(), '');
  Object.assign(ctx.S, { mode: 'replace', editInfo: { positions: 4, total: 695.9 } });
  assert.equal(ctx.replaceHead(), 'УВАГА: попереднє замовлення (4 поз., 695.9 грн)\nбуде ПОВНІСТЮ ЗАМІНЕНЕ на це.\n\n');
  ctx.S.prod.hidePrice = true;
  assert.ok(ctx.replaceHead().includes('(4 поз.)'));
});
