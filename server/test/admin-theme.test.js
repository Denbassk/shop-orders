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
test('быстрые действия на «Сегодня» выделены обводкой (ряд .qa с рамкой цвета --teal в обеих темах); фильтры точек ниже - без неё', () => {
  const html = require('../scripts/build-admin').build();
  const css = html.slice(html.indexOf('.achip{'));
  assert.match(css.slice(0, 1500), /\.qa \.achip\{[^}]*border:2px solid var\(--teal\)/);
  const today = html.slice(html.lastIndexOf('function loadToday()'));
  assert.ok(today.includes('<div class="atools qa">'), 'ряд быстрых действий помечен классом qa');
  const atDraw = html.slice(html.indexOf('function dchip('), html.indexOf('function dchip(') + 600);
  assert.ok(!atDraw.includes('qa'), 'кнопки-фильтры (chip/dchip) обводку не получают');
  assert.match(html, /:root\{[^}]*--teal:#0F766E/); assert.match(html, /\[data-theme=dark\]\{[^}]*--teal:#2DD4BF/);
});
