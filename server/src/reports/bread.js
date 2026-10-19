// Звіти хліба (ЧП Рома): «Заказы», «Данные Заказов» і лист «Завантаження». Перенос app/BreadReport.gs
// (buildBreadOrdersSheet_, buildBreadSummarySheet_, breadInfoByAddr_, breadTodayRows_) і app/Export.gs (writeBreadDownloadSheet_).
// Тексти, порядок рядків і формати - дослівно; різниця лише в способі запису (batchUpdate замість SpreadsheetApp) і в джерелах:
//   - рядки - з бази (reports/rows.js), а не з сирого листа;
//   - номери ТТ і ЄДРПОУ - зі stores (rowToStore), а не з Довідника.
const R = require('../rules');
const { serialOfDmy, asText } = require('./sheetsTypes');

const BREAD_ORDERS_SHEET = 'Заказы';
const BREAD_SUMMARY_SHEET = 'Данные Заказов';
const BREAD_DOWNLOAD_SHEET = 'Завантаження';
const BREAD_EDRPOU = '44413718';

const uk = (a, b) => a.localeCompare(b, 'uk');
// .gs: a.barcode.localeCompare(b.barcode) - без локалі; штрихкоди цифрові, фіксуємо 'en' щоб не залежати від локалі процесу
const en = (a, b) => a.localeCompare(b, 'en');
const cellStr = (v) => String(v == null ? '' : v).trim();
const breadNum = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };

// Сирий рядок листа хліба (A дата | B маршрут | C адреса (коротка) | D штрихкод | E назва | F ціна | G кількість) ->
// робочий рядок: дата ДД.ММ.РРРР, кількість числом. Лишає рядки за dmy з назвою і кількістю > 0 (breadTodayRows_).
function normalizeRawRows(rawRows, dmy) {
  const { dmyOfSheetCell } = require('../export/raw');
  return rawRows.map((r) => {
    const x = [];
    for (let i = 0; i < 7; i++) x.push(r[i] == null ? '' : r[i]);
    x[0] = dmyOfSheetCell(x[0]).slice(0, 10);
    x[6] = breadNum(x[6]);
    return x;
  }).filter((r) => r[0] === dmy && cellStr(r[4]) && r[6] > 0);
}

// breadInfoByAddr_: коротка адреса (addrKey) -> { code, edrpou }
function breadInfoByAddr(stores) {
  const map = {};
  stores.forEach((s) => {
    if (s.directions.indexOf('bread') < 0) return;
    map[R.addrKey(R.shortenAddress(s.addrBread))] = { code: s.code, edrpou: s.edrpou || BREAD_EDRPOU };
  });
  return map;
}

function groupByRouteStore(rows, withInfo, info) {
  const byKey = {};
  rows.forEach((r) => {
    const route = cellStr(r[1]), store = cellStr(r[2]);
    if (!store) return;
    const key = route + '|||' + store;
    if (!byKey[key]) {
      byKey[key] = { route, store, items: [] };
      if (withInfo) {
        const i = info[R.addrKey(store)] || {};
        byKey[key].code = i.code || '';
        byKey[key].edrpou = i.edrpou || BREAD_EDRPOU;
      }
    }
    byKey[key].items.push({ barcode: cellStr(r[3]), name: cellStr(r[4]), qty: breadNum(r[6]) });
  });
  const keys = Object.keys(byKey).sort((a, b) => {
    const pa = a.split('|||'), pb = b.split('|||');
    if (pa[0] !== pb[0]) return uk(pa[0], pb[0]);
    return uk(pa[1], pb[1]);
  });
  return { byKey, keys };
}

// ---------- «Заказы» ----------
function ordersPlan(rows, c) {
  const info = breadInfoByAddr(c.stores);
  const { byKey, keys } = groupByRouteStore(rows, true, info);

  const head = ['Дата заказа', 'Маршрут', 'Магазин', 'Штрих-код', 'Название Продукта', 'Количество', 'Код ЄДРПОУ', 'Номер магазина'];
  const data = [head], g = { sep: [], row: [], empty: [] };

  keys.forEach((k) => {
    const o = byKey[k];
    o.items.sort((a, b) => en(a.barcode, b.barcode));
    data.push(['', '', '', '', '', '', asText(o.edrpou), asText(o.code)]);          // спершу рядок із ЄДРПОУ і номером магазину
    g.sep.push(data.length);
    o.items.forEach((it) => {
      data.push([serialOfDmy(c.today), o.route, o.store, it.barcode, it.name, it.qty, '', '']);
      g.row.push(data.length);
    });
  });

  if (data.length === 1) {
    data.push(['Замовлень на ' + c.today + ' немає', '', '', '', '', '', '', '']);
    g.empty.push(data.length);
  }

  const apply = (w) => {
    w.fmt(null, 'A', 'H', { font: 'Arial', size: 10, valign: 'middle', color: '#212121', bg: '#FFFFFF', halign: 'left' });
    w.border(null, 'A', 'H');
    // штрихкод і номер магазину - текстом, інакше Google з'їдає нулі
    w.fmt(null, 'D', 'D', { num: '@' });
    w.fmt(null, 'G', 'H', { num: '@' });
    w.fmt(null, 'F', 'F', { num: '0.###' });

    // Sheets сам ставить формат дати на блок колонки A від першої дати до кінця таблиці (разом з рядками-роздільниками)
    if (g.row.length) w.fmt(Array.from({ length: data.length - g.row[0] + 1 }, (_, i) => g.row[0] + i), 'A', 'A', { num: 'dd.mm.yyyy' });

    w.fmt([1], 'A', 'H', { bg: '#FFFF00', bold: true, halign: 'center' });

    w.fmt(g.sep, 'G', 'H', { bold: true, halign: 'center' });
    if (g.row.length) {
      w.fmt(g.row, 'A', 'H', { bold: true });
      w.fmt(g.row, 'A', 'A', { halign: 'center' });
      w.fmt(g.row, 'F', 'F', { halign: 'center' });
    }
    w.fmt(g.empty, 'A', 'H', { color: '#C62828', bold: true });

    w.colWidths([110, 120, 200, 150, 400, 100, 110, 130]).frozen(1);
  };
  return { data, width: head.length, apply,
    info: `Заказы (хліб): рядків ${data.length}, ТТ ${keys.length}, позицій ${g.row.length}` };
}

// ---------- «Данные Заказов» ----------
function summaryPlan(rows, c) {
  const byKey = {}, total = {};
  let grandQty = 0;
  rows.forEach((r) => {
    const route = cellStr(r[1]), store = cellStr(r[2]), barcode = cellStr(r[3]), name = cellStr(r[4]);
    const qty = breadNum(r[6]);
    if (!store || !name) return;
    const key = route + '|||' + store;
    if (!byKey[key]) byKey[key] = { route, store, items: [] };
    byKey[key].items.push({ barcode, name, qty });
    if (!total[barcode]) total[barcode] = { name, qty: 0 };
    total[barcode].qty += qty;
    grandQty += qty;
  });

  const keys = Object.keys(byKey).sort((a, b) => {
    const pa = a.split('|||'), pb = b.split('|||');
    if (pa[0] !== pb[0]) return uk(pa[0], pb[0]);
    return uk(pa[1], pb[1]);
  });

  const ordered = {};
  keys.forEach((k) => { ordered[R.addrKey(byKey[k].store)] = 1; });
  const all = c.stores.filter((s) => s.directions.indexOf('bread') >= 0 && c.dayAllowed(s));
  const missing = all.filter((s) => !ordered[R.addrKey(R.shortenAddress(s.addrBread))]).map((s) => s.label);

  const head = ['Маршрут', 'Магазин', 'Штрих-код', 'Название Продукта', 'Количество'];
  const data = [head], g = { row: [], band: [], sumHead: [], sumRow: [], grand: [], missHead: [], miss: [] };

  keys.forEach((k) => {
    const o = byKey[k];
    o.items.sort((a, b) => en(a.barcode, b.barcode));
    o.items.forEach((it) => {
      data.push([o.route, o.store, it.barcode, it.name, it.qty]);
      g.row.push(data.length);
    });
    data.push(['', '', '', '', '']);
  });

  if (keys.length) {
    data.push(['', '', '', '', '']);
    data.push(['ЗВЕДЕННЯ ПО ПОЗИЦІЯХ - ' + c.today, '', '', '', '']);
    g.band.push(data.length);
    data.push(['Штрих-код', 'Название Продукта', 'Общее Количество', '', '']);
    g.sumHead.push(data.length);

    Object.keys(total).sort().forEach((bc) => {
      data.push([bc, total[bc].name, total[bc].qty, '', '']);
      g.sumRow.push(data.length);
    });
    data.push(['', 'ВСЬОГО:', asText(grandQty), '', '']);
    g.grand.push(data.length);
  } else {
    data.push(['Замовлень на ' + c.today + ' немає', '', '', '', '']);
    g.missHead.push(data.length);
  }

  if (missing.length) {
    data.push(['', '', '', '', '']);
    data.push(['ТТ без замовлень (' + missing.length + '):', '', '', '', '']);
    g.missHead.push(data.length);
    missing.sort(uk).forEach((s) => {
      data.push(['   ' + s, '', '', '', '']);
      g.miss.push(data.length);
    });
  }

  const apply = (w) => {
    w.fmt(null, 'A', 'E', { font: 'Arial', size: 10, valign: 'middle', color: '#212121', bg: '#FFFFFF', halign: 'left' });
    w.fmt(null, 'C', 'C', { num: '@' });
    w.fmt(null, 'E', 'E', { num: '0.###' });

    w.fmt([1], 'A', 'E', { bg: '#FFFF00', bold: true, halign: 'center' });

    if (g.row.length) {
      w.border(g.row, 'A', 'E');
      w.fmt(g.row, 'E', 'E', { halign: 'center' });
    }
    w.fmt(g.band, 'A', 'E', { bg: '#4CAF50', color: '#FFFFFF', bold: true, size: 12 });
    w.fmt(g.sumHead, 'A', 'C', { bg: '#FFC107', bold: true, halign: 'center' });
    if (g.sumRow.length) {
      w.fmt(g.sumRow, 'A', 'A', { num: '@' });      // штрихкод текстом: без наукового запису і без втрати ведучих нулів
      w.border(g.sumRow, 'A', 'C');
      w.fmt(g.sumRow, 'C', 'C', { halign: 'center', num: '0.###' });
    }
    w.fmt(g.grand, 'A', 'C', { bg: '#E0E0E0', bold: true, size: 11 });
    w.fmt(g.missHead, 'A', 'E', { bg: '#FFEBEE', color: '#C62828', bold: true });
    w.fmt(g.miss, 'A', 'A', { color: '#C62828' });

    w.colWidths([120, 200, 150, 400, 100]).frozen(1);
  };
  return { data, width: head.length, apply,
    info: `Данные Заказов (хліб): ТТ ${keys.length} з ${all.length}, позицій ${Object.keys(total).length}, разом ${grandQty}, без замовлень ${missing.length}` };
}

// rows - робочі рядки (normalizeRawRows / reports/rows.js). opts: { stores (усі, rowToStore), now }
function buildBreadReports(rows, opts = {}) {
  const stores = opts.stores || [];
  const at = opts.now || new Date();
  const k = R.kyivNow(at);
  const dayCtx = { at, settings: {}, lateRows: [] };
  const c = { today: k.dmy, stores, dayAllowed: (s) => R.dayAllowed('bread', s, dayCtx) };
  return {
    [BREAD_ORDERS_SHEET]: ordersPlan(rows, c),
    [BREAD_SUMMARY_SHEET]: summaryPlan(rows, c),
  };
}

// ---------- лист «Завантаження» (Export.gs: writeBreadDownloadSheet_) ----------
const xlsxUrl = (ssId, gid) => 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=xlsx&gid=' + gid;

// Повний лист: заголовок, два посилання на xlsx листів «Заказы» і «Данные Заказов» (за gid), пояснення і час збирання.
// opts: { spreadsheetId, ordersGid, summaryGid (необов'язково), now }
function breadDownloadPlan(opts) {
  const k = R.kyivNow(opts.now || new Date());
  const stamp = k.time.slice(0, 5);
  const data = [], link = [];
  data.push(['ЗАМОВЛЕННЯ ХЛІБ РОМА']);
  data.push(['за ' + k.dmy]);
  data.push(['']);
  data.push(['⬇  ЗАВАНТАЖИТИ EXCEL «' + BREAD_ORDERS_SHEET + '» за ' + k.dmy]);
  link.push({ row: 4, url: xlsxUrl(opts.spreadsheetId, opts.ordersGid), size: 14 });
  if (opts.summaryGid != null) {
    data.push(['⬇  «' + BREAD_SUMMARY_SHEET + '» (зведення по позиціях)']);
    link.push({ row: 5, url: xlsxUrl(opts.spreadsheetId, opts.summaryGid), size: 11 });
  } else data.push(['']);
  data.push(['']);
  data.push(['Файл міститиме ТІЛЬКИ вибраний лист - решта листів у нього не потрапляє.']);
  data.push(['Звіт оновлюється кожні 5 хвилин, посилання постійне - можна покласти в закладки.']);
  data.push(['Звіт перезібрано о ' + stamp]);

  const apply = (w) => {
    w.fmt([1], 'A', 'A', { size: 16, bold: true });
    w.fmt([2], 'A', 'A', { color: '#6b7280' });
    link.forEach((l) => {
      w.raw({ updateCells: {
        start: { sheetId: w.sheetId, rowIndex: l.row - 1, columnIndex: 0 }, fields: 'textFormatRuns',
        rows: [{ values: [{ textFormatRuns: [{ startIndex: 0, format: { link: { uri: l.url }, fontSize: l.size, bold: true,
          foregroundColor: { red: 0x1a / 255, green: 0x73 / 255, blue: 0xe8 / 255 }, underline: true } }] }] }],
      } });
    });
    w.fmt([7, 8, 9], 'A', 'A', { color: '#6b7280', size: 10 });
    w.colWidths([620]);
    w.raw({ updateSheetProperties: { properties: { sheetId: w.sheetId, gridProperties: { hideGridlines: true } },
      fields: 'gridProperties.hideGridlines' } });
  };
  return { data, width: 1, apply, sheetIndex: 0, info: 'Завантаження (хліб): повний лист' };
}

// Лист вже є і зібраний сьогодні: оновлюється лише час останнього збирання (комірка A9)
function breadDownloadStampRequests(sheetId, now) {
  const k = R.kyivNow(now || new Date());
  return [{ updateCells: { start: { sheetId, rowIndex: 8, columnIndex: 0 }, fields: 'userEnteredValue',
    rows: [{ values: [{ userEnteredValue: { stringValue: 'Звіт перезібрано о ' + k.time.slice(0, 5) } }] }] } }];
}

module.exports = {
  BREAD_ORDERS_SHEET, BREAD_SUMMARY_SHEET, BREAD_DOWNLOAD_SHEET, BREAD_EDRPOU,
  buildBreadReports, normalizeRawRows, breadInfoByAddr, breadDownloadPlan, breadDownloadStampRequests, xlsxUrl,
};
