// Імпорт сьогоднішніх замовлень з БОЙОВИХ сирих листів Google в базу (orders/order_lines). Потрібен двічі:
//   - у тіньовому режимі (Task 11, крок 1): база має ті самі замовлення, що листи Apps Script - звіти і пульт з бази можна звіряти;
//   - перед переключенням: замовлення дня вже в базі, тож продавець не зробить дубль, а вигрузка не допише їх у лист вдруге
//     (exported_at = changed_at: рядки вже є в листі).
// planImport - чисті правила (без бази і мережі); applyPlan - запис. Замовлення, створені НЕ імпортом (order_id не 'import-...'), не чіпаємо.
const R = require('../rules');
const { storeIndex, COLS, hmOf } = require('../admin/googleOrders');
const { nameKey } = require('../reports/nbhz');
const { dmyOfSheetCell } = require('../export/raw');

const IMPORT_PREFIX = 'import-';
const importOrderId = (day, dir, storeId) => `${IMPORT_PREFIX}${day}-${dir}-${storeId}`;
const money = (n) => Math.round(n * 100) / 100;

// Київський час 'ГГ:ХХ' дня day -> ISO з відступом (+03:00 влітку, +02:00 взимку)
function kyivIso(day, hhmm) {
  for (const off of ['+03:00', '+02:00']) {
    const iso = `${day}T${hhmm}:00${off}`;
    if (R.kyivNow(new Date(iso)).time.slice(0, 5) === hhmm) return iso;
  }
  return `${day}T${hhmm}:00+03:00`;
}

function productIndex(list) {
  const byBarcode = {}, byName = {};
  (list || []).forEach((p) => { if (p.barcode) byBarcode[String(p.barcode)] = p; byName[nameKey(p.name)] = p; });
  return (dir, r) => {
    const p = (r.barcode && byBarcode[String(r.barcode)]) || byName[nameKey(r.name)];
    if (p) return String(p.id);
    return dir === 'nbhz' ? nameKey(r.name) : dir === 'veg' ? String(r.name) : (r.barcode || nameKey(r.name));
  };
}

const sig = (lines) => JSON.stringify(lines.map((l) => [Number(l.line_no), String(l.barcode || ''), String(l.name), Number(l.qty), Number(l.price)]));

// input: { day, now, stores (rowToStore), products { dir: [...] }, existing: активні замовлення дня з бази [{ order_id, pk, dir, store_id, status, lines }],
//          rows: [{ dir, addr, time, barcode, name, price, qty }] (рядки листів за день, qty > 0) }
function planImport({ day, now, stores, products, existing, rows }) {
  const nowIso = now.toISOString();
  const out = { inserts: [], updates: [], cancels: [], skipped: [], unmatched: [] };
  const idx = {}, pid = {};
  const idxOf = (dir) => idx[dir] || (idx[dir] = storeIndex(dir, stores));
  const pidOf = (dir) => pid[dir] || (pid[dir] = productIndex(products[dir]));

  const groups = new Map();
  rows.forEach((r) => {
    const storeId = idxOf(r.dir).find(r.addr);
    if (!storeId) { if (!out.unmatched.some((u) => u.dir === r.dir && u.addr === r.addr)) out.unmatched.push({ dir: r.dir, addr: r.addr }); return; }
    const k = r.dir + '|' + storeId;
    if (!groups.has(k)) groups.set(k, { dir: r.dir, storeId, rows: [] });
    groups.get(k).rows.push(r);
  });

  const exBy = {};
  (existing || []).filter((o) => o.status === 'active').forEach((o) => { (exBy[o.dir + '|' + o.store_id] = exBy[o.dir + '|' + o.store_id] || []).push(o); });

  for (const [k, g] of groups) {
    const ex = exBy[k] || [];
    if (ex.some((o) => !String(o.order_id).startsWith(IMPORT_PREFIX))) { out.skipped.push({ dir: g.dir, storeId: g.storeId, reason: 'у базі вже є справжнє замовлення' }); continue; }
    const lines = g.rows.map((r, i) => ({ line_no: i + 1, product_id: pidOf(g.dir)(g.dir, r), barcode: String(r.barcode || ''), name: String(r.name), price: Number(r.price) || 0, qty: Number(r.qty) }));
    const total = money(lines.reduce((s, l) => s + l.price * l.qty, 0));
    const mine = ex.find((o) => o.order_id === importOrderId(day, g.dir, g.storeId));
    if (mine) {
      if (sig(mine.lines) === sig(lines)) out.skipped.push({ dir: g.dir, storeId: g.storeId, reason: 'без змін' });
      else out.updates.push({ pk: mine.pk, dir: g.dir, store_id: g.storeId, total, lines, changed_at: nowIso, exported_at: nowIso });
      continue;
    }
    const withTime = g.rows.map((r) => r.time).filter(Boolean).sort().pop();
    out.inserts.push({ order_id: importOrderId(day, g.dir, g.storeId), dir: g.dir, store_id: g.storeId, order_date: day, status: 'active', is_addon: false, total,
      created_at: withTime ? kyivIso(day, withTime) : nowIso, changed_at: nowIso, exported_at: nowIso, lines });
  }
  // імпортовані замовлення, рядків яких у листі вже нема (скасовані в Google), скасовуємо і в базі
  (existing || []).forEach((o) => {
    if (o.status !== 'active' || !String(o.order_id).startsWith(IMPORT_PREFIX)) return;
    if (!groups.has(o.dir + '|' + o.store_id)) out.cancels.push({ pk: o.pk, dir: o.dir, store_id: o.store_id, changed_at: nowIso, exported_at: nowIso });
  });
  return out;
}

// Рядки з сирого листа -> робочі {dir, addr, time, barcode, name, price, qty} за день (дата 'ДД.ММ.РРРР'), qty > 0
function rowsOfSheet(dir, sheetRows, dmy) {
  const c = COLS[dir];
  const F = { bread: [4, 3, 5], nbhz: [4, 3, 5], bakery: [5, 4, 6], veg: [3, -1, 4] }[dir];            // індекси колонок: назва, штрихкод, ціна
  const cell = (r, i) => (i < 0 || r[i] == null ? '' : String(r[i]));
  const out = [];
  for (let i = 1; i < sheetRows.length; i++) {
    const r = sheetRows[i];
    if (dmyOfSheetCell(r[0]) !== dmy) continue;
    const qty = Number(cell(r, c.qty).replace(',', '.')) || 0;
    if (!(qty > 0)) continue;
    out.push({ dir, addr: cell(r, c.addr).trim(), time: c.time >= 0 ? hmOf(r[c.time]) : '',
      barcode: cell(r, F[1]).replace(/^'/, '').trim(), name: cell(r, F[0]).trim(), price: Number(cell(r, F[2]).replace(',', '.')) || 0, qty });
  }
  return out;
}

async function loadExisting(sb, day) {
  const { data, error } = await sb.from('orders').select('id,order_id,dir,store_id,status,order_lines(line_no,barcode,name,qty,price)').eq('order_date', day).eq('status', 'active');
  if (error) throw new Error('orders: ' + error.message);
  return data.map(({ id, order_lines, ...o }) => ({ ...o, pk: id, lines: order_lines || [] }));
}

async function applyPlan(sb, plan) {
  const must = (label, { error }) => { if (error) throw new Error(`${label}: ${error.message}`); };
  const lineRows = (pk, lines) => lines.map((l) => ({ order_pk: pk, line_no: l.line_no, product_id: l.product_id, barcode: l.barcode, name: l.name, price: l.price, qty: l.qty }));
  for (const o of plan.inserts) {
    const { lines, ...row } = o;
    const { data, error } = await sb.from('orders').insert(row).select('id');
    if (error) throw new Error('orders.insert ' + o.order_id + ': ' + error.message);
    must('order_lines', await sb.from('order_lines').insert(lineRows(data[0].id, lines)));
  }
  for (const u of plan.updates) {
    must('order_lines.delete', await sb.from('order_lines').delete().eq('order_pk', u.pk));
    must('order_lines', await sb.from('order_lines').insert(lineRows(u.pk, u.lines)));
    must('orders.update', await sb.from('orders').update({ total: u.total, changed_at: u.changed_at, exported_at: u.exported_at }).eq('id', u.pk));
  }
  for (const c of plan.cancels) must('orders.cancel', await sb.from('orders').update({ status: 'cancelled', changed_at: c.changed_at, exported_at: c.exported_at }).eq('id', c.pk));
}

module.exports = { IMPORT_PREFIX, importOrderId, planImport, rowsOfSheet, loadExisting, applyPlan, kyivIso };
