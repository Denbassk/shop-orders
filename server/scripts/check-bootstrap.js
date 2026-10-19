#!/usr/bin/env node
// Звірка точок з бази з бойовим bootstrap (Apps Script /exec): склад, порядок, напрямки, dayOk/dayOff.
// Нічого не пише. Використання: node scripts/check-bootstrap.js [url]
const { loadEnv } = require('../src/env');
loadEnv();
const { loadStores, supabase } = require('../src/db');
const R = require('../src/rules');

const URL_EXEC = process.argv[2] || 'https://script.google.com/macros/s/AKfycbzGY4--nMFFW5Fb-rsBbTqHX5718u0yC5FEKzo7TKXaqkZ4gHlwwWTbYjD4eFRXcJ5Z/exec';

(async () => {
  const at = new Date();
  const res = await fetch(URL_EXEC, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'bootstrap', payload: {} }), redirect: 'follow', signal: AbortSignal.timeout(90000) });
  const live = (await res.json());
  if (!live.ok) throw new Error('bootstrap: ' + live.error);

  const { data: srows } = await supabase().from('settings').select('*');
  const settings = Object.fromEntries(srows.map((r) => [r.key, r.value]));
  const ctx = { at, settings, lateRows: [] };
  const stores = await loadStores();

  const diffs = [];
  const mine = new Map(stores.map((s) => [s.id, s]));
  live.data.stores.forEach((l, i) => {
    const s = mine.get(l.id);
    if (!s) return diffs.push(`нема в базі: ${l.id}`);
    if (stores[i] && stores[i].id !== l.id) diffs.push(`порядок: позиція ${i} - live ${l.id}, база ${stores[i].id}`);
    if (l.label !== s.label) diffs.push(`label ${l.id}: "${l.label}" / "${s.label}"`);
    if (l.code !== s.code) diffs.push(`code ${l.id}: "${l.code}" / "${s.code}"`);
    const dirs = s.directions.filter((d) => R.dirEnabled(d, settings));
    if (JSON.stringify(l.directions) !== JSON.stringify(dirs)) diffs.push(`напрямки ${l.id}: ${l.directions} / ${dirs}`);
    dirs.forEach((d) => {
      const ok = R.dayAllowed(d, s, ctx);
      if (l.dayOk[d] !== ok) diffs.push(`dayOk ${l.id}/${d}: live ${l.dayOk[d]}, правила ${ok}`);
      const off = ok ? undefined : R.dayOffText(d, s);
      if (l.dayOff[d] !== off) diffs.push(`dayOff ${l.id}/${d}: "${l.dayOff[d]}" / "${off}"`);
    });
  });
  stores.forEach((s) => { if (!live.data.stores.some((l) => l.id === s.id)) diffs.push(`зайва в базі: ${s.id}`); });

  const day = R.kyivNow(at);
  const pairs = live.data.stores.reduce((n, l) => n + l.directions.length, 0);
  const closed = live.data.stores.reduce((n, l) => n + Object.values(l.dayOk).filter((v) => !v).length, 0);
  console.log(`Київ ${day.dmy} ${day.time}, день тижня ${day.dow}`);
  console.log(`live: точок ${live.data.stores.length}, база: ${stores.length}`);
  console.log(`пар (точка × напрямок): ${pairs}, з них закрито за днем: ${closed}`);
  console.log(`напрямки в live: ${JSON.stringify(Object.keys(live.data.directions))}`);
  console.log(`розбіжностей: ${diffs.length}`);
  diffs.slice(0, 40).forEach((d) => console.log('  ' + d));
  process.exit(diffs.length ? 1 : 0);
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exit(1); });
