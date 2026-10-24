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
const { loadExisting } = require('../src/import/today');
const { importToday } = require('../src/import/run');

(async () => {
  const apply = process.argv.includes('--apply');
  const sb = supabase();
  const r = await importToday({ sb, loadStores, googleApi, directions: DIRECTIONS, apply });
  Object.keys(DIRECTIONS).forEach((dir) => console.log(`${dir}: рядків у листі за ${r.dmy}: ${r.rowsByDir[dir]}`));
  const plan = r.plan;
  const by = (list) => { const o = {}; list.forEach((x) => { o[x.dir] = (o[x.dir] || 0) + 1; }); return JSON.stringify(o); };
  console.log(`нових замовлень ${plan.inserts.length} ${by(plan.inserts)}; змінених ${plan.updates.length}; скасувати ${plan.cancels.length}; без змін/пропущено ${plan.skipped.length}`);
  plan.skipped.filter((s) => s.reason !== 'без змін').forEach((s) => console.log(`  пропущено [${s.dir}] ${s.storeId}: ${s.reason}`));
  if (plan.guarded && plan.guarded.length) console.log('  УВАГА: лист порожній, скасування не робимо: ' + plan.guarded.join(', '));
  if (plan.unmatched.length) console.log('  адреси, яких нема серед точок: ' + plan.unmatched.map((u) => `[${u.dir}] ${u.addr}`).join(' | '));
  if (!apply) { console.log('(без --apply: у базу нічого не писали)'); return; }
  const after = await loadExisting(sb, r.day);
  console.log(`записано. Активних замовлень дня в базі: ${after.length}`);
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
