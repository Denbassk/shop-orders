// Активні замовлення напрямку за день (з рядками order_lines) -> робочі рядки звіту, у форматі сирого рядка вигрузки (export/raw.js).
// Ті самі поля, що йдуть у сирий лист (rowOfOrder там), але без апострофа перед штрихкодом: звіт читає значення комірки, а не те, що набрано.
//   orders: [{ store_id, order_date, created_at, lines: [{ line_no, barcode, name, price, qty }] }]
//   stores: УСІ точки (замовлення від уже вимкненої точки теж у звіті).
const R = require('../rules');
const { DIRECTIONS } = require('../directions');
const { rawRowOf } = require('../export/raw');
const bakery = require('./bakery');
const bread = require('./bread');
const veg = require('./veg');
const nbhz = require('./nbhz');

const NORMALIZE = {
  bakery: bakery.normalizeRawRows,
  bread: bread.normalizeRawRows,
  veg: veg.normalizeRawRows,
  nbhz: nbhz.normalizeRawRows,
};

function rowsFromOrders(dir, orders, stores, day) {
  const cfg = DIRECTIONS[dir];
  const storeBy = Object.fromEntries(stores.map((s) => [s.id, s]));
  const dmy = day.slice(8, 10) + '.' + day.slice(5, 7) + '.' + day.slice(0, 4);
  const out = [];
  orders.slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).forEach((o) => {
    const store = storeBy[o.store_id];
    if (!store) { console.error(`звіт ${dir}: точки ${o.store_id} нема в stores - замовлення пропущено`); return; }
    const address = store[cfg.addressAlias] || '';
    const ctx = {
      dateStr: dmy,
      timeStr: R.kyivNow(new Date(o.created_at)).time,
      address,
      shortAddress: R.shortenAddress(address),
      route: store[cfg.routeAlias || 'route'] || store.route || '',
      store,
    };
    o.lines.slice().sort((a, b) => a.line_no - b.line_no).forEach((l) => {
      out.push(rawRowOf(dir, ctx, { barcode: l.barcode || '', name: l.name, price: Number(l.price), qty: Number(l.qty) }));
    });
  });
  return NORMALIZE[dir](out, dmy);
}

module.exports = { rowsFromOrders };
