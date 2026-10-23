const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
test('закупниця: ЮА Маркет на плитках, асортимент блоками, Дозволи і Прийом без перемикання напрямків', () => {
  for (const s of ['ua: !!r.ua', 'class="ua"', "['ua', 'ЮА Маркет']", 'function isShared()', 'Усі напрямки', 'class="pgrid"']) assert.ok(H.includes(s), s);
});