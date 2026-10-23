#!/usr/bin/env node
// ЛИШЕ ЧИТАННЯ: чим точки і асортимент у базі відрізняються від того, що зараз у Довіднику ТТ / «Ассортименті» Google
// (до переключення правки йдуть у Google, база - копія з 19.10). Нічого не пише.
//   node scripts/diff-reference.js
const { loadEnv } = require('../src/env');
loadEnv();
const { supabase } = require('../src/db');
const { readAll } = require('./import-reference');
const { storeToRow } = require('../src/import/parse');

const FIELDS = ['label', 'address', 'code', 'route', 'type', 'addr_bread', 'addr_bakery', 'addr_veg', 'addr_nbhz', 'route_nbhz', 'zone', 'edrpou',
  'bread', 'nbhz', 'bakery', 'veg', 'days_veg', 'days_bakery', 'note'];
const same = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);

(async () => {
  const sb = supabase();
  const data = await readAll();
  const { data: dbStores, error } = await sb.from('stores').select('*');
  if (error) throw new Error(error.message);
  const byId = Object.fromEntries(dbStores.map((r) => [r.store_id, r]));
  let nd = 0;
  data.stores.forEach((s, i) => {
    const g = storeToRow(s, i), d = byId[s.id];
    if (!d) { console.log(`ТОЧКА Є В GOOGLE, НЕМА В БАЗІ: ${s.label} (${s.id})`); nd++; return; }
    const diffs = FIELDS.filter((f) => !same(g[f], d[f])).map((f) => `${f}: Google=${JSON.stringify(g[f])} база=${JSON.stringify(d[f])}`);
    if (diffs.length) { nd++; console.log(`ТОЧКА ${s.label}: ${diffs.join('; ')}`); }
  });
  const gIds = new Set(data.stores.map((s) => s.id));
  dbStores.filter((r) => r.active && !gIds.has(r.store_id) && !String(r.store_id).startsWith('test-')).forEach((r) => { nd++; console.log(`У БАЗІ Є, У GOOGLE НЕМА (або неактивна): ${r.label}`); });
  console.log(`точки: розбіжностей ${nd} з ${data.stores.length}`);

  for (const dir of Object.keys(data.products)) {
    const { data: db } = await sb.from('products').select('id,name,price,status,category,cost').eq('dir', dir);
    const m = Object.fromEntries(db.map((r) => [r.id, r]));
    let n = 0;
    data.products[dir].forEach((p) => {
      const d = m[p.id];
      if (!d) { n++; console.log(`  [${dir}] новий у Google: ${p.name}`); return; }
      const df = ['name', 'status', 'category'].filter((f) => !same(p[f], d[f])).map((f) => `${f}: Google=${JSON.stringify(p[f])} база=${JSON.stringify(d[f])}`);
      if (Number(p.price) !== Number(d.price) && dir !== 'veg') df.push(`price: Google=${p.price} база=${d.price}`);
      if (df.length) { n++; console.log(`  [${dir}] ${p.name}: ${df.join('; ')}`); }
    });
    const gi = new Set(data.products[dir].map((p) => p.id));
    db.filter((r) => !gi.has(r.id)).forEach((r) => { n++; console.log(`  [${dir}] у базі є, у Google нема: ${r.name}`); });
    console.log(`${dir}: розбіжностей ${n}`);
  }
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
