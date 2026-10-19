// Звіти ВК: «Заказы ВК», «Сводная ВК», «Маршрути ВК». Перенос app/BakeryReport.gs (buildBakeryReports,
// buildBakeryOrdersSheet_, buildBakerySummarySheet_, bakeryTodayRows_, bakeryCats_) і app/BakeryZones.gs
// (buildBakeryRouteSheet_, bakeryStoreByRawAddr_, bakeryCatOf_, bakeryZoneList_) - тексти, порядок, формати дослівно.
//
// Відмінності від Apps Script (джерела даних, не логіка):
//   - рядки - не з сирого листа, а з бази: bakeryRowsFromOrders (формат сирого рядка вигрузки Task 5);
//   - категорія за штрихкодом/назвою - з products (dir='bakery') замість читання листа «Ассортимент»;
//   - зона і назва ТТ - зі stores (rowToStore), а не з Довідника;
//   - час «оновлено» і «сьогодні» беруться з годинника opts.now / opts.nowBy[назва листа] (у тесті - з фікстури).
const R = require('../rules');
const { rawRowOf, dmyOfSheetCell } = require('../export/raw');

const BAKERY_ORDERS_SHEET = 'Заказы ВК';
const BAKERY_SUMMARY_SHEET = 'Сводная ВК';
const BAKERY_ROUTE_SHEET = 'Маршрути ВК';
const BAKERY_CAT_ORDER = ['Випічка', 'Кулінарія'];
const BAKERY_ZONE_ORDER = ['Салтовка', 'Новые дома', 'Центр', 'не возится'];

// Адреси, вписані в сирий лист руками. Ключ - як написали, значення - назва ТТ у Довіднику (через addrKey).
const BAKERY_ADDR_ALIASES = {
  'валентиновская50': 'Валентинівська, 50 А',
  'валентиновская 50': 'Валентинівська, 50 А',
  'грозненская': 'Грозненська, 38',
  'грозненская38': 'Грозненська, 38',
};

const uk = (a, b) => a.localeCompare(b, 'uk');
const cellStr = (v) => String(v == null ? '' : v).trim();

// nameKey_ (Products.gs)
function nameKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[’'`"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- рядки ----------
// Сирий рядок листа (8 колонок: дата, час, адреса, зона, штрихкод, назва, ціна, кількість) -> робочий рядок звіту:
// дата ДД.ММ.РРРР, час HH:mm, кількість числом. Лишає рядки за `dmy` з назвою і кількістю > 0 (bakeryTodayRows_).
function normalizeRawRows(rawRows, dmy) {
  return rawRows.map((r) => {
    const x = [];
    for (let i = 0; i < 8; i++) x.push(r[i] == null ? '' : r[i]);
    x[0] = dmyOfSheetCell(x[0]).slice(0, 10);
    x[1] = typeof x[1] === 'number'
      ? (() => { const m = Math.round((x[1] - Math.floor(x[1])) * 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); })()
      : cellStr(x[1]).slice(0, 5);
    x[7] = typeof x[7] === 'number' ? x[7] : (Number(cellStr(x[7]).replace(',', '.')) || 0);
    return x;
  }).filter((r) => r[0] === dmy && String(r[5] || '').trim() && (Number(r[7]) || 0) > 0);
}

// Активні замовлення ВК за день (з рядками order_lines) -> сирі рядки. orders: [{store_id, order_date, created_at, lines}],
// stores - за id. Порядок - як у листі: за часом створення, усередині замовлення - за line_no.
function bakeryRowsFromOrders(orders, stores, day) {
  const storeBy = Object.fromEntries(stores.map((s) => [s.id, s]));
  const dmy = day.slice(8, 10) + '.' + day.slice(5, 7) + '.' + day.slice(0, 4);
  const out = [];
  orders.slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).forEach((o) => {
    const store = storeBy[o.store_id];
    if (!store) { console.error(`звіт ВК: точки ${o.store_id} нема в stores - замовлення пропущено`); return; }
    const ctx = { dateStr: dmy, timeStr: R.kyivNow(new Date(o.created_at)).time, address: store.addrBakery || '', store };
    o.lines.slice().sort((a, b) => a.line_no - b.line_no).forEach((l) => {
      out.push(rawRowOf('bakery', ctx, { barcode: l.barcode || '', name: l.name, price: Number(l.price), qty: Number(l.qty) }));
    });
  });
  return normalizeRawRows(out, dmy);
}

// ---------- довідники ----------
// bakeryCatByBarcode_: штрихкод -> категорія і 'n:'+назва -> категорія. products - рядки products dir='bakery'.
function bakeryCatMap(products) {
  const map = {};
  (products || []).forEach((p) => {
    const bc = cellStr(p.barcode), cat = cellStr(p.category);
    if (bc && cat) map[bc] = cat;
    const nm = cellStr(p.name);
    if (nm && cat) map['n:' + nameKey(nm)] = cat;
  });
  return map;
}

function bakeryCatOf(r, map) {
  const bc = cellStr(r[4]);
  if (map[bc]) return map[bc];
  const name = cellStr(r[5]);
  const byName = map['n:' + nameKey(name)];
  if (byName) return byName;
  const first = name.split(' ')[0];
  if (BAKERY_CAT_ORDER.indexOf(first) >= 0) return first;
  return 'Інше';
}

// bakeryStoreByRawAddr_: адреса з сирого листа -> { label, addr, zone }
function bakeryStoreByRawAddr(stores) {
  const byKey = {};
  stores.forEach((s) => {
    if (s.directions.indexOf('bakery') < 0) return;
    const rec = { label: s.label, addr: s.addrBakery, zone: s.zone || '' };
    byKey[R.addrKey(s.addrBakery)] = rec;
    byKey[R.addrKey(s.label)] = rec;
    byKey[R.addrKey(R.shortenAddress(s.addrBakery))] = rec;
  });
  Object.keys(BAKERY_ADDR_ALIASES).forEach((k) => {
    const target = byKey[R.addrKey(BAKERY_ADDR_ALIASES[k])];
    if (target) byKey[R.addrKey(k)] = target;
  });
  return byKey;
}

function bakeryCats(obj) {
  const cats = BAKERY_CAT_ORDER.filter((c) => obj[c] && obj[c].length);
  Object.keys(obj).forEach((c) => {
    if (BAKERY_CAT_ORDER.indexOf(c) < 0 && obj[c] && obj[c].length) cats.push(c);
  });
  return cats;
}

function bakeryZoneList(obj) {
  const out = BAKERY_ZONE_ORDER.filter((z) => obj[z]);
  Object.keys(obj).sort(uk).forEach((z) => { if (out.indexOf(z) < 0) out.push(z); });
  return out;
}

// ---------- збирач ----------
// ctx = { today 'ДД.ММ.РРРР', stamp 'HH:mm:ss', catMap, stores, allToday (ТТ напрямку з робочим днем) }
function ordersPlan(rows, c) {
  const byStore = {};
  rows.forEach((r) => {
    const addr = String(r[2] || '').trim();
    if (!addr) return;
    const cat = bakeryCatOf(r, c.catMap);
    byStore[addr] = byStore[addr] || {};
    byStore[addr][cat] = byStore[addr][cat] || [];
    byStore[addr][cat].push({
      name: String(r[5] || '').trim(),
      price: Number(r[6]) || 0,
      qty: Number(r[7]) || 0,
    });
  });

  const ordered = {};
  Object.keys(byStore).forEach((a) => { ordered[R.addrKey(a)] = true; });

  const all = c.allToday;
  const missing = all.filter((s) => !ordered[R.addrKey(s.addrBakery)]).map((s) => s.label);

  const data = [], g = { title: [], sub: [], head: [], store: [], cat: [],
                         row: [], total: [], grand: [], missHead: [], miss: [] };
  const push = (v, t) => { data.push(v); if (t) g[t].push(data.length); };

  push(['Замовлення випічки та кулінарії - ' + c.today, '', '', ''], 'title');
  push(['ТТ із замовленнями: ' + Object.keys(byStore).length + ' з ' + all.length +
        '   (оновлено ' + c.stamp + ')', '', '', ''], 'sub');
  push(['', '', '', ''], null);
  push(['№', 'Назва товару', 'Кіл-ть', 'Сума, грн'], 'head');

  let num = 1, grandQty = 0, grandSum = 0;

  Object.keys(byStore).sort(uk).forEach((store) => {
    push([store, '', '', ''], 'store');
    let sQty = 0, sSum = 0;

    bakeryCats(byStore[store]).forEach((cat) => {
      push([cat, '', '', ''], 'cat');
      byStore[store][cat].forEach((it) => {
        const sum = Math.round(it.price * it.qty * 100) / 100;
        sQty += it.qty;
        sSum = Math.round((sSum + sum) * 100) / 100;
        push([num++, it.name, it.qty, sum], 'row');
      });
    });

    push(['РАЗОМ по ТТ:', '', sQty, sSum], 'total');
    push(['', '', '', ''], null);
    grandQty += sQty;
    grandSum = Math.round((grandSum + sSum) * 100) / 100;
  });

  if (Object.keys(byStore).length) {
    push(['ЗАГАЛЬНИЙ ПІДСУМОК', '', grandQty, grandSum], 'grand');
    push(['', '', '', ''], null);
  } else {
    push(['Замовлень на сьогодні ще немає', '', '', ''], 'missHead');
    push(['', '', '', ''], null);
  }

  if (missing.length) {
    push(['ТТ без замовлень (' + missing.length + '):', '', '', ''], 'missHead');
    missing.sort(uk).forEach((s) => { push(['   ' + s, '', '', ''], 'miss'); });
  }

  const apply = (w) => {
    w.fmt(null, 'A', 'D', { font: 'Arial', size: 10, valign: 'middle', color: '#212121', bg: '#FFFFFF' });
    w.rowHeights(24);

    w.fmt(g.title, 'A', 'D', { bg: '#1565C0', color: '#FFFFFF', bold: true, size: 14 });
    w.fmt(g.sub, 'A', 'D', { bg: '#E3F2FD', color: '#1565C0', size: 11 });
    w.fmt(g.head, 'A', 'D', { bg: '#37474F', color: '#FFFFFF', bold: true, halign: 'center' });
    w.fmt(g.store, 'A', 'D', { bg: '#1976D2', color: '#FFFFFF', bold: true });
    w.fmt(g.cat, 'A', 'D', { bg: '#FFF8E1', color: '#E65100', bold: true });

    if (g.row.length) {
      const even = g.row.filter((_, i) => i % 2 === 1);
      w.fmt(even, 'A', 'D', { bg: '#F8F9FA' });
      w.fmt(g.row, 'A', 'A', { halign: 'center' });
      w.fmt(g.row, 'C', 'C', { halign: 'center', num: '0.###' });
      w.fmt(g.row, 'D', 'D', { halign: 'right', num: '#,##0.00' });
    }
    // 0.### - щоб кількість була "11", а не "11,00"
    w.fmt(g.total, 'A', 'D', { bg: '#E8F5E9', color: '#2E7D32', bold: true });
    w.fmt(g.total, 'C', 'C', { halign: 'center', num: '0.###' });
    w.fmt(g.total, 'D', 'D', { halign: 'right', num: '#,##0.00' });
    w.fmt(g.grand, 'A', 'D', { bg: '#388E3C', color: '#FFFFFF', bold: true, size: 11 });
    w.fmt(g.grand, 'C', 'C', { halign: 'center', num: '0.###' });
    w.fmt(g.grand, 'D', 'D', { halign: 'right', num: '#,##0.00' });
    w.fmt(g.missHead, 'A', 'D', { bg: '#FFEBEE', color: '#C62828', bold: true });
    w.fmt(g.miss, 'A', 'A', { color: '#C62828' });

    w.colWidths([50, 420, 90, 120]).frozen(4);
  };
  return { data, width: 4, apply,
    info: `Заказы ВК: рядків ${data.length}, позицій ${num - 1}, ТТ ${Object.keys(byStore).length} з ${all.length}, без замовлень ${missing.length}` };
}

function summaryPlan(rows, c) {
  const sum = {};
  let grandQty = 0, grandSum = 0;
  rows.forEach((r) => {
    const cat = bakeryCatOf(r, c.catMap);
    const name = String(r[5] || '').trim();
    const qty = Number(r[7]) || 0;
    const price = Number(r[6]) || 0;
    sum[cat] = sum[cat] || {};
    sum[cat][name] = sum[cat][name] || { qty: 0, sum: 0 };
    sum[cat][name].qty += qty;
    sum[cat][name].sum = Math.round((sum[cat][name].sum + price * qty) * 100) / 100;
    grandQty += qty;
    grandSum = Math.round((grandSum + price * qty) * 100) / 100;
  });

  const data = [], g = { title: [], head: [], cat: [], row: [], total: [] };
  const push = (v, t) => { data.push(v); if (t) g[t].push(data.length); };

  push(['Зведена таблиця - ' + c.today + '   (оновлено ' + c.stamp + ')', '', '', ''], 'title');
  push(['Асортимент', 'Кількість, шт', 'Сума, грн', '% від заг.'], 'head');

  if (!rows.length) {
    push(['Замовлень на сьогодні ще немає', '', '', ''], 'cat');
  } else {
    const catNames = {};
    Object.keys(sum).forEach((cn) => { catNames[cn] = Object.keys(sum[cn]); });

    bakeryCats(catNames).forEach((cat) => {
      const items = sum[cat];
      let cQty = 0, cSum = 0;
      Object.keys(items).forEach((nm) => {
        cQty += items[nm].qty;
        cSum = Math.round((cSum + items[nm].sum) * 100) / 100;
      });
      push([cat, cQty, cSum, grandQty ? (cQty / grandQty * 100).toFixed(1) + '%' : '0%'], 'cat');

      Object.keys(items).sort(uk).forEach((nm) => {
        const d = items[nm];
        push([nm, d.qty, d.sum, grandQty ? (d.qty / grandQty * 100).toFixed(1) + '%' : '0%'], 'row');
      });
      push(['', '', '', ''], null);
    });
    push(['ЗАГАЛОМ', grandQty, grandSum, '100%'], 'total');
  }

  const apply = (w) => {
    w.fmt(null, 'A', 'D', { font: 'Arial', size: 10, valign: 'middle', color: '#212121', bg: '#FFFFFF' });
    w.rowHeights(24);

    // формати задаємо явно, щоб % з колонки D не перетікав у C
    w.fmt(null, 'A', 'A', { num: '@' });
    w.fmt(null, 'B', 'B', { num: '0.###' });
    w.fmt(null, 'C', 'C', { num: '#,##0.00' });
    w.fmt(null, 'D', 'D', { num: '@' });

    w.fmt(g.title, 'A', 'D', { bg: '#1565C0', color: '#FFFFFF', bold: true, size: 14 });
    w.fmt(g.head, 'A', 'D', { bg: '#37474F', color: '#FFFFFF', bold: true, halign: 'center' });
    w.fmt(g.cat, 'A', 'D', { bg: '#FFF8E1', color: '#E65100', bold: true });
    w.fmt(g.total, 'A', 'D', { bg: '#388E3C', color: '#FFFFFF', bold: true });

    w.colWidths([420, 120, 120, 100]).frozen(2);
  };
  return { data, width: 4, apply,
    info: `Сводная ВК: позицій ${Math.max(data.length - 2, 0)}, разом ${grandQty} шт / ${grandSum} грн` };
}

function routePlan(rows, c) {
  const byRawAddr = bakeryStoreByRawAddr(c.stores);

  // зона -> товар -> назва ТТ -> кількість
  const z = {}, unknown = {};
  rows.forEach((r) => {
    const name = String(r[5] || '').trim();
    const addr = String(r[2] || '').trim();
    const qty = Number(r[7]) || 0;
    if (!name || !addr || qty <= 0) return;

    // назва ТТ і зона - з Довідника; що в листі, те лише ключ пошуку
    const st = byRawAddr[R.addrKey(addr)];
    if (!st) unknown[addr] = 1;
    const label = st ? st.label : addr;
    const zone = (st && st.zone) || String(r[3] || '').trim() || 'Без маршруту';

    z[zone] = z[zone] || {};
    z[zone][name] = z[zone][name] || {};
    z[zone][name][label] = (z[zone][name][label] || 0) + qty;
  });

  const unknownList = Object.keys(unknown);
  if (unknownList.length) console.log('Маршрути ВК: адреси, яких немає в Довіднику - ' + unknownList.join(', '));

  const data = [], g = { title: [], head: [], row: [], item: [], zone: [], empty: [] };
  const push = (v, t) => { data.push(v); if (t) g[t].push(data.length); };

  push(['Розвозка випічки і кулінарії - ' + c.today + '   (оновлено ' + c.stamp + ')', '', '', ''], 'title');
  push(['Торгова точка', 'Найменування продукції', 'Кількість', 'Маршрут'], 'head');

  let grand = 0;

  bakeryZoneList(z).forEach((zone) => {
    const items = z[zone];
    let zoneQty = 0;

    Object.keys(items).sort(uk).forEach((name) => {
      const byAddr = items[name];
      let itemQty = 0;

      Object.keys(byAddr).sort(uk).forEach((addr) => {
        push([addr, name, byAddr[addr], zone], 'row');
        itemQty += byAddr[addr];
      });

      push(['Разом', name, itemQty, zone], 'item');
      push(['', '', '', ''], null);        // порожній рядок між товарами
      zoneQty += itemQty;
    });

    push(['ВСЬОГО ' + zone, '', zoneQty, zone], 'zone');
    push(['', '', '', ''], null);
    push(['', '', '', ''], null);          // розрив між маршрутами
    grand += zoneQty;
  });

  if (!Object.keys(z).length) {
    push(['Замовлень на сьогодні ще немає', '', '', ''], 'empty');
  } else {
    push(['ЗАГАЛОМ', '', grand, ''], 'zone');
  }

  const apply = (w) => {
    w.fmt(null, 'A', 'D', { font: 'Arial', size: 10, valign: 'middle', color: '#000000', bg: '#FFFFFF' });
    w.rowHeights(22);
    w.fmt(null, 'C', 'C', { num: '0.###', halign: 'center' });
    w.fmt(null, 'D', 'D', { halign: 'center' });

    w.fmt(g.title, 'A', 'D', { bg: '#1565C0', color: '#FFFFFF', bold: true, size: 12 });
    w.fmt(g.head, 'A', 'D', { bold: true, halign: 'center' }).border(g.head, 'A', 'D');
    w.border(g.row, 'A', 'D');
    w.fmt(g.item, 'A', 'D', { bg: '#F1F3F4', bold: true }).border(g.item, 'A', 'D');
    w.fmt(g.zone, 'A', 'D', { bg: '#E8F5E9', color: '#1B5E20', bold: true }).border(g.zone, 'A', 'D');
    w.fmt(g.empty, 'A', 'D', { bg: '#FFEBEE', color: '#C62828', bold: true });

    w.colWidths([220, 420, 110, 130]).frozen(2);
  };
  return { data, width: 4, apply,
    info: `Маршрути ВК: маршрутів ${Object.keys(z).length}, рядків ${data.length}, разом ${grand} шт` };
}

// rows - робочі рядки (normalizeRawRows / bakeryRowsFromOrders). opts:
//   stores   - точки у формі rowToStore (усі; ТТ напрямку з робочим днем відбираються тут)
//   products - рядки products dir='bakery' (barcode, name, category)
//   now      - Date збирання (за замовчуванням зараз); nowBy - { 'назва листа': Date } для золотого тесту
// Повертає { 'Заказы ВК': plan, 'Сводная ВК': plan, 'Маршрути ВК': plan }, plan = { data, width, apply(w), info }.
function buildBakeryReports(rows, opts = {}) {
  const stores = opts.stores || [];
  const catMap = bakeryCatMap(opts.products);
  const sorted = rows.slice().sort((a, b) => {
    const x = uk(String(a[2] || ''), String(b[2] || ''));
    return x || uk(String(a[5] || ''), String(b[5] || ''));
  });
  const clock = (name) => (opts.nowBy && opts.nowBy[name]) || opts.now || new Date();
  const ctxFor = (name) => {
    const at = clock(name), k = R.kyivNow(at);
    const dayCtx = { at, settings: {}, lateRows: [] };
    return { today: k.dmy, stamp: k.time, catMap, stores,
      allToday: stores.filter((s) => s.directions.indexOf('bakery') >= 0 && R.dayAllowed('bakery', s, dayCtx)) };
  };
  return {
    [BAKERY_ORDERS_SHEET]: ordersPlan(sorted, ctxFor(BAKERY_ORDERS_SHEET)),
    [BAKERY_SUMMARY_SHEET]: summaryPlan(sorted, ctxFor(BAKERY_SUMMARY_SHEET)),
    [BAKERY_ROUTE_SHEET]: routePlan(sorted, ctxFor(BAKERY_ROUTE_SHEET)),
  };
}

module.exports = {
  BAKERY_ORDERS_SHEET, BAKERY_SUMMARY_SHEET, BAKERY_ROUTE_SHEET,
  buildBakeryReports, normalizeRawRows, bakeryRowsFromOrders, bakeryCatMap, bakeryCatOf, bakeryStoreByRawAddr, nameKey,
};
