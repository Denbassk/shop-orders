const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const H = fs.readFileSync(path.join(__dirname, '../public/buyer/index.html'), 'utf8');
const wo = H.slice(H.indexOf('const WO_T ='), H.indexOf('async function showWo()'));   // весь рендер вкладки «Списання»
test('списання: графік по днях компактний (wo-compact)', () => {
  assert.ok(H.includes('/* wo-compact */'));
  assert.match(H, /\.wdc\{flex:0 1 64px;/);
  assert.match(H, /\.wod\{[^}]*height:130px/);
});
test('списання: рівна сітка - картки-списки однакової фіксованої висоти з прокруткою всередині, без «рваних» колонок', () => {
  assert.match(H, /\.wolist\{display:flex;flex-direction:column;height:440px;container-type:inline-size\}/);
  assert.match(H, /\.wolst\{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain/);
  assert.match(H, /\.wogrid\{display:grid;gap:16px;grid-template-columns:minmax\(0,1fr\);margin-top:16px;align-items:stretch\}/);
  assert.match(H, /repeat\(2,minmax\(0,1fr\)\)\}\.wogrid>\.wocard:last-child:nth-child\(odd\)\{grid-column:1\/-1\}/, 'непарна остання картка розтягується - без діри');
  assert.match(H, /\.wocol\{position:sticky;top:0/, 'шапка колонок лишається при прокрутці');
  assert.ok(!/\.wocard\.wide:has\(\.wod\)/.test(H) && !/function woRank/.test(H), 'старі «рвані» картки прибрано');
});
test('списання: один словник підписів у плитках, шапках колонок і підказці', () => {
  assert.match(wo, /const WO_T = \{ qty: 'Списано, шт', docs: 'Подач', cost: 'Собівартість, грн', mk: 'З націнкою, грн' \}/);
  for (const k of ['qty', 'docs', 'cost', 'mk']) assert.ok(wo.includes('WO_T.' + k), 'WO_T.' + k);
  assert.match(wo, /kpi\(fmtM\(t\.sum \|\| 0\), WO_T\.cost\) \+ kpi\(fmtM\(t\.sum20 \|\| 0\), WO_T\.mk\) \+ kpi\(fmtN\(t\.qty \|\| 0\), WO_T\.qty\)/);
  assert.ok(wo.includes('Як читати цифри.</b>') && wo.includes('до 19.10.2026 було +15%'), 'пояснення: що таке подача, собівартість, націнка');
  assert.ok(!wo.includes("'грн +20%'") && !wo.includes("'штук'") && !wo.includes("' шт · подач '"), 'старі двозначні підписи прибрано');
  assert.ok(wo.includes('function woPeriod(') && wo.includes('Показано за'), 'над плитками написано, за який період/юрособу/категорію цифри');
});
test('списання: рядок розкривається в склад (details), кожен список має шапку колонок і підпис', () => {
  assert.ok(wo.includes('<details class="wr"><summary class="wos">'));
  for (const s of ["itemHead: 'Що списали: товар'", "itemHead: 'Де списали: точка'", "itemHead: 'Склад подачі: товар'", "nameHead: 'Продавець · точка'"]) assert.ok(wo.includes(s), s);
  assert.ok(wo.includes('woMob(') && /@container \(max-width:540px\)/.test(H), 'вузька карточка: подач/націнка - підписаним рядком');
  assert.ok(wo.includes("'Позицій'") && wo.includes('x.lines'), 'останні подачі розкриваються у позиції');
});
test('списання: розмітка не містить українських підписів у ламаному стані - скрипт сторінки компілюється', () => {
  for (const m of H.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
});
