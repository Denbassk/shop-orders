#!/usr/bin/env node
// Наскрізна перевірка прийому замовлень на розгорнутому сервері. ТІЛЬКИ тестові точки (store_id 'test-e2e-…').
//   node scripts/e2e-submit.js a        відправка, повтор, паралельна пара, час submitOrder (дедлайни відкриті)
//   node scripts/e2e-submit.js b        після дедлайну ВК: відмова -> запит дозволу (ОДИН лист на SMTP_USER) -> /ok -> відправка
//   node scripts/e2e-submit.js cleanup  прибрати тестові точки, замовлення, запити дозволу
// URL сервера: --url (за замовчуванням https://shop-orders.fly.dev). LATE_SECRET береться з ~/.secrets/shop-orders-late-secret.txt.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadEnv } = require('../src/env');
loadEnv();
const { supabase } = require('../src/db');
const { createLate } = require('../src/late');
const { call } = require('./exec-client');

const args = process.argv.slice(2);
const phase = args[0];
const urlOpt = args.indexOf('--url');
const BASE = (urlOpt >= 0 ? args[urlOpt + 1] : 'https://shop-orders.fly.dev').replace(/\/+$/, '');
const API = BASE + '/api';
const sb = supabase();
const RUN = Date.now().toString(36);
const ids = { a: 'test-e2e-a', b: 'test-e2e-b', timing: [1, 2, 3, 4, 5].map((n) => `test-e2e-t${n}`) };
const ALL = [ids.a, ids.b, ...ids.timing];

const check = (label, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function setup() {
  const rows = ALL.map((id, i) => ({
    store_id: id, active: true, label: `ТЕСТ e2e ${id.slice(9)}`, address: `Тест ${id}`, addr_bread: `Тест ${id}`, addr_bakery: `Тест ${id}`,
    addr_veg: `Тест ${id}`, addr_nbhz: `Тест ${id}`, bread: true, bakery: true, nbhz: false, veg: false, sort: 9000 + i,
  }));
  const { error } = await sb.from('stores').upsert(rows, { onConflict: 'store_id' });
  if (error) throw new Error('stores: ' + error.message);
  await new Promise((r) => setTimeout(r, 31000));                 // кеш stores на сервері - 30 с
}

async function cleanup() {
  await sb.from('orders').delete().like('store_id', 'test-e2e-%');
  await sb.from('late_requests').delete().like('store_id', 'test-e2e-%');
  await sb.from('stores').delete().like('store_id', 'test-e2e-%');
  const left = {};
  for (const [t, col] of [['orders', 'store_id'], ['late_requests', 'store_id'], ['stores', 'store_id']]) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true }).like(col, 'test-e2e-%');
    left[t] = count;
  }
  console.log('після прибирання test-e2e у базі:', JSON.stringify(left));
}

async function productsOf(dir, storeId) {
  const r = (await call(API, 'products', { dir, storeId })).body;
  if (!r.ok) throw new Error(`products ${dir}: ${r.error}`);
  return r.data;
}

// набір позицій, що проходить мінімалку напрямку
function itemsFor(p) {
  const need = p.minOrder || 1;
  const it = p.products.find((x) => x.price > 0);
  return [{ id: it.id, qty: Math.max(1, Math.ceil(need / it.price)) }];
}

async function phaseA() {
  await setup();
  const boot = (await call(API, 'bootstrap', {})).body;
  check('bootstrap бачить тестові точки', boot.ok && boot.data.stores.some((s) => s.id === ids.a));

  const p = await productsOf('bread', ids.a);
  const items = itemsFor(p);
  const orderId = `e2e-${RUN}-1`;
  const first = await call(API, 'submitOrder', { dir: 'bread', storeId: ids.a, orderId, items });
  check('submitOrder: ok', first.body.ok === true, `positions=${first.body.data && first.body.data.positions} total=${first.body.data && first.body.data.total} ${first.ms} мс`);
  const keys = first.body.data ? Object.keys(first.body.data).sort().join(',') : '';
  check('поля відповіді', keys === 'date,direction,ok,positions,removed,replaced,store,test,time,total', keys);

  const again = await call(API, 'submitOrder', { dir: 'bread', storeId: ids.a, orderId, items });
  check('повтор order_id: duplicate:true і той самий результат', again.body.ok && again.body.data.duplicate === true && again.body.data.time === first.body.data.time && again.body.data.total === first.body.data.total, `${again.ms} мс`);

  const second = await call(API, 'submitOrder', { dir: 'bread', storeId: ids.a, orderId: `e2e-${RUN}-2`, items });
  check('інший order_id тієї ж точки: "вже сьогодні відправлено"', second.body.ok === false && /вже сьогодні відправлено/.test(second.body.error), second.body.error);

  const pb = await productsOf('bread', ids.b);
  const par = await Promise.all([
    call(API, 'submitOrder', { dir: 'bread', storeId: ids.b, orderId: `e2e-${RUN}-pa`, items: itemsFor(pb) }),
    call(API, 'submitOrder', { dir: 'bread', storeId: ids.b, orderId: `e2e-${RUN}-pb`, items: itemsFor(pb) }),
  ]);
  const okCount = par.filter((r) => r.body.ok).length;
  check('паралельна пара однієї точки: рівно один ok', okCount === 1, par.map((r) => r.body.ok ? 'ok' : r.body.error.slice(0, 40)).join(' | '));

  const ms = [];
  for (const id of ids.timing) {
    const pt = await productsOf('bread', id);
    const r = await call(API, 'submitOrder', { dir: 'bread', storeId: id, orderId: `e2e-${RUN}-${id}`, items: itemsFor(pt) });
    if (!r.body.ok) check(`таймінг ${id}`, false, r.body.error);
    ms.push(r.ms);
  }
  console.log(`час submitOrder (5 різних точок): ${ms.join(' / ')} мс, медіана ${median(ms)} мс`);

  const bad = await fetch(`${BASE}/ok?dir=bakery&st=${encodeURIComponent(ids.a)}&d=2026-10-19&s=badbadbadbadbadbadbadbad`);
  check('/ok з поганим підписом -> 403', bad.status === 403, String(bad.status));

  const { data: dbOrders } = await sb.from('orders').select('store_id,status,is_addon').like('store_id', 'test-e2e-%');
  const byStore = {};
  dbOrders.forEach((o) => { byStore[o.store_id] = (byStore[o.store_id] || 0) + 1; });
  check('у базі по одному замовленню на тестову точку', Object.values(byStore).every((n) => n === 1) && dbOrders.length === 7, JSON.stringify(byStore));
}

async function phaseB() {
  await setup();
  const dir = 'bakery';
  const secret = fs.readFileSync(path.join(os.homedir(), '.secrets', 'shop-orders-late-secret.txt'), 'utf8').trim();
  const late = createLate({ secret, baseUrl: BASE });
  const boot = (await call(API, 'bootstrap', {})).body;
  check('ВК закрито (13:00 минуло)', boot.data.directions[dir].closed === true, `closed=${boot.data.directions[dir].closed}`);

  const p = await productsOf(dir, ids.a);
  check('products: closed і locked, можна просити дозвіл', p.closed && p.locked && p.canRequestLate && p.lateRequest === 'none');
  const items = [{ id: p.products[0].id, qty: 1 }];

  const denied = await call(API, 'submitOrder', { dir, storeId: ids.a, orderId: `e2e-${RUN}-late0`, items });
  check('submitOrder після дедлайну без дозволу - відмова', denied.body.ok === false && /^Прийом на "Випічка і кулінарія" закрито \(до 13:00\)\. Натисніть "Попросити дозвіл"/.test(denied.body.error), denied.body.error);

  const rq = await call(API, 'requestLate', { dir, storeId: ids.a });
  check('requestLate: pending, лист іде у фоні', rq.body.ok && rq.body.data.status === 'pending' && rq.body.data.mailed === true, `${JSON.stringify(rq.body.data)} ${rq.ms} мс`);
  let lr = null;
  for (let i = 0; i < 20 && !(lr && lr.mailed_at); i++) { await new Promise((r) => setTimeout(r, 500)); lr = (await sb.from('late_requests').select('status,mailed_at,approved_at').eq('store_id', ids.a).eq('dir', dir).maybeSingle()).data; }
  check('late_requests.mailed_at поставлено після відправки листа', !!(lr && lr.mailed_at), JSON.stringify(lr));

  const p2 = await productsOf(dir, ids.a);
  check('products: lateRequest=pending', p2.lateRequest === 'pending');

  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
  const link = late.approveUrl(dir, ids.a, day);               // той самий URL, що сервер вклав у лист
  const form = await fetch(link);
  const formHtml = await form.text();
  const afterGet = (await sb.from('late_requests').select('status,approved_at').eq('store_id', ids.a).eq('dir', dir).maybeSingle()).data;
  check('GET /ok (посилання з листа) -> форма з кнопкою, дозвіл НЕ виданий', form.status === 200 && formHtml.includes('<form method="post"') && afterGet.status === 'pending' && !afterGet.approved_at, `${form.status} ${JSON.stringify(afterGet)}`);
  const u = new URL(link);
  const ok = await fetch(BASE + '/ok', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(u.searchParams) });
  const html = await ok.text();
  check('POST /ok -> 200 "Дозволено на 30 хв"', ok.status === 200 && html.includes('Дозволено на 30 хв'), String(ok.status));

  const p3 = await productsOf(dir, ids.a);
  check('products: approved, lateLeftMin 29-30, locked=false', p3.lateRequest === 'approved' && p3.lateLeftMin >= 29 && p3.lateLeftMin <= 30 && p3.locked === false, `left=${p3.lateLeftMin}`);

  const done = await call(API, 'submitOrder', { dir, storeId: ids.a, orderId: `e2e-${RUN}-late1`, items });
  check('submitOrder після дедлайну З дозволом - проходить', done.body.ok === true, `${JSON.stringify(done.body.data || done.body.error)} ${done.ms} мс`);

  const add = await call(API, 'submitOrder', { dir, storeId: ids.a, orderId: `e2e-${RUN}-late2`, items });
  check('друга відправка з дозволом - добавка (не "вже відправлено")', add.body.ok === true, JSON.stringify(add.body.error || ''));

  const rep = await call(API, 'submitOrder', { dir, storeId: ids.a, orderId: `e2e-${RUN}-late3`, mode: 'replace', items });
  check('replace з дозволом: replaced:true, removed = рядки двох попередніх', rep.body.ok && rep.body.data.replaced === true && rep.body.data.removed === 2, JSON.stringify(rep.body.data || rep.body.error));
}

(async () => {
  console.log(`сервер: ${BASE}, run=${RUN}`);
  if (phase === 'a') await phaseA();
  else if (phase === 'b') await phaseB();
  else if (phase === 'cleanup') await cleanup();
  else throw new Error('використання: e2e-submit.js a|b|cleanup');
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
