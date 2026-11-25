const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = fs.readFileSync(path.join(__dirname, '../public/admin/index.html'), 'utf8');

test('пульт: екран «Сегодня» та перехід у «Кто заказал» зібрано у бандл', () => {
  for (const f of ['Кто заказал', 'Собрать отчёт', 'Открыть всем', 'dirStores']) assert.ok(s.includes(f), f);
});
