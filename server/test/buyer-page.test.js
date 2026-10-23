const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');

test('сторінка закупниці: адреса з посилання, усі дії, Excel через сервер, без Apps Script і PIN', () => {
  for (const s of ["location.pathname.split('/')[3]", "'/buyer/' + CODE + '/' + KEY", "call('me'", "call('info'", "call('today'",
    "call('remove'", "call('editOrder'", "call('late'", "call('approve'", "call('openAll'", "call('closeAll'", "call('report'",
    "call('products'", "call('setProduct'", "'/xlsx/'", 'setInterval(']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes('google.script'));
  assert.ok(!html.includes("action: 'login'"));
  assert.ok(!html.includes('<?'));
});

test('сторінка закупниці: стиль пульта (Golos, нижні вкладки, панель знизу), ширше на великому екрані', () => {
  for (const s of ['Golos Text', 'class="tabs"', '.sheet{', '@media (min-width:900px)', 'name="viewport"']) assert.ok(html.includes(s), s);
});

test('сторінка закупниці: текст DeleteSheet.gs; дані з бази в HTML лише через esc()', () => {
  assert.ok(html.includes('⏳ Видаляю замовлення: '));
  assert.ok(html.includes('function esc('));
  const bad = html.split('\n').filter((l) => /\.(label|name|sub|category|availability|barcode)\b/.test(l) && l.includes('<') && !l.includes('esc('));
  assert.deepEqual(bad, []);
});

test('GET /buyer/bakery без ключа і /buyer/xxx -> 404', async () => {
  const srv = createApp({ buyerLinkSecret: 's' }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const b = 'http://127.0.0.1:' + srv.address().port;
  try {
    assert.equal((await fetch(b + '/buyer/bakery')).status, 404);
    assert.equal((await fetch(b + '/buyer/xxx')).status, 404);
  } finally { await new Promise((r) => srv.close(r)); }
});
test('сторінка закупниці: вбудовані скрипти без синтаксичних помилок; на вкладці «Асортимент» є кнопка «+ Нова позиція» зі своєю формою', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(html))) { n++; assert.doesNotThrow(() => new Function(m[1]), 'скрипт №' + n); }
  assert.ok(n >= 1);
  for (const f of ['askNewProduct()', "call('addProduct'", '+ Нова позиція', 'saveNewProduct']) assert.ok(html.includes(f), f);
});

test('кнопки скачування (Excel і звіт про списання): ім\'я файлу береться з filename*=UTF-8 (в регулярці * екрановано)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  const res = html.match(/\/filename[^\n]*?UTF-8''\(\[\^;\]\+\)\//g) || [];
  assert.ok(res.length >= 2, 'регулярок імені файлу: ' + res.length);
  for (const lit of res) {
    const re = new Function('return ' + lit)();
    assert.equal(re.exec('attachment; filename="report.xlsx"; filename*=UTF-8\'\'%D0%A1.xlsx')?.[1], '%D0%A1.xlsx', lit);
  }
});
