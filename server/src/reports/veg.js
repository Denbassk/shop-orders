// Звіти овочів: «Замовлення Овочі» і «Зведена Овочі». Перенос app/VegReport.gs (buildVegOrdersSheet_, buildVegSummarySheet_,
// vegTodayRows_, vegStoresToday_) і позначки ЮА з app/Registry.gs (isUaStore_, uaAddrKeys_, UA_MARK).
// Тексти, порядок і формати - дослівно. Рядки - з бази (reports/rows.js), список ТТ і дні - зі stores (rowToStore).
const R = require('../rules');

const VEG_ORDERS_SHEET = 'Замовлення Овочі';
const VEG_SUMMARY_SHEET = 'Зведена Овочі';
const UA_EDRPOU = '45672783';
const UA_MARK = ' · ЮА';

const uk = (a, b) => a.localeCompare(b, 'uk');
const cellStr = (v) => String(v == null ? '' : v).trim();
const vegNum = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const vegRound = (x) => Math.round(x * 100) / 100;

const isUaStore = (s) => String((s && s.edrpou) || '').replace(/\D/g, '') === UA_EDRPOU;

// uaAddrKeys_: ключі addrKey адрес точок ЮА в полі field (addrVeg, addrNbhz...)
function uaAddrKeys(stores, field) {
  const keys = {};
  stores.forEach((s) => {
    if (!isUaStore(s)) return;
    [s[field], s.address].forEach((a) => {
      if (!a) return;
      keys[R.addrKey(a)] = true;
      keys[R.addrKey(R.shortenAddress(a))] = true;
    });
  });
  return keys;
}

// Сирий рядок листа овочів (A дата | B час | C адреса | D назва | E ціна | F кількість | G сума) -> робочий рядок:
// дата ДД.ММ.РРРР, кількість числом. Лишає рядки за dmy з назвою і кількістю > 0 (vegTodayRows_).
function normalizeRawRows(rawRows, dmy) {
  const { dmyOfSheetCell } = require('../export/raw');
  return rawRows.map((r) => {
    const x = [];
    for (let i = 0; i < 7; i++) x.push(r[i] == null ? '' : r[i]);
    x[0] = dmyOfSheetCell(x[0]).slice(0, 10);
    x[5] = vegNum(x[5]);
    return x;
  }).filter((r) => r[0] === dmy && cellStr(r[3]) && r[5] > 0);
}

// ---------- «Замовлення Овочі» ----------
function ordersPlan(rows, c) {
  const byStore = {};
  rows.forEach((r) => {
    const addr = cellStr(r[2]);
    if (!addr) return;
    byStore[addr] = byStore[addr] || [];
    byStore[addr].push({
      name: cellStr(r[3]),
      price: vegNum(r[4]),
      qty: vegNum(r[5]),
      sum: vegNum(r[6]) || vegRound(vegNum(r[4]) * vegNum(r[5])),
    });
  });

  const ordered = {};
  Object.keys(byStore).forEach((a) => { ordered[R.addrKey(a)] = 1; });

  const all = c.allToday;
  const missing = all.filter((s) => !ordered[R.addrKey(s.addrVeg)]).map((s) => s.label + (isUaStore(s) ? UA_MARK : ''));
  const ua = uaAddrKeys(c.stores, 'addrVeg');

  const data = [], g = { title: [], sub: [], head: [], store: [], row: [], total: [], grand: [], missHead: [], miss: [] };
  const push = (v, t) => { data.push(v); if (t) g[t].push(data.length); };

  push(['Замовлення овочів - ' + c.today, '', '', '', ''], 'title');
  push(['ТТ із замовленнями: ' + Object.keys(byStore).length + ' з ' + all.length + '   (оновлено ' + c.stamp + ')', '', '', '', ''], 'sub');
  push(['', '', '', '', ''], null);
  push(['№', 'Назва овочу', 'Ціна/кг', 'Кількість, кг', 'Сума, грн'], 'head');

  let num = 1, grandQty = 0, grandSum = 0;

  Object.keys(byStore).sort(uk).forEach((store) => {
    push([store + (ua[R.addrKey(store)] ? UA_MARK : ''), '', '', '', ''], 'store');
    let sQty = 0, sSum = 0;

    byStore[store].sort((a, b) => uk(a.name, b.name)).forEach((it) => {
      sQty = vegRound(sQty + it.qty);
      sSum = vegRound(sSum + it.sum);
      push([num++, it.name, it.price, it.qty, it.sum], 'row');
    });

    push(['РАЗОМ по ТТ:', '', '', sQty, sSum], 'total');
    push(['', '', '', '', ''], null);
    grandQty = vegRound(grandQty + sQty);
    grandSum = vegRound(grandSum + sSum);
  });

  if (Object.keys(byStore).length) {
    push(['ЗАГАЛЬНИЙ ПІДСУМОК', '', '', grandQty, grandSum], 'grand');
    push(['', '', '', '', ''], null);
  } else {
    push(['Замовлень на сьогодні ще немає', '', '', '', ''], 'missHead');
    push(['', '', '', '', ''], null);
  }

  if (missing.length) {
    push(['ТТ без замовлень (' + missing.length + '):', '', '', '', ''], 'missHead');
    missing.sort(uk).forEach((s) => { push(['   ' + s, '', '', '', ''], 'miss'); });
  }

  const apply = (w) => {
    w.fmt(null, 'A', 'E', { font: 'Arial', size: 10, valign: 'middle', color: '#212121', bg: '#FFFFFF' });
    w.rowHeights(24);

    w.fmt(g.title, 'A', 'E', { bg: '#2E7D32', color: '#FFFFFF', bold: true, size: 14 });
    w.fmt(g.sub, 'A', 'E', { bg: '#E8F5E9', color: '#2E7D32', size: 11 });
    w.fmt(g.head, 'A', 'E', { bg: '#37474F', color: '#FFFFFF', bold: true, halign: 'center' });
    w.fmt(g.store, 'A', 'E', { bg: '#FFF3E0', color: '#E65100', bold: true });

    if (g.row.length) {
      const even = g.row.filter((_, i) => i % 2 === 1);
      if (even.length) w.fmt(even, 'A', 'E', { bg: '#F8F9FA' });
      w.fmt(g.row, 'A', 'A', { halign: 'center' });
      w.fmt(g.row, 'C', 'C', { halign: 'center', num: '#,##0.00' });
      w.fmt(g.row, 'D', 'D', { halign: 'center', num: '0.###' });
      w.fmt(g.row, 'E', 'E', { halign: 'right', num: '#,##0.00' });
    }
    if (g.total.length) {
      w.fmt(g.total, 'A', 'E', { bg: '#E8F5E9', color: '#2E7D32', bold: true });
      w.fmt(g.total, 'D', 'D', { halign: 'center', num: '0.###' });
      w.fmt(g.total, 'E', 'E', { halign: 'right', num: '#,##0.00' });
    }
    if (g.grand.length) {
      w.fmt(g.grand, 'A', 'E', { bg: '#1B5E20', color: '#FFFFFF', bold: true, size: 11 });
      w.fmt(g.grand, 'D', 'D', { halign: 'center', num: '0.###' });
      w.fmt(g.grand, 'E', 'E', { halign: 'right', num: '#,##0.00' });
    }
    w.fmt(g.missHead, 'A', 'E', { bg: '#FFEBEE', color: '#C62828', bold: true });
    w.fmt(g.miss, 'A', 'A', { color: '#C62828' });

    w.colWidths([50, 300, 100, 130, 130]).frozen(4);
  };
  return { data, width: 5, apply,
    info: `Замовлення Овочі: рядків ${data.length}, позицій ${num - 1}, ТТ ${Object.keys(byStore).length} з ${all.length}, без замовлень ${missing.length}` };
}

// ---------- «Зведена Овочі» ----------
function summaryPlan(rows, c) {
  const sum = {}, stores = {};
  let grandQty = 0, grandSum = 0;
  rows.forEach((r) => {
    const name = cellStr(r[3]);
    if (!name) return;
    const price = vegNum(r[4]), qty = vegNum(r[5]);
    const s = vegNum(r[6]) || vegRound(price * qty);

    sum[name] = sum[name] || { qty: 0, sum: 0, price };
    sum[name].qty = vegRound(sum[name].qty + qty);
    sum[name].sum = vegRound(sum[name].sum + s);
    if (price > 0) sum[name].price = price;

    grandQty = vegRound(grandQty + qty);
    grandSum = vegRound(grandSum + s);
    const addr = cellStr(r[2]);
    if (addr) stores[R.addrKey(addr)] = 1;
  });

  const data = [], g = { title: [], sub: [], head: [], row: [], total: [], empty: [] };
  const push = (v, t) => { data.push(v); if (t) g[t].push(data.length); };

  push(['Зведене замовлення овочів - ' + c.today, '', '', '', ''], 'title');
  push(['ТТ: ' + Object.keys(stores).length + '   |   разом ' + grandQty + ' кг   |   ' + grandSum.toFixed(2) + ' грн   (оновлено ' + c.stamp + ')',
    '', '', '', ''], 'sub');
  push(['', '', '', '', ''], null);
  push(['№', 'Назва овочу', 'Ціна/кг', 'Кількість, кг', 'Сума, грн'], 'head');

  if (!rows.length) {
    push(['Замовлень на сьогодні ще немає', '', '', '', ''], 'empty');
  } else {
    let num = 1;
    Object.keys(sum).sort(uk).forEach((name) => {
      const it = sum[name];
      push([num++, name, it.price, it.qty, it.sum], 'row');
    });
    push(['', '', '', '', ''], null);
    push(['ЗАГАЛОМ', '', '', grandQty, grandSum], 'total');
  }

  const apply = (w) => {
    w.fmt(null, 'A', 'E', { font: 'Arial', size: 10, valign: 'middle', color: '#212121', bg: '#FFFFFF' });
    w.rowHeights(24);

    w.fmt(g.title, 'A', 'E', { bg: '#2E7D32', color: '#FFFFFF', bold: true, size: 14 });
    w.fmt(g.sub, 'A', 'E', { bg: '#E8F5E9', color: '#2E7D32', size: 11 });
    w.fmt(g.head, 'A', 'E', { bg: '#37474F', color: '#FFFFFF', bold: true, halign: 'center' });
    if (g.row.length) {
      const even = g.row.filter((_, i) => i % 2 === 1);
      if (even.length) w.fmt(even, 'A', 'E', { bg: '#F8F9FA' });
      w.fmt(g.row, 'A', 'A', { halign: 'center' });
      w.fmt(g.row, 'C', 'C', { halign: 'center', num: '#,##0.00' });
      w.fmt(g.row, 'D', 'D', { halign: 'center', num: '0.###' });
      w.fmt(g.row, 'E', 'E', { halign: 'right', num: '#,##0.00' });
    }
    if (g.total.length) {
      w.fmt(g.total, 'A', 'E', { bg: '#1B5E20', color: '#FFFFFF', bold: true, size: 11 });
      w.fmt(g.total, 'D', 'D', { halign: 'center', num: '0.###' });
      w.fmt(g.total, 'E', 'E', { halign: 'right', num: '#,##0.00' });
    }
    w.fmt(g.empty, 'A', 'E', { bg: '#FFEBEE', color: '#C62828', bold: true });

    w.colWidths([50, 300, 100, 130, 130]).frozen(4);
  };
  return { data, width: 5, apply,
    info: `Зведена Овочі: позицій ${Object.keys(sum).length}, разом ${grandQty} кг / ${grandSum} грн` };
}

// rows - робочі рядки (normalizeRawRows / reports/rows.js). opts: { stores (усі, rowToStore), now, nowBy }
function buildVegReports(rows, opts = {}) {
  const stores = opts.stores || [];
  const clock = (name) => (opts.nowBy && opts.nowBy[name]) || opts.now || new Date();
  const ctxFor = (name) => {
    const at = clock(name), k = R.kyivNow(at);
    const dayCtx = { at, settings: {}, lateRows: [] };
    return { today: k.dmy, stamp: k.time, stores,
      allToday: stores.filter((s) => s.directions.indexOf('veg') >= 0 && R.dayAllowed('veg', s, dayCtx)) };
  };
  return {
    [VEG_ORDERS_SHEET]: ordersPlan(rows, ctxFor(VEG_ORDERS_SHEET)),
    [VEG_SUMMARY_SHEET]: summaryPlan(rows, ctxFor(VEG_SUMMARY_SHEET)),
  };
}

module.exports = { VEG_ORDERS_SHEET, VEG_SUMMARY_SHEET, UA_MARK, UA_EDRPOU, isUaStore, uaAddrKeys, normalizeRawRows, buildVegReports };
