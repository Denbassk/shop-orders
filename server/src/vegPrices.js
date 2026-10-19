// Ціни овочей на льоту з дзеркала прайсу постачальника (правила readVegPriceSheet_).
//   1) кеш процесу ttlMs (10 хв); 2) Google не відповів за timeoutMs або віддав порожній прайс -
//   ціни з products.price (вдале читання щоразу їх оновлює); 3) негативний кеш failTtlMs, щоб при
//   збої Google продавці не чекали таймаут на кожному запиті.
// Овоч без ціни продавцю не віддається.
const { readVegPrices, nameKey } = require('./import/parse');

function withTimeout(promise, ms) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('тайм-аут ' + ms + ' мс')), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

const cents = (n) => Math.round(n * 100);

function createVegPrices({ readPriceSheet, savePrices, now = Date.now, ttlMs = 600000, timeoutMs = 10000, failTtlMs = 60000, log = console.error }) {
  let cache = null;          // { map, at }
  let failedAt = null;
  let inflight = null;
  const saved = new Map();   // id -> остання ціна (в копійках), яку вже записали в базу

  async function load() {
    try {
      const map = readVegPrices(await withTimeout(readPriceSheet(), timeoutMs));
      if (!Object.keys(map).length) throw new Error('у прайсі не знайдено жодної позиції');
      cache = { map, at: now() };
      failedAt = null;
      return map;
    } catch (e) {
      failedAt = now();
      log('ціни овочей: беремо з бази (' + e.message + ')');
      return null;
    }
  }

  async function prices() {
    if (cache && now() - cache.at < ttlMs) return cache.map;
    if (failedAt != null && now() - failedAt < failTtlMs) return null;
    if (!inflight) inflight = load().finally(() => { inflight = null; });
    return inflight;
  }

  // rows - активні овочі з products; повертає ті, що мають ціну, вже з актуальною ціною
  async function resolve(rows) {
    const map = await prices();
    if (!map) return rows.filter((r) => Number(r.price) > 0);

    const out = [], changes = [];
    for (const r of rows) {
      const p = map[nameKey(r.name)];
      if (!(p > 0)) continue;
      out.push({ ...r, price: p });
      if (cents(p) !== cents(Number(r.price)) && saved.get(r.id) !== cents(p)) {
        changes.push({ id: r.id, name: r.name, price: p });
      }
    }
    if (changes.length) {
      try { await savePrices(changes); changes.forEach((c) => saved.set(c.id, cents(c.price))); }
      catch (e) { log('ціни овочей: не записали в базу (' + e.message + ')'); }
    }
    return out;
  }

  return { resolve };
}

module.exports = { createVegPrices };
