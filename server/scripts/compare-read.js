#!/usr/bin/env node
// Порівняння читання: той самий запит у бойовий /exec (Apps Script) і в наш сервер, diff по полях.
//   node scripts/compare-read.js --local            наш код у цьому процесі (реальна база); ordered береться з бойового bootstrap
//   node scripts/compare-read.js --url https://shop-orders.fly.dev    наш сервер по мережі
//   --all-products   products для всіх пар точка × напрямок (за замовчуванням: ≤4 точки на напрямок)
//   --bench N        після порівняння: медіана часу відповіді bootstrap і products (N запитів) у нашого сервера
//
// Поля, що залежать від таблиці orders (ordered, alreadyOrdered, locked, canRequestLate), у режимі --url
// порівнюються лише коли orders у базі наповнена (до import-today вона порожня) - вони рахуються окремо.
const { loadEnv } = require('../src/env');
loadEnv();
const { call, LIVE_EXEC } = require('./exec-client');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };

const ORDERS_FIELDS = new Set(['ordered', 'alreadyOrdered', 'locked', 'canRequestLate']);
const TIME_FIELDS = new Set(['version', 'today']);

function diff(a, b, path, out) {
  if (a === b) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff(a[k], b[k], path ? `${path}.${k}` : k, out);
    return;
  }
  out.push({ path, live: a, ours: b });
}

const lastKey = (p) => p.split('.').pop();
const isOrdersPath = (p) => p.split('.').some((k) => ORDERS_FIELDS.has(k)) || /(^|\.)ordered(\.|$)/.test(p);

function median(xs) { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

(async () => {
  let setOrdered = () => {};
  let server = null, base = opt('--url');
  const live = (action, payload) => call(LIVE_EXEC, action, payload);

  const liveBoot = (await live('bootstrap', {})).body;
  if (!liveBoot.ok) throw new Error('бойовий bootstrap: ' + liveBoot.error);

  if (!base) {
    const { createApp } = require('../src/app');
    const { createApi } = require('../src/api');
    const { createRuntime } = require('../src/runtime');
    const rt = createRuntime();
    // ordered у нашій базі порожнє (замовлення поки лише в сирих листах) - беремо з бойового bootstrap
    const data = rt.getEnv().data;
    // знімок оновлюємо з кожної живої відповіді refresh (див. setOrdered): за 15 хв прогону продавці встигають відправити
    let snapshot = {};
    setOrdered = (orderedByStore) => {
      snapshot = {};
      Object.entries(orderedByStore).forEach(([id, byDir]) => Object.entries(byDir).forEach(([d, v]) => { if (v) (snapshot[d] = snapshot[d] || new Set()).add(id); }));
    };
    setOrdered(Object.fromEntries(liveBoot.data.stores.map((s) => [s.id, s.ordered])));
    data.orderedToday = async () => snapshot;
    server = createApp({ api: createApi(rt.getEnv) }).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/api`;
    console.log('режим: локально, ordered з бойового bootstrap -> порівнюємо ВСІ поля');
  } else {
    base = base.replace(/\/+$/, '') + '/api';
    console.log(`режим: ${base}; поля від orders (ordered/alreadyOrdered/locked/canRequestLate) окремо`);
  }
  const ourCall = (action, payload) => call(base, action, payload);

  const tally = { requests: 0, equal: 0, diffs: [], ordersDiffs: [], timeDiffs: [], errorsEqual: 0 };
  function compare(label, a, b) {
    tally.requests++;
    const out = [];
    if (a.ok !== b.ok) out.push({ path: 'ok', live: a.ok, ours: b.ok });
    else if (!a.ok) { if (a.error !== b.error) out.push({ path: 'error', live: a.error, ours: b.error }); else tally.errorsEqual++; }
    else diff(a.data, b.data, 'data', out);
    const rest = [];
    for (const d of out) {
      const k = lastKey(d.path);
      if (TIME_FIELDS.has(k)) tally.timeDiffs.push({ label, ...d });
      else if (isOrdersPath(d.path)) tally.ordersDiffs.push({ label, ...d });
      else rest.push({ label, ...d });
    }
    if (!out.length) tally.equal++;
    tally.diffs.push(...rest);
  }

  // bootstrap
  const ourBoot = (await ourCall('bootstrap', {})).body;
  compare('bootstrap', liveBoot, ourBoot);
  console.log(`bootstrap: точок live ${liveBoot.data.stores.length}, наш ${ourBoot.ok ? ourBoot.data.stores.length : 'ПОМИЛКА ' + ourBoot.error}`);
  const refreshLive = (await live('refresh', {})).body;
  setOrdered(refreshLive.data.ordered);
  compare('refresh {}', refreshLive, (await ourCall('refresh', {})).body);

  // products (+ refresh пари)
  const pairs = [];
  for (const dir of Object.keys(liveBoot.data.directions)) {
    const all = liveBoot.data.stores.filter((s) => s.directions.includes(dir));
    if (opt('--all-products')) { all.forEach((s) => pairs.push([dir, s.id])); continue; }
    const open = all.filter((s) => s.dayOk[dir]);
    [...open.filter((s) => !s.ordered[dir]).slice(0, 2), ...open.filter((s) => s.ordered[dir]).slice(0, 1),
      ...all.filter((s) => !s.dayOk[dir]).slice(0, 1)].forEach((s) => pairs.push([dir, s.id]));
  }
  for (const [dir, storeId] of pairs) {
    const payload = { dir, storeId };
    const liveRefresh = (await live('refresh', payload)).body;            // свіжий стан orders у бойового
    setOrdered(liveRefresh.data.ordered);
    compare(`products ${dir}/${storeId}`, (await live('products', payload)).body, (await ourCall('products', payload)).body);
    compare(`refresh ${dir}/${storeId}`, liveRefresh, (await ourCall('refresh', payload)).body);
  }

  console.log(`\nзапитів порівняно: ${tally.requests}, повністю збіглось: ${tally.equal} (з них однакові помилки: ${tally.errorsEqual})`);
  console.log(`пар (напрямок × точка) для products/refresh: ${pairs.length}`);
  console.log(`розбіжностей у полях (без orders і часу): ${tally.diffs.length}`);
  tally.diffs.slice(0, 30).forEach((d) => console.log(`  ${d.label} ${d.path}: live=${JSON.stringify(d.live)} ours=${JSON.stringify(d.ours)}`));
  console.log(`розбіжностей version/today: ${tally.timeDiffs.length}`);
  tally.timeDiffs.slice(0, 5).forEach((d) => console.log(`  ${d.label} ${d.path}: live=${JSON.stringify(d.live)} ours=${JSON.stringify(d.ours)}`));
  console.log(`розбіжностей у полях від orders: ${tally.ordersDiffs.length}`);
  const unexpected = tally.ordersDiffs.filter((d) => !(d.live === true && d.ours === false));
  console.log(`  з них НЕ вигляду "live=true, ours=false" (тобто не просто порожня orders): ${unexpected.length}`);
  unexpected.slice(0, 10).forEach((d) => console.log(`  ${d.label} ${d.path}: live=${JSON.stringify(d.live)} ours=${JSON.stringify(d.ours)}`));
  tally.ordersDiffs.slice(0, 30).forEach((d) => console.log(`  ${d.label} ${d.path}: live=${JSON.stringify(d.live)} ours=${JSON.stringify(d.ours)}`));

  const n = +opt('--bench') || 0;
  if (n) {
    const [dir, storeId] = pairs.find(([d]) => d === 'bakery') || pairs[0];
    for (const [name, action, payload] of [['bootstrap', 'bootstrap', {}], [`products ${dir}`, 'products', { dir, storeId }]]) {
      const ms = [];
      for (let i = 0; i < n; i++) ms.push((await ourCall(action, payload)).ms);
      console.log(`час ${name}: ${ms.join(' / ')} мс, медіана ${median(ms)} мс`);
    }
  }
  if (server) server.close();
  process.exit(tally.diffs.length ? 1 : 0);
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exit(1); });
