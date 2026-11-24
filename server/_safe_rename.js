const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./src/env');
const { supabase } = require('./src/db');

loadEnv();
if (!process.env.SUPABASE_URL) {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });
}

function normalizeWeightName(raw) {
  let s = String(raw || '').trim();
  // 0,500 г / 0.5 г / 0,250 Г -> 500 гр
  s = s.replace(
    /(^|[^\d.,])(\d+[.,]\d+)\s*(?:гр\.?|г\.?)(?![а-яіїєґa-z0-9])/giu,
    (match, prefix, numStr) => {
      const val = parseFloat(numStr.replace(',', '.'));
      if (!(val > 0)) return match;
      return `${prefix}${Math.round(val * 1000)} гр`;
    }
  );
  // 500гр / 500 г / 500 Г / 500гр. -> 500 гр
  s = s.replace(
    /(^|[^\d.,])(\d+)\s*(?:гр\.?|г\.?)(?![а-яіїєґa-z0-9])/giu,
    (match, prefix, numStr) => `${prefix}${numStr} гр`
  );
  return s.replace(/\s{2,}/g, ' ').trim();
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sb = supabase();

  const [{ data: products, error: e1 }, { data: activeOrders, error: e2 }] = await Promise.all([
    sb.from('products').select('*'),
    sb.from('orders').select('*').eq('status', 'active'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const activeOrderIds = (activeOrders || []).map((o) => o.id).filter(Boolean);
  let activeLines = [];
  if (activeOrderIds.length) {
    const { data: lines, error: e3 } = await sb.from('order_lines').select('*').in('order_pk', activeOrderIds);
    if (e3) throw e3;
    activeLines = lines || [];
  }

  const dirCol = products.length && ('dir' in products[0]) ? 'dir' : 'direction';
  products.sort((a, b) => String(a[dirCol]).localeCompare(String(b[dirCol])) || String(a.name).localeCompare(String(b.name), 'uk'));

  const byDir = new Map();
  for (const p of products) {
    const d = p[dirCol];
    if (!byDir.has(d)) byDir.set(d, new Set());
    byDir.get(d).add(String(p.name || '').toLowerCase());
  }

  const changes = [];
  for (const p of products) {
    const next = normalizeWeightName(p.name);
    if (next && next !== p.name) {
      const d = p[dirCol];
      const conflict = next.toLowerCase() !== p.name.toLowerCase() && byDir.get(d).has(next.toLowerCase());
      changes.push({ id: p.id, dir: d, old: p.name, next, conflict });
    }
  }

  if (!changes.length) {
    console.log('Изменений не требуется — все названия уже приведены к единому виду.');
    return;
  }

  const changeByProdId = new Map(changes.filter((c) => !c.conflict).map((c) => [String(c.id), c]));
  const linesToUpdate = activeLines.filter((ln) => {
    const ch = changeByProdId.get(String(ln.product_id));
    return ch && ln.name !== ch.next;
  });

  console.log(`Позиций в справочнике для обновления: ${changes.length}`);
  console.log(`Строк в активных заказах, которые обновятся синхронно: ${linesToUpdate.length}\n`);
  for (const c of changes) {
    console.log(`[${c.dir}] ${c.old}  --->  ${c.next}${c.conflict ? '  ⚠️ ДУБЛЬ (пропустим)' : ''}`);
  }

  if (!apply) {
    console.log('\nЭто предпросмотр (база не изменена).');
    console.log('Чтобы применить синхронно в справочнике и активных заказах, выполните:');
    console.log('node server/_safe_rename.js --apply');
    return;
  }

  let updatedProds = 0;
  for (const c of changes) {
    if (c.conflict) continue;
    let q = sb.from('products').update({ name: c.next }).eq('id', c.id);
    if (dirCol) q = q.eq(dirCol, c.dir);
    const { error } = await q;
    if (error) throw new Error(`products (${c.id}): ${error.message || JSON.stringify(error)}`);
    updatedProds++;
  }

  let updatedLines = 0;
  const touchedOrderPks = new Set();
  for (const ln of linesToUpdate) {
    const ch = changeByProdId.get(String(ln.product_id));
    const { error } = await sb.from('order_lines').update({ name: ch.next }).eq('id', ln.id);
    if (error) throw new Error(`order_lines (${ln.id}): ${error.message || JSON.stringify(error)}`);
    updatedLines++;
    if (ln.order_pk != null) touchedOrderPks.add(ln.order_pk);
  }

  const hasChangedAt = activeOrders.length && ('changed_at' in activeOrders[0]);
  if (hasChangedAt && touchedOrderPks.size) {
    const ts = new Date().toISOString();
    for (const opk of touchedOrderPks) {
      const { error } = await sb.from('orders').update({ changed_at: ts }).eq('id', opk).eq('status', 'active');
      if (error) throw new Error(`orders (${opk}): ${error.message || JSON.stringify(error)}`);
    }
  }

  await sb.from('admin_log').insert({
    action: 'Масова правка назв',
    details: `Уніфіковано вагу (гр): ${updatedProds} поз. у довіднику, ${updatedLines} рядків у замовленнях`.slice(0, 900),
  });

  console.log(`\nГОТОВО: обновлено в справочнике — ${updatedProds}, в строках заказов — ${updatedLines}.`);
}

main().catch((err) => {
  console.error('Ошибка:', err && err.message ? err.message : JSON.stringify(err, null, 2));
  process.exit(1);
});
