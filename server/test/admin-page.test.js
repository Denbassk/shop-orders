const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, OUT } = require('../scripts/build-admin');
const appMod = require('../src/app');
const createApp = appMod.createApp || appMod;
const norm = (s) => s.replace(/\r\n/g, '\n');

test('build: React-пульт зібрано у single-file HTML без шаблонів Apps Script', () => {
  const html = build();
  assert.ok(!html.includes('<?'), 'лишилась вставка <?');
  assert.ok(!html.includes('google.script'), 'лишились згадки google.script');
  assert.ok(html.includes('<title>Пульт Фемелі Маркет</title>'));
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('id="root"'));
});

test('build: зв\'язок з сервером через /admin/api, /admin/logout та HttpOnly cookie', () => {
  const html = build();
  for (const f of ['/admin/api', '/admin/logout', 'same-origin']) assert.ok(html.includes(f), f);
});

test('збережена сторінка = свіжа збірка (після зміни admin-ui - npm run build:admin)', () => {
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

test('вкладка «Магазини»: дії storesTable, storeCard, cardSave, cardAdd підключено в бандлі', () => {
  const html = build();
  for (const f of ['storesTable', 'storeCard', 'cardSave', 'cardAdd', 'Справочник ТТ (Google)']) assert.ok(html.includes(f), f);
});

test('установка пульта на головний екран: маніфест у голові сторінки, файли маніфесту/іконок віддаються, інші файли папки - ні', async () => {
  const html = build();
  for (const s of ['rel="manifest" href="/admin/manifest.webmanifest"', 'name="theme-color"', 'rel="apple-touch-icon"']) assert.ok(html.includes(s), s);
  const dir = path.join(__dirname, '..', 'public', 'admin');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual([m.start_url, m.scope, m.display, m.short_name], ['/admin', '/admin', 'standalone', 'Пульт']);
  for (const ic of m.icons) assert.ok(fs.existsSync(path.join(dir, path.basename(ic.src))), ic.src);
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  const app = createApp({ adminAuth: {}, adminApi: async () => ({}) });
  const srv = app.listen(0);
  try {
    const base = 'http://127.0.0.1:' + srv.address().port;
    const r = await fetch(base + '/admin/manifest.webmanifest');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /manifest\+json/);
    const i = await fetch(base + '/admin/icon-192.png');
    assert.equal(i.status, 200);
    assert.equal(i.headers.get('content-type'), 'image/png');
    assert.notEqual((await fetch(base + '/admin/index.html')).status, 200, 'сторінка пульта лише через /admin');
    assert.notEqual((await fetch(base + '/admin/..%2Fsrc%2Fapp.js')).status, 200);
  } finally { srv.close(); }
});

test('оболонка «Пульт» на GitHub Pages: після переходу на Fly веде на /admin Fly, поки Apps Script - лишається як було', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'pult', 'index.html'), 'utf8');
  const re = new RegExp(src.match(/if \((\/\^https:[^\n]*?\/)\.test\(url\)\) \{ location\.replace/)[1].slice(1, -1));
  assert.ok(re.test('https://shop-orders.fly.dev/'));
  assert.ok(re.test('https://shop-orders.fly.dev'));
  assert.ok(!re.test('https://script.google.com/macros/s/AKfycb.../exec'));
  assert.ok(!re.test('https://evil.example.com/?https://x.fly.dev/'));
  assert.ok(src.includes("+ '/admin'); return; }"));
});
