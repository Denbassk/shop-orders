const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const s = fs.readFileSync(path.join(__dirname, '../public/admin/index.html'), 'utf8');
test('пульт: точки плитками зі статусом по напрямках (adm-tiles)', () => {
  assert.ok(s.includes('/* adm-tiles */'));
  for (const f of ['function atTile', 'function atDraw', 'Сделано']) assert.ok(s.includes(f), f);
  assert.ok(s.lastIndexOf('function loadToday') > s.indexOf('/* adm-tiles */'), 'нова loadToday - остання');
});
test('пульт: дані з екранованням через esc()', () => {
  const blk = s.slice(s.indexOf('/* adm-tiles */'));
  assert.ok(/esc\(r\.label\)/.test(blk) && /attr\(r\.id\)/.test(blk));
});