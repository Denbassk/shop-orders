// Стрес: N разів паралельний повтор того самого order_id (тестові точки test-…, після прогону прибираємо).
// node scripts/stress-same-order.js [N=200] [паралельних=2]
const { randomUUID } = require('node:crypto');
const { loadEnv } = require('../src/env');
loadEnv();
const { apiSubmitOrder } = require('../src/api/submit');
const { DIRECTIONS } = require('../src/directions');

const N = Number(process.argv[2] || 200), K = Number(process.argv[3] || 2);
const AT = new Date('2026-10-19T10:00:00+03:00');
const RUN = randomUUID().slice(0, 8);
const sb = require('../src/db').supabase();
const realData = require('../src/data').createData(sb);
const prod = (id, name, price) => ({ dir: 'bread', id, barcode: id, name, price, category: null, availability: null, box: null, status: 'active', sort: 0 });
const trace = [];
const items = [{ id: '111', qty: 3 }, { id: '222', qty: 2 }];

function env(storeId) {
  return {
    at: AT, queueExport: () => {}, veg: { resolve: async (r) => r },
    data: {
      stores: async () => [{ id: storeId, label: 'Тест БД', code: '', edrpou: '', days: { veg: [], bakery: [] }, directions: ['bread'] }],
      settings: async () => ({ test_mode: true }),
      directions: async () => DIRECTIONS,
      products: async () => [prod('111', 'Батон', 100), prod('222', 'Багет', 150)],
      lateRows: async () => [],
      hasOrderToday: async (...a) => { const r = await realData.hasOrderToday(...a); if (r) trace.push('hasOrderToday=true'); return r; },
      orderResult: realData.orderResult,
      submitOrderTx: async (p) => { const r = await realData.submitOrderTx(p); if (!r.ok) trace.push('tx=' + JSON.stringify(r)); return r; },
    },
  };
}

(async () => {
  const fails = {};
  let good = 0;
  for (let i = 0; i < N; i++) {
    const s = `test-db-${RUN}-${i}`, oid = `${RUN}-same-${i}`;
    trace.length = 0;
    const res = await Promise.allSettled(Array.from({ length: K }, () => apiSubmitOrder({ dir: 'bread', storeId: s, orderId: oid, items }, env(s))));
    const { count } = await sb.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', s);
    const bad = res.filter((x) => x.status === 'rejected').map((x) => x.reason.message);
    if (!bad.length && count === 1) good++;
    else { const k = bad.join(' | ') + ' [orders=' + count + '] trace=' + trace.splice(0).join(','); fails[k] = (fails[k] || 0) + 1; }
  }
  await sb.from('orders').delete().like('store_id', `test-db-${RUN}-%`);
  console.log(`N=${N} K=${K}: зелених ${good}/${N}`);
  Object.entries(fails).forEach(([k, v]) => console.log(v + '×', k));
  process.exit(good === N ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
