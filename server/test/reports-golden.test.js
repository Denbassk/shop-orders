// Золоті тести звітів хліба, овочів і вигрузки НБХЗ: фікстура = знімок БОЙОВОЇ таблиці ПІСЛЯ дедлайну напрямку
// (scripts/snapshot-report.js: сирі рядки + значення і оформлення листів Apps Script одним моментом). З сирих рядків фікстури наш код
// будує листи; значення (з типом), формати, рамки, ширини, закріплення мають збігатися з бойовими комірка в комірку.
// Тест проходить по ВСІХ знайдених фікстурах (<dir>-РРРР-ММ-ДД.json): кожен знятий день - окремий еталон.
// Допуски (див. shadow.js): час збирання і id/gid у посиланнях; закріплення колонок; залишок формату числа в порожніх комірках;
// число/текст у штрихкодах зведення хліба; ширини A:B і висота шапки НБХЗ, які рахує Google (autoResize).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { FIXTURES, loadFixture, plansFor, compareFixture } = require('./helpers/golden');

const daysOf = (dir) => fs.readdirSync(FIXTURES)
  .map((f) => (f.match(new RegExp('^' + dir + '-(\\d{4}-\\d{2}-\\d{2})\\.json$')) || [])[1]).filter(Boolean).sort();
const sheetsOf = (dir, day) => ({
  bread: ['Заказы', 'Данные Заказов', 'Завантаження'],
  veg: ['Замовлення Овочі', 'Зведена Овочі'],
  nbhz: ['Вивантаження ' + day.slice(8, 10) + '.' + day.slice(5, 7) + '.' + day.slice(0, 4), 'Завантаження'],
}[dir]);

for (const dir of ['bread', 'veg', 'nbhz']) {
  test(`золоті фікстури ${dir}: є хоча б одна`, () => { assert.ok(daysOf(dir).length >= 1, 'нема фікстур ' + dir); });

  for (const day of daysOf(dir)) {
    test(`золота фікстура ${dir} ${day}: сирі рядки і всі листи звіту є`, () => {
      const fx = loadFixture(dir, day);
      // фікстура порожнього дня (напр. овочі в четвер: 0 рядків) теж еталон - звіт «Замовлень на сьогодні ще немає»
      assert.ok(fx.raw.length > 20 || fx.raw.length === 0, 'сирих рядків: ' + fx.raw.length);
      assert.deepEqual(Object.keys(fx.models).sort(), sheetsOf(dir, day).slice().sort());
    });

    test(`золото ${dir} ${day}: значення, типи і оформлення збігаються з бойовим листом Apps Script (0 розбіжностей)`, () => {
      const fx = loadFixture(dir, day);
      const cmp = compareFixture(dir, fx);
      const show = Object.entries(cmp.sheets).flatMap(([n, s]) => (s.missing ? [`«${n}»: нашого листа нема`]
        : [...s.valueDiffs, ...s.formatDiffs].slice(0, 8).map((d) => `«${n}» ${d.cell} ${d.prop}: бойовий=${d.gas} наш=${d.ours}`)));
      assert.equal(cmp.totalValue + cmp.totalFormat, 0, `\n${show.join('\n')}`);
      assert.ok(cmp.totalCells > (fx.raw.length ? 100 : 20), 'порівняно комірок: ' + cmp.totalCells);
    });

    test(`золото ${dir} ${day}: кількість рядків кожного листа збігається з бойовим`, () => {
      const fx = loadFixture(dir, day);
      const plans = plansFor(dir, fx);
      for (const [name, vals] of Object.entries(fx.values)) {
        assert.ok(plans[name], 'є план листа ' + name);
        const trimmed = plans[name].data.filter((r, i, all) => all.slice(i).some((x) => x.some((c) => c !== '' && c != null))).length;      // Google не віддає порожні рядки наприкінці
        assert.equal(trimmed, vals.length, `«${name}»: рядків`);
      }
    });
  }
}
