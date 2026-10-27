// Сайт продавця: зміна відправленого замовлення (scripts/front-change.js + правки build-front.js). Добавок нема, лише заміна.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('../scripts/build-front');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'front-change.js'), 'utf8');

function sandbox({ callImpl, storage = {}, storageBroken = false } = {}) {
  const alerts = [], calls = [], drawn = [];
  const els = {};
  const document = {
    createElement: () => ({ id: '', className: '', innerHTML: '', parentNode: null, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } }),
    body: { appendChild(n) { n.parentNode = document.body; els[n.id] = n; }, removeChild(n) { delete els[n.id]; n.parentNode = null; } },
  };
  const localStorage = storageBroken
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = v; } };
  const ctx = {
    document, localStorage,
    S: { screen: 'prod', dir: 'bakery', store: { id: 'st-1' }, cart: {}, mode: 'new', edit: false, editInfo: null,
      prod: { products: [{ id: 'a' }, { id: 'b' }], hidePrice: false } },
    el: (id) => els[id] || null, esc: (s) => String(s).replace(/</g, '&lt;'), money: (n) => String(n),
    alert: (m) => alerts.push(m), drawProd: () => drawn.push(JSON.stringify(ctx.S.cart)),
    call: (action, payload) => { calls.push([action, payload]); return callImpl ? callImpl(action, payload) : Promise.resolve({}); },
    Promise, JSON, Object, Array,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, alerts, calls, drawn, els, storage };
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

test('changeHtml у режимі правки: "Ви редагуєте замовлення. Було: N поз., X грн", кнопка "Скасувати"; слів про заміну нема', () => {
  const { ctx } = sandbox();
  ctx.S.edit = true; ctx.S.editInfo = { positions: 4, total: 695.9 };
  const h = ctx.changeHtml(prod({ alreadyOrdered: true }));
  assert.ok(h.includes('Ви редагуєте замовлення. Було: <b>4 поз., 695.9 грн</b>') && h.includes('cancelEdit()') && h.includes('>Скасувати<'));
  assert.ok(!h.includes('startEdit') && !/замін/i.test(h));
  assert.ok(ctx.changeHtml(prod({ alreadyOrdered: true, hidePrice: true })).includes('Було: <b>4 поз.</b>'));
});

test('sendLocked: замовлення є -> зберегти можна лише в режимі правки, поки змінювати можна і коли щось змінено; замовлення нема -> серверний locked', () => {
  const { ctx } = sandbox();
  const set = (d, edit, cart = {}, orig = { a: 1 }) => { ctx.S.prod = prod({ products: [{ id: 'a', name: 'А' }, { id: 'b', name: 'Б' }], ...d }); ctx.S.edit = !!edit; ctx.S.cart = cart; ctx.S.editInfo = { orig }; return ctx.sendLocked(); };
  assert.equal(set({ alreadyOrdered: true, locked: true }, false), true, 'є замовлення, правку не почато');
  assert.equal(set({ alreadyOrdered: true, locked: true }, true, { a: 2 }), false, 'до дедлайну, правка зі змінами: серверний locked=true НЕ блокує');
  assert.equal(set({ alreadyOrdered: true, locked: true }, true, { a: 1 }), true, 'правка без змін - зберігати нічого');
  assert.equal(set({ alreadyOrdered: true, locked: false, windowOpen: false, lateRequest: 'approved' }, true, { a: 2 }), false, 'після дедлайну з дозволом');
  assert.equal(set({ alreadyOrdered: true, locked: false, windowOpen: false, lateRequest: 'none' }, true, { a: 2 }), true, 'дозвіл спливув під час правки');
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
  assert.deepEqual(plain([ctx.S.edit, ctx.S.mode, ctx.S.editInfo]), [true, 'replace', { positions: 3, total: 125, gone: [], orig: { a: 3, b: 1.5 } }]);
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

test('sendLabel: у режимі зміни кнопка "Зберегти", а не "Замінити"; у звичайному "Відправити"', () => {
  const { ctx } = sandbox();
  assert.equal(ctx.sendLabel(), 'Відправити');
  ctx.S.mode = 'replace';
  assert.equal(ctx.sendLabel(), 'Зберегти');
});

test('збірка: внизу "Зберегти" (sendLabel), підтвердження "Зберегти зміни?", слова "Замінити" на кнопці нема', () => {
  const html = build();
  assert.ok(html.includes("sendLabel() + '</button>"));
  assert.ok(html.includes("'Зберегти зміни?'") && html.includes("'Збереження…'"));
  assert.ok(!html.includes("'Замінити'"));
  assert.ok(html.includes("r.replaced ? 'Зміни збережено' : 'Замовлення прийнято'"));
  assert.ok(!html.includes('прибрано рядків') && !html.includes('Попереднє замовлення замінено') && !html.includes('ПОВНІСТЮ ЗАМІНЕНЕ'));
  assert.ok(!html.includes("'\\n\\nВідправити?'"));
});

test('changeLines / replaceHead: підтвердження показує зміни (було → стало, додано, прибрано), а не "буде замінене"', () => {
  const { ctx } = sandbox();
  Object.assign(ctx.S.prod, { products: [{ id: 'a', name: 'Сосиска' }, { id: 'b', name: 'Пюре' }, { id: 'c', name: 'Окрошка' }, { id: 'd', name: 'Салат' }] });
  assert.equal(ctx.replaceHead(), '', 'не в режимі правки');
  Object.assign(ctx.S, { mode: 'replace', cart: { a: 5, b: 4, d: 2 }, editInfo: { orig: { a: 5, b: 1, c: 4 }, gone: [{ name: 'Стара', qty: 2 }] } });
  assert.deepEqual(plain(ctx.changeLines()), ['Пюре: 1 → 4', '+ Салат: 2', '- Окрошка', '- Стара']);
  assert.equal(ctx.replaceHead(), 'ЗМІНИ:\nПюре: 1 → 4\n+ Салат: 2\n- Окрошка\n- Стара\n\n');
  assert.ok(!ctx.replaceHead().includes('ЗАМІНЕН'));
  ctx.S.cart = { a: 5, b: 1, c: 4 }; ctx.S.editInfo = { orig: { a: 5, b: 1, c: 4 } };
  assert.deepEqual(plain(ctx.changeLines()), [], 'без змін');
});

test('replaceHead: більше 12 змін - перші 12 і "…і ще N"', () => {
  const { ctx } = sandbox();
  const products = Array.from({ length: 15 }, (_, i) => ({ id: 'p' + i, name: 'Т' + i }));
  Object.assign(ctx.S, { mode: 'replace', cart: {}, editInfo: { orig: Object.fromEntries(products.map((p) => [p.id, 1])) } });
  ctx.S.prod.products = products;
  const h = ctx.replaceHead();
  assert.equal(h.split('\n').filter((l) => l.startsWith('- ')).length, 12);
  assert.ok(h.includes('…і ще 3'));
});

// ---------- разове оголошення ----------
const noticeOpen = (ctx, d) => { ctx.S.screen = 'prod'; ctx.S.prod = prod({ products: [], ...d }); ctx.changeNotice(); };
const click = (node, className) => node.listeners.click({ target: className ? { className } : node });

test('changeNotice: показується там, де ще не замовляли і прийом відкритий; текст про зміну без дозволу, до дедлайну, підсумкову кількість', () => {
  const { ctx, els } = sandbox();
  noticeOpen(ctx, { alreadyOrdered: false, windowOpen: true, deadline: '13:00' });
  const h = els['chg-ov'].innerHTML;
  assert.ok(h.includes('Замовлення тепер можна змінити') && h.includes('«Змінити замовлення»'));
  assert.ok(h.includes('без дозволу закупниці') && h.includes('в усіх напрямках') && h.includes('до <b>13:00</b>'));
  assert.ok(h.includes('підсумкову кількість') && h.includes('Зрозуміло'));
});

test('changeNotice: не показується, якщо замовлення вже є (побачить завтра або в іншому напрямку без замовлення), після дедлайну, не на екрані товарів', () => {
  const a = sandbox(); noticeOpen(a.ctx, { alreadyOrdered: true, windowOpen: true });
  assert.equal(a.els['chg-ov'], undefined);
  const b = sandbox(); noticeOpen(b.ctx, { alreadyOrdered: false, windowOpen: false });
  assert.equal(b.els['chg-ov'], undefined);
  const c = sandbox(); c.ctx.S.screen = 'store'; c.ctx.S.prod = prod({ products: [] }); c.ctx.changeNotice();
  assert.equal(c.els['chg-ov'], undefined);
});

test('changeNotice: "Зрозуміло" закриває і запам\'ятовує на пристрої - наступного разу не показується', () => {
  const { ctx, els, storage } = sandbox();
  noticeOpen(ctx, { alreadyOrdered: false, windowOpen: true });
  click(els['chg-ov'], 'rem-go chg-ok');
  assert.equal(els['chg-ov'], undefined);
  assert.equal(storage.fm_chg_notice, '1');
  noticeOpen(ctx, { alreadyOrdered: false, windowOpen: true });
  assert.equal(els['chg-ov'], undefined);
  // новий запуск застосунку на тому ж пристрої: прочитано з localStorage
  const again = sandbox({ storage });
  noticeOpen(again.ctx, { alreadyOrdered: false, windowOpen: true });
  assert.equal(again.els['chg-ov'], undefined);
});

test('changeNotice: клік мимо вікна (нічого не натиснуто) не закриває; клік по затемненню закриває; не дублюється при перемальовуванні', () => {
  const { ctx, els } = sandbox();
  noticeOpen(ctx, { alreadyOrdered: false, windowOpen: true });
  const node = els['chg-ov'];
  click(node, 'rem-box chg-box');                       // всередині вікна, але не на кнопці
  assert.ok(els['chg-ov']);
  ctx.changeNotice(); ctx.changeNotice();               // drawProd викликається часто
  assert.equal(els['chg-ov'], node);
  node.listeners.click({ target: node });               // затемнення
  assert.equal(els['chg-ov'], undefined);
});

test('changeNotice: localStorage заблоковано - працює, а "бачили" тримається до перезавантаження', () => {
  const { ctx, els } = sandbox({ storageBroken: true });
  noticeOpen(ctx, { alreadyOrdered: false, windowOpen: true });
  assert.ok(els['chg-ov']);
  click(els['chg-ov'], 'rem-go chg-ok');
  noticeOpen(ctx, { alreadyOrdered: false, windowOpen: true });
  assert.equal(els['chg-ov'], undefined);
});

test('збірка: changeNotice викликається після кожного малювання екрана товарів', () => {
  const html = build();
  assert.ok(html.includes("try { injectLate(); } catch (e) {}\n  try { changeNotice(); } catch (e) {}\n};"));
});
