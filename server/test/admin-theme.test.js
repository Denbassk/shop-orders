const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = fs.readFileSync(path.join(__dirname, '../public/admin/index.html'), 'utf8');

test('пульт: перемикач темної та світлої теми (pult_theme) у бандлі', () => {
  assert.ok(s.includes('pult_theme'));
  assert.ok(s.includes('Светлая тема') || s.includes('Тёмная тема'));
});

test('пульт: основні екрани та API-дії зібрані у бандл', () => {
  for (const f of ['today', 'dirStores', 'assortment', 'incomingPreview', 'woBrief', 'noticeList', 'health', 'log']) assert.ok(s.includes(f), f);
});
