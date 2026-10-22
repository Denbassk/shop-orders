#!/usr/bin/env node
// Імпорт сьогоднішніх замовлень з БОЙОВИХ сирих листів у базу (Task 11). Листи лише ЧИТАЮТЬСЯ.
//   node scripts/import-today.js             - показати, що буде зроблено (в базу нічого не пишемо)
//   node scripts/import-today.js --apply     - записати: нові замовлення, заміна змінених, скасування зниклих з листа
// Ідемпотентний: ключ замовлення import-<день>-<напрямок>-<точка>; справжні замовлення продавців (інші order_id) не чіпає.
// exported_at = changed_at: рядки вже є в листі, вигрузка їх не допише вдруге.
const { loadEnv } = require('../src/env');
loadEnv();
const { supabase, loadStores } = require('../src/db');
const { DIRECTIONS } = require('../src/directions');
const googleApi = require('../src/google');
const R = require('../src/rules');
const { planImport, rowsOfSheet, loadExisting, applyPlan } = require('../src/import/today');

(async () => {
  const apply = process.argv.includes('--apply');
  const now = new Date();
  const k = R.kyivNow(now);
  const sb = supabase();
  const stores = await loadStores();
  const products = {};
  const rows = [];
  for (const dir of Object.keys(DIRECTIONS)) {
    const cfg = DIRECTIONS[dir];
    const { data, error } = await sb.from('products').select('id,barcode,name').eq('dir', dir);
    if (error) throw new Error('products: ' + error.message);
    products[dir] = data;
    const sheet = await googleApi.getValues(cfg.spreadsheetId, googleApi.a1q(cfg.rawSheet, 'A:H'));
    const got = rowsOfSheet(dir, sheet, k.dmy);
    rows.push(...got);
    console.log(`${dir}: рядків у листі за ${k.dmy}: ${got.length}`);
  }
  const existing = await loadExisting(sb, k.day);
  const plan = planImport({ day: k.day, now, stores, products, existing, rows });
  const by = (list) => { const o = {}; list.forEach((x) => { o[x.dir] = (o[x.dir] || 0) + 1; }); return JSON.stringify(o); };
  console.log(`нових замовлень ${plan.inserts.length} ${by(plan.inserts)}; змінених ${plan.updates.length}; скасувати ${plan.cancels.length}; без змін/пропущено ${plan.skipped.length}`);
  plan.skipped.filter((s) => s.reason !== 'без змін').forEach((s) => console.log(`  пропущено [${s.dir}] ${s.storeId}: ${s.reason}`));
  if (plan.unmatched.length) console.log('  адреси, яких нема серед точок: ' + plan.unmatched.map((u) => `[${u.dir}] ${u.addr}`).join(' | '));
  if (!apply) { console.log('(без --apply: у базу нічого не писали)'); return; }
  await applyPlan(sb, plan);
  const after = await loadExisting(sb, k.day);
  console.log(`записано. Активних замовлень дня в базі: ${after.length}`);
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
