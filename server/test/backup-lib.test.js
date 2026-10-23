// Бекап бази (scripts/backup-db-lib.cjs): список таблиць з OpenAPI PostgREST, перевірка «підозрілого» бекапу.
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../scripts/backup-db-lib.cjs');

const spec = { definitions: {
  stores: { properties: { store_id: { description: 'Note:\n<pk/>' }, label: {} } },
  products: { properties: { dir: { description: '<pk/>' }, id: { description: '<pk/>' }, name: {} } },
  writeoffs_export_pending: { properties: { id: {} } },
  stores_backup_manual: { properties: { x: {} } },
} };

test('tablesFromOpenApi: таблиці за алфавітом, в\'ю writeoffs_export_pending і разові backup-копії без ключа пропущено, порядок - за ключем', () => {
  const t = lib.tablesFromOpenApi(spec);
  assert.deepEqual(t.map((x) => x.name), ['products', 'stores']);
  assert.deepEqual(t[0].order, ['dir', 'id']);
});

test('sanityProblems: порожні stores/products - підозрілий бекап', () => {
  assert.deepEqual(lib.sanityProblems({ stores: 39, products: 92 }), []);
  assert.equal(lib.sanityProblems({ stores: 0, products: 5 }).length, 1);
  assert.match(lib.sanityProblems({})[0], /stores|products/);
});

test('ім\'я файлу має префікс Замовлення_база_', () => {
  assert.ok(lib.FILE_PREFIX.startsWith('Замовлення_база'));
});
