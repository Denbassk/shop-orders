// Знімає з ОРИГІНАЛЬНОГО Apps Script-коду (vm) еталонні ключі для всіх точок бази -> test/fixtures/addr-keys.json
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv } = require('../src/env');
loadEnv();
const { loadStores } = require('../src/db');
const { loadOracle } = require('./gas-oracle');

(async () => {
  const gas = loadOracle();
  const stores = await loadStores();
  const dirs = ['bread', 'nbhz', 'bakery', 'veg'];
  const out = { stores: [], addresses: [] };
  const seen = new Set();
  for (const s of stores) {
    const rec = { store: s, canon: gas.canonKey_(s.address), status: {} };
    for (const d of dirs) {
      rec.status[d] = gas.statusKey_(d, s);
      for (const a of [s.address, s[gas.DIRECTIONS[d].addressAlias]]) {
        if (seen.has(a)) continue;
        seen.add(a);
        out.addresses.push({ address: a, short: gas.shortenAddress_(a), addrKey: gas.addrKey_(a), addrKeyShort: gas.addrKey_(gas.shortenAddress_(a)) });
      }
    }
    out.stores.push(rec);
  }
  const f = path.join(__dirname, '..', 'test', 'fixtures', 'addr-keys.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 1));
  console.log(`точок ${out.stores.length}, унікальних адрес ${out.addresses.length} -> ${path.relative(process.cwd(), f)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
