// === КОНФИГУРАЦИЯ ===
const ROUTES_STORES_SHEET_NAME = 'Адреса ТТ';
const PRODUCTS_SHEET_NAME = 'Ассортимент';
const HIDDEN_RAW_DATA_SHEET_NAME = '_Сырые_Заказы_ВК';
const FORMATTED_ORDERS_SHEET_NAME = 'Заказы ВК';
const SUMMARY_SHEET_NAME = 'Сводная ВК';
const MIN_ORDER_AMOUNT = 0;
const MAX_QUANTITY_PER_PRODUCT = 1000;
const MAX_PRODUCTS_PER_ORDER = 500;
// === КОНЕЦ КОНФИГУРАЦИИ ===

const scriptProperties = PropertiesService.getScriptProperties();

// ============================================================
// УТИЛИТЫ
// ============================================================

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// Быстрое форматирование даты — заменяет Utilities.formatDate в циклах (900x быстрее)
function formatDateDMY(date) {
  return String(date.getDate()).padStart(2,'0') + '.' +
         String(date.getMonth()+1).padStart(2,'0') + '.' +
         date.getFullYear();
}

function formatTimestamp(date) {
  return String(date.getHours()).padStart(2,'0') + ':' +
         String(date.getMinutes()).padStart(2,'0') + ':' +
         String(date.getSeconds()).padStart(2,'0');
}

// ============================================================
// КЭШИРОВАНИЕ
// ============================================================

function getCached(key) {
  try {
    var val = CacheService.getScriptCache().get(key);
    return val ? JSON.parse(val) : null;
  } catch(e) { return null; }
}

function setCached(key, data, seconds) {
  try {
    var str = JSON.stringify(data);
    if (str.length < 90000) CacheService.getScriptCache().put(key, str, seconds || 600);
  } catch(e) {}
}

function invalidateCache() {
  CacheService.getScriptCache().removeAll([
    'products_v1', 'stores_v1', 'orders_today_v1',
    'barcodes_v1', 'sheets_initialized'
  ]);
  console.log('✅ Кэш очищен');
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================

function ensureSheetsExist() {
  var ss = getSpreadsheet();

  var productsSheet = ss.getSheetByName(PRODUCTS_SHEET_NAME);
  if (!productsSheet) {
    productsSheet = ss.insertSheet(PRODUCTS_SHEET_NAME);
    var headers = ['Статус', 'Категория', 'Штрих-код', 'Цена', 'Название', 'Наявність'];
    productsSheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setBackground('#4CAF50').setFontColor('#FFFFFF').setFontWeight('bold');
    productsSheet.setFrozenRows(1);
    var data = [
      ['', 'Випічка', '2984670066468', 37.50, 'Випічка Пампушка з часником 300г', ''],
      ['', 'Випічка', '2984670068158', 29.50, 'Випічка Сосиска в тісті 1шт', ''],
      ['', 'Випічка', '2984670066529', 38.50, 'Випічка Хліб Козацький з часником 500г', ''],
      ['', 'Випічка', '2984670066536', 36.00, 'Випічка Хліб Мюнхенський 500г', ''],
      ['', 'Випічка', '2984670073824', 28.70, 'Випічка Хліб Селянський 400г', ''],
      ['', 'Кулінарія', '2984670074791', 20.00, 'Кулінарія Капуста тушкована 145г', ''],
      ['', 'Кулінарія', '2984670066550', 70.00, 'Кулінарія Обід Картопля з рубл.котлетою 240г', ''],
      ['', 'Кулінарія', '2984670078850', 70.00, 'Кулінарія Обід Картопля з шніцелем 240г', ''],
      ['', 'Кулінарія', '2984670066598', 69.60, 'Кулінарія Окрошка 480г', ''],
      ['', 'Кулінарія', '2984670066604', 29.50, 'Кулінарія Рублені котлети 1шт', ''],
      ['', 'Кулінарія', '2984670066628', 50.00, 'Кулінарія Салат Оселедець під шубою 195г', ''],
      ['', 'Кулінарія', '2984670066642', 65.00, 'Кулінарія Солянка 330г', ''],
      ['', 'Кулінарія', '2984670066611', 43.00, 'Кулінарія Салат Олів\'є 165г', ''],
    ];
    productsSheet.getRange(2, 1, data.length, headers.length).setValues(data);
    productsSheet.getRange(2, 3, data.length, 1).setNumberFormat('@');
    productsSheet.autoResizeColumns(1, headers.length);
  }

  var storesSheet = ss.getSheetByName(ROUTES_STORES_SHEET_NAME);
  if (!storesSheet) {
    storesSheet = ss.insertSheet(ROUTES_STORES_SHEET_NAME);
    storesSheet.getRange(1, 1, 1, 1).setValues([['Адрес ТТ']])
      .setBackground('#2196F3').setFontColor('#FFFFFF').setFontWeight('bold');
    storesSheet.setFrozenRows(1);
    var addresses = [
      ['м. Харків вул. Амосова, 5А'],['м. Харків вул. Астрономічна, 44 Г'],
      ['м. Харків вул. Богдана Хмельницького, 8'],['м. Харків вул. Бучми, 32'],
      ['м. Харків вул. Бучми, 32Б1'],['м. Харків вул. Бучми, 52'],
      ['м. Харків вул. Валентинівська, 24 Б'],['м. Харків вул. Валентинівська, 50 А'],
      ['м. Харків вул. Гарібальді, 1'],['м. Харків вул. Гвардій Широнінців, 54'],
      ['м. Харків вул. Нескорених, 4 Д'],['м. Харків вул. Нескорених, 33'],
      ['м. Харків вул. Грозненська, 38'],['м. Харків вул. Зернова, 6/5'],['м. Харків вул. Зубенка, 23'],
      ['м. Харків вул. Зубенка, 31В5'],['м. Харків вул. Качанівська,19'],
      ['м. Харків вул. Краснодарська, 171/З'],['м. Харків вул. Михайля Семенка 17'],
      ['м. Харків вул. Ньютона, 102'],['м. Харків вул. Ньютона, 111'],
      ['м. Харків вул. Олімпійська, 9А'],['м. Харків вул. Переяславська, 23'],
      ['м. Харків вул. Полевая, 83'],['м. Харків вул. Роганська, 130/4'],
      ['м. Харків вул. Роганська, 148'],['м. Харків вул. Салтівське Шосе, 264 В'],
      ['м. Харків вул. Танкопія, 16'],['м. Харків вул. Шевченко, 341'],
      ['м. Харків пл. Героїв Небесної Сотні, 14/1'],['м. Харків пров. Іскринський, 19 В'],
      ['м. Харків пр-т Байрона, 138/1'],['м. Харків пр-т Байрона, 156'],
      ['м. Харків пр-т Байрона, 163 А'],['м. Харків пр-т Героїв Харкова, 160'],
      ['м. Харків пр-т Петра Григоренка, 37'],['м. Харків пр-т Ювілейний, 67'],
      ['м. Харків пр-т Тракторобудівників, 95'],
    ];
    storesSheet.getRange(2, 1, addresses.length, 1).setValues(addresses);
    storesSheet.autoResizeColumns(1, 1);
  }

  var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  if (!rawSheet) {
    rawSheet = ss.insertSheet(HIDDEN_RAW_DATA_SHEET_NAME);
    var rh = ['Дата', 'Час', 'Адрес ТТ', 'Категорія', 'Штрих-код', 'Назва', 'Ціна', 'Кількість'];
    rawSheet.getRange(1, 1, 1, rh.length).setValues([rh])
      .setBackground('#9E9E9E').setFontColor('#FFFFFF').setFontWeight('bold');
    rawSheet.setFrozenRows(1);
    rawSheet.hideSheet();
  }

  return true;
}

// ============================================================
// НОРМАЛИЗАЦИЯ АДРЕСОВ
// ============================================================

function normalizeAddress(address, preserveCase) {
  if (!address || typeof address !== 'string') return '';
  var cleaned = String(address).trim();
  cleaned = cleaned.replace(/^(м|г|місто|город)\.?\s*харк(о|і)в\s*,?\s*/i, '');
  cleaned = cleaned.replace(/^(вул|ул|улиця|пр-т|проспект|пл|площа|пров|провулок)\.?\s*/i, '');
  cleaned = cleaned.trim();
  if (preserveCase && cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  } else if (!preserveCase) {
    cleaned = cleaned.toLowerCase();
  }
  return cleaned;
}

// ============================================================
// WEB APP
// ============================================================

function doGet() {
  ensureSheetsExist();
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Заказ выпечки и кулинарии')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

// ============================================================
// ЧТЕНИЕ ДАННЫХ — с кэшем
// ============================================================

function getSheetDataInternal(sheetName, startRow, startCol, numCols) {
  try {
    var sheet = getSpreadsheet().getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < startRow) return [];
    return sheet.getRange(startRow, startCol, sheet.getLastRow() - startRow + 1, numCols).getValues();
  } catch(e) {
    console.error('Ошибка чтения "' + sheetName + '": ' + e.toString());
    return [];
  }
}

// Живое чтение — вызывается только когда кэш пуст или истёк
function getStoresWithOrdersToday() {
  try {
    var rawSheet = getSpreadsheet().getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    var result = new Set();
    if (!rawSheet || rawSheet.getLastRow() < 2) return result;

    var today = formatDateDMY(new Date());
    var allData = rawSheet.getRange(2, 1, rawSheet.getLastRow() - 1, 3).getValues();

    for (var i = 0; i < allData.length; i++) {
      var store = String(allData[i][2] || '').trim();
      if (!store || store.length < 5) continue;
      var raw = allData[i][0];
      var rowDate = raw instanceof Date ? formatDateDMY(raw) : String(raw).trim().substring(0, 10);
      if (rowDate === today) result.add(normalizeAddress(store, false));
    }
    return result;
  } catch(e) {
    console.error('Помилка getStoresWithOrdersToday: ' + e.toString());
    return new Set();
  }
}

// Кэшированная версия — 60 сек, сбрасывается при новом заказе
function getStoresWithOrdersToday_cached() {
  var cached = getCached('orders_today_v1');
  if (cached) return new Set(cached);
  var result = getStoresWithOrdersToday();
  setCached('orders_today_v1', Array.from(result), 60);
  return result;
}

// Список магазинов кэшируется на 1 час, заказы — 60 сек
function getStoresOrderStatus_cached() {
  try {
    var allStores = getCached('stores_v1');
    if (!allStores) {
      var storesSheet = getSpreadsheet().getSheetByName(ROUTES_STORES_SHEET_NAME);
      allStores = [];
      if (storesSheet && storesSheet.getLastRow() > 1) {
        allStores = storesSheet.getRange(2, 1, storesSheet.getLastRow()-1, 1)
          .getValues().map(function(r) { return String(r[0]||'').trim(); }).filter(Boolean);
      }
      setCached('stores_v1', allStores, 3600);
    }

    var storesWithOrders = getStoresWithOrdersToday_cached();
    var available = [], ordered = [], seen = {};

    allStores.forEach(function(store) {
      if (!store || seen[store]) return;
      seen[store] = true;
      if (storesWithOrders.has(normalizeAddress(store, false))) ordered.push(store);
      else available.push(store);
    });

    function streetKey(addr) {
      return addr.replace(/^м\.\s*Харків\s*/i,'')
        .replace(/^(вул\.|пр-т|пл\.|пров\.)\s*/i,'').trim().toLowerCase();
    }
    function ukSort(a,b) { return streetKey(a).localeCompare(streetKey(b),'uk'); }

    return { available: available.sort(ukSort), ordered: ordered.sort(ukSort) };
  } catch(e) {
    console.error('Помилка getStoresOrderStatus: ' + e.toString());
    return { available: [], ordered: [] };
  }
}

function getAllProductsForClient() {
  try {
    var data = getSheetDataInternal(PRODUCTS_SHEET_NAME, 2, 1, 6);
    if (!data.length) return {};
    var result = {};
    data.forEach(function(row) {
      var status = String(row[0]||'').toLowerCase().trim();
      if (status === 'стоп' || status === '#') return;
      var category = String(row[1]||'').trim();
      var barcode  = String(row[2]||'').trim();
      var price    = parseFloat(String(row[3]||'0').replace(',','.')) || 0;
      var name     = String(row[4]||'Без назви').trim();
      var avail    = String(row[5]||'').toLowerCase().trim();
      if (!barcode || !category) return;
      var availStatus = avail === 'ні' || avail === 'нет' || avail === 'no' ? 'unavailable'
                      : avail === 'мало' || avail === 'low' ? 'low' : 'available';
      if (!result[category]) result[category] = [];
      result[category].push({ barcode, name, price, category, availability: availStatus });
    });
    return result;
  } catch(e) {
    console.error('Помилка getAllProductsForClient: ' + e.toString());
    return {};
  }
}

function getAllProductsForClient_cached() {
  var cached = getCached('products_v1');
  if (cached) return cached;
  var result = getAllProductsForClient();
  setCached('products_v1', result, 600);
  return result;
}

function getValidBarcodesSet_cached() {
  var cached = getCached('barcodes_v1');
  if (cached) return new Set(cached);
  var data = getSheetDataInternal(PRODUCTS_SHEET_NAME, 2, 1, 6);
  var barcodes = [];
  data.forEach(function(row) {
    var s = String(row[0]||'').toLowerCase().trim();
    if (s !== 'стоп' && s !== '#') barcodes.push(String(row[2]));
  });
  setCached('barcodes_v1', barcodes, 600);
  return new Set(barcodes);
}

// Главная функция загрузки формы
function getInitialFormData() {
  try {
    // ensureSheetsExist только при первом запуске за сутки
    if (!getCached('sheets_initialized')) {
      ensureSheetsExist();
      setCached('sheets_initialized', true, 86400);
    }
    var storesStatus = getStoresOrderStatus_cached();
    var productsByCategory = getAllProductsForClient_cached();
    return {
      stores: storesStatus.available,
      storesWithOrders: storesStatus.ordered,
      productsByCategory: productsByCategory,
      minOrderAmount: MIN_ORDER_AMOUNT
    };
  } catch(e) {
    console.error('КРИТИЧНА ПОМИЛКА getInitialFormData: ' + e.toString());
    return { stores: [], storesWithOrders: [], productsByCategory: {}, minOrderAmount: MIN_ORDER_AMOUNT };
  }
}

// ============================================================
// ЗАПИСЬ ЗАКАЗА
// ============================================================

function recordOrder(orderData) {
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(5000)) {
      Utilities.sleep(3000);
      if (!lock.tryLock(5000))
        return { success: false, message: '❌ Сервер зайнятий, спробуйте через 10 секунд.' };
    }

    var ss = getSpreadsheet();
    var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    if (!rawSheet) {
      ensureSheetsExist();
      rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
      if (!rawSheet) return { success: false, message: '❌ Лист не знайдено.' };
    }

    var storeAddress = String(orderData.selectedStore || orderData.store || '').trim();
    if (!storeAddress) return { success: false, message: '❌ Не обрано адресу ТТ.' };

    var products = orderData.products;
    if (!products || !products.length) return { success: false, message: '❌ Не обрано жодного товару.' };

    // Проверка дубля — живое чтение (не кэш, т.к. нужна точность)
    var storesWithOrders = getStoresWithOrdersToday();
    if (storesWithOrders.has(normalizeAddress(storeAddress, false)))
      return { success: false, message: '⚠️ Ця ТТ вже зробила замовлення сьогодні:\n' + storeAddress };

    // Валидация штрихкодов из кэша
    var validBarcodes = getValidBarcodesSet_cached();
    var badProducts = products.filter(function(p) { return !validBarcodes.has(String(p.barcode)); });
    if (badProducts.length)
      return { success: false, message: '❌ Продукти не знайдені: ' + badProducts.map(function(p){return p.name;}).join(', ') };

    var badQty = products.filter(function(p) { return p.quantity <= 0 || p.quantity > MAX_QUANTITY_PER_PRODUCT; });
    if (badQty.length)
      return { success: false, message: '❌ Некоректна кількість: ' + badQty.map(function(p){return p.name;}).join(', ') };

    var now = new Date();
    var dateStr = formatDateDMY(now);
    var timeStr = formatTimestamp(now);

    var rows = products
      .filter(function(p) { return p.barcode && p.quantity > 0; })
      .map(function(p) {
        return [dateStr, timeStr, storeAddress, String(p.category||''),
                String(p.barcode), String(p.name||''), Number(p.price)||0, Number(p.quantity)||0];
      });

    if (!rows.length) return { success: false, message: '❌ Немає товарів для запису.' };

    rawSheet.getRange(rawSheet.getLastRow()+1, 1, rows.length, 8).setValues(rows);
    SpreadsheetApp.flush();

    // Сбрасываем только кэш заказов — продукты и адреса не трогаем
    CacheService.getScriptCache().remove('orders_today_v1');

    var totalSum = rows.reduce(function(s,r) { return s + r[6]*r[7]; }, 0);
    console.log('✅ Записано: ' + storeAddress + ', ' + rows.length + ' позицій');

    return {
      success: true,
      message: '✅ Замовлення прийнято!\n📍 ' + storeAddress +
               '\n📦 Позицій: ' + rows.length + '\n💰 Сума: ' + totalSum.toFixed(2) + ' грн'
    };
  } catch(e) {
    console.error('❌ recordOrder: ' + e.toString());
    return { success: false, message: '❌ Помилка сервера. Спробуйте ще раз.' };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// ============================================================
// ГЕНЕРАЦИЯ ОТЧЁТОВ
// Правило: _internal функции вызываются когда лок УЖЕ захвачен снаружи.
// Публичные обёртки берут лок сами — для ручного вызова из меню.
// ============================================================

// Настраивает conditional formatting на листе "Заказы ВК" — запускать ОДИН РАЗ
// После этого отчёт обновляется только данными (clearContents + setValues = 2 API-вызова)
// ============================================================
// ЗАМЕНИТЬ ЭТИ ДВЕ ФУНКЦИИ В Code.gs
// ============================================================

// Запускать ОДИН РАЗ после замены — обновляет conditional formatting
// setupOrdersSheetFormatting — теперь только очищает старые правила
// (вызывать один раз после замены кода)
function setupOrdersSheetFormatting() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(FORMATTED_ORDERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(FORMATTED_ORDERS_SHEET_NAME);
  sheet.clearConditionalFormatRules();
  SpreadsheetApp.flush();
  console.log('✅ Старі правила форматування видалено');
}

// ── ЗВІТ ЗАМОВЛЕНЬ ──────────────────────────────────────────

function generateFormattedOrdersReport_internal() {
  var ss = getSpreadsheet();
  var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  if (!rawSheet || rawSheet.getLastRow() < 2) return;

  var today = formatDateDMY(new Date());
  var allData = rawSheet.getRange(2, 1, rawSheet.getLastRow()-1, 8).getValues();

  // Тільки рядки за сьогодні, пропускаємо порожні
  var todayRows = [];
  for (var i = 0; i < allData.length; i++) {
    var raw = allData[i][0];
    var rowDate = raw instanceof Date ? formatDateDMY(raw) : String(raw).trim().substring(0,10);
    if (rowDate !== today) continue;
    var name = String(allData[i][5]||'').trim();
    var qty  = Number(allData[i][7])||0;
    if (!name || qty <= 0) continue; // пропускаємо порожні рядки
    todayRows.push(allData[i]);
  }

  // Групуємо: storeOrders[адреса][категорія] = [{name,price,qty}]
  var storeOrders = {};
  todayRows.forEach(function(row) {
    var addr = String(row[2]||'').trim();
    if (!addr) return;
    var cat  = String(row[3]||'Інше').trim() || 'Інше';
    if (!storeOrders[addr]) storeOrders[addr] = {};
    if (!storeOrders[addr][cat]) storeOrders[addr][cat] = [];
    storeOrders[addr][cat].push({
      name:  String(row[5]||'').trim(),
      price: Number(row[6])||0,
      qty:   Number(row[7])||0
    });
  });

  // Список всіх ТТ для "без замовлень"
  var storesSheet = ss.getSheetByName(ROUTES_STORES_SHEET_NAME);
  var allStores = [];
  if (storesSheet && storesSheet.getLastRow() > 1) {
    allStores = storesSheet.getRange(2, 1, storesSheet.getLastRow()-1, 1)
      .getValues().map(function(r){return String(r[0]||'').trim();}).filter(Boolean);
  }
  var orderedNorm = {};
  Object.keys(storeOrders).forEach(function(addr) {
    orderedNorm[normalizeAddress(addr,false)] = true;
  });
  var missingStores = allStores.filter(function(a) {
    return !orderedNorm[normalizeAddress(a,false)];
  });

  var CAT_ORDER  = ['Випічка', 'Кулінарія'];
  var CAT_ICONS  = { 'Випічка': '🥐 ', 'Кулінарія': '🍲 ' };

  // Збираємо дані і індекси рядків по типу
  var reportData = [];
  var g = { // groups
    title:[], subtitle:[], header:[],
    store:[], cat:[], data:[], total:[], grand:[],
    missHead:[], miss:[]
  };

  function push(vals, type) {
    reportData.push(vals);
    var r = reportData.length;
    if (type && g[type]) g[type].push(r);
  }

  push(['Замовлення випічки та кулінарії — ' + today, '', '', ''], 'title');
  push(['Всього ТТ із замовленнями: ' + Object.keys(storeOrders).length +
        ' з ' + allStores.length, '', '', ''], 'subtitle');
  push(['', '', '', ''], null);
  push(['№', 'Назва товару', 'Кіл-ть', 'Сума, грн'], 'header');

  var num = 1, grandTotal = 0, grandQty = 0;

  Object.keys(storeOrders).sort(function(a,b){return a.localeCompare(b,'uk');})
    .forEach(function(store) {

    push([store, '', '', ''], 'store');
    var storeTotal = 0, storeQty = 0;

    // Спочатку Випічка, Кулінарія — потім решта
    var cats = CAT_ORDER.filter(function(c){return storeOrders[store][c] && storeOrders[store][c].length;});
    Object.keys(storeOrders[store]).forEach(function(c){
      if (CAT_ORDER.indexOf(c) < 0 && storeOrders[store][c].length) cats.push(c);
    });

    cats.forEach(function(cat) {
      var icon = CAT_ICONS[cat] || '📦 ';
      push([icon + cat, '', '', ''], 'cat');
      storeOrders[store][cat].forEach(function(item) {
        var sum = Math.round(item.price * item.qty * 100) / 100;
        storeTotal += sum;
        storeQty  += item.qty;
        push([num++, item.name, item.qty, sum], 'data');
      });
    });

    push(['РАЗОМ по ТТ:', '', storeQty, storeTotal], 'total');
    push(['', '', '', ''], null);
    grandTotal += storeTotal;
    grandQty   += storeQty;
  });

  if (Object.keys(storeOrders).length > 0) {
    push(['ЗАГАЛЬНИЙ ПІДСУМОК', '', grandQty, grandTotal], 'grand');
    push(['', '', '', ''], null);
  }

  if (missingStores.length > 0) {
    push(['', '', '', ''], null);
    push(['❌ ТТ без замовлень (' + missingStores.length + '):', '', '', ''], 'missHead');
    missingStores.sort(function(a,b){return a.localeCompare(b,'uk');})
      .forEach(function(s){ push(['  • ' + s, '', '', ''], 'miss'); });
  }

  // ── Записуємо в лист ───────────────────────────────────────
  var sheet = ss.getSheetByName(FORMATTED_ORDERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(FORMATTED_ORDERS_SHEET_NAME);

  sheet.clear();
  sheet.clearConditionalFormatRules();

  var nRows = reportData.length;
  sheet.getRange(1, 1, nRows, 4).setValues(reportData);

  // Явно задаємо формати колонок — щоб % з колонки D не перетікав у C
  sheet.getRange(1, 1, nRows, 1).setNumberFormat('@');        // A: текст
  sheet.getRange(1, 2, nRows, 1).setNumberFormat('0');        // B: ціле число
  sheet.getRange(1, 3, nRows, 1).setNumberFormat('#,##0.00'); // C: гроші
  sheet.getRange(1, 4, nRows, 1).setNumberFormat('@');        // D: текст (% як рядок)

  // Базове форматування всього листа одним викликом
  sheet.getRange(1, 1, nRows, 4)
    .setFontFamily('Arial').setFontSize(10)
    .setVerticalAlignment('middle')
    .setFontColor('#212121').setBackground('#FFFFFF');
  sheet.setRowHeights(1, nRows, 24);

  // Хелпер: масив A1-нотацій для getRangeList
  function rl(rows, c1, c2) {
    c2 = c2 || c1;
    return rows.map(function(r){ return c1+r+':'+c2+r; });
  }

  // Заголовок відчіту — синій
  if (g.title.length)
    sheet.getRangeList(rl(g.title,'A','D'))
      .setBackground('#1565C0').setFontColor('#FFFFFF')
      .setFontWeight('bold').setFontSize(14).setHorizontalAlignment('left');

  // Підзаголовок — блідо-синій
  if (g.subtitle.length)
    sheet.getRangeList(rl(g.subtitle,'A','D'))
      .setBackground('#E3F2FD').setFontColor('#1565C0')
      .setFontSize(11).setHorizontalAlignment('left');

  // Шапка таблиці — темно-сіра
  if (g.header.length)
    sheet.getRangeList(rl(g.header,'A','D'))
      .setBackground('#37474F').setFontColor('#FFFFFF')
      .setFontWeight('bold').setHorizontalAlignment('center');

  // Рядки магазину — синій
  if (g.store.length)
    sheet.getRangeList(rl(g.store,'A','D'))
      .setBackground('#1976D2').setFontColor('#FFFFFF').setFontWeight('bold');

  // Категорія — жовто-оранжевий
  if (g.cat.length)
    sheet.getRangeList(rl(g.cat,'A','D'))
      .setBackground('#FFF8E1').setFontColor('#E65100').setFontWeight('bold');

  // Рядки даних — зебра
  if (g.data.length) {
    var even = g.data.filter(function(_,i){return i%2===1;});
    var odd  = g.data.filter(function(_,i){return i%2===0;});
    if (odd.length)  sheet.getRangeList(rl(odd,'A','D')).setBackground('#FFFFFF');
    if (even.length) sheet.getRangeList(rl(even,'A','D')).setBackground('#F8F9FA');
    // Колонка № — по центру
    sheet.getRangeList(rl(g.data,'A','A')).setHorizontalAlignment('center');
    // Кількість — по центру
    sheet.getRangeList(rl(g.data,'C','C')).setHorizontalAlignment('center');
    // Сума — формат числа, вправо
    sheet.getRangeList(rl(g.data,'D','D'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }

  // Разом по ТТ — зелений
  if (g.total.length) {
    sheet.getRangeList(rl(g.total,'A','D'))
      .setBackground('#E8F5E9').setFontColor('#2E7D32').setFontWeight('bold');
    sheet.getRangeList(rl(g.total,'C','C')).setHorizontalAlignment('center');
    sheet.getRangeList(rl(g.total,'D','D'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }

  // Загальний підсумок — темно-зелений, великий
  if (g.grand.length) {
    sheet.getRangeList(rl(g.grand,'A','D'))
      .setBackground('#388E3C').setFontColor('#FFFFFF')
      .setFontWeight('bold').setFontSize(11).setHorizontalAlignment('left');
    sheet.getRangeList(rl(g.grand,'D','D')).setNumberFormat('#,##0.00');
  }

  // ТТ без замовлень
  if (g.missHead.length)
    sheet.getRangeList(rl(g.missHead,'A','D'))
      .setBackground('#FFEBEE').setFontColor('#C62828').setFontWeight('bold');
  if (g.miss.length)
    sheet.getRangeList(rl(g.miss,'A','A')).setFontColor('#C62828');

  // Ширина колонок
  sheet.setColumnWidth(1, 45);    // №
  sheet.autoResizeColumn(2);      // Назва товару — авто
  sheet.setColumnWidth(3, 90);    // Кіл-ть
  sheet.setColumnWidth(4, 120);   // Сума, грн

  sheet.setFrozenRows(4);

  SpreadsheetApp.flush();
  console.log('✅ Звіт замовлень: ' + nRows + ' рядків, ' + (num-1) + ' позицій');
}

// ── ЗВЕДЕНА ТАБЛИЦЯ ─────────────────────────────────────────

function generateSummaryReport_internal() {
  var ss = getSpreadsheet();
  var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  if (!rawSheet || rawSheet.getLastRow() < 2) return;

  var today = formatDateDMY(new Date());
  var allData = rawSheet.getRange(2, 1, rawSheet.getLastRow()-1, 8).getValues();

  var todayRows = [];
  for (var i = 0; i < allData.length; i++) {
    var raw = allData[i][0];
    var rowDate = raw instanceof Date ? formatDateDMY(raw) : String(raw).trim().substring(0,10);
    if (rowDate !== today) continue;
    var name = String(allData[i][5]||'').trim();
    var qty  = Number(allData[i][7])||0;
    if (!name || qty <= 0) continue;
    todayRows.push(allData[i]);
  }
  if (!todayRows.length) return;

  // Зводимо: cat -> name -> {qty, sum}
  var summary = {}, grandQty = 0, grandSum = 0;
  todayRows.forEach(function(row) {
    var cat   = String(row[3]||'Інше').trim() || 'Інше';
    var name  = String(row[5]||'').trim();
    var qty   = Number(row[7])||0;
    var price = Number(row[6])||0;
    if (!summary[cat]) summary[cat] = {};
    if (!summary[cat][name]) summary[cat][name] = {qty:0, sum:0};
    summary[cat][name].qty += qty;
    summary[cat][name].sum  = Math.round((summary[cat][name].sum + price*qty)*100)/100;
    grandQty += qty;
    grandSum  = Math.round((grandSum + price*qty)*100)/100;
  });

  var CAT_ORDER = ['Випічка', 'Кулінарія'];
  var CAT_ICONS = { 'Випічка': '🥐 ', 'Кулінарія': '🍲 ' };

  var reportData = [];
  var g = { title:[], header:[], catRow:[], data:[], total:[] };

  function push(vals, type) {
    reportData.push(vals);
    var r = reportData.length;
    if (type && g[type]) g[type].push(r);
  }

  // Колонки: Асортимент | Кількість, шт | Сума, грн | %
  push(['Зведена таблиця — ' + today, '', '', ''], 'title');
  push(['Асортимент', 'Кількість, шт', 'Сума, грн', '% від заг.'], 'header');

  var allCats = CAT_ORDER.filter(function(c){return summary[c];});
  Object.keys(summary).forEach(function(c){
    if (CAT_ORDER.indexOf(c) < 0) allCats.push(c);
  });

  allCats.forEach(function(cat) {
    var items  = summary[cat];
    var catQty = 0, catSum = 0;
    Object.keys(items).forEach(function(n){
      catQty += items[n].qty;
      catSum  = Math.round((catSum + items[n].sum)*100)/100;
    });

    var icon = CAT_ICONS[cat] || '📦 ';
    var pct  = grandQty > 0 ? (catQty/grandQty*100).toFixed(1)+'%' : '0%';
    push([icon + cat, catQty, catSum, pct], 'catRow');

    Object.keys(items).sort(function(a,b){return a.localeCompare(b,'uk');})
      .forEach(function(name) {
        var d = items[name];
        var dp = grandQty > 0 ? (d.qty/grandQty*100).toFixed(1)+'%' : '0%';
        push([name, d.qty, d.sum, dp], 'data');
      });

    push(['', '', '', ''], null);
  });

  push(['ЗАГАЛОМ', grandQty, grandSum, '100%'], 'total');

  // ── Записуємо ─────────────────────────────────────────────
  var sheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SUMMARY_SHEET_NAME);
  sheet.clear();
  sheet.clearConditionalFormatRules();

  var nRows = reportData.length;
  sheet.getRange(1, 1, nRows, 4).setValues(reportData);

  // Явно задаємо формати колонок — щоб % з колонки D не перетікав у C
  sheet.getRange(1, 1, nRows, 1).setNumberFormat('@');        // A: текст
  sheet.getRange(1, 2, nRows, 1).setNumberFormat('0');        // B: ціле число
  sheet.getRange(1, 3, nRows, 1).setNumberFormat('#,##0.00'); // C: гроші
  sheet.getRange(1, 4, nRows, 1).setNumberFormat('@');        // D: текст (% як рядок)

  sheet.getRange(1, 1, nRows, 4)
    .setFontFamily('Arial').setFontSize(10)
    .setVerticalAlignment('middle')
    .setFontColor('#212121').setBackground('#FFFFFF');
  sheet.setRowHeights(1, nRows, 24);

  function rl(rows, c1, c2) {
    c2 = c2 || c1;
    return rows.map(function(r){ return c1+r+':'+c2+r; });
  }

  if (g.title.length)
    sheet.getRangeList(rl(g.title,'A','D'))
      .setBackground('#1565C0').setFontColor('#FFFFFF')
      .setFontWeight('bold').setFontSize(14).setHorizontalAlignment('center');

  if (g.header.length)
    sheet.getRangeList(rl(g.header,'A','D'))
      .setBackground('#37474F').setFontColor('#FFFFFF')
      .setFontWeight('bold').setHorizontalAlignment('center');

  if (g.catRow.length) {
    sheet.getRangeList(rl(g.catRow,'A','D'))
      .setBackground('#FFF3E0').setFontColor('#E65100').setFontWeight('bold').setFontSize(11);
    sheet.getRangeList(rl(g.catRow,'B','D')).setHorizontalAlignment('center');
    sheet.getRangeList(rl(g.catRow,'C','C')).setNumberFormat('#,##0.00');
  }

  if (g.data.length) {
    var even = g.data.filter(function(_,i){return i%2===1;});
    var odd  = g.data.filter(function(_,i){return i%2===0;});
    if (odd.length)  sheet.getRangeList(rl(odd,'A','D')).setBackground('#FFFFFF');
    if (even.length) sheet.getRangeList(rl(even,'A','D')).setBackground('#F8F9FA');
    // Назва — відступ зліва
    sheet.getRangeList(rl(g.data,'A','A')).setTextRotation(0); // просто щоб не було зайвого
    sheet.getRangeList(rl(g.data,'B','D')).setHorizontalAlignment('center');
    sheet.getRangeList(rl(g.data,'C','C')).setNumberFormat('#,##0.00');
  }

  if (g.total.length)
    sheet.getRangeList(rl(g.total,'A','D'))
      .setBackground('#388E3C').setFontColor('#FFFFFF')
      .setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center');

  // Ширина колонок
  sheet.autoResizeColumn(1);    // Асортимент — авто
  sheet.setColumnWidth(2, 120); // Кількість
  sheet.setColumnWidth(3, 120); // Сума
  sheet.setColumnWidth(4, 100); // %
  sheet.setFrozenRows(2);

  SpreadsheetApp.flush();
  console.log('✅ Зведена таблиця оновлена');
}

// Публичные обёртки с локом — для ручного вызова из меню
function generateFormattedOrdersReport() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try { generateFormattedOrdersReport_internal(); }
  catch(e) { console.error('❌ generateFormattedOrdersReport: ' + e.toString()); }
  finally { try { lock.releaseLock(); } catch(e) {} }
}

function generateSummaryReport() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try { generateSummaryReport_internal(); }
  catch(e) { console.error('❌ generateSummaryReport: ' + e.toString()); }
  finally { try { lock.releaseLock(); } catch(e) {} }
}

// ============================================================
// АВТООБНОВЛЕНИЕ (триггер каждые 3 минуты)
// ============================================================

function autoMaintenance() {
  var now = new Date();
  var hour = now.getHours();
  if (hour < 7 || hour >= 18) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { console.log('⏳ Lock зайнятий, пропускаю'); return; }

  try {
    var raw = getSpreadsheet().getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    if (!raw || raw.getLastRow() < 2) return;

    var currentCount = raw.getLastRow();
    var lastCount = scriptProperties.getProperty('lastProcessedRowCount_VK');
    if (lastCount && parseInt(lastCount) === currentCount) {
      console.log('ℹ️ Нових замовлень немає');
      return;
    }

    // Вызываем _internal — лок уже держим, дедлока нет
    generateFormattedOrdersReport_internal();
    generateSummaryReport_internal();

    scriptProperties.setProperty('lastProcessedRowCount_VK', currentCount.toString());
    console.log('✅ Звіти оновлено о ' + formatTimestamp(now));
  } catch(e) {
    console.error('❌ autoMaintenance: ' + e.toString());
  } finally {
    lock.releaseLock();
  }
}

// Запустить один раз после деплоя — пересоздаёт триггер
function updateTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('autoMaintenance').timeBased().everyMinutes(5).create();
  console.log('✅ Тригер: autoMaintenance кожні 5 хвилин');
}

// ============================================================
// УДАЛЕНИЕ ЗАКАЗА
// ============================================================

function deleteOrderForStoreFromDialog(storeAddress) {
  try {
    var ss = getSpreadsheet();
    var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    if (!rawSheet || rawSheet.getLastRow() < 2) throw new Error('Немає даних для видалення');

    var today = formatDateDMY(new Date());
    var normStore = normalizeAddress(storeAddress, false);
    var allData = rawSheet.getRange(2, 1, rawSheet.getLastRow()-1, 3).getValues();
    var toDelete = [];

    for (var i = allData.length-1; i >= 0; i--) {
      var raw = allData[i][0];
      var rowDate = raw instanceof Date ? formatDateDMY(raw) : String(raw).trim().substring(0,10);
      if (rowDate === today && normalizeAddress(allData[i][2], false) === normStore) {
        toDelete.push(i + 2);
      }
    }

    if (!toDelete.length) throw new Error('Замовлення для "' + storeAddress + '" не знайдено');

    toDelete.forEach(function(idx) { rawSheet.deleteRow(idx); });
    SpreadsheetApp.flush();

    // Сбрасываем кэш заказов
    CacheService.getScriptCache().remove('orders_today_v1');

    generateFormattedOrdersReport();
    generateSummaryReport();

    return 'Видалено ' + toDelete.length + ' позицій для "' + storeAddress + '". ТТ може замовити знову.';
  } catch(e) {
    logError('deleteOrderForStoreFromDialog', e, { storeAddress });
    throw e;
  }
}

// ============================================================
// ЛОГИРОВАНИЕ ОШИБОК
// ============================================================

function logError(fnName, error, info) {
  try {
    var ss = getSpreadsheet();
    var log = ss.getSheetByName('_Лог_Ошибок');
    if (!log) {
      log = ss.insertSheet('_Лог_Ошибок');
      log.appendRow(['Дата и время','Функция','Ошибка','Доп. информация','Stack Trace']);
      log.hideSheet();
      log.getRange(1,1,1,5).setBackground('#FF0000').setFontColor('#FFFFFF')
        .setFontWeight('bold').setHorizontalAlignment('center');
    }
    log.appendRow([new Date(), fnName, error.toString(), JSON.stringify(info||{}), error.stack||'']);
  } catch(e) { console.error('Не вдалося записати помилку: ' + e); }
}

// ============================================================
// ЭКСПОРТ EXCEL
// ============================================================

function getExcelExportUrl(sheetName) {
  var sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('Лист "' + sheetName + '" не знайдено');
  return 'https://docs.google.com/spreadsheets/d/' + getSpreadsheet().getId() +
         '/export?format=xlsx&gid=' + sheet.getSheetId();
}
function exportOrdersToExcel() { return getExcelExportUrl(FORMATTED_ORDERS_SHEET_NAME); }
function exportSummaryToExcel() { return getExcelExportUrl(SUMMARY_SHEET_NAME); }

// ============================================================
// МЕНЮ
// ============================================================

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('📋 Випічка/Кулінарія')
      .addItem('📅 Фільтр за датою', 'showDateFilterDialog')
      .addItem('🔄 Оновити звіти', 'forceGenerateReports')
      .addItem('🎨 Форматувати листи', 'formatAllSheets')
      .addSeparator()
      .addItem('📊 Експорт "Заказы ВК" в Excel', 'downloadOrdersAsExcel')
      .addItem('📊 Експорт "Сводна ВК" в Excel', 'downloadSummaryAsExcel')
      .addSeparator()
      .addItem('🗑️ Видалити замовлення ТТ', 'showDeleteOrderDialog')
      .addItem('🧹 Скинути кеш адрес/товарів', 'invalidateCache')
      .addSeparator()
      .addItem('🧹 Очистити лог помилок', 'clearErrorLog')
      .addToUi();
  } catch(e) { console.error('Помилка меню: ' + e); }
}

function forceGenerateReports() {
  generateFormattedOrdersReport();
  generateSummaryReport();
  formatRawDataSheet();
  SpreadsheetApp.getUi().alert('Звіти оновлено!');
}

function downloadOrdersAsExcel() {
  try {
    var url = exportOrdersToExcel();
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(
        '<html><body><h3>Заказы ВК</h3>' +
        '<a href="' + url + '" target="_blank" style="font-size:16px;">📥 Скачать Excel</a><br><br>' +
        '<button onclick="google.script.host.close()">Закрыть</button></body></html>'
      ).setWidth(400).setHeight(150), 'Экспорт в Excel');
  } catch(e) { SpreadsheetApp.getUi().alert('Ошибка: ' + e.toString()); }
}

function downloadSummaryAsExcel() {
  try {
    var url = exportSummaryToExcel();
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(
        '<html><body><h3>Сводная ВК</h3>' +
        '<a href="' + url + '" target="_blank" style="font-size:16px;">📥 Скачать Excel</a><br><br>' +
        '<button onclick="google.script.host.close()">Закрыть</button></body></html>'
      ).setWidth(400).setHeight(150), 'Экспорт в Excel');
  } catch(e) { SpreadsheetApp.getUi().alert('Ошибка: ' + e.toString()); }
}

function showDeleteOrderDialog() {
  try {
    var ui = SpreadsheetApp.getUi();
    var ss = getSpreadsheet();
    var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    if (!rawSheet || rawSheet.getLastRow() < 2) {
      ui.alert('Інформація', 'На сьогодні немає замовлень.', ui.ButtonSet.OK); return;
    }

    var today = formatDateDMY(new Date());
    var allData = rawSheet.getRange(2, 1, rawSheet.getLastRow()-1, 3).getValues();
    var origAddresses = new Set();
    allData.forEach(function(row) {
      var raw = row[0];
      var rowDate = raw instanceof Date ? formatDateDMY(raw) : String(raw).trim().substring(0,10);
      if (rowDate === today) origAddresses.add(String(row[2]||'').trim());
    });

    if (!origAddresses.size) {
      ui.alert('Інформація', 'На сьогодні немає замовлень для видалення.', ui.ButtonSet.OK); return;
    }

    var list = Array.from(origAddresses).sort(function(a,b){return a.localeCompare(b,'uk');});
    var html = '<html><head><base target="_top"><style>' +
      'body{font-family:Arial,sans-serif;padding:20px}' +
      'select{width:100%;padding:10px;font-size:14px;margin-bottom:20px;border:2px solid #ddd;border-radius:4px}' +
      '.btns{display:flex;gap:10px;justify-content:flex-end}' +
      'button{padding:10px 20px;font-size:14px;border:none;border-radius:4px;cursor:pointer}' +
      '#del{background:#d32f2f;color:#fff}#cancel{background:#757575;color:#fff}' +
      '.warn{background:#fff3cd;border:1px solid #ffc107;padding:15px;border-radius:4px;margin-bottom:20px;color:#856404}' +
      '</style></head><body>' +
      '<div class="warn"><strong>⚠️ Увага:</strong> Видалення дозволить магазину замовити знову. Дія незворотня!</div>' +
      '<label><strong>Виберіть магазин:</strong></label>' +
      '<select id="ss"><option value="">-- Виберіть --</option>' +
      list.map(function(s){return '<option value="'+s+'">'+s+'</option>';}).join('') +
      '</select><div class="btns">' +
      '<button id="cancel" onclick="google.script.host.close()">Скасувати</button>' +
      '<button id="del" onclick="del()">🗑️ Видалити</button></div>' +
      '<script>function del(){' +
      'var v=document.getElementById("ss").value;if(!v){alert("Виберіть магазин");return}' +
      'if(!confirm("Видалити замовлення \\""+v+"\\"?"))return;' +
      'document.getElementById("del").disabled=true;document.getElementById("del").textContent="Видалення...";' +
      'google.script.run.withSuccessHandler(function(m){alert(m);google.script.host.close()})' +
      '.withFailureHandler(function(e){alert("Помилка: "+e.message);' +
      'document.getElementById("del").disabled=false;document.getElementById("del").textContent="🗑️ Видалити"})' +
      '.deleteOrderForStoreFromDialog(v);}</script></body></html>';

    ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(500).setHeight(300), '🗑️ Видалення замовлення');
  } catch(e) { SpreadsheetApp.getUi().alert('Ошибка: ' + e.toString()); }
}

function clearErrorLog() {
  try {
    var ui = SpreadsheetApp.getUi();
    if (ui.alert('Підтвердження', 'Очистити лог помилок?', ui.ButtonSet.YES_NO) === ui.Button.YES) {
      var log = getSpreadsheet().getSheetByName('_Лог_Ошибок');
      if (log) {
        log.clearContents();
        log.appendRow(['Дата и время','Функция','Ошибка','Доп. информация','Stack Trace']);
        log.getRange(1,1,1,5).setBackground('#FF0000').setFontColor('#FFFFFF')
          .setFontWeight('bold').setHorizontalAlignment('center');
        ui.alert('Лог очищено');
      } else { ui.alert('Лог не знайдено'); }
    }
  } catch(e) { SpreadsheetApp.getUi().alert('Ошибка: ' + e.toString()); }
}

// ============================================================
// ФОРМАТИРОВАНИЕ ЛИСТОВ (ручное)
// ============================================================

function formatAllSheets() {
  formatRawDataSheet();
  formatProductsSheet();
  SpreadsheetApp.getUi().alert('Форматування застосовано!');
}

function formatRawDataSheet() {
  var raw = getSpreadsheet().getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  if (!raw || raw.getLastRow() < 1) return;
  var lastRow = raw.getLastRow();
  raw.getRange(1,1,1,8).setValues([['Дата','Час','Адрес ТТ','Категорія','Штрих-код','Назва','Ціна','Кількість']])
    .setFontWeight('bold').setBackground('#1565C0').setFontColor('#FFFFFF')
    .setHorizontalAlignment('center').setFontSize(10);
  raw.setColumnWidth(1,100); raw.setColumnWidth(2,80);  raw.setColumnWidth(3,280);
  raw.setColumnWidth(4,100); raw.setColumnWidth(5,140); raw.setColumnWidth(6,280);
  raw.setColumnWidth(7,70);  raw.setColumnWidth(8,90);
  if (lastRow >= 2) {
    raw.getRange(2,1,lastRow-1,8).setFontSize(9).setVerticalAlignment('middle')
      .setBorder(true,true,true,true,true,true,'#D0D0D0',SpreadsheetApp.BorderStyle.SOLID);
    raw.getRange(2,1,lastRow-1,1).setNumberFormat('dd.MM.yyyy').setHorizontalAlignment('center');
    raw.getRange(2,2,lastRow-1,1).setHorizontalAlignment('center');
    raw.getRange(2,3,lastRow-1,1).setHorizontalAlignment('left');
    raw.getRange(2,4,lastRow-1,1).setHorizontalAlignment('center');
    raw.getRange(2,5,lastRow-1,1).setHorizontalAlignment('center').setNumberFormat('@');
    raw.getRange(2,6,lastRow-1,1).setHorizontalAlignment('left');
    raw.getRange(2,7,lastRow-1,1).setHorizontalAlignment('center').setNumberFormat('0.00');
    raw.getRange(2,8,lastRow-1,1).setHorizontalAlignment('center').setNumberFormat('0');
  }
  raw.setFrozenRows(1);
  SpreadsheetApp.flush();
}

function formatProductsSheet() {
  try {
    var sheet = getSpreadsheet().getSheetByName(PRODUCTS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 1) return;
    sheet.getRange(1,1,1,6).setFontWeight('bold').setFontSize(10)
      .setBackground('#4CAF50').setFontColor('#FFFFFF')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.setFrozenRows(1); sheet.setRowHeight(1,30);
    sheet.setColumnWidth(1,70);  sheet.setColumnWidth(2,100); sheet.setColumnWidth(3,150);
    sheet.setColumnWidth(4,80);  sheet.setColumnWidth(5,380); sheet.setColumnWidth(6,100);
    if (sheet.getLastRow() >= 2) {
      var rows = sheet.getLastRow()-1;
      sheet.getRange(2,1,rows,6).setFontSize(10).setVerticalAlignment('middle');
      sheet.getRange(2,1,rows,1).setHorizontalAlignment('center');
      sheet.getRange(2,2,rows,1).setHorizontalAlignment('center');
      sheet.getRange(2,3,rows,1).setHorizontalAlignment('center').setNumberFormat('@');
      sheet.getRange(2,4,rows,1).setHorizontalAlignment('center');
      sheet.getRange(2,5,rows,1).setHorizontalAlignment('left');
      sheet.getRange(2,6,rows,1).setHorizontalAlignment('center');
    }
  } catch(e) { console.error('Помилка formatProductsSheet: ' + e.toString()); }
}

// ============================================================
// ФИЛЬТР ПО ДАТЕ
// ============================================================

function getAvailableDates() {
  var raw = getSpreadsheet().getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  if (!raw || raw.getLastRow() < 2) return [];
  var dates = raw.getRange(2,1,raw.getLastRow()-1,1).getValues();
  var unique = {};
  dates.forEach(function(row) {
    if (row[0] instanceof Date) {
      var d = formatDateDMY(row[0]);
      var key = row[0].getFullYear() + '-' +
                String(row[0].getMonth()+1).padStart(2,'0') + '-' +
                String(row[0].getDate()).padStart(2,'0');
      if (!unique[key]) unique[key] = { value: key, display: d, count: 0 };
      unique[key].count++;
    }
  });
  return Object.values(unique).sort(function(a,b){return b.value.localeCompare(a.value);});
}

function showDateFilterDialog() {
  var raw = getSpreadsheet().getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  if (!raw || raw.getLastRow() < 2) return;
  var dates = raw.getRange(2,1,raw.getLastRow()-1,1).getValues();
  var unique = [], seen = {};
  dates.forEach(function(row) {
    if (row[0] instanceof Date) {
      var d = formatDateDMY(row[0]);
      if (!seen[d]) { seen[d]=true; unique.push(d); }
    }
  });
  unique.sort().reverse();
  var html = '<style>body{font-family:Arial;padding:15px;}' +
    'button{display:block;width:100%;padding:12px;margin:6px 0;border:none;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;}' +
    '.d{background:#E3F2FD;color:#1565C0;}.d:hover{background:#BBDEFB;}' +
    '.a{background:#4CAF50;color:#fff;}.a:hover{background:#388E3C;}' +
    '.s{text-align:center;margin-top:10px;font-size:13px;color:#666;}</style>' +
    '<button class="a" onclick="f(\'ALL\')">📋 Показати всі дати</button>';
  unique.forEach(function(d) { html += '<button class="d" onclick="f(\''+d+'\')">📅 '+d+'</button>'; });
  html += '<div class="s" id="s"></div><script>' +
    'function f(d){document.getElementById("s").innerText="Фільтрую...";' +
    'google.script.run.withSuccessHandler(function(r){document.getElementById("s").innerText=r;})' +
    '.withFailureHandler(function(e){document.getElementById("s").innerText="Помилка: "+e.message;})' +
    '.applyDateFilter(d);}</script>';
  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(html).setTitle('📅 Фільтр за датою').setWidth(250)
  );
}

function applyDateFilter(dateStr) {
  var raw = getSpreadsheet().getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  var lastRow = raw.getLastRow();
  if (lastRow < 2) return 'Немає даних';
  var filter = raw.getFilter();
  if (filter) filter.remove();
  raw.showRows(2, lastRow-1);
  if (dateStr === 'ALL') { SpreadsheetApp.flush(); return '✅ Показано всі дати (' + (lastRow-1) + ' рядків)'; }
  var allDates = raw.getRange(2,1,lastRow-1,1).getValues();
  var shown = 0, hidden = 0, i = 0;
  while (i < allDates.length) {
    var match = allDates[i][0] instanceof Date && formatDateDMY(allDates[i][0]) === dateStr;
    if (!match) {
      var start = i+2, len = 1; i++;
      while (i < allDates.length && !(allDates[i][0] instanceof Date && formatDateDMY(allDates[i][0]) === dateStr)) { len++; i++; }
      raw.hideRows(start, len); hidden += len;
    } else { shown++; i++; }
  }
  SpreadsheetApp.flush();
  return '✅ ' + dateStr + ': ' + shown + ' рядків (приховано ' + hidden + ')';
}

function clearRawFilter() {
  var raw = getSpreadsheet().getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  if (!raw) return 'Лист не знайдено';
  var filter = raw.getFilter();
  if (filter) filter.remove();
  var lastRow = raw.getLastRow();
  if (lastRow > 1) raw.showRows(2, lastRow-1);
  SpreadsheetApp.flush();
  return '✅ Фільтр знято. Показано всі ' + (lastRow-1) + ' рядків.';
}