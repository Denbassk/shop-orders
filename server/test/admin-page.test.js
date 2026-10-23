const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, OUT } = require('../scripts/build-admin');
const appMod = require('../src/app');
const createApp = appMod.createApp || appMod;

const norm = (s) => s.replace(/\r\n/g, '\n');

test('build: усі вставки <?!= include ?> замінені вмістом, шаблонів не лишилось', () => {
  const html = build();
  assert.ok(!html.includes('<?'), 'лишилась вставка <?');
  for (const f of ['function loadWo', 'function callNet', 'function loadHealth', 'function tabGo']) assert.ok(html.includes(f), f);
  assert.ok(html.includes('<title>Пульт Фемелі Маркет</title>'));
  assert.ok(html.includes('name="viewport"'));
});

test('build: блок зв\'язку з сервером - після всіх скриптів Apps Script, fetch /admin/api, cookie', () => {
  const html = build();
  const shim = html.indexOf('shop-orders: зв\'язок з сервером');
  assert.ok(shim > 0);
  assert.ok(shim > html.lastIndexOf('google.script.run'), 'перевизначення має йти після оригіналу');
  const tail = html.slice(shim);
  for (const f of ['function callNet(', 'function doLogin(', 'function logout(', "fetch('/admin/api'", "'/admin/logout'", "credentials: 'same-origin'"]) assert.ok(tail.includes(f), f);
  assert.ok(!tail.includes('google.script'));
});

test('збережена сторінка = свіжа збірка (після зміни app/ui - node scripts/build-admin.js)', () => {
  assert.equal(norm(fs.readFileSync(OUT, 'utf8')), norm(build()));
});

test('GET /admin -> сторінка пульта, без кешу', async () => {
  const app = createApp({ adminAuth: {}, adminApi: async () => ({}) });
  const srv = app.listen(0);
  try {
    const r = await fetch('http://127.0.0.1:' + srv.address().port + '/admin');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok((await r.text()).includes('Пульт Фемелі Маркет'));
  } finally { srv.close(); }
});
test('build: прибрані кнопки (бэкап, дублі, позначка, збереження картки) приховані і не шлють запитів', () => {
  const html = build();
  const tail = html.slice(html.indexOf('shop-orders: на сервері немає'));
  for (const sel of [`[onclick*="'restore'"]`, `[onclick*="'dups'"]`, '[onclick*="askClearMark"]']) assert.ok(tail.includes(sel), sel);
  assert.ok(!html.includes('Сохранение карточки - после переезда'), 'заглушку збереження картки прибрано');
});
test('нижня панель: вкладка «Здоровье» (бувша «Бэкап») відкриває екран health і підсвічується на ньому', () => {
  const html = build();
  assert.match(html, /<button class="tab" id="t-restore" onclick="tabGo\('health'\)">[\s\S]*?Здоровье<\/button>/);
  assert.ok(!/Бэкап<\/button>/.test(html));
  assert.ok(!html.slice(html.indexOf('shop-orders: на сервері немає')).includes('#t-restore'), 'вкладку більше не приховано');
  const tabsFn = html.slice(html.lastIndexOf('function tabs(name)'));
  assert.match(tabsFn, /health: 'restore'/);
});
test('вкладка «Магазини»: перемикач Таблиця | Картка, дані з дій storesTable і storeCard, кнопка «Відкрити Довідник», лише перегляд', () => {
  const html = build();
  for (const f of ["call('storesTable')", 'window.stView', 'Открыть Довідник', 'Таблица', 'Клик по строке открывает карточку']) assert.ok(html.includes(f), f);
  assert.ok(html.lastIndexOf('call(\'storesTable\')') > html.lastIndexOf('function loadStores('), 'перевизначення loadStores - після оригіналу');
  const mine = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'admin-stores.html'), 'utf8');
  assert.ok(!/call\('(?!storesTable|storeCard)/.test(mine), 'блок «Магазини» викликає лише storesTable і storeCard - нічого не зберігає');
});

test('вкладка «Магазини»: картка (реквізити, сьогодні по напрямках, графік днів), нижня вкладка перейменована, плиток у цій вкладці нема', () => {
  const html = build();
  for (const f of ["call('storeCard'", 'Отменить заказ', 'Открыть приём точке', 'График и направления', 'Реквизиты', "'Магазины'", "['Пн', 1]", "['Вс', 0]"]) assert.ok(html.includes(f), f);
  assert.ok(!html.includes('stMode('), 'вигляд «Плитки» прибрано з вкладки');
  assert.ok(html.lastIndexOf('loadStore = function') > html.lastIndexOf('function loadStore('), 'екран store веде в нову картку');
});

test('форма точки: «Редактировать» і «+ Добавить адрес» ведуть у cardSave/cardAdd; форма перевизначена після оригіналу; до переходу кнопка збереження неактивна', () => {
  const html = build();
  assert.ok(html.lastIndexOf('function loadCard(') > html.indexOf('function loadCard('), 'loadCard перевизначено після оригіналу');
  assert.ok(html.lastIndexOf('function askCard()') > html.indexOf('function askCard()'), 'askCard перевизначено після оригіналу');
  for (const f of ["call('cardSave'", "call('cardAdd'", 'stNewStore()', 'onclick="go(\\\'card\\\'', "S.screen === 'newstore'", 'c.editable']) assert.ok(html.includes(f), f);
  assert.match(html, /newstore: 'stores'/);
  assert.ok(!html.includes('Правка - після переїзду'));
});

test('сторінка пульта: усі вбудовані скрипти без синтаксичних помилок (ловить зіпсовані екранування у вставках)', () => {
  const html = build();
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(html))) { n++; assert.doesNotThrow(() => new Function(m[1]), 'скрипт №' + n); }
  assert.ok(n >= 5, 'скриптів: ' + n);
});

test('блок «Система» здоров\'я: без залишків Apps Script («Свойства скрипта», «Сессии пульта»), синтаксис цілий', () => {
  const html = build();
  assert.ok(!html.includes('Свойства скрипта') && !html.includes('Сессии пульта'));
  assert.ok(html.includes("{ t: 'Тестовый режим'") && html.includes("{ t: 'Версия'"));
});
