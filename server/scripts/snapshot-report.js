#!/usr/bin/env node
// Знімок для золотих тестів звітів напрямку bread | veg | nbhz | bakery. ЛИШЕ ЧИТАННЯ бойової таблиці.
// Сирі рядки за сьогодні і значення звітів Apps Script читаються ОДНИМ запитом values.batchGet (один момент часу);
// оформлення цих листів (кольори, шрифти, рамки, ширини, закріплення) - другим запитом spreadsheets.get; довідник точок і асортимент - з бази.
// Знімати ТІЛЬКИ після дедлайну і оновлення звіту: скрипт відмовляє раніше (дедлайн + 5 хв), --force знімає запобіжник.
//   node scripts/snapshot-report.js <dir> [--force] [вихідний.json]
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv } = require('../src/env');
loadEnv();
const { DIRECTIONS } = require('../src/directions');
const googleApi = require('../src/google');
const { loadStores, supabase } = require('../src/db');
const R = require('../src/rules');
const { readLive } = require('../src/reports/liveRead');
const { FIXTURES, compareFixture } = require('../test/helpers/golden');

const args = process.argv.slice(2);
const force = args.includes('--force');
const [dir, out] = args.filter((a) => !a.startsWith('--'));
if (!DIRECTIONS[dir]) { console.error('використання: snapshot-report.js bread|veg|nbhz|bakery [--force] [файл]'); process.exit(2); }

// час із тексту звіту: "(оновлено 12:56:19)" / "Звіт перезібрано о 15:42"
const stampsIn = (values) => {
  const out = [];
  JSON.stringify(values).replace(/оновлено (\d\d:\d\d:\d\d)|перезібрано о (\d\d:\d\d)/g, (m, a, b) => { out.push(a || b); return m; });
  return out;
};

(async () => {
  const now = new Date(), k = R.kyivNow(now);
  const [h, m] = DIRECTIONS[dir].deadline.split(':').map(Number);
  const ready = k.hh * 60 + k.mm >= h * 60 + m + 5;
  console.log(`${dir}: зараз ${k.time}, дедлайн ${DIRECTIONS[dir].deadline}${ready ? '' : ' - ЩЕ НЕ МИНУВ + 5 хв'}`);
  if (!ready && !force) { console.error('відмова: звіт ще може змінитись. Знімати після дедлайну + 5 хв (або --force).'); process.exit(3); }

  const live = await readLive(dir, now);
  if (live.missing.length) throw new Error('у бойовій таблиці нема листів: ' + live.missing.join(', '));
  const sheetIds = Object.fromEntries((await googleApi.sheetList(DIRECTIONS[dir].spreadsheetId)).map((s) => [s.title, s.sheetId]));
  const stores = await loadStores();
  const { data: products, error } = await supabase().from('products').select('barcode,name,category,status').eq('dir', dir).order('sort');
  if (error) throw new Error(error.message);

  const fx = { modelVersion: 2, dir, day: live.day, dmy: live.dmy, takenAt: live.takenAt, sheetIds, raw: live.raw, values: live.values, models: live.models, stores, products,
    note: 'raw = сирі рядки за день (UNFORMATTED); values = значення A:… звітів Apps Script (один batchGet з raw); models = значення+оформлення цих листів (spreadsheets.get); stores/products - з бази' };
  const file = out || path.join(FIXTURES, `${dir}-${live.day}.json`);
  fs.writeFileSync(file, JSON.stringify(fx));

  console.log(`знімок ${live.takenAt} -> ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} КБ)`);
  console.log(`сирих рядків за ${live.dmy}: ${live.raw.length}, робочих ${live.rows.length}; точок у базі ${stores.length}, позицій у products ${products.length}`);
  for (const [name, v] of Object.entries(live.values)) console.log(`  «${name}»: рядків ${v.length}; позначки часу в тексті: ${stampsIn(v).join(' | ') || '-'}`);
  // якщо в сирих рядках є час (ВК, овочі) - позначка «оновлено» має бути пізнішою за останній рядок
  const timeCol = { bakery: 1, veg: 1 }[dir];
  if (timeCol != null && live.raw.length) {
    const t = live.raw.map((r) => (typeof r[timeCol] === 'number' ? `${String(Math.floor(((r[timeCol] % 1) * 1440) / 60)).padStart(2, '0')}:${String(Math.round((r[timeCol] % 1) * 1440) % 60).padStart(2, '0')}` : String(r[timeCol]).slice(0, 5))).sort().pop();
    console.log(`  останній сирий рядок о ${t}; найраніша «оновлено» ${stampsIn(live.values).sort()[0] || '-'}`);
  } else console.log('  у сирих рядках цього напрямку немає часу — свіжість звіту підтверджується збігом з нашою збіркою (нижче) і повторним знімком');

  const cmp = compareFixture(dir, fx);
  console.log(`порівняння з нашою збіркою: комірок ${cmp.totalCells}, розбіжностей значень ${cmp.totalValue}, оформлення ${cmp.totalFormat}`);
  for (const [n, s] of Object.entries(cmp.sheets)) {
    if (s.missing) { console.log(`  «${n}»: нашого листа немає`); continue; }
    [...s.valueDiffs, ...s.formatDiffs].slice(0, 10).forEach((d) => console.log(`    «${n}» ${d.cell} ${d.prop}: бойовий=${d.gas} наш=${d.ours}`));
  }
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
