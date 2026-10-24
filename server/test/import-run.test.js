// Підтяжка замовлень з листів у базу (src/import/run.js): читає листи, будує план, не скасовує при порожньому листі, apply викликається лише на запит.
const test = require('node:test');
const assert = require('node:assert/strict');
const { importToday, guardCancels } = require('../src/import/run');

const NOW = new Date('2026-10-24T11:00:00+03:00');
const STORES = [{ id: 'амосова 5а', label: 'Амосова, 5А', address: 'м. Харків вул. Амосова, 5А', addrBread: 'м. Харків вул. Амосова, 5А', addrBakery: '', addrVeg: '', addrNbhz: '',
  directions: ['bread'], days: { veg: [], bakery: [] }, ua: false }];
const DIRS = { bread: { spreadsheetId: 'S', rawSheet: 'raw' } };

// колонки сирого листа хліба: дата, ..., адреса (3), штрихкод (4), назва, ціна, к-сть - див. admin/googleOrders COLS.bread
const { COLS } = require('../src/admin/googleOrders');
function sheetRow(over = {}) {
  const c = COLS.bread, r = new Array(10).fill('');
  r[0] = '24.10.2026'; r[c.addr] = 'м. Харків вул. Амосова, 5А'; r[c.qty] = '3';
  r[4] = '4820000000011'; r[3] = ''; r[5] = '25';
  r[Math.max(c.time, 0) || 1] = '10:15:00';
  Object.assign(r, over);
  return r;
}
const header = new Array(10).fill('h');

function mk({ sheet, existing = [], dirs = DIRS, realKeys = new Set() }) {
  const applied = [];
  return {
    applied,
    run: (extra = {}) => importToday({ sb: null, loadStores: async () => STORES, googleApi: null, directions: dirs, now: NOW,
      deps: { readSheet: async () => sheet, loadRealKeys: async () => realKeys, loadProducts: async () => [], loadExisting: async () => existing, apply: async (p) => { applied.push(p); } }, ...extra }),
  };
}

test('guardCancels: напрямок без рядків у листі - скасування не робимо (збій читання не знищує імпорт)', () => {
  const plan = { inserts: [], updates: [], skipped: [], unmatched: [], cancels: [{ pk: 1, dir: 'bread' }, { pk: 2, dir: 'veg' }] };
  const g = guardCancels(plan, { bread: 5, veg: 0 });
  assert.deepEqual(g.cancels.map((c) => c.pk), [1]);
  assert.deepEqual(g.guarded, ['veg']);
});

test('importToday: нові рядки з листа -> інсерти, apply викликається один раз з планом', async () => {
  const m = mk({ sheet: [header, sheetRow()] });
  const r = await m.run();
  assert.equal(r.dmy, '24.10.2026');
  assert.equal(r.rowsByDir.bread, 1);
  assert.equal(r.plan.inserts.length, 1);
  assert.equal(r.plan.inserts[0].order_id, 'import-2026-10-24-bread-амосова 5а');
  assert.equal(r.plan.inserts[0].exported_at, r.plan.inserts[0].changed_at);
  assert.equal(m.applied.length, 1);
});

test('importToday: apply=false нічого не пише; повторний імпорт без змін - skipped', async () => {
  const m = mk({ sheet: [header, sheetRow()] });
  const dry = await m.run({ apply: false });
  assert.equal(dry.plan.inserts.length, 1);
  assert.equal(m.applied.length, 0);
  const ins = dry.plan.inserts[0];
  const existing = [{ order_id: ins.order_id, pk: 'pk1', dir: 'bread', store_id: ins.store_id, status: 'active', lines: ins.lines }];
  const again = await mk({ sheet: [header, sheetRow()], existing }).run({ apply: false });
  assert.deepEqual([again.plan.inserts.length, again.plan.updates.length, again.plan.cancels.length], [0, 0, 0]);
});

test('importToday: порожній лист не скасовує вже імпортоване замовлення; справжнє (не import-) замовлення не чіпається', async () => {
  const imp = { order_id: 'import-2026-10-24-bread-амосова 5а', pk: 'a', dir: 'bread', store_id: 'амосова 5а', status: 'active', lines: [] };
  const r = await mk({ sheet: [header], existing: [imp] }).run({ apply: false });
  assert.equal(r.plan.cancels.length, 0);
  assert.deepEqual(r.plan.guarded, ['bread']);
  const real = { order_id: 'o1abc', pk: 'b', dir: 'bread', store_id: 'амосова 5а', status: 'active', lines: [] };
  const r2 = await mk({ sheet: [header, sheetRow()], existing: [real] }).run({ apply: false });
  assert.equal(r2.plan.inserts.length, 0);
  assert.match(r2.plan.skipped[0].reason, /справжнє замовлення/);
});

test('точка, що вже замовляла через Fly (навіть скасоване замовлення), НЕ імпортується: рядки в листі - наша ж вигрузка, скасоване не воскресає', async () => {
  const r = await mk({ sheet: [header, sheetRow()], realKeys: new Set(['bread|амосова 5а']) }).run({ apply: false });
  assert.equal(r.plan.inserts.length, 0);
  assert.equal(r.plan.skipped[0].reason, 'точка вже замовляла через Fly');
  const other = await mk({ sheet: [header, sheetRow()], realKeys: new Set(['bread|інша точка']) }).run({ apply: false });
  assert.equal(other.plan.inserts.length, 1);
});
