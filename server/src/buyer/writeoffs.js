// Списання ВК для сторінки закупниці (/buyer/bakery): ЛИШЕ читання таблиць списань юросіб.
// Пише туди app/WriteOff.gs; ID таблиць беремо з листа-змісту «Списания» таблиці ВК (або WO_BOOKS у .env).
const { DIRECTIONS } = require('../directions');
const WO_SHEET = 'Списания', WO_ARCH = 'Архив', INDEX = 'Списания';
const C = { id: 0, at: 1, date: 2, store: 3, code: 4, cat: 5, name: 7, qty: 8, price: 9, sum: 10, sum20: 11, seller: 12 };
const ID_RE = /spreadsheets\/d\/([A-Za-z0-9_-]{25,})/g;
const TTL = 5 * 60 * 1000;
const cache = new Map();
const pad = (n) => ('0' + n).slice(-2);
const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const fromSerial = (v) => new Date(Math.round((v - 25569) * 864e5));
function dayOf(v) {
  if (typeof v === 'number') { const d = fromSerial(v); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  const m = String(v || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? m[3] + '-' + pad(m[2]) + '-' + pad(m[1]) : '';
}
function timeOf(v) {
  if (typeof v === 'number') { const d = fromSerial(v); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  const m = String(v || '').match(/(\d{1,2}):(\d{2})/);
  return m ? pad(m[1]) + ':' + m[2] : '';
}
const numOf = (v) => (typeof v === 'number' ? v : (parseFloat(String(v || '').replace(/[\s\u00a0]/g, '').replace(',', '.')) || 0));
function kyivDay(at, back = 0) {
  const d = new Date(new Date(at).toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
  d.setDate(d.getDate() - back);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function bookIds(cells, own) {
  const s = new Set();
  (cells || []).forEach((r) => (r || []).forEach((v) => {
    ID_RE.lastIndex = 0; let m;
    while ((m = ID_RE.exec(String(v)))) if (m[1] !== own) s.add(m[1]);
  }));
  return [...s];
}
function entityOf(title) { const t = String(title || ''); const m = t.match(/·\s*(.+)$/); return (m ? m[1] : t).trim() || 'Юрособа'; }
function parseRows(values, entity) {
  return (values || []).filter((r) => r && r[C.id]).map((r) => ({
    id: String(r[C.id]), day: dayOf(r[C.date]), at: dayOf(r[C.at]), time: timeOf(r[C.at]),
    store: String(r[C.store] || '').trim(), code: String(r[C.code] || '').trim(),
    cat: String(r[C.cat] || '').trim() || 'Інше', name: String(r[C.name] || '').trim(),
    qty: numOf(r[C.qty]), price: numOf(r[C.price]), sum: numOf(r[C.sum]), sum20: numOf(r[C.sum20]),
    seller: String(r[C.seller] || '').replace(/\s+/g, ' ').trim() || '-', entity }));
}
function aggregate(rows, { from = '', to = '', entity = '', cat = '', today = '' } = {}) {
  const all = rows.filter((x) => x.day && (!from || x.day >= from) && (!to || x.day <= to));
  const entities = [...new Set(all.map((x) => x.entity))].sort();
  const cats = [...new Set(all.map((x) => x.cat))].sort((a, b) => a.localeCompare(b, 'uk'));
  const f = all.filter((x) => (!entity || x.entity === entity) && (!cat || x.cat === cat));
  const grp = (key, n = 15) => {
    const m = new Map();
    f.forEach((x) => { const k = key(x); const a = m.get(k) || { name: k, sum: 0, sum20: 0, qty: 0, docs: new Set() };
      a.sum += x.sum; a.sum20 += x.sum20; a.qty += x.qty; a.docs.add(x.id); m.set(k, a); });
    return [...m.values()].map((a) => ({ name: a.name, sum: r2(a.sum), sum20: r2(a.sum20), qty: r3(a.qty), docs: a.docs.size }))
      .sort((a, b) => b.sum - a.sum).slice(0, n);
  };
  const tot = f.reduce((a, x) => { a.sum += x.sum; a.sum20 += x.sum20; a.qty += x.qty; return a; }, { sum: 0, sum20: 0, qty: 0 });
  const docs = new Map();
  f.forEach((x) => { const d = docs.get(x.id) || { id: x.id, day: x.day, at: x.at, time: x.time, store: x.store, seller: x.seller, entity: x.entity, qty: 0, sum: 0, items: 0 };
    d.qty += x.qty; d.sum += x.sum; d.items++; docs.set(x.id, d); });
  const recent = [...docs.values()].sort((a, b) => (b.at + b.time).localeCompare(a.at + a.time)).slice(0, 30)
    .map((d) => ({ ...d, qty: r3(d.qty), sum: r2(d.sum) }));
  const todayStores = new Set(rows.filter((x) => x.day === today && (!entity || x.entity === entity)).map((x) => x.store)).size;
  return { entities, cats,
    total: { sum: r2(tot.sum), sum20: r2(tot.sum20), qty: r3(tot.qty), docs: docs.size, stores: new Set(f.map((x) => x.store)).size },
    stores: grp((x) => x.store + (x.code ? ' · №' + x.code : '')), products: grp((x) => x.name),
    sellers: grp((x) => x.seller + ' · ' + x.store), byCat: grp((x) => x.cat, 20), byEntity: grp((x) => x.entity, 10),
    days: grp((x) => x.day, 400).sort((a, b) => a.name.localeCompare(b.name)), recent, todayStores };
}
const hint = (m, sa) => (/permission|403|not have/i.test(m) ? 'немає доступу' + (sa ? ' - відкрийте таблицю для ' + sa + ' (лише перегляд)' : '') : m);
async function books(google, fresh) {
  const c = cache.get('books');
  if (c && !fresh && Date.now() - c.t < 30 * 60e3) return c.v;
  const own = DIRECTIONS.bakery.spreadsheetId, REQ = { timeout: google.TIMEOUT_MS, retry: false };
  let ids = String(process.env.WO_BOOKS || '').split(/[\s,;]+/).filter(Boolean);
  if (!ids.length) {
    const res = await google.sheetsClient().spreadsheets.values.get({ spreadsheetId: own, range: google.a1q(INDEX, 'A1:J60'), valueRenderOption: 'FORMULA' }, REQ);
    ids = bookIds(res.data.values, own);
    if (!ids.length) ids = bookIds(await google.getValues(own, google.a1q(INDEX, 'A1:J60'), { formatted: true }), own);
  }
  if (!ids.length) throw new Error('У листі «Списания» таблиці ВК не знайдено посилань на таблиці списань. Додайте у .env WO_BOOKS=ID1,ID2 і перезапустіть сервер.');
  const out = [];
  for (const id of ids) {
    try { const r = await google.sheetsClient().spreadsheets.get({ spreadsheetId: id, fields: 'properties.title' }, REQ); out.push({ id, entity: entityOf(r.data.properties.title) }); }
    catch (e) { out.push({ id, error: e.message }); }
  }
  cache.set('books', { t: Date.now(), v: out });
  return out;
}
async function loadRows(google, arch, fresh) {
  const key = arch ? 'rows-a' : 'rows', c = cache.get(key);
  if (c && !fresh && Date.now() - c.t < TTL) return c.v;
  const bs = await books(google, fresh), list = [], errors = [];
  let sa = ''; try { sa = google.loadCredentials().client_email || ''; } catch (e) { /* без пошти */ }
  for (const b of bs) {
    if (b.error) { errors.push(b.id.slice(0, 8) + '…: ' + hint(b.error, sa)); continue; }
    for (const nm of arch ? [WO_SHEET, WO_ARCH] : [WO_SHEET]) {
      try { list.push(...parseRows(await google.getValues(b.id, google.a1q(nm, 'A2:N')), b.entity)); }
      catch (e) { if (nm === WO_SHEET) errors.push(b.entity + ': ' + hint(e.message, sa)); }
    }
  }
  const v = { list, meta: { books: bs.filter((b) => !b.error).map((b) => b.entity), errors } };
  cache.set(key, { t: Date.now(), v });
  return v;
}
async function stats(dir, p = {}, deps = {}) {
  if (dir !== 'bakery') throw new Error('Списання є лише у випічки і кулінарії');
  const google = deps.google || require('../google'), at = deps.at || new Date();
  const days = [1, 7, 31, 90].includes(+p.days) ? +p.days : 7;
  const r = await loadRows(google, days > 31, !!p.fresh);
  const today = kyivDay(at), from = kyivDay(at, days - 1);
  return { days, from, to: today, at: new Date(at).toISOString(), ...r.meta,
    ...aggregate(r.list, { from, to: today, entity: String(p.entity || ''), cat: String(p.cat || ''), today }) };
}
module.exports = { stats, loadRows, aggregate, parseRows, bookIds, entityOf, dayOf, _reset: () => cache.clear() };