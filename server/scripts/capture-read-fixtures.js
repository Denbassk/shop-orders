#!/usr/bin/env node
// Знімає відповіді бойового /exec: bootstrap, refresh і products по напрямках -> test/fixtures/read-live.json
const fs = require('node:fs');
const path = require('node:path');
const { LIVE_EXEC, call } = require('./exec-client');

(async () => {
  const capturedAt = new Date().toISOString();
  const boot = (await call(LIVE_EXEC, 'bootstrap')).body;
  if (!boot.ok) throw new Error('bootstrap: ' + boot.error);
  const out = { capturedAt, bootstrap: boot, refresh: [], products: [] };

  for (const dir of Object.keys(boot.data.directions)) {
    const all = boot.data.stores.filter((s) => s.directions.includes(dir));
    const open = all.filter((s) => s.dayOk[dir]);
    const picks = [
      ...open.filter((s) => !s.ordered[dir]).slice(0, 2),
      ...open.filter((s) => s.ordered[dir]).slice(0, 1),
      ...all.filter((s) => !s.dayOk[dir]).slice(0, 1),
    ];
    for (const s of picks) {
      const payload = { dir, storeId: s.id };
      out.products.push({ payload, response: (await call(LIVE_EXEC, 'products', payload)).body });
      out.refresh.push({ payload, response: (await call(LIVE_EXEC, 'refresh', payload)).body });
    }
  }
  out.refresh.push({ payload: {}, response: (await call(LIVE_EXEC, 'refresh', {})).body });

  const f = path.join(__dirname, '..', 'test', 'fixtures', 'read-live.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 1));
  console.log(`bootstrap: ${boot.data.stores.length} точок; refresh ${out.refresh.length}; products ${out.products.length} (з помилкою: ${out.products.filter((p) => !p.response.ok).length}) -> ${path.relative(process.cwd(), f)}`);
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exit(1); });
