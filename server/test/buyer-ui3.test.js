const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
test('закупниця: «Зроблено» зеленим, звірка з таблицею Google, «Сьогодні» спільна для напрямків', () => {
  for (const s of ['function gsApply()', 'function sumAll(', 'function aggCls(', "t: 'Зроблено'", "today: 'Сьогодні'", "S.tab === 'today') &&", '.tile.st-ok', 'gs: !!r.gs']) assert.ok(H.includes(s), s);
});