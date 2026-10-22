const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../src/buyer/api');
const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
test('info: правила прийому', async () => {
  const env = { at: new Date('2026-10-22T10:00:00+03:00'), adm: { getSetting: async () => ({}) } };
  const r = await B.buyerInfo('bread', env);
  assert.equal(r.rules.minOrder, 400);
  assert.equal(r.rules.byDays, false);
  assert.equal((await B.buyerInfo('veg', env)).rules.byDays, true);
});
test('runtime: board підключено', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8');
  assert.ok(src.includes('board: () => read.admDirStores'));
});
test('сторінка: плитки, темна тема, «Сьогодні» лише у #view', () => {
  for (const s of ["call('board'", 'class="tiles"', 'data-theme=dark', 'toggleTheme', 'class="bm', 'prefers-reduced-motion']) assert.ok(h.includes(s), s);
  assert.ok(!h.includes("querySelector('.wrap')"));
});