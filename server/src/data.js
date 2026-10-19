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

  return { stores, settings, directions, products, orderedToday, lateRows, saveVegPrices };
}

module.exports = { createData };
