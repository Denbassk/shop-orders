const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
test('списання: графік по днях компактний (wo-compact)', () => {
  const s = fs.readFileSync(path.join(__dirname, '../public/buyer/index.html'), 'utf8');
  assert.ok(s.includes('/* wo-compact */'));
  assert.match(s, /\.wdc\{flex:0 1 48px\}/);
});