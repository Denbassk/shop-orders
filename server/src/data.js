// Джерело даних для /api: Supabase (service_role). Невеликі кеші процесу - як CacheService в Apps Script.
const { rowToStore } = require('./db');
const { DIRECTIONS } = require('./directions');
const R = require('./rules');

function memo(fn, ttlMs, now) {
  let v, at = -Infinity, inflight = null;
  return async () => {
    if (now() - at < ttlMs) return v;
    if (!inflight) {
      inflight = fn().then((r) => { v = r; at = now(); return r; }).finally(() => { inflight = null; });
    }
    return inflight;
  };
}

function createData(sb, { now = Date.now } = {}) {
  const must = (label, { data, error }) => {
    if (error) throw new Error(`${label}: ${error.message}`);
    return data;
  };

  const stores = memo(async () => {
    const rows = must('stores', await sb.from('stores').select('*').eq('active', true).order('sort'));
    return rows.map(rowToStore);
  }, 30000, now);

  const settings = memo(async () => {
    const rows = must('settings', await sb.from('settings').select('key,value'));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }, 10000, now);

  const directions = memo(async () => {
    const rows = must('directions', await sb.from('directions').select('dir,cfg'));
    const byDir = Object.fromEntries(rows.map((r) => [r.dir, r.cfg]));
    const out = {};
    Object.keys(DIRECTIONS).concat(Object.keys(byDir)).forEach((k) => { if (byDir[k]) out[k] = byDir[k]; });   // порядок: bread, nbhz, bakery, veg
    return out;
  }, 30000, now);

  const productsMemo = {};
  const products = (dir) => {
    if (!productsMemo[dir]) {
      productsMemo[dir] = memo(async () => must('products', await sb.from('products').select('*').eq('dir', dir)), 30000, now);
    }
    return productsMemo[dir]();
  };

  // активні замовлення за день -> { dir: Set(store_id) }
  async function orderedToday(day) {
    const rows = must('orders', await sb.from('orders').select('dir,store_id').eq('order_date', day).eq('status', 'active'));
    const out = {};
    rows.forEach((r) => { (out[r.dir] = out[r.dir] || new Set()).add(r.store_id); });
    return out;
  }

  // запити дозволу по парі; req_date >= вчора - дозвіл може перейти через північ
  async function lateRows(dir, storeId) {
    const d = new Date(now() - 86400000);
    const since = R.kyivNow(d).day;
    return must('late_requests', await sb.from('late_requests').select('dir,store_id,requested_at,approved_at')
      .eq('dir', dir).eq('store_id', storeId).gte('req_date', since));
  }

  // вдало прочитані ціни овочей -> products.price (лише name+price: інші колонки не чіпаємо)
  async function saveVegPrices(changes) {
    must('products.price', await sb.from('products').upsert(
      changes.map((c) => ({ dir: 'veg', id: c.id, name: c.name, price: c.price })), { onConflict: 'dir,id' }));
  }

  // збережена відповідь на order_id (повтор після обриву зв'язку)
  async function orderResult(orderId) {
    const rows = must('orders', await sb.from('orders').select('result').eq('order_id', orderId).limit(1));
    return rows.length ? rows[0].result : null;
  }

  // чи є активне замовлення точки по напрямку за день (основне або добавка)
  async function hasOrderToday(dir, storeId, day) {
    const { count, error } = await sb.from('orders').select('id', { count: 'exact', head: true })
      .eq('dir', dir).eq('store_id', storeId).eq('order_date', day).eq('status', 'active');
    if (error) throw new Error('orders: ' + error.message);
    return count > 0;
  }

  // атомарний запис замовлення - supabase/migrations/…_orders_tx.sql
  async function submitOrderTx(p) {
    return must('submit_order_tx', await sb.rpc('submit_order_tx', { p }));
  }

  // запит дозволу: pending; approved_at не чіпаємо (upsert оновлює лише передані колонки)
  async function requestLate(dir, storeId, day, at) {
    must('late_requests', await sb.from('late_requests').upsert(
      { dir, store_id: storeId, req_date: day, status: 'pending', requested_at: at.toISOString() }, { onConflict: 'dir,store_id,req_date' }));
  }

  // дозвіл закупниці: approved_at = зараз (requested_at лишається, або ставиться за замовчуванням, якщо запиту не було)
  async function approveLate(dir, storeId, day, at) {
    must('late_requests', await sb.from('late_requests').upsert(
      { dir, store_id: storeId, req_date: day, status: 'approved', approved_at: at.toISOString() }, { onConflict: 'dir,store_id,req_date' }));
  }

  // лист про дозвіл надіслано (ставиться лише після успіху SMTP)
  async function markLateMailed(dir, storeId, day, at) {
    must('late_requests', await sb.from('late_requests').update({ mailed_at: at.toISOString() })
      .eq('dir', dir).eq('store_id', storeId).eq('req_date', day));
  }

  // pending-запити дозволу за день без листа, подані раніше за olderThan (щоб не наздоганяти фонову відправку)
  async function unmailedLate(day, olderThan, notBefore) {
    return must('late_requests', await sb.from('late_requests').select('dir,store_id,req_date,requested_at')
      .eq('req_date', day).eq('status', 'pending').is('mailed_at', null)
      .lt('requested_at', olderThan.toISOString()).gt('requested_at', notBefore.toISOString()));
  }

  // --- вигрузка в сирі листи (export/raw.js) ---
  const isDirty = (o) => !o.exported_at || Date.parse(o.exported_at) < Date.parse(o.changed_at);

  // Замовлення напрямку, що чекають вигрузки, разом з УСІМА замовленнями їхніх груп (точка, день) і рядками;
  // stores - усі точки (також вимкнені: замовлення від них уже є в базі).
  // exported_at < changed_at у PostgREST не порівняти, тому беремо невигружені + останні 3 дні і рахуємо тут.
  async function exportSnapshot(dir) {
    const since = R.kyivNow(new Date(now() - 3 * 86400000)).day;
    const sel = 'id,order_id,dir,store_id,order_date,status,is_addon,created_at,changed_at,exported_at,order_lines(line_no,barcode,name,price,qty)';
    const [recent, allStores] = await Promise.all([
      sb.from('orders').select(sel).eq('dir', dir).or(`exported_at.is.null,order_date.gte.${since}`),
      sb.from('stores').select('*'),
    ]).then(([a, b]) => [must('orders', a), must('stores', b)]);
    const dirty = recent.filter(isDirty);
    let orders = [];
    if (dirty.length) {
      const pairs = new Set(dirty.map((o) => o.store_id + '|' + o.order_date));
      const storeIds = [...new Set(dirty.map((o) => o.store_id))];
      const days = [...new Set(dirty.map((o) => o.order_date))];
      const all = must('orders', await sb.from('orders').select(sel).eq('dir', dir).in('store_id', storeIds).in('order_date', days));
      orders = all.filter((o) => pairs.has(o.store_id + '|' + o.order_date))
        .map(({ order_lines, ...o }) => ({ ...o, lines: order_lines || [] }));
    }
    return { orders, stores: orders.length ? allStores.map(rowToStore) : [] };
  }

  // exported_at = changed_at вигруженої версії: зміна після читання лишає замовлення невигруженим
  async function markExported(items) {
    await Promise.all(items.map(async (it) => {
      must('orders.exported_at', await sb.from('orders').update({ exported_at: it.exported_at }).eq('id', it.id));
    }));
  }

  return { stores, settings, directions, products, orderedToday, lateRows, saveVegPrices,
    orderResult, hasOrderToday, submitOrderTx, requestLate, approveLate, markLateMailed, unmailedLate,
    exportSnapshot, markExported };
}

module.exports = { createData };
