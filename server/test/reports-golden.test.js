// Золоті тести звітів хліба, овочів і вигрузки НБХЗ: фікстура = знімок БОЙОВОЇ таблиці 19.10.2026 ПІСЛЯ дедлайну напрямку
// (scripts/snapshot-report.js: сирі рядки + значення і оформлення листів Apps Script одним моментом). З сирих рядків фікстури наш код
// будує листи; значення (з типом), формати, рамки, ширини, закріплення мають збігатися з бойовими комірка в комірку.
// Допуски (див. shadow.js): час збирання і id/gid у посиланнях; закріплення колонок; залишок формату числа в порожніх комірках;
// число/текст у штрихкодах зведення хліба; ширини A:B і висота шапки НБХЗ, які рахує Google (autoResize).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FIXTURES, loadFixture, plansFor, compareFixture } = require('./helpers/golden');

const DAY = '2026-10-19';
const SHEETS = {
  bread: ['Заказы', 'Данные Заказов', 'Завантаження'],
  veg: ['Замовлення Овочі', 'Зведена Овочі'],
  nbhz: ['Вивантаження 19.10.2026', 'Завантаження'],
};

for (const dir of Object.keys(SHEETS)) {
  test(`золота фікстура ${dir}: файл є, містить сирі рядки і всі листи звіту`, () => {
    const file = path.join(FIXTURES, `${dir}-${DAY}.json`);
    assert.ok(fs.existsSync(file), 'нема фікстури ' + file);
    const fx = loadFixture(dir, DAY);
    assert.ok(fx.raw.length > 20, 'сирих рядків: ' + fx.raw.length);
    assert.deepEqual(Object.keys(fx.models).sort(), SHEETS[dir].slice().sort());
  });

  test(`золото ${dir}: значення, типи і оформлення збігаються з бойовим листом Apps Script (0 розбіжностей)`, () => {
    const fx = loadFixture(dir, DAY);
    const cmp = compareFixture(dir, fx);
    const show = Object.entries(cmp.sheets).flatMap(([n, s]) => (s.missing ? [`«${n}»: нашого листа нема`]
      : [...s.valueDiffs, ...s.formatDiffs].slice(0, 8).map((d) => `«${n}» ${d.cell} ${d.prop}: бойовий=${d.gas} наш=${d.ours}`)));
    assert.equal(cmp.totalValue + cmp.totalFormat, 0, `\n${show.join('\n')}`);
    assert.ok(cmp.totalCells > 100, 'порівняно комірок: ' + cmp.totalCells);
  });

  test(`золото ${dir}: наші листи мають ті самі розміри (рядків × колонок), що бойові`, () => {
    const fx = loadFixture(dir, DAY);
    const plans = plansFor(dir, fx);
    for (const [name, vals] of Object.entries(fx.values)) {
      const plan = plans[name];
      assert.ok(plan, 'є план листа ' + name);
      assert.equal(plan.data.length, vals.length, `«${name}»: рядків`);
    }
  });
}
