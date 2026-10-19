#!/usr/bin/env node
// Разовий імпорт довідників з Google-таблиць у Supabase.
//   node scripts/import-reference.js --dry     - прочитати і надрукувати кількості, у базу не писати
//   node scripts/import-reference.js           - записати (відмовиться, якщо в stores/products уже є дані)
//   node scripts/import-reference.js --force   - перезаписати stores і products (затре правки з Table Editor!)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const secretsEnv = path.join(os.homedir(), '.secrets', 'shop-orders-sb.env');
if (!process.env.SUPABASE_URL && fs.existsSync(secretsEnv)) {
  require('dotenv').config({ path: secretsEnv, quiet: true });
}

const { getValues, firstSheetTitle, a1q } = require('../src/google');
const { DIRECTIONS, REGISTRY_ID, REGISTRY_SHEET, APP_VERSION, WO_DEADLINE } = require('../src/directions');
const {
  parseStores, storeToRow, parseSheetProducts, parseNbhzProducts, readVegPrices, parseVegProducts,
} = require('../src/import/parse');

const DEFAULT_SETTINGS = {
  dirs_off: [],
  late_all: {},
  app_version: APP_VERSION,
  test_mode: false,
  wo_deadline: WO_DEADLINE,
};

// Читає з Google і повертає { stores, products: {dir: [...]}, warnings }
async function readAll() {
  const warnings = [];
  const dropped = [];

  const regRows = await getValues(REGISTRY_ID, a1q(REGISTRY_SHEET, 'A2:T'));
  const stores = parseStores(regRows, dropped);
  const seenIds = new Set();
  stores.forEach((s) => { if (seenIds.has(s.id)) warnings.push(`дубль store_id: ${s.id}`); seenIds.add(s.id); });

  const products = {};
  for (const dir of ['bread', 'bakery']) {
    const cfg = DIRECTIONS[dir];
    products[dir] = parseSheetProducts(dir, cfg, await getValues(cfg.spreadsheetId, a1q(cfg.productsSheet, 'A2:F')), dropped);
  }
  const nb = DIRECTIONS.nbhz;
  products.nbhz = parseNbhzProducts(await getValues(nb.spreadsheetId, a1q(nb.productsSheet, 'A2:C')), dropped);

  const veg = DIRECTIONS.veg;
  const settingsRows = await getValues(veg.spreadsheetId, a1q('Налаштування', 'A2:B'));
  if (!settingsRows.length) throw new Error('Лист "Налаштування" овочів порожній');
  const priceTitle = await firstSheetTitle(veg.priceSpreadsheetId);
  const priceData = await getValues(veg.priceSpreadsheetId, a1q(priceTitle, 'A1:Z'));
  const prices = readVegPrices(priceData);
  products.veg = parseVegProducts(settingsRows, prices, dropped);
  if (!products.veg.length) throw new Error('Не знайдено жодної позиції в прайсі постачальника');

  // PK (dir,id): повтор штрихкоду/назви - лишаємо перший, активний переважає стоп
  for (const dir of Object.keys(products)) {
    const byId = new Map();
    for (const p of products[dir]) {
      const old = byId.get(p.id);
      if (!old) { byId.set(p.id, p); continue; }
      const keep = old.status === 'stop' && p.status === 'active' ? p : old;
      dropped.push({ dir, row: null, reason: `дубль id "${p.id}"`, name: (keep === p ? old : p).name });
      byId.set(p.id, keep);
    }
    products[dir] = [...byId.values()];
  }
  return { stores, products, warnings, dropped };
}

function summarize({ stores, products, warnings, dropped }) {
  const lines = [];
  const perDir = {};
  stores.forEach((s) => s.directions.forEach((d) => { perDir[d] = (perDir[d] || 0) + 1; }));
  lines.push(`точок: ${stores.length}  (по напрямках: ${Object.entries(perDir).map(([d, n]) => `${d}=${n}`).join(', ')})`);
  for (const [dir, list] of Object.entries(products)) {
    const act = list.filter((p) => p.status === 'active').length;
    lines.push(`${dir}: активних ${act}, стоп ${list.length - act}`);
  }
  warnings.forEach((w) => lines.push(`УВАГА: ${w}`));
  lines.push(`відсіяно рядків: ${dropped.length}`);
  dropped.forEach((d) => lines.push(`  [${d.dir}] ${d.row ? 'рядок ' + d.row + ': ' : ''}${d.reason} - ${d.name}`));
  return lines.join('\n');
}

async function countRows(sb, table) {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count;
}

async function write(data, { force }) {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const must = (label, { error }) => { if (error) throw new Error(`${label}: ${error.message}`); };

  const existing = (await countRows(sb, 'stores')) + (await countRows(sb, 'products'));
  if (existing && !force) {
    throw new Error(`У stores/products уже ${existing} рядків. Імпорт разовий; --force затре правки з Table Editor.`);
  }

  must('directions', await sb.from('directions').upsert(
    Object.entries(DIRECTIONS).map(([dir, cfg]) => ({ dir, cfg })), { onConflict: 'dir' }));
  // settings не перезаписуємо: dirs_off/late_all на бою живі
  must('settings', await sb.from('settings').upsert(
    Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })),
    { onConflict: 'key', ignoreDuplicates: true }));

  if (force) {
    must('products.delete', await sb.from('products').delete().neq('id', '\u0000'));
    must('stores.delete', await sb.from('stores').delete().neq('store_id', '\u0000'));
  }
  must('stores', await sb.from('stores').upsert(data.stores.map((s, i) => storeToRow(s, i)), { onConflict: 'store_id' }));

  for (const [dir, list] of Object.entries(data.products)) {
    const rows = list.map((p) => ({ dir, ...p }));
    for (let i = 0; i < rows.length; i += 500) {
      must(`products ${dir}`, await sb.from('products').upsert(rows.slice(i, i + 500), { onConflict: 'dir,id' }));
    }
  }

  const counts = {};
  for (const t of ['directions', 'settings', 'stores', 'products']) counts[t] = await countRows(sb, t);
  return counts;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const force = args.includes('--force');

  const data = await readAll();
  console.log(summarize(data));
  if (dry) { console.log('--dry: в базу не писали'); return; }

  const counts = await write(data, { force });
  console.log('в базі:', JSON.stringify(counts));
}

if (require.main === module) {
  main().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exit(1); });
}

module.exports = { readAll, summarize };
