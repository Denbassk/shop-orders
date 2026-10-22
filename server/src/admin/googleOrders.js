// Хто вже замовив сьогодні за СИРИМИ ЛИСТАМИ Google. До переключення (Task 11) замовлення пише Apps Script, у базі їх нема, тому
// «Сегодня» пульта без цього показувало б нулі. Лише читання (values.get), кеш 60 с, збій Google пульт не ламає.
// Після переключення замовлення в базі, а лист - вигрузка тієї самої бази: об'єднання «база або лист» нічого не рахує двічі.
const R = require('../rules');
const { dmyOfSheetCell } = require('../export/raw');
const { fuzzyKey } = require('../reports/nbhz');

// 0-based колонки сирого листа: адреса, кількість, час (-1 - часу нема)
const COLS = { bread: { addr: 2, qty: 6, time: -1 }, nbhz: { addr: 2, qty: 6, time: -1 }, bakery: { addr: 2, qty: 7, time: 1 }, veg: { addr: 2, qty: 5, time: 1 } };
const ADDR_FIELD = { bread: 'addrBread', bakery: 'addrBakery', veg: 'addrVeg', nbhz: 'addrNbhz' };
const pad = (n) => String(n).padStart(2, '0');

function hmOf(v) {
  if (typeof v === 'number') { const m = Math.round((v - Math.floor(v)) * 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  const m = String(v == null ? '' : v).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? pad(+m[1]) + ':' + m[2] : '';
}

// ключ адреси -> точка напрямку (адреса напрямку повна і коротка, для НБХЗ ще й «нечіткий» ключ рос/укр написання)
function storeIndex(dir, stores) {
  const exact = {}, fuzzy = {};
  stores.forEach((s) => {
    if (s.directions.indexOf(dir) < 0) return;
    const a = s[ADDR_FIELD[dir]] || (dir === 'nbhz' ? s.address : '');
    if (!a) return;
    exact[R.addrKey(a)] = s.id;
    exact[R.addrKey(R.shortenAddress(a))] = s.id;
    if (dir === 'nbhz') fuzzy[fuzzyKey(R.shortenAddress(a))] = s.id;
  });
  return { find: (addr) => exact[R.addrKey(addr)] || (dir === 'nbhz' ? fuzzy[fuzzyKey(addr)] : undefined) };
}

// opts: { directions: {dir: {rawSheet, spreadsheetId}}, getValues(spreadsheetId, a1) -> рядки (сирі значення), a1q, now, ttlMs }
function createGoogleOrders({ directions, getValues, a1q, now = Date.now, ttlMs = 60000 }) {
  const cache = {};

  async function readDir(dir, dmy, stores) {
    const cfg = directions[dir];
    const rows = await getValues(cfg.spreadsheetId, a1q(cfg.rawSheet, 'A:H'));
    const c = COLS[dir], idx = storeIndex(dir, stores), map = new Map(), unmatched = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (dmyOfSheetCell(r[0]) !== dmy) continue;
      const qty = Number(String(r[c.qty] == null ? '' : r[c.qty]).replace(',', '.')) || 0;
      if (!(qty > 0)) continue;
      const addr = String(r[c.addr] == null ? '' : r[c.addr]).trim();
      const id = idx.find(addr);
      if (!id) { if (addr && unmatched.indexOf(addr) < 0) unmatched.push(addr); continue; }
      const a = map.get(id) || { n: 0, qty: 0, time: '' };
      a.n++; a.qty = Math.round((a.qty + qty) * 1000) / 1000;
      if (c.time >= 0) a.time = hmOf(r[c.time]) || a.time;
      map.set(id, a);
    }
    return { map, unmatched };
  }

  // day 'РРРР-ММ-ДД'; stores - точки (rowToStore). -> { bread: Map(id -> {n, qty, time}), ..., unmatched: {dir: [адреси]}, error? }
  async function byDir(day, stores) {
    const hit = cache[day];
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const dmy = day.slice(8, 10) + '.' + day.slice(5, 7) + '.' + day.slice(0, 4);
    const out = { unmatched: {} }, errors = [];
    await Promise.all(Object.keys(COLS).filter((d) => directions[d]).map(async (dir) => {
      try { const r = await readDir(dir, dmy, stores); out[dir] = r.map; out.unmatched[dir] = r.unmatched; }
      catch (e) { out[dir] = new Map(); out.unmatched[dir] = []; errors.push(dir + ': ' + e.message); console.error('замовлення з листа Google (' + dir + '): ' + e.message); }
    }));
    if (errors.length) out.error = errors.join('; ');
    cache[day] = { at: now(), value: out };
    return out;
  }

  return { byDir };
}

module.exports = { createGoogleOrders, hmOf };
