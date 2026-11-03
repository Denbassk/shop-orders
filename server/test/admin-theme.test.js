const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
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

// кнопка «Домой» в шапке: на ноутбуке нижняя панель - плавающая «таблетка» внизу по центру, до неё далеко ехать мышью
const homeCode = () => {
  const html = require('../scripts/build-admin').build();
  const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).filter((x) => x.includes('adm-home'));
  assert.equal(m.length, 1, 'скрипт кнопки «Домой» один');
  return { html, code: m[0] };
};
function fakeBtn(cls) {
  const b = { className: cls, attrs: {}, setAttribute(k, v) { b.attrs[k] = v; },
    classList: { toggle(c, on) { const a = new Set(b.className.split(' ').filter(Boolean)); on ? a.add(c) : a.delete(c); b.className = [...a].join(' '); } } };
  return b;
}
function runHome(withTheme = true) {
  const theme = fakeBtn('icobtn thbtn'), refresh = fakeBtn('icobtn');
  const kids = withTheme ? [theme, refresh] : [refresh];
  const hdr = { querySelectorAll: (q) => (q === '.icobtn' ? kids.slice() : []), querySelector: (q) => (q === '.thbtn' && withTheme ? theme : null),
    insertBefore(n, ref) { kids.splice(kids.indexOf(ref), 0, n); } };
  const made = [], calls = [];
  const sb = { document: { querySelector: (q) => (q === '.hdr' ? hdr : null), createElement: () => { const b = fakeBtn(''); made.push(b); return b; } },
    tabGo: (x) => calls.push(x), tabsSeen: [] };
  sb.window = sb; sb.tabs = (n) => sb.tabsSeen.push(n);
  vm.runInNewContext(homeCode().code, sb);
  return { kids, theme, refresh, made, calls, sb };
}
test('«Домой» в шапке: кнопка с домиком и подписью, ведёт на «Сегодня», стоит перед темой и обновлением', () => {
  const { kids, theme, refresh, made, calls } = runHome();
  assert.equal(made.length, 1);
  const b = made[0];
  assert.match(b.className, /\bhomebtn\b/);
  assert.equal(b.attrs['aria-label'], 'Домой');
  assert.match(b.innerHTML, /<svg[\s\S]*Домой/, 'домик и подпись');
  assert.deepEqual(kids, [b, theme, refresh], 'порядок: Домой, тема, обновить');
  b.onclick();
  assert.deepEqual(calls, ['today'], 'нажатие = нижняя вкладка «Сегодня» (история сбрасывается)');
});
test('«Домой»: на самом экране «Сегодня» приглушена (on), на любом другом - активна; исходный tabs() не ломаем', () => {
  const { made, sb } = runHome();
  const b = made[0];
  sb.tabs('dir'); assert.ok(!/\bon\b/.test(b.className), 'на экране направления домой доступен');
  sb.tabs('today'); assert.match(b.className, /\bon\b/, 'на «Сегодня» уже дома');
  sb.tabs('store'); assert.ok(!/\bon\b/.test(b.className));
  assert.deepEqual(sb.tabsSeen, ['dir', 'today', 'store'], 'исходный tabs() по-прежнему вызывается с тем же аргументом');
});
test('«Домой»: без кнопки темы встаёт перед «Обновить»; на телефоне прячется (там вкладка «Сегодня» под большим пальцем)', () => {
  const { kids, refresh, made } = runHome(false);
  assert.deepEqual(kids, [made[0], refresh]);
  const { html } = homeCode();
  assert.match(html, /@media \(max-width:640px\)\{\.homebtn\{display:none\}\}/);
  assert.match(html, /\.homebtn\{[^}]*width:auto/);
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
