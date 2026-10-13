// ============================================================
// СПИСАННЯ ВИПІЧКИ І КУЛІНАРІЇ
//
// Продавець з телефона подає списання: дата (сьогодні або вчора), товари
// з усього асортименту випічки і кулінарії, кількість. Сума рахується за
// собівартістю (поки колонки "Собівартість" в "Ассортименті" немає - за
// продажною ціною з колонки D, див. woProducts_).
//
// Кожна юрособа - ОКРЕМА Google-таблиця. Куди піде списання, вирішує
// ЄДРПОУ точки з колонки T Довідника ТТ (порожньо = BREAD_EDRPOU).
// Поміняли ЄДРПОУ в Довіднику - наступні списання точки самі підуть
// у таблицю нової юрособи. Старі рядки лишаються там, де були.
//
// Прийом - щодня до WO_DEADLINE (і в суботу, і в неділю). До дедлайну
// продавець може видалити своє сьогоднішнє списання.
// Рядки, старші за WO_KEEP_DAYS днів (за датою списання), щоночі
// переносяться на лист "Архів" тієї ж таблиці.
//
// Разово: w01_setupWriteOffs() в Actions.gs - створює таблиці і тригер.
// ============================================================

var WO_DEADLINE   = '13:00';
var WO_KEEP_DAYS  = 31;
var WO_BOOKS_KEY  = 'wo_books';          // {edrpou: {id, name}}
var WO_LATE_KEY   = 'wo_late';           // дата, на яку прийом відкрито до кінця дня
var WO_SHEET      = 'Списания';          // назви листів і шапки - російською, як в основній таблиці
var WO_ARCH       = 'Архив';
var WO_SUM        = 'Сводная';
var WO_OLD_NAMES  = { 'Списання': 'Списания', 'Архів': 'Архив', 'Зведена': 'Сводная' };  // перші таблиці
var WO_MAX_ITEMS  = 150;
var WO_MAX_QTY    = 500;
var WO_HEAD = ['ID', 'Подано', 'Дата списания', 'Торговая точка', '№ ТТ', 'ЕГРПОУ',
               'Категория', 'Штрихкод', 'Товар', 'Количество', 'Цена', 'Сумма', 'Цена по', 'Ключ ТТ'];
var WO_COLS = WO_HEAD.length;
// Індекси колонок (з нуля)
var WC = { id: 0, at: 1, date: 2, store: 3, code: 4, edrpou: 5, cat: 6, barcode: 7,
           name: 8, qty: 9, price: 10, sum: 11, src: 12, key: 13 };

// ============================================================
// ЮРОСОБИ І ТАБЛИЦІ
// ============================================================

function woEdrpouOf_(store) {
  return String((store && store.edrpou) || BREAD_EDRPOU).trim();
}

function woBooks_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(WO_BOOKS_KEY) || '{}'); }
  catch (e) { return {}; }
}

function woSaveBooks_(books) {
  PropertiesService.getScriptProperties().setProperty(WO_BOOKS_KEY, JSON.stringify(books));
}

function woBookUrl_(id) { return 'https://docs.google.com/spreadsheets/d/' + id + '/edit'; }

function woSheetOf_(bookId, name) {
  return SpreadsheetApp.openById(bookId).getSheetByName(name || WO_SHEET);
}

// Точки, яким доступне списання: ті, що в Довіднику мають випічку (колонка H).
// Вимкнений у пульті напрямок списання НЕ вимикає - заказ і списання незалежні.
function woStores_() {
  return loadStores_().filter(function (s) { return s.directions.indexOf('bakery') >= 0; });
}

// Усі ЄДРПОУ, що зараз зустрічаються серед точок випічки
function woEdrpouList_() {
  var seen = {}, out = [];
  [BREAD_EDRPOU, NEW_ENTITY_EDRPOU].concat(woStores_().map(woEdrpouOf_)).forEach(function (e) {
    if (e && !seen[e]) { seen[e] = 1; out.push(e); }
  });
  return out;
}

// Створити таблицю юрособи, якщо її ще немає (або стару видалили)
function woEnsureBook_(edrpou) {
  if (!/^\d{8}$/.test(edrpou)) throw new Error('ЄДРПОУ - 8 цифр: ' + edrpou);
  var books = woBooks_();
  var b = books[edrpou];
  if (b && b.id) {
    try { woSetupBook_(SpreadsheetApp.openById(b.id), edrpou); return { id: b.id, created: false }; }
    catch (e) { console.error('Таблиця списань ' + edrpou + ' не відкривається, створюю нову: ' + e.message); }
  }
  var ss = SpreadsheetApp.create(woBookTitle_(edrpou));
  ss.setSpreadsheetTimeZone('Europe/Kyiv');
  woSetupBook_(ss, edrpou);
  books[edrpou] = { id: ss.getId(), name: 'ЕГРПОУ ' + edrpou };
  woSaveBooks_(books);
  return { id: ss.getId(), created: true };
}

// Листи і оформлення. Ідемпотентно: дані не чіпає.
function woBookTitle_(edrpou) { return 'Списания ВК · ЕГРПОУ ' + edrpou; }

function woSetupBook_(ss, edrpou) {
  // таблиці, створені з українськими назвами, - перейменувати (дані на місці)
  Object.keys(WO_OLD_NAMES).forEach(function (old) {
    var sh = ss.getSheetByName(old);
    if (sh && !ss.getSheetByName(WO_OLD_NAMES[old])) sh.setName(WO_OLD_NAMES[old]);
  });
  if (ss.getName() !== woBookTitle_(edrpou)) ss.rename(woBookTitle_(edrpou));
  var live = ss.getSheetByName(WO_SHEET);
  if (!live) {
    var first = ss.getSheets()[0];
    live = (first && first.getLastRow() === 0 && ss.getSheets().length === 1)
      ? first.setName(WO_SHEET) : ss.insertSheet(WO_SHEET);
  }
  woStyleData_(live, '#E65100');
  var arch = ss.getSheetByName(WO_ARCH) || ss.insertSheet(WO_ARCH);
  woStyleData_(arch, '#5f6368');

  var sum = ss.getSheetByName(WO_SUM) || ss.insertSheet(WO_SUM);
  var q = "'" + WO_SHEET + "'!A2:N";
  sum.getRange('A1').setValue('Сводная · ЕГРПОУ ' + edrpou + ' · строки листа «' + WO_SHEET +
    '» (последние ' + WO_KEEP_DAYS + ' дней, более старые - на листе «' + WO_ARCH + '»)')
    .setFontWeight('bold').setFontSize(13);
  sum.getRange('A3').setValue('По торговым точкам').setFontWeight('bold').setFontColor('#E65100');
  sum.getRange('A4').setFormula('=IFERROR(QUERY(' + q + ', "select D, count(I), sum(J), sum(L) ' +
    'where D is not null group by D order by sum(L) desc ' +
    "label D 'Торговая точка', count(I) 'Строк', sum(J) 'Количество', sum(L) 'Сумма, грн'\", 0), \"пока пусто\")");
  sum.getRange('G3').setValue('По товарам').setFontWeight('bold').setFontColor('#E65100');
  sum.getRange('G4').setFormula('=IFERROR(QUERY(' + q + ', "select I, sum(J), sum(L) ' +
    'where I is not null group by I order by sum(L) desc ' +
    "label I 'Товар', sum(J) 'Количество', sum(L) 'Сумма, грн'\", 0), \"пока пусто\")");
  sum.setColumnWidth(1, 300); sum.setColumnWidth(7, 300);
  sum.setTabColor('#1565C0');

  ss.setActiveSheet(live);
  ss.moveActiveSheet(1);
}

function woStyleData_(sh, color) {
  sh.getRange(1, 1, 1, WO_COLS).setValues([WO_HEAD])
    .setFontWeight('bold').setBackground(color).setFontColor('#ffffff');
  sh.setFrozenRows(1);
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(2, WC.id + 1, rows, 1).setNumberFormat('@');
  sh.getRange(2, WC.at + 1, rows, 1).setNumberFormat('dd.MM.yyyy HH:mm');
  sh.getRange(2, WC.date + 1, rows, 1).setNumberFormat('dd.MM.yyyy');
  sh.getRange(2, WC.code + 1, rows, 3).setNumberFormat('@');          // № ТТ, ЄДРПОУ, категорія
  sh.getRange(2, WC.barcode + 1, rows, 1).setNumberFormat('@');
  sh.getRange(2, WC.qty + 1, rows, 1).setNumberFormat('0.###');
  sh.getRange(2, WC.price + 1, rows, 2).setNumberFormat('0.00');
  var widths = [90, 125, 105, 260, 60, 85, 100, 120, 280, 80, 70, 85, 100, 60];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.hideColumns(WC.key + 1);
}

// ============================================================
// ДАТИ І ДЕДЛАЙН
// ============================================================

function woToday_() { return formatDateDMY_(new Date()); }

function woDaysAgo_(n) {
  var d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// 'dd.MM.yyyy' або Date -> yyyyMMdd числом (для порівняння періодів)
function woNum_(v) {
  if (v instanceof Date) return Number(Utilities.formatDate(v, 'Europe/Kyiv', 'yyyyMMdd'));
  var m = String(v || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
}

function woDmyOfNum_(n) {
  var s = String(n);
  return s.slice(6, 8) + '.' + s.slice(4, 6) + '.' + s.slice(0, 4);
}

function woDateOf_(dmy) {
  var p = String(dmy).split('.');
  return new Date(+p[2], +p[1] - 1, +p[0], 12, 0, 0);
}

function woOpenedAll_() {
  return PropertiesService.getScriptProperties().getProperty(WO_LATE_KEY) === woToday_();
}

function woClosed_() {
  if (woOpenedAll_()) return false;
  var n = nowKyiv_();
  var p = WO_DEADLINE.split(':');
  return (n.hh * 60 + n.mm) >= (+p[0] * 60 + +p[1]);
}

// Дати, за які продавець може подати списання: сьогодні і вчора
function woAllowedDates_() {
  return [{ v: woToday_(), t: 'Сьогодні' }, { v: formatDateDMY_(woDaysAgo_(1)), t: 'Вчора' }];
}

// ============================================================
// АСОРТИМЕНТ ДЛЯ СПИСАННЯ
// Той самий лист "Ассортимент" випічки. Ціна - з колонки, назва якої
// містить "собів"/"себест" (якщо є і > 0), інакше продажна з колонки D.
// ============================================================

function woProducts_() {
  var cached = cacheGet_('wo_prod_v2');
  if (cached) return cached;

  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(cfg.productsSheet);
  var out = { products: [], categories: [], costCol: false };
  if (!sh || sh.getLastRow() < 2) return out;

  var w = Math.max(sh.getLastColumn(), 6);
  var data = sh.getRange(1, 1, sh.getLastRow(), w).getValues();
  var costIdx = -1;
  data[0].forEach(function (h, i) { if (costIdx < 0 && /собів|себест/i.test(String(h))) costIdx = i; });
  out.costCol = costIdx >= 0;

  // Є колонка собівартості - продавцям лише товари з заповненою собівартістю
  // (статус "стоп" тут не важливий: стоп на замовлення, а списати залишок можна).
  // Колонки немає - як раніше: усе без "стоп" за продажною ціною.
  out.noCost = [];
  var seen = {};
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var name = String(row[4] || '').trim();
    if (!name) continue;
    var barcode = String(row[2] || '').trim();
    var retail = parseFloat(String(row[3] || '').replace(',', '.')) || 0;
    var cost = costIdx >= 0 ? (parseFloat(String(row[costIdx] || '').replace(',', '.')) || 0) : 0;
    if (costIdx >= 0) {
      if (!(cost > 0)) { out.noCost.push(name); continue; }
    } else if (String(row[0] || '').trim().toLowerCase() === 'стоп') continue;
    var id = barcode || nameKey_(name);
    if (seen[id]) id = id + '#' + r;
    seen[id] = 1;
    out.products.push({
      id: id, barcode: barcode, name: name,
      category: String(row[1] || '').trim() || 'Інше',
      price: Math.round((cost > 0 ? cost : retail) * 100) / 100,
      src: cost > 0 ? 'себестоимость' : 'продажная'
    });
  }
  out.products.sort(function (a, b) {
    return a.category.localeCompare(b.category, 'uk') || a.name.localeCompare(b.name, 'uk');
  });
  out.products.forEach(function (p) {
    if (out.categories.indexOf(p.category) < 0) out.categories.push(p.category);
  });
  cachePut_('wo_prod_v2', out, 600);
  return out;
}

// ============================================================
// ЧИТАННЯ РЯДКІВ
// ============================================================

function woRowObj_(r, rowNum, bookEdrpou, sheetName) {
  return {
    row: rowNum, sheet: sheetName, book: bookEdrpou,
    id: String(r[WC.id] || ''), at: r[WC.at], date: r[WC.date], dateNum: woNum_(r[WC.date]),
    store: String(r[WC.store] || ''), code: String(r[WC.code] || ''),
    edrpou: String(r[WC.edrpou] || ''), cat: String(r[WC.cat] || ''),
    barcode: String(r[WC.barcode] || ''), name: String(r[WC.name] || ''),
    qty: Number(r[WC.qty]) || 0, price: Number(r[WC.price]) || 0, sum: Number(r[WC.sum]) || 0,
    src: String(r[WC.src] || ''), key: String(r[WC.key] || '')
  };
}

// Рядки з усіх таблиць юросіб. opt.archive - читати й "Архів".
function woReadAll_(opt) {
  opt = opt || {};
  var books = woBooks_(), out = [];
  Object.keys(books).forEach(function (e) {
    if (opt.edrpou && opt.edrpou !== e) return;
    var ss;
    try { ss = SpreadsheetApp.openById(books[e].id); }
    catch (err) { console.error('Списання ' + e + ': ' + err.message); return; }
    var names = opt.archive ? [WO_SHEET, WO_ARCH] : [WO_SHEET];
    names.forEach(function (nm) {
      var sh = ss.getSheetByName(nm);
      if (!sh || sh.getLastRow() < 2) return;
      sh.getRange(2, 1, sh.getLastRow() - 1, WO_COLS).getValues().forEach(function (r, i) {
        if (!r[WC.id]) return;
        out.push(woRowObj_(r, i + 2, e, nm));
      });
    });
  });
  return out;
}

// Рядки -> подачі (одна подача = один ID)
function woDocs_(rows) {
  var map = {}, list = [];
  rows.forEach(function (x) {
    var d = map[x.id];
    if (!d) {
      d = map[x.id] = {
        id: x.id, book: x.book, sheet: x.sheet, key: x.key, store: x.store, code: x.code,
        edrpou: x.edrpou, dateNum: x.dateNum, date: woDmyOfNum_(x.dateNum),
        at: (x.at instanceof Date) ? Utilities.formatDate(x.at, 'Europe/Kyiv', 'dd.MM.yyyy HH:mm') : String(x.at || ''),
        atNum: (x.at instanceof Date) ? x.at.getTime() : 0,
        items: [], qty: 0, total: 0
      };
      list.push(d);
    }
    d.items.push({ name: x.name, qty: x.qty, price: x.price, sum: x.sum });
    d.qty = Math.round((d.qty + x.qty) * 1000) / 1000;
    d.total = Math.round((d.total + x.sum) * 100) / 100;
  });
  list.sort(function (a, b) { return (b.atNum - a.atNum) || (b.dateNum - a.dateNum); });
  return list;
}

// ============================================================
// API ПРОДАВЦЯ
// ============================================================

function woStoreChecked_(storeId) {
  var store = findStore_(storeId);
  if (store.directions.indexOf('bakery') < 0)
    throw new Error('Для цієї ТТ списання випічки не передбачене');
  return store;
}

function apiWoProducts_(payload) {
  var store = woStoreChecked_(payload.storeId);
  var p = woProducts_();
  var edrpou = woEdrpouOf_(store);
  return {
    products: p.products.map(function (x) {
      return { id: x.id, name: x.name, category: x.category, price: x.price };
    }),
    categories: p.categories,
    costCol: p.costCol,
    dates: woAllowedDates_(),
    closed: woClosed_(),
    deadline: WO_DEADLINE,
    edrpou: edrpou,
    hasBook: !!(woBooks_()[edrpou] || {}).id
  };
}

function apiWoSubmit_(payload) {
  var docId = String(payload.docId || '');
  if (!/^[a-z0-9]{8,40}$/i.test(docId)) throw new Error('Оновіть сторінку і спробуйте ще раз');
  var store = woStoreChecked_(payload.storeId);
  if (woClosed_()) throw new Error('Прийом списань на сьогодні закрито о ' + WO_DEADLINE + '. Подати можна завтра до ' + WO_DEADLINE + '.');

  var date = String(payload.date || '');
  var dates = woAllowedDates_().map(function (d) { return d.v; });
  if (dates.indexOf(date) < 0) throw new Error('Списання можна подати лише за сьогодні або вчора');

  var props = PropertiesService.getScriptProperties();
  var prev = props.getProperty('oid_wo_' + docId);
  if (prev) { var r0 = JSON.parse(prev); r0.duplicate = true; return r0; }

  var edrpou = woEdrpouOf_(store);
  var book = woBooks_()[edrpou];
  if (!book || !book.id)
    throw new Error('Для юрособи ЄДРПОУ ' + edrpou + ' ще не створено таблицю списань. Повідомте керівника.');

  // ціни - тільки з сервера, телефону не віримо
  var byId = {};
  woProducts_().products.forEach(function (p) { byId[p.id] = p; });
  var merged = {}, order = [];
  (payload.items || []).forEach(function (it) {
    var p = byId[String(it && it.id)];
    if (!p) throw new Error('Товар не знайдено в асортименті - оновіть сторінку');
    var q = parseFloat(String(it.qty).replace(',', '.'));
    if (!(q > 0)) return;
    if (!merged[p.id]) { merged[p.id] = 0; order.push(p.id); }
    merged[p.id] = Math.round((merged[p.id] + q) * 1000) / 1000;
  });
  if (!order.length) throw new Error('Не вибрано жодного товару');
  if (order.length > WO_MAX_ITEMS) throw new Error('Забагато позицій в одному списанні');

  var now = new Date();
  var wdate = woDateOf_(date);
  var total = 0, qty = 0;
  var values = order.map(function (id) {
    var p = byId[id], q = merged[id];
    if (q > WO_MAX_QTY) throw new Error('Перевірте кількість: ' + p.name + ' - ' + q);
    var s = Math.round(p.price * q * 100) / 100;
    total += s; qty += q;
    return [docId, now, wdate, store.label, store.code, edrpou, p.category, p.barcode,
            p.name, q, p.price, s, p.src, store.id];
  });
  total = Math.round(total * 100) / 100;

  var result = {
    docId: docId, store: store.label, woDate: date, edrpou: edrpou,
    positions: values.length, qty: Math.round(qty * 1000) / 1000, total: total,
    time: Utilities.formatDate(now, 'Europe/Kyiv', 'HH:mm'),
    date: woToday_()                       // день подачі: за ним нічна чистка прибирає ключ
  };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('BUSY: спробуйте ще раз за хвилину');
  try {
    if (props.getProperty('oid_wo_' + docId)) {
      var r1 = JSON.parse(props.getProperty('oid_wo_' + docId)); r1.duplicate = true; return r1;
    }
    var sh = woSheetOf_(book.id);
    if (!sh) throw new Error('У таблиці списань немає листа «' + WO_SHEET + '». Запустіть w01_setupWriteOffs.');
    var last = sh.getLastRow();
    // запасна перевірка на дубль: ID уже в хвості листа
    if (last > 1) {
      var take = Math.min(last - 1, 3000);
      var ids = sh.getRange(last - take + 1, 1, take, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === docId) { result.duplicate = true; return result; }
    }
    if (last + values.length > sh.getMaxRows())
      sh.insertRowsAfter(sh.getMaxRows(), values.length + 200);
    sh.getRange(last + 1, 1, values.length, WO_COLS).setValues(values);
    SpreadsheetApp.flush();
    props.setProperty('oid_wo_' + docId, JSON.stringify(result));
  } finally { try { lock.releaseLock(); } catch (e) {} }

  try { CacheService.getScriptCache().remove('wo_brief'); } catch (e) {}
  result.duplicate = false;
  return result;
}

// "Мої списання": усе, що ще не пішло в архів, з таблиць усіх юросіб
function apiWoMine_(payload) {
  var store = woStoreChecked_(payload.storeId);
  var rows = woReadAll_({}).filter(function (x) { return x.key === store.id; });
  var docs = woDocs_(rows);
  var today = woToday_(), closed = woClosed_();
  var monthFrom = Math.floor(woNum_(today) / 100) * 100 + 1;
  var sum = 0, month = 0;
  docs.forEach(function (d) {
    d.canDelete = !closed && d.at.indexOf(today) === 0;
    sum += d.total;
    if (d.dateNum >= monthFrom) month += d.total;
    delete d.atNum; delete d.key; delete d.sheet;
  });
  return {
    docs: docs, closed: closed, deadline: WO_DEADLINE, keepDays: WO_KEEP_DAYS,
    total: Math.round(sum * 100) / 100, month: Math.round(month * 100) / 100,
    edrpou: woEdrpouOf_(store)
  };
}

// Продавець видаляє СВОЄ СЬОГОДНІШНЄ списання до дедлайну
function apiWoDelete_(payload) {
  var store = woStoreChecked_(payload.storeId);
  if (woClosed_()) throw new Error('Після ' + WO_DEADLINE + ' видалити списання вже не можна. Зверніться до керівника.');
  var docId = String(payload.docId || '');
  var res = woDeleteDoc_(docId, function (x) {
    if (x.key !== store.id) throw new Error('Це списання іншої точки');
    var day = (x.at instanceof Date) ? formatDateDMY_(x.at) : String(x.at || '').slice(0, 10);
    if (day !== woToday_()) throw new Error('Видалити можна лише списання, подане сьогодні');
  }, false);
  if (!res.removed) throw new Error('Списання не знайдено - можливо, його вже видалили');
  adminLog_('Продавець видалив списання', store.label + ' - за ' + res.date + ', позицій ' + res.removed +
            ', ' + res.total + ' грн (ID ' + docId + ')');
  return res;
}

// Видалити всі рядки подачі. check(row) кидає помилку, якщо видаляти не можна.
function woDeleteDoc_(docId, check, withArchive) {
  if (!/^[a-z0-9]{8,40}$/i.test(docId)) throw new Error('Невірний ID списання');
  var books = woBooks_();
  var removed = 0, total = 0, date = '', store = '';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Сервер зайнятий, спробуйте ще раз');
  try {
    Object.keys(books).forEach(function (e) {
      var ss;
      try { ss = SpreadsheetApp.openById(books[e].id); } catch (err) { return; }
      (withArchive ? [WO_SHEET, WO_ARCH] : [WO_SHEET]).forEach(function (nm) {
        var sh = ss.getSheetByName(nm);
        if (!sh || sh.getLastRow() < 2) return;
        var hits = [];
        sh.getRange(2, 1, sh.getLastRow() - 1, WO_COLS).getValues().forEach(function (r, i) {
          if (String(r[WC.id]) !== docId) return;
          var x = woRowObj_(r, i + 2, e, nm);
          if (check) check(x);
          hits.push(x.row);
          total += x.sum; date = woDmyOfNum_(x.dateNum); store = x.store;
        });
        // знизу вгору, суцільними шматками
        for (var j = hits.length - 1; j >= 0;) {
          var end = hits[j], start = end;
          while (j > 0 && hits[j - 1] === start - 1) { j--; start--; }
          // Таблиця не дає видалити ВСІ незакріплені рядки - лишаємо запасний
          if (sh.getMaxRows() - (end - start + 1) < 2) sh.insertRowsAfter(sh.getMaxRows(), 1);
          sh.deleteRows(start, end - start + 1);
          j--;
        }
        removed += hits.length;
      });
    });
    if (removed) PropertiesService.getScriptProperties().deleteProperty('oid_wo_' + docId);
  } finally { try { lock.releaseLock(); } catch (e) {} }
  try { CacheService.getScriptCache().remove('wo_brief'); } catch (e) {}
  return { removed: removed, total: Math.round(total * 100) / 100, date: date, store: store };
}

// ============================================================
// АРХІВ: щоночі рядки старші WO_KEEP_DAYS днів -> лист "Архів"
// ============================================================

function woArchive_() {
  var cut = woNum_(woDaysAgo_(WO_KEEP_DAYS));
  var books = woBooks_(), moved = 0;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) throw new Error('Сервер зайнятий, архів - наступного разу');
  try {
    Object.keys(books).forEach(function (e) {
      var ss;
      try { ss = SpreadsheetApp.openById(books[e].id); } catch (err) { console.error(err.message); return; }
      var live = ss.getSheetByName(WO_SHEET), arch = ss.getSheetByName(WO_ARCH);
      if (!live || !arch || live.getLastRow() < 2) return;
      var n = live.getLastRow() - 1;
      var data = live.getRange(2, 1, n, WO_COLS).getValues();
      var old = [], keep = [];
      data.forEach(function (r) {
        if (!r[WC.id]) return;
        var d = woNum_(r[WC.date]);
        (d && d < cut ? old : keep).push(r);
      });
      if (!old.length) return;
      // спершу дописуємо в архів, потім переписуємо робочий лист:
      // збій посередині дасть хіба дубль в архіві, але не втрату
      var al = arch.getLastRow();
      if (al + old.length > arch.getMaxRows()) arch.insertRowsAfter(arch.getMaxRows(), old.length + 200);
      arch.getRange(al + 1, 1, old.length, WO_COLS).setValues(old);
      live.getRange(2, 1, n, WO_COLS).clearContent();
      if (keep.length) live.getRange(2, 1, keep.length, WO_COLS).setValues(keep);
      SpreadsheetApp.flush();
      moved += old.length;
      console.log('Списання ' + e + ': в архів ' + old.length + ', лишилось ' + keep.length);
    });
  } finally { try { lock.releaseLock(); } catch (e) {} }
  try { CacheService.getScriptCache().remove('wo_brief'); } catch (e) {}
  return { moved: moved, before: woDmyOfNum_(cut) };
}

// Тригер щоночі (ставить w01_setupWriteOffs)
function woNightly() {
  try { woArchive_(); } catch (e) { console.error('woNightly: ' + e.message); }
  try { woIndexSheet_(); } catch (e) { console.error('woNightly, зміст: ' + e.message); }
}

function woInstallTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'woNightly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('woNightly').timeBased().everyDays(1).atHour(2).create();
}

// Створити таблиці для всіх ЄДРПОУ точок випічки + тригер
function woSetup_() {
  var out = woEdrpouList_().map(function (e) {
    var r = woEnsureBook_(e);
    return { edrpou: e, id: r.id, created: r.created, url: woBookUrl_(r.id) };
  });
  woInstallTrigger_();
  try { woIndexSheet_(); } catch (e) { console.error('Вкладка "' + WO_SHEET + '" в таблиці випічки: ' + e.message); }
  return out;
}

// Вкладка "Списання" в основній таблиці випічки - зміст: посилання на таблиці
// списань кожної юрособи і скільки точок у неї пише. Переписується повністю
// при w01 / "Создать таблицы" в пульті і щоночі (кількість точок свіжа).
function woIndexSheet_() {
  var cfg = dirCfg_('bakery');
  var ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  var sh = ss.getSheetByName(WO_SHEET) || ss.insertSheet(WO_SHEET);
  var books = woBooks_(), cnt = {};
  woStores_().forEach(function (st) { var e = woEdrpouOf_(st); cnt[e] = (cnt[e] || 0) + 1; });
  var rows = Object.keys(books).sort(function (a, b) { return (cnt[b] || 0) - (cnt[a] || 0); })
    .map(function (e) {
      var url = woBookUrl_(books[e].id);
      return ['ЕГРПОУ ' + e, cnt[e] || 0,
              '=HYPERLINK("' + url + '", "Открыть таблицу списаний")'];
    });
  sh.clear();
  sh.getRange(1, 1).setValue('Списания выпечки и кулинарии - отдельная таблица на каждое юрлицо')
    .setFontWeight('bold').setFontSize(12);
  sh.getRange(2, 1).setValue('Юрлицо точки - по колонке T (ЕГРПОУ) Довідника ТТ. Новое юрлицо - пульт → Списания → «Создать недостающие таблицы».')
    .setFontColor('#666666');
  var head = sh.getRange(4, 1, 1, 3).setValues([['Юрлицо', 'Точек', 'Таблица']]);
  ss.getSheetByName(cfg.productsSheet) && ss.getSheetByName(cfg.productsSheet).getRange(1, 2)
    .copyTo(head, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  if (rows.length) {
    sh.getRange(5, 1, rows.length, 3).setValues(rows);
    sh.getRange(4, 1, rows.length + 1, 3).setBorder(true, true, true, true, true, true);
    sh.getRange(5, 2, rows.length, 1).setHorizontalAlignment('center');
  } else {
    sh.getRange(5, 1).setValue('Таблиц ещё нет - запустите w01_setupWriteOffs');
  }
  sh.setColumnWidth(1, 160); sh.setColumnWidth(2, 70); sh.setColumnWidth(3, 220);
  return rows.length;
}

// ============================================================
// ПУЛЬТ
// ============================================================

// Період -> [from, to] у вигляді yyyyMMdd
function woPeriod_(p) {
  var t = woNum_(new Date());
  var y = Math.floor(t / 10000), m = Math.floor(t / 100) % 100;
  switch (String(p || 'month')) {
    case 'today':     return { from: t, to: t, title: 'сегодня' };
    case 'yesterday': var yd = woNum_(woDaysAgo_(1)); return { from: yd, to: yd, title: 'вчера' };
    case 'week':      return { from: woNum_(woDaysAgo_(6)), to: t, title: '7 дней' };
    case 'prev':
      var py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      return { from: py * 10000 + pm * 100 + 1, to: py * 10000 + pm * 100 + 31, title: 'прошлый месяц' };
    default:          return { from: y * 10000 + m * 100 + 1, to: t, title: 'этот месяц' };
  }
}

function woPeriodRows_(per, edrpou) {
  var archive = per.from < woNum_(woDaysAgo_(WO_KEEP_DAYS));
  return woReadAll_({ archive: archive, edrpou: edrpou || '' })
    .filter(function (x) { return x.dateNum >= per.from && x.dateNum <= per.to; });
}

// Плашка на головному екрані пульта
function admWoBrief_() {
  var c = cacheGet_('wo_brief');
  if (c) { c.closed = woClosed_(); c.openedAll = woOpenedAll_(); return c; }
  var t = woNum_(new Date()), mFrom = Math.floor(t / 100) * 100 + 1;
  var rows = woReadAll_({});
  var today = { docs: {}, sum: 0, stores: {} }, month = 0;
  rows.forEach(function (x) {
    if (x.dateNum >= mFrom && x.dateNum <= t) month += x.sum;
    var day = (x.at instanceof Date) ? formatDateDMY_(x.at) : '';
    if (day === woToday_()) { today.docs[x.id] = 1; today.sum += x.sum; today.stores[x.key] = 1; }
  });
  var out = {
    todayDocs: Object.keys(today.docs).length, todayStores: Object.keys(today.stores).length,
    todaySum: Math.round(today.sum * 100) / 100, monthSum: Math.round(month * 100) / 100,
    books: Object.keys(woBooks_()).length, deadline: WO_DEADLINE
  };
  cachePut_('wo_brief', out, 60);
  out.closed = woClosed_(); out.openedAll = woOpenedAll_();
  return out;
}

function admWoStats_(payload) {
  var per = woPeriod_(payload.period);
  var only = String(payload.edrpou || '');
  var rows = woPeriodRows_(per, only);
  var books = woBooks_();
  var stores = woStores_();
  var label = {};
  stores.forEach(function (s) { label[s.id] = s; });

  var byStore = {}, byProd = {}, byDay = {}, byEnt = {}, docs = {};
  var total = 0, qty = 0, src = {};
  rows.forEach(function (x) {
    total += x.sum; qty += x.qty; docs[x.id] = 1; src[x.src] = 1;
    var s = byStore[x.key] || (byStore[x.key] = { id: x.key, label: x.store, code: x.code,
                                                   edrpou: x.edrpou, sum: 0, qty: 0, docs: {} });
    s.sum += x.sum; s.qty += x.qty; s.docs[x.id] = 1;
    var pk = x.barcode || x.name;
    var p = byProd[pk] || (byProd[pk] = { name: x.name, cat: x.cat, sum: 0, qty: 0 });
    p.sum += x.sum; p.qty += x.qty;
    byDay[x.dateNum] = (byDay[x.dateNum] || 0) + x.sum;
    var en = byEnt[x.book] || (byEnt[x.book] = { sum: 0, qty: 0, stores: {} });
    en.sum += x.sum; en.qty += x.qty; en.stores[x.key] = 1;
  });
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var r3 = function (v) { return Math.round(v * 1000) / 1000; };

  var storeList = Object.keys(byStore).map(function (k) {
    var s = byStore[k], cur = label[k];
    return { id: k, label: cur ? cur.label : s.label, code: cur ? cur.code : s.code,
             edrpou: s.edrpou, nowEdrpou: cur ? woEdrpouOf_(cur) : '',
             sum: r2(s.sum), qty: r3(s.qty), docs: Object.keys(s.docs).length };
  }).sort(function (a, b) { return b.sum - a.sum; });

  var prodList = Object.keys(byProd).map(function (k) {
    var p = byProd[k]; return { name: p.name, cat: p.cat, sum: r2(p.sum), qty: r3(p.qty) };
  }).sort(function (a, b) { return b.sum - a.sum; }).slice(0, 20);

  var dayList = Object.keys(byDay).map(Number).sort(function (a, b) { return b - a; })
    .map(function (d) { return { date: woDmyOfNum_(d), sum: r2(byDay[d]) }; });

  // точки, які ще нічого не списали за період (серед тих, кому доступно)
  var silent = stores.filter(function (s) {
    return !byStore[s.id] && (!only || woEdrpouOf_(s) === only);
  }).map(function (s) { return s.label; });

  // ЄДРПОУ з Довідника, для яких немає таблиці - їхні списання не приймуться
  var missing = {};
  stores.forEach(function (s) {
    var e = woEdrpouOf_(s);
    if (!(books[e] && books[e].id)) (missing[e] = missing[e] || []).push(s.label);
  });

  var bookList = Object.keys(books).map(function (e) {
    var id = books[e].id, live = '';
    try {
      var sh = woSheetOf_(id);
      if (sh) live = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx&gid=' + sh.getSheetId();
    } catch (err) {}
    var en = byEnt[e] || { sum: 0, qty: 0, stores: {} };
    return {
      edrpou: e, name: 'ЕГРПОУ ' + e, url: woBookUrl_(id), xlsx: live,
      sum: r2(en.sum), qty: r3(en.qty), active: Object.keys(en.stores).length,
      storesNow: stores.filter(function (s) { return woEdrpouOf_(s) === e; }).length
    };
  }).sort(function (a, b) { return b.storesNow - a.storesNow; });

  var p = woProducts_();
  return {
    period: String(payload.period || 'month'), periodTitle: per.title,
    from: woDmyOfNum_(per.from), to: woDmyOfNum_(Math.min(per.to, woNum_(new Date()))),
    edrpou: only, total: r2(total), qty: r3(qty), docs: Object.keys(docs).length,
    storesCount: storeList.length, storesAll: stores.length,
    stores: storeList, products: prodList, days: dayList, silent: silent,
    books: bookList,
    missing: Object.keys(missing).map(function (e) { return { edrpou: e, stores: missing[e] }; }),
    priceSrc: Object.keys(src).join(', ') || (p.costCol ? 'себестоимость' : 'продажная'),
    costCol: p.costCol, prodCount: p.products.length, noCost: p.noCost || [],
    closed: woClosed_(), openedAll: woOpenedAll_(), deadline: WO_DEADLINE, keepDays: WO_KEEP_DAYS
  };
}

function admWoStore_(payload) {
  var per = woPeriod_(payload.period);
  var key = String(payload.storeId || '');
  var docs = woDocs_(woPeriodRows_(per, '').filter(function (x) { return x.key === key; }));
  var cur = null;
  woStores_().forEach(function (s) { if (s.id === key) cur = s; });
  var books = woBooks_();
  var e = cur ? woEdrpouOf_(cur) : '';
  var total = 0, qty = 0;
  docs.forEach(function (d) { total += d.total; qty += d.qty; delete d.atNum; delete d.key; });
  return {
    id: key, label: cur ? cur.label : (docs[0] ? docs[0].store : key), code: cur ? cur.code : '',
    edrpou: e, bookUrl: (books[e] && books[e].id) ? woBookUrl_(books[e].id) : '',
    period: String(payload.period || 'month'), periodTitle: per.title,
    from: woDmyOfNum_(per.from), to: woDmyOfNum_(Math.min(per.to, woNum_(new Date()))),
    docs: docs, total: Math.round(total * 100) / 100, qty: Math.round(qty * 1000) / 1000
  };
}

function admWoDelete_(payload) {
  var docId = String(payload.docId || '');
  var res = woDeleteDoc_(docId, null, true);
  if (!res.removed) throw new Error('Списание не найдено');
  adminLog_('Видалено списання (пульт)', res.store + ' - за ' + res.date + ', рядків ' + res.removed +
            ', ' + res.total + ' грн (ID ' + docId + ')');
  return res;
}

function admWoOpen_(payload) {
  var props = PropertiesService.getScriptProperties();
  if (payload.on) props.setProperty(WO_LATE_KEY, woToday_());
  else props.deleteProperty(WO_LATE_KEY);
  adminLog_(payload.on ? 'Списання: відкрито до кінця дня' : 'Списання: звичайний режим', 'дедлайн ' + WO_DEADLINE);
  return { closed: woClosed_(), openedAll: woOpenedAll_() };
}

function admWoArchive_() {
  var r = woArchive_();
  adminLog_('Списання: архів', 'перенесено рядків ' + r.moved + ' (дата списання до ' + r.before + ')');
  return r;
}

function admWoSetup_() {
  var r = woSetup_();
  adminLog_('Списання: таблиці', r.map(function (x) {
    return x.edrpou + (x.created ? ' створено' : ' є');
  }).join('; '));
  return r;
}
