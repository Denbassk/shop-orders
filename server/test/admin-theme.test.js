const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const s = fs.readFileSync(path.join(__dirname, '../public/admin/index.html'), 'utf8');
test('пульт: тема і ширина ноутбука (adm-theme)', () => {
  assert.ok(s.includes('/* adm-theme */'));
  assert.match(s, /\[data-theme=dark\]\{--bg:/);
  assert.match(s, /\.wrap\{max-width:1320px/);
  assert.ok(s.indexOf('buyer_theme') < s.indexOf('</head>'), 'тема ставиться до відмальовки');
});
test('пульт: логіку не чіпали (вхід і виклики на місці)', () => {
  for (const f of ['function doLogin', 'function call(', 'function tabGo', 'function loadToday']) assert.ok(s.includes(f), f);
});