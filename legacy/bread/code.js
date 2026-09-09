// === КОНФИГУРАЦИЯ ОВОЩИ ===
const ROUTES_STORES_SHEET_NAME = 'Адреса ТТ';
const HIDDEN_RAW_DATA_SHEET_NAME = '_Сырые_Заказы_Овочі';
const FORMATTED_ORDERS_SHEET_NAME = 'Замовлення Овочі';
const SUMMARY_SHEET_NAME = 'Зведена Овочі';
const MIN_ORDER_AMOUNT = 500;          // минимум поставщика (грн)
const PRICE_MARKUP = 1.5;              // наценка для продавцов (×1.5)
const MIN_ORDER_AMOUNT_DISPLAY = MIN_ORDER_AMOUNT * PRICE_MARKUP; // 750 грн — видят продавцы
const ORDER_TIMEOUT_MS = 5000;
const MAX_QUANTITY_PER_PRODUCT = 5000; // макс кг на позицию
const MAX_PRODUCTS_PER_ORDER = 500;

// Внешняя таблица с ценами (у вас права читателя — этого достаточно для openById)
const PRICE_SPREADSHEET_ID = '1WnxkoU_aHZg6WjrkT4cdCFrk6tMlbIsdYDGkvlaDV7w';
const PRICE_SHEET_GID = 0; // первый лист

// === КОНЕЦ КОНФИГУРАЦИИ ===

const scriptProperties = PropertiesService.getScriptProperties();

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ============================================================
// ЧТЕНИЕ ЦЕН ИЗ ВНЕШНЕЙ ТАБЛИЦЫ
// ============================================================

/**
 * Читает актуальные цены из внешней Google-таблицы.
 * Ожидаемая структура прайса:
 *   Колонка A — Название овоща
 *   Колонка B — Цена за кг
 * Заголовок в строке 1, данные со строки 2.
 * 
 * ВАЖНО: Если структура вашего прайса отличается — измените номера колонок ниже.
 */
/**
 * Читает актуальные цены из внешней Google-таблицы.
 * Структура прайса:
 *   Строка 1 — пустая
 *   Колонка A — пустая
 *   Колонка B — Название овоща (со строки 2)
 *   Колонка C — Цена за кг (со строки 2)
 */
/**
 * Читает актуальные цены из внешней Google-таблицы.
 * Фильтрует только разрешённые позиции.
 */
/**
 * Читает актуальные цены из внешней Google-таблицы.
 * Умный поиск: ищет колонки с названием и ценой автоматически,
 * даже если поставщик сдвинул данные.
 * Фильтрует по списку из листа "Налаштування".
 */
function getPricesFromExternalSheet() {
  // --- ДОБАВЛЕНО: Проверяем кэш перед тем как лезть во внешнюю таблицу ---
  var cache = CacheService.getScriptCache();
  var cachedPrices = cache.get('veg_prices_cache');
  
  if (cachedPrices) {
    console.log('⚡ Прайс завантажено з швидкого кешу');
    return JSON.parse(cachedPrices);
  }
  // -------------------------------------------------------------------------

  try {
    // 1. Читаем разрешённые позиции из листа "Налаштування"
    var allowedProducts = getAllowedProductsList();
    if (allowedProducts.length === 0) {
      console.error('Список дозволених позицій порожній');
      return [];
    }
    
    // 2. Открываем прайс поставщика (ЭТО САМАЯ ДОЛГАЯ ОПЕРАЦИЯ)
    console.log('🔄 Кеш порожній. Завантажую з таблиці постачальника...');
    var priceSS = SpreadsheetApp.openById(PRICE_SPREADSHEET_ID);
    var priceSheet = priceSS.getSheets()[0];
    
    if (!priceSheet || priceSheet.getLastRow() < 1) {
      console.error('Прайс-таблиця порожня або не знайдена');
      return [];
    }
    
    var lastRow = priceSheet.getLastRow();
    var lastCol = priceSheet.getLastColumn();
    if (lastRow < 1 || lastCol < 2) return [];
    
    // 3. Читаем ВСЕ данные из прайса
    var allData = priceSheet.getRange(1, 1, lastRow, lastCol).getValues();
    
    // 4. Умный поиск: ищем пары "текст + число" в соседних колонках
    var nameCol = -1;
    var priceCol = -1;
    var dataStartRow = -1;
    
    for (var r = 0; r < allData.length; r++) {
      for (var c = 0; c < allData[r].length - 1; c++) {
        var cellText = String(allData[r][c] || '').trim();
        var cellNext = allData[r][c + 1];
        var nextNum = parseFloat(String(cellNext || '').replace(',', '.'));
        
        if (cellText.length > 2 && !isNaN(nextNum) && nextNum > 0) {
          var lower = cellText.toLowerCase();
          var isProduct = allowedProducts.some(function(ap) {
            return lower === ap.toLowerCase() || lower.indexOf(ap.toLowerCase()) !== -1 || ap.toLowerCase().indexOf(lower) !== -1;
          });
          
          if (isProduct) {
            nameCol = c;
            priceCol = c + 1;
            dataStartRow = r;
            break;
          }
        }
      }
      if (nameCol >= 0) break;
    }
    
    if (nameCol < 0 || priceCol < 0) {
      console.error('Не вдалося знайти дані у прайсі. Колонки не визначені.');
      return [];
    }
    
    // 5. Читаем данные начиная с найденной строки
    var allowedMap = {};
    allowedProducts.forEach(function(name) {
      allowedMap[name.toLowerCase().trim()] = true;
    });
    
    var products = [];
    
    for (var i = dataStartRow; i < allData.length; i++) {
      var name = String(allData[i][nameCol] || '').trim();
      var priceRaw = allData[i][priceCol];
      var supplierPrice = parseFloat(String(priceRaw || '0').replace(',', '.')) || 0;
      
      if (!name || supplierPrice <= 0) continue;
      
      var nameKey = name.toLowerCase().trim();
      if (!allowedMap[nameKey]) continue;
      
      products.push({
        id: 'veg_' + i,
        name: name,
        supplierPrice: supplierPrice,
        displayPrice: Math.round(supplierPrice * PRICE_MARKUP * 100) / 100
      });
    }
    
    // --- ДОБАВЛЕНО: Сохраняем готовый прайс в кэш на 15 минут (900 секунд) ---
    if (products.length > 0) {
      cache.put('veg_prices_cache', JSON.stringify(products), 900);
      console.log('✅ Прайс збережено в кеш');
    }
    // -------------------------------------------------------------------------
    
    return products;
  } catch (error) {
    console.error('Помилка читання прайсу: ' + error.toString());
    return [];
  }
}
/**
 * Читает список разрешённых позиций из листа "Налаштування"
 */
function getAllowedProductsList() {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Налаштування');
    if (!sheet || sheet.getLastRow() < 2) return [];
    
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    var allowed = [];
    
    for (var i = 0; i < data.length; i++) {
      var name = String(data[i][0] || '').trim();
      var status = String(data[i][1] || '').toLowerCase().trim();
      
      if (!name) continue;
      if (status === 'стоп') continue; // пропускаем выключенные
      
      allowed.push(name);
    }
    
    return allowed;
  } catch (error) {
    console.error('Помилка читання налаштувань: ' + error.toString());
    return [];
  }
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ — создание листов
// ============================================================

function ensureSheetsExist() {
  var ss = getSpreadsheet();

  // 1. Адреса ТТ
  var storesSheet = ss.getSheetByName(ROUTES_STORES_SHEET_NAME);
  if (!storesSheet) {
    storesSheet = ss.insertSheet(ROUTES_STORES_SHEET_NAME);
    var headers = ['Адрес ТТ'];
    storesSheet.getRange(1, 1, 1, 1).setValues([headers])
      .setBackground('#2196F3').setFontColor('#FFFFFF').setFontWeight('bold');
    storesSheet.setFrozenRows(1);

    var addresses = [
      ['м. Харків вул. Амосова, 5А'],
      ['м. Харків вул. Астрономічна, 44 Г'],
      ['м. Харків вул. Богдана Хмельницького, 8'],
      ['м. Харків вул. Бучми, 32'],
      ['м. Харків вул. Бучми, 32Б1'],
      ['м. Харків вул. Бучми, 52'],
      ['м. Харків вул. Валентинівська, 24 Б'],
      ['м. Харків вул. Валентинівська, 50 А'],
      ['м. Харків вул. Гарібальді, 1'],
      ['м. Харків вул. Гвардій Широнінців, 54'],
      ['м. Харків вул. Нескорених, 4 Д'],
      ['м. Харків вул. Нескорених, 33'],
      ['м. Харків вул. Грозненська, 38'],
      ['м. Харків вул. Зубенка, 23'],
      ['м. Харків вул. Зубенка, 31В5'],
      ['м. Харків вул. Качанівська,19'],
      ['м. Харків вул. Краснодарська, 171/З'],
      ['м. Харків вул. Михайля Семенка 17'],
      ['м. Харків вул. Ньютона, 102'],
      ['м. Харків вул. Ньютона, 111'],
      ['м. Харків вул. Олімпійська, 9А'],
      ['м. Харків вул. Переяславська, 23'],
      ['м. Харків вул. Полевая, 83'],
      ['м. Харків вул. Роганська, 130/4'],
      ['м. Харків вул. Роганська, 148'],
      ['м. Харків вул. Салтівське Шосе, 264 В'],
      ['м. Харків вул. Танкопія, 16'],
      ['м. Харків вул. Шевченко, 341'],
      ['м. Харків пл. Героїв Небесної Сотні, 14/1'],
      ['м. Харків пров. Іскринський, 19 В'],
      ['м. Харків пр-т Байрона, 138/1'],
      ['м. Харків пр-т Байрона, 156'],
      ['м. Харків пр-т Байрона, 163 А'],
      ['м. Харків пр-т Героїв Харкова, 160'],
      ['м. Харків пр-т Петра Григоренка, 37'],
      ['м. Харків пр-т Ювілейний, 67'],
      ['м. Харків пр-т Тракторобудівників, 95'],
    ];
    storesSheet.getRange(2, 1, addresses.length, 1).setValues(addresses);
    storesSheet.autoResizeColumns(1, 1);
  }

  // 2. Сырые заказы овощей
  var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  if (!rawSheet) {
    rawSheet = ss.insertSheet(HIDDEN_RAW_DATA_SHEET_NAME);
    var headers = ['Дата', 'Час', 'Адрес ТТ', 'Назва овочу', 'Ціна за кг', 'Кількість (кг)', 'Сума'];
    rawSheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setBackground('#4CAF50').setFontColor('#FFFFFF').setFontWeight('bold');
    rawSheet.setFrozenRows(1);
    rawSheet.hideSheet();
  }
  // 3. Лист налаштувань (список дозволених позицій)
  var settingsSheet = ss.getSheetByName('Налаштування');
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet('Налаштування');
    
    // Заголовки
    settingsSheet.getRange(1, 1, 1, 3).setValues([['Назва овочу (як у прайсі)', 'Статус', 'Примітка']])
      .setBackground('#2E7D32').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
    settingsSheet.setFrozenRows(1);
    
    // Начальный список
    var initialProducts = [
      ['Апельсин Турция', '', ''],
      ['Мандарин (Муркот)', '', ''],
      ['Лимон', '', ''],
      ['Авокадо Хасс 18', '', ''],
      ['Яблуко Фуджі', '', ''],
      ['Яблуко Україна', '', ''],
      ['Груша Киргизька', '', ''],
      ['Виноград Кардинал', '', ''],
      ['Огірок колючка (Машенька)', '', ''],
      ['Помідор гілка', '', ''],
      ['Перець червоний', '', ''],
      ['Кабачок', '', ''],
      ['Редис', '', ''],
      ['Капуста білоголова', '', ''],
      ['Капуста Пекінська', '', ''],
      ['Часник', '', ''],
      ['Часник молодий', '', ''],
      ['Цибуля ріпчаста', '', ''],
      ['Морква', '', ''],
      ['Буряк', '', ''],
      ['Картопля', '', ''],
      ['Картопля молода', '', ''],
      ['Капуста молода', '', '']
    ];
    settingsSheet.getRange(2, 1, initialProducts.length, 3).setValues(initialProducts);
    
    settingsSheet.setColumnWidth(1, 300);
    settingsSheet.setColumnWidth(2, 100);
    settingsSheet.setColumnWidth(3, 200);
    
    // Валидация для колонки "Статус"
    var statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['', 'стоп'], true)
      .setAllowInvalid(false)
      .build();
    settingsSheet.getRange(2, 2, 100, 1).setDataValidation(statusRule);
  }

  return true;
}

// ============================================================
// НОРМАЛИЗАЦИЯ АДРЕСОВ
// ============================================================

function normalizeAddress(address, preserveCase) {
  if (!address || typeof address !== 'string') return '';
  
  let cleaned = String(address).trim();
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
    .setTitle('Замовлення овочів')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

// ============================================================
// ЧТЕНИЕ ДАННЫХ
// ============================================================

function getSheetDataInternal(sheetName, startRow, startCol, numCols) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    if (sheet.getLastRow() < startRow) return [];
    
    return sheet.getRange(startRow, startCol, sheet.getLastRow() - startRow + 1, numCols).getValues();
  } catch (error) {
    console.error('Помилка читання листа "' + sheetName + '": ' + error.toString());
    return [];
  }
}

function getStoresWithOrdersToday() {
  try {
    var ss = getSpreadsheet();
    var rawOrderSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    var storesWithOrders = new Set();

    if (!rawOrderSheet || rawOrderSheet.getLastRow() < 2) return storesWithOrders;

    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
    var lastRow = rawOrderSheet.getLastRow();
    // Читаем ОДИН раз, только 3 колонки
    var allRawData = rawOrderSheet.getRange(2, 1, lastRow - 1, 3).getValues();

    for (var i = 0; i < allRawData.length; i++) {
      var storeAddress = String(allRawData[i][2] || '').trim();
      if (!storeAddress || storeAddress.length < 5) continue;

      var cell = allRawData[i][0];
      var dateMatch = false;
      if (cell instanceof Date) {
        if (Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd.MM.yyyy') === today) dateMatch = true;
      } else {
        var s = String(cell || '').trim();
        if (s === today || s.indexOf(today) === 0) dateMatch = true;
      }

      if (dateMatch) {
        storesWithOrders.add(normalizeAddress(storeAddress, false));
      }
    }

    return storesWithOrders;
  } catch (error) {
    console.error('Помилка getStoresWithOrdersToday: ' + error.toString());
    return new Set();
  }
}

function getStoresOrderStatus() {
  try {
    var ss = getSpreadsheet();
    var storesSheet = ss.getSheetByName(ROUTES_STORES_SHEET_NAME);
    
    if (!storesSheet || storesSheet.getLastRow() < 2) {
      return { available: [], ordered: [] };
    }
    
    var data = storesSheet.getRange(2, 1, storesSheet.getLastRow() - 1, 1).getValues();
    var ordersMap = getTodayOrdersMap();
    
    var available = [];
    var ordered = [];
    var all = [];
    var seen = {};
    
    data.forEach(function(row) {
      var store = String(row[0] || '').trim();
      if (store === '' || seen[store]) return;
      seen[store] = true;
      
      var norm = normalizeAddress(store, false);
      var info = ordersMap[norm];
      
      if (info) {
        ordered.push(store);
        all.push({
          name: store,
          ordered: true,
          time: info.firstTime,
          positions: info.positions,
          kg: info.kg,
          sum: Math.round(info.supplierSum * PRICE_MARKUP * 100) / 100
        });
      } else {
        available.push(store);
        all.push({ name: store, ordered: false, time: '', positions: 0, kg: 0, sum: 0 });
      }
    });
    
    function extractStreetName(addr) {
      var cleaned = addr
        .replace(/^м\.\s*Харків\s*/i, '')
        .replace(/^(вул\.|пр-т|пл\.|пров\.)\s*/i, '')
        .trim()
        .toLowerCase();
      return cleaned;
    }
    
    function ukStreetSort(a, b) {
      var nameA = extractStreetName(a);
      var nameB = extractStreetName(b);
      return nameA.localeCompare(nameB, 'uk');
    }
    
    return {
      available: available.sort(ukStreetSort),
      ordered: ordered.sort(ukStreetSort),
      all: all.sort(function(a, b) { return ukStreetSort(a.name, b.name); })
    };
    
  } catch (error) {
    console.error('Помилка getStoresOrderStatus: ' + error.toString());
    return { available: [], ordered: [] };
  }
}

/**
 * Главная функция загрузки начальных данных для формы
 */
function getInitialFormData() {
  try {
    const storesStatus = getStoresOrderStatus();
    const products = getPricesFromExternalSheet();

    return {
      stores: storesStatus.available,
      storesWithOrders: storesStatus.ordered,
      allStores: storesStatus.all || [],
      products: products,
      minOrderAmount: MIN_ORDER_AMOUNT_DISPLAY  // 750 грн — в продажных ценах
    };
  } catch (error) {
    console.error('КРИТИЧНА ПОМИЛКА getInitialFormData: ' + error.toString());
    return { stores: [], storesWithOrders: [], products: [], minOrderAmount: MIN_ORDER_AMOUNT_DISPLAY };
  }
}

// ============================================================
// ЗАПИСЬ ЗАКАЗА
// ============================================================

function isDuplicateOrder(storeAddress) {
  const lastOrderKey = 'lastOrder_Veg_' + storeAddress;
  const lastOrderTime = scriptProperties.getProperty(lastOrderKey);
  
  if (lastOrderTime) {
    const timeDiff = Date.now() - parseInt(lastOrderTime);
    if (timeDiff < ORDER_TIMEOUT_MS) return true;
  }
  
  scriptProperties.setProperty(lastOrderKey, Date.now().toString());
  cleanupOldOrderRecords();
  return false;
}

function cleanupOldOrderRecords() {
  try {
    const allProperties = scriptProperties.getProperties();
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    for (let key in allProperties) {
      if (key.startsWith('lastOrder_Veg_')) {
        const timestamp = parseInt(allProperties[key]);
        if (timestamp < oneDayAgo) {
          scriptProperties.deleteProperty(key);
        }
      }
    }
  } catch (error) {
    console.error('Помилка cleanupOldOrderRecords: ' + error.toString());
  }
}

function validateOrder(orderData) {
  if (orderData.products.length > MAX_PRODUCTS_PER_ORDER) {
    throw new Error('Максимум позицій у замовленні: ' + MAX_PRODUCTS_PER_ORDER + '. У вас: ' + orderData.products.length);
  }
  
  const invalidProducts = [];
  
  orderData.products.forEach(product => {
    if (product.quantity > MAX_QUANTITY_PER_PRODUCT) {
      invalidProducts.push(product.name + ': ' + product.quantity + ' кг (макс. ' + MAX_QUANTITY_PER_PRODUCT + ')');
    }
    if (product.quantity <= 0 || product.quantity % 1 !== 0) {
      invalidProducts.push(product.name + ': кількість повинна бути цілим числом кг (' + product.quantity + ')');
    }
  });
  
  if (invalidProducts.length > 0) {
    throw new Error('Некоректна кількість:\n' + invalidProducts.join('\n'));
  }
  
  return true;
}

/**
 * Запись заказа овощей с перепроверкой актуальных цен
 */
function recordOrder(orderData) {
  var MAX_RETRIES = 3;
  var lock = LockService.getScriptLock();
  
  try {
    // === ПРОВЕРКА РАБОЧЕГО ВРЕМЕНИ ===
    var now = new Date();
    var currentHour = now.getHours();
    if (currentHour < 9 || currentHour >= 20) {
      return { 
        success: false, 
        message: '❌ Замовлення приймаються з 9:00 до 20:00.\nЗараз: ' + 
          Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm') 
      };
    }

    if (!lock.tryLock(5000)) {
      Utilities.sleep(3000);
      if (!lock.tryLock(5000)) {
        return { success: false, message: '❌ Сервер зайнятий, спробуйте через 10 секунд.' };
      }
    }
    
    var ss = getSpreadsheet();
    var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    
    if (!rawSheet) {
      ensureSheetsExist();
      rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
      if (!rawSheet) {
        return { success: false, message: '❌ Помилка: лист для запису не знайдено.' };
      }
    }
    
    var storeAddress = String(orderData.selectedStore || orderData.store || '').trim();
    if (!storeAddress) {
      return { success: false, message: '❌ Не обрано адресу торгової точки.' };
    }
    var normalizedStore = normalizeAddress(storeAddress, false);
    
    var products = orderData.products;
    if (!products || !products.length) {
      return { success: false, message: '❌ Не обрано жодного товару.' };
    }
    
    // === ЗАХИСТ 1: той самий запит надіслано двічі (подвійний клік, зависла сторінка) ===
    var orderToken = String(orderData.orderToken || '');
    if (orderToken && CacheService.getScriptCache().get('veg_token_' + orderToken)) {
      return { success: false, alreadyOrdered: true, message: '⚠️ Це замовлення вже було надіслано.\nПовторна відправка заблокована.' };
    }
    
    // === ЗАХИСТ 2: швидкі повторні кліки по одній ТТ ===
    if (isDuplicateOrder(normalizedStore)) {
      return { success: false, message: '⏳ Замовлення для цієї ТТ вже обробляється.\nЗачекайте 10 секунд і оновіть сторінку — не надсилайте повторно.' };
    }
    
    // === ЗАХИСТ 3: одна ТТ — одне замовлення на день ===
    var todayOrders = getTodayOrdersMap();
    if (todayOrders[normalizedStore]) {
      var ex = todayOrders[normalizedStore];
      var exSum = Math.round(ex.supplierSum * PRICE_MARKUP * 100) / 100;
      return {
        success: false,
        alreadyOrdered: true,
        storeInfo: { address: storeAddress, time: ex.firstTime, positions: ex.positions, kg: ex.kg, sum: exSum },
        message: '🚫 Ця торгова точка вже зробила замовлення сьогодні!\n📍 ' + storeAddress +
                 '\n🕐 Час: ' + ex.firstTime +
                 '\n📦 Позицій: ' + ex.positions + ' (' + ex.kg + ' кг)' +
                 '\n💰 Сума: ' + exSum.toFixed(2) + ' грн' +
                 '\n\nПовторне замовлення неможливе. Якщо потрібно щось змінити — зверніться до менеджера.'
      };
    }
    
    // === ПЕРЕПРОВЕРКА АКТУАЛЬНЫХ ЦЕН ПОСТАВЩИКА ===
    var actualPrices = getPricesFromExternalSheet();
    var priceMap = {};
    actualPrices.forEach(function(p) {
      priceMap[p.name.toLowerCase().trim()] = {
        supplierPrice: p.supplierPrice,
        displayPrice: p.displayPrice
      };
    });
    
    var priceChanges = [];
    
    // Проверка кратности и обновление цен
    for (var v = 0; v < products.length; v++) {
      var qty = Number(products[v].quantity) || 0;
      if (qty <= 0) continue;
      
      if (qty % 1 !== 0) {
        return { success: false, message: '❌ Кількість повинна бути цілим числом кг. ' + products[v].name + ': ' + qty + ' кг' };
      }
      
      var nameKey = String(products[v].name || '').toLowerCase().trim();
      if (priceMap.hasOwnProperty(nameKey)) {
        var oldDisplayPrice = Number(products[v].price) || 0;
        var newDisplayPrice = priceMap[nameKey].displayPrice;
        var newSupplierPrice = priceMap[nameKey].supplierPrice;
        
        // Сохраняем цену поставщика для записи
        products[v].supplierPrice = newSupplierPrice;
        
        if (Math.abs(oldDisplayPrice - newDisplayPrice) > 0.01) {
          priceChanges.push(products[v].name + ': ' + oldDisplayPrice.toFixed(2) + ' → ' + newDisplayPrice.toFixed(2) + ' грн/кг');
          products[v].price = newDisplayPrice;
        }
      }
    }
    
    // Проверяем минимальную сумму ПО ЦЕНАМ ПОСТАВЩИКА
    var supplierTotal = 0;
    products.forEach(function(p) {
      var qty = Number(p.quantity) || 0;
      if (qty > 0) {
        supplierTotal += (Number(p.supplierPrice) || 0) * qty;
      }
    });
    
    if (supplierTotal < MIN_ORDER_AMOUNT) {
      // Показываем продавцу в продажных ценах
      var displayTotal = 0;
      products.forEach(function(p) {
        var qty = Number(p.quantity) || 0;
        if (qty > 0) {
          displayTotal += (Number(p.price) || 0) * qty;
        }
      });
      var msg = '❌ Сума замовлення ' + displayTotal.toFixed(2) + ' грн менше мінімальної (' + MIN_ORDER_AMOUNT_DISPLAY + ' грн).';
      if (priceChanges.length > 0) {
        msg += '\n\n⚠️ Ціни змінились під час оформлення:\n' + priceChanges.join('\n');
      }
      return { success: false, message: msg };
    }
    
    // Формируем строки С ЦЕНАМИ ПОСТАВЩИКА для записи
    var timestamp = new Date();
    var dateStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'dd.MM.yyyy');
    var timeStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'HH:mm:ss');
    
    var rows = [];
    var displayTotal = 0;
    
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var qty = Number(p.quantity) || 0;
      if (qty <= 0) continue;
      var supPrice = Number(p.supplierPrice) || 0;
      var dispPrice = Number(p.price) || 0;
      
      displayTotal += dispPrice * qty;
      
      rows.push([
        dateStr,                         // A - дата
        timeStr,                         // B - время
        storeAddress,                    // C - адрес ТТ
        String(p.name || ''),            // D - название овоща
        supPrice,                        // E - цена ПОСТАВЩИКА за кг
        qty,                             // F - количество (кг)
        supPrice * qty                   // G - сума по цене ПОСТАВЩИКА
      ]);
    }
    
    if (rows.length === 0) {
      return { success: false, message: '❌ Немає товарів для запису.' };
    }
    
    // Запись с повторными попытками
    var written = false;
    var lastError = '';
    
    for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        var lastRow = rawSheet.getLastRow();
        rawSheet.getRange(lastRow + 1, 1, rows.length, 7).setValues(rows);
        SpreadsheetApp.flush();
        
        var checkData = rawSheet.getRange(lastRow + 1, 1, rows.length, 7).getValues();
        var allOk = true;
        for (var c = 0; c < checkData.length; c++) {
          if (!checkData[c][0] || !checkData[c][2] || !checkData[c][5]) {
            allOk = false;
          }
        }
        
        if (allOk) {
          written = true;
          console.log('✅ Замовлення овочів записано з ' + attempt + ' спроби. Рядків: ' + rows.length + ', ТТ: ' + storeAddress);
          break;
        } else {
          rawSheet.getRange(lastRow + 1, 1, rows.length, 7).setValues(rows);
          SpreadsheetApp.flush();
          written = true;
          break;
        }
      } catch (writeError) {
        lastError = writeError.toString();
        console.error('Спроба ' + attempt + ': ' + lastError);
        if (attempt < MAX_RETRIES) Utilities.sleep(1000 * attempt);
      }
    }
    
    // Якщо записати не вдалося — не показуємо продавцю фальшивий успіх
    if (!written) {
      return { success: false, message: '❌ Не вдалося записати замовлення. Спробуйте ще раз.\n' + lastError };
    }
    
    // Токен використано — цей самий запит більше не пройде
    if (orderToken) {
      try { CacheService.getScriptCache().put('veg_token_' + orderToken, '1', 21600); } catch (e) {}
    }

    // Обновляем отчёты сразу после записи (не ждём триггер)
    scriptProperties.deleteProperty('lastProcessedRowCount_Veg');
    try {
      generateFormattedOrdersReport();
      generateSummaryReport();
    } catch (repErr) {
      console.error('Звіт не оновився одразу: ' + repErr);
    }

    // Сообщение продавцу — показываем в ПРОДАЖНЫХ ценах
    var successMsg = '✅ Замовлення овочів прийнято!\n📍 ' + storeAddress + '\n📦 Позицій: ' + rows.length + '\n💰 Сума: ' + displayTotal.toFixed(2) + ' грн';
    
    if (priceChanges.length > 0) {
      successMsg += '\n\n⚠️ Увага! Ціни оновлено:\n' + priceChanges.join('\n');
      successMsg += '\n\nЗамовлення записано з актуальними цінами.';
    }

    return {
      success: true,
      message: successMsg
    };

  } catch (e) {
    console.error('❌ ПОМИЛКА recordOrder: ' + e.toString());
    return { success: false, message: '❌ Помилка сервера. Спробуйте ще раз.' };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// ============================================================
// ГЕНЕРАЦИЯ ОТЧЁТОВ
// ============================================================

/**
 * Лист 1: Замовлення овочів — заказы в разрезе точек
 */
function generateFormattedOrdersReport() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  
  try {
    var ss = getSpreadsheet();
    var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
    
    var todayRows = [];
    
    if (rawSheet && rawSheet.getLastRow() >= 2) {
      var allData = rawSheet.getRange(2, 1, rawSheet.getLastRow() - 1, 7).getValues();
      
      for (var i = 0; i < allData.length; i++) {
        var cell = allData[i][0];
        var dateMatch = false;
        if (cell instanceof Date) {
          if (Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd.MM.yyyy') === today) dateMatch = true;
        } else {
          if (String(cell || '').trim() === today) dateMatch = true;
        }
        if (dateMatch) todayRows.push(allData[i]);
      }
    }
    
    // Все ТТ
    var storesSheet = ss.getSheetByName(ROUTES_STORES_SHEET_NAME);
    var allStores = [];
    if (storesSheet && storesSheet.getLastRow() > 1) {
      allStores = storesSheet.getRange(2, 1, storesSheet.getLastRow() - 1, 1)
        .getValues().map(function(r) { return String(r[0] || '').trim(); }).filter(Boolean);
    }
    
    var ordersSheet = ss.getSheetByName(FORMATTED_ORDERS_SHEET_NAME);
    if (!ordersSheet) ordersSheet = ss.insertSheet(FORMATTED_ORDERS_SHEET_NAME);
    ordersSheet.clear();
    
    // === ЕСЛИ НЕТ ЗАКАЗОВ — ПУСТОЙ ОТЧЁТ ===
    if (todayRows.length === 0) {
      var emptyData = [
        ['Замовлення овочів — ' + today, '', '', '', ''],
        ['Замовлень на сьогодні немає', '', '', '', '']
      ];
      ordersSheet.getRange(1, 1, 2, 5).setValues(emptyData);
      ordersSheet.getRange(1, 1, 1, 5).merge().setFontSize(14).setFontWeight('bold')
        .setHorizontalAlignment('center').setBackground('#2E7D32').setFontColor('#FFFFFF');
      ordersSheet.getRange(2, 1, 1, 5).merge().setFontSize(12)
        .setHorizontalAlignment('center').setBackground('#FFF3E0').setFontColor('#E65100');
      ordersSheet.setColumnWidth(1, 50);
      ordersSheet.setColumnWidth(2, 300);
      ordersSheet.setColumnWidth(3, 100);
      ordersSheet.setColumnWidth(4, 130);
      ordersSheet.setColumnWidth(5, 130);
      
      // Показываем все ТТ как без заказов
      if (allStores.length > 0) {
        var missingData = [['', '', '', '', ''], ['❌ ТТ без замовлень (' + allStores.length + '):', '', '', '', '']];
        allStores.sort(function(a, b) { return a.localeCompare(b, 'uk'); });
        allStores.forEach(function(store) {
          missingData.push(['    • ' + store, '', '', '', '']);
        });
        ordersSheet.getRange(3, 1, missingData.length, 5).setValues(missingData);
        ordersSheet.getRange(4, 1, 1, 5).merge().setFontWeight('bold').setFontSize(10)
          .setBackground('#FFEBEE').setFontColor('#C62828');
        for (var m = 5; m < 4 + allStores.length; m++) {
          ordersSheet.getRange(m, 1, 1, 5).merge().setFontSize(9).setFontColor('#C62828');
        }
      }
      
      SpreadsheetApp.flush();
      console.log('✅ Звіт замовлень очищено — замовлень немає');
      return;
    }
    
    // === ЕСТЬ ЗАКАЗЫ — ПОЛНЫЙ ОТЧЁТ (весь остальной код без изменений) ===
    var storeOrders = {};
    todayRows.forEach(function(row) {
      var addr = String(row[2] || '').trim();
      if (!addr) return;
      if (!storeOrders[addr]) storeOrders[addr] = [];
      storeOrders[addr].push({
        name: String(row[3] || ''),
        price: Number(row[4]) || 0,
        qty: Number(row[5]) || 0,
        sum: Number(row[6]) || 0
      });
    });
    
    var orderedStoresNorm = {};
    Object.keys(storeOrders).forEach(function(addr) {
      orderedStoresNorm[normalizeAddress(addr, false)] = true;
    });
    
    var missingStores = allStores.filter(function(addr) {
      return !orderedStoresNorm[normalizeAddress(addr, false)];
    });
    
    var reportData = [];
    var formats = [];
    
    reportData.push(['Замовлення овочів — ' + today, '', '', '', '']);
    formats.push('title');
    reportData.push(['Всього ТТ із замовленнями: ' + Object.keys(storeOrders).length + ' з ' + allStores.length, '', '', '', '']);
    formats.push('subtitle');
    reportData.push(['', '', '', '', '']);
    formats.push('empty');
    reportData.push(['№', 'Назва овочу', 'Ціна/кг', 'Кількість (кг)', 'Сума (грн)']);
    formats.push('header');
    
    var num = 1;
    var sortedStores = Object.keys(storeOrders).sort(function(a, b) { return a.localeCompare(b, 'uk'); });
    var grandTotal = 0;
    var grandQty = 0;
    
    sortedStores.forEach(function(store) {
      reportData.push(['📍 ' + store, '', '', '', '']);
      formats.push('store');
      
      var storeTotal = 0;
      var storeQty = 0;
      
      storeOrders[store].sort(function(a, b) { return a.name.localeCompare(b.name, 'uk'); });
      
      storeOrders[store].forEach(function(item) {
        storeTotal += item.sum;
        storeQty += item.qty;
        reportData.push([num++, item.name, item.price.toFixed(2), item.qty, item.sum.toFixed(2)]);
        formats.push('data');
      });
      
      grandTotal += storeTotal;
      grandQty += storeQty;
      
      reportData.push(['', 'Разом по ТТ:', '', storeQty + ' кг', storeTotal.toFixed(2) + ' грн']);
      formats.push('storetotal');
      reportData.push(['', '', '', '', '']);
      formats.push('empty');
    });
    
    reportData.push(['', 'ЗАГАЛОМ:', '', grandQty + ' кг', grandTotal.toFixed(2) + ' грн']);
    formats.push('grandtotal');
    
    if (missingStores.length > 0) {
      reportData.push(['', '', '', '', '']);
      formats.push('empty');
      reportData.push(['❌ ТТ без замовлень (' + missingStores.length + '):', '', '', '', '']);
      formats.push('missing_header');
      missingStores.sort(function(a, b) { return a.localeCompare(b, 'uk'); });
      missingStores.forEach(function(store) {
        reportData.push(['    • ' + store, '', '', '', '']);
        formats.push('missing');
      });
    }
    
    if (reportData.length > 0) {
      ordersSheet.getRange(1, 1, reportData.length, 5).setValues(reportData);
    }
    
    ordersSheet.setColumnWidth(1, 50);
    ordersSheet.setColumnWidth(2, 300);
    ordersSheet.setColumnWidth(3, 100);
    ordersSheet.setColumnWidth(4, 130);
    ordersSheet.setColumnWidth(5, 130);
    ordersSheet.setFrozenRows(4);
    
    var bgs = [], sizes = [], weights = [], colors = [], aligns = [];
    
    for (var r = 0; r < formats.length; r++) {
      var bg = '#FFFFFF', size = 9, weight = 'normal', color = '#000000';
      var rowAlign = ['left', 'left', 'left', 'left', 'left'];
      
      switch (formats[r]) {
        case 'title':
          bg = '#2E7D32'; size = 14; weight = 'bold'; color = '#FFFFFF';
          rowAlign = ['center', 'center', 'center', 'center', 'center'];
          ordersSheet.getRange(r + 1, 1, 1, 5).merge();
          break;
        case 'subtitle':
          bg = '#E8F5E9'; size = 11; weight = 'normal'; color = '#2E7D32';
          rowAlign = ['center', 'center', 'center', 'center', 'center'];
          ordersSheet.getRange(r + 1, 1, 1, 5).merge();
          break;
        case 'header':
          bg = '#37474F'; size = 10; weight = 'bold'; color = '#FFFFFF';
          rowAlign = ['center', 'center', 'center', 'center', 'center'];
          break;
        case 'store':
          bg = '#FFF3E0'; size = 10; weight = 'bold'; color = '#E65100';
          ordersSheet.getRange(r + 1, 1, 1, 5).merge();
          break;
        case 'data':
          size = 9;
          rowAlign = ['center', 'left', 'center', 'center', 'center'];
          break;
        case 'storetotal':
          bg = '#E8F5E9'; size = 9; weight = 'bold'; color = '#2E7D32';
          rowAlign = ['left', 'left', 'left', 'center', 'center'];
          break;
        case 'grandtotal':
          bg = '#1B5E20'; size = 11; weight = 'bold'; color = '#FFFFFF';
          rowAlign = ['left', 'left', 'left', 'center', 'center'];
          break;
        case 'missing_header':
          bg = '#FFEBEE'; size = 10; weight = 'bold'; color = '#C62828';
          ordersSheet.getRange(r + 1, 1, 1, 5).merge();
          break;
        case 'missing':
          size = 9; color = '#C62828';
          ordersSheet.getRange(r + 1, 1, 1, 5).merge();
          break;
      }
      
      bgs.push([bg, bg, bg, bg, bg]);
      sizes.push([size, size, size, size, size]);
      weights.push([weight, weight, weight, weight, weight]);
      colors.push([color, color, color, color, color]);
      aligns.push(rowAlign);
    }
    
    if (formats.length > 0) {
      var totalRange = ordersSheet.getRange(1, 1, formats.length, 5);
      totalRange.setBackgrounds(bgs);
      totalRange.setFontSizes(sizes);
      totalRange.setFontWeights(weights);
      totalRange.setFontColors(colors);
      totalRange.setHorizontalAlignments(aligns);
    }
    
    SpreadsheetApp.flush();
    console.log('✅ Звіт замовлень овочів оновлено: ' + reportData.length + ' рядків');
    
  } catch (e) {
    console.error('❌ generateFormattedOrdersReport: ' + e.toString());
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

/**
 * Лист 2: Зведена Овочі — общий заказ суммарно по видам овощей
 */
function generateSummaryReport() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  
  try {
    var ss = getSpreadsheet();
    var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
    
    var todayRows = [];
    
    if (rawSheet && rawSheet.getLastRow() >= 2) {
      var allData = rawSheet.getRange(2, 1, rawSheet.getLastRow() - 1, 7).getValues();
      
      for (var i = 0; i < allData.length; i++) {
        var cell = allData[i][0];
        var dateMatch = false;
        if (cell instanceof Date) {
          if (Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd.MM.yyyy') === today) dateMatch = true;
        } else {
          if (String(cell || '').trim() === today) dateMatch = true;
        }
        if (dateMatch) todayRows.push(allData[i]);
      }
    }
    
    var summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
    if (!summarySheet) summarySheet = ss.insertSheet(SUMMARY_SHEET_NAME);
    summarySheet.clear();
    
    // === ЕСЛИ НЕТ ЗАКАЗОВ — ПУСТОЙ ОТЧЁТ ===
    if (todayRows.length === 0) {
      var emptyData = [
        ['Зведене замовлення овочів — ' + today, '', '', '', ''],
        ['Замовлень на сьогодні немає', '', '', '', '']
      ];
      summarySheet.getRange(1, 1, 2, 5).setValues(emptyData);
      summarySheet.getRange(1, 1, 1, 5).merge().setFontSize(14).setFontWeight('bold')
        .setHorizontalAlignment('center').setBackground('#2E7D32').setFontColor('#FFFFFF');
      summarySheet.getRange(2, 1, 1, 5).merge().setFontSize(12)
        .setHorizontalAlignment('center').setBackground('#FFF3E0').setFontColor('#E65100');
      summarySheet.setColumnWidth(1, 50);
      summarySheet.setColumnWidth(2, 300);
      summarySheet.setColumnWidth(3, 100);
      summarySheet.setColumnWidth(4, 180);
      summarySheet.setColumnWidth(5, 180);
      SpreadsheetApp.flush();
      console.log('✅ Зведена таблиця очищена — замовлень немає');
      return;
    }
    
    // === ЕСТЬ ЗАКАЗЫ — ПОЛНЫЙ ОТЧЁТ ===
    var summary = {};
    var grandTotalQty = 0;
    var grandTotalSum = 0;
    var storesSet = new Set();
    
    todayRows.forEach(function(row) {
      var name = String(row[3] || '').trim();
      var price = Number(row[4]) || 0;
      var qty = Number(row[5]) || 0;
      var sum = Number(row[6]) || 0;
      var addr = String(row[2] || '').trim();
      
      if (!name) return;
      
      if (!summary[name]) {
        summary[name] = { qty: 0, sum: 0, price: price };
      }
      summary[name].qty += qty;
      summary[name].sum += sum;
      if (price > 0) summary[name].price = price;
      
      grandTotalQty += qty;
      grandTotalSum += sum;
      if (addr) storesSet.add(addr);
    });
    
    var reportData = [];
    var formats = [];
    
    reportData.push(['Зведене замовлення овочів — ' + today, '', '', '', '']);
    formats.push('title');
    reportData.push(['Всього ТТ: ' + storesSet.size + ' | Загальна кількість: ' + grandTotalQty + ' кг | Загальна сума: ' + grandTotalSum.toFixed(2) + ' грн', '', '', '', '']);
    formats.push('subtitle');
    reportData.push(['', '', '', '', '']);
    formats.push('empty');
    
    reportData.push(['№', 'Назва овочу', 'Ціна/кг', 'Загальна кількість (кг)', 'Загальна сума (грн)']);
    formats.push('header');
    
    var productNames = Object.keys(summary).sort(function(a, b) { return a.localeCompare(b, 'uk'); });
    
    var num = 1;
    productNames.forEach(function(name) {
      var item = summary[name];
      reportData.push([num++, name, item.price.toFixed(2), item.qty, item.sum.toFixed(2)]);
      formats.push('data');
    });
    
    reportData.push(['', '', '', '', '']);
    formats.push('empty');
    reportData.push(['', 'ЗАГАЛОМ', '', grandTotalQty + ' кг', grandTotalSum.toFixed(2) + ' грн']);
    formats.push('total');
    
    if (reportData.length > 0) {
      summarySheet.getRange(1, 1, reportData.length, 5).setValues(reportData);
    }
    
    summarySheet.setColumnWidth(1, 50);
    summarySheet.setColumnWidth(2, 300);
    summarySheet.setColumnWidth(3, 100);
    summarySheet.setColumnWidth(4, 180);
    summarySheet.setColumnWidth(5, 180);
    summarySheet.setFrozenRows(4);
    
    var bgs = [], sizes = [], weights = [], colors = [], aligns = [];
    
    for (var r = 0; r < formats.length; r++) {
      var bg = '#FFFFFF', size = 10, weight = 'normal', color = '#000000';
      var rowAlign = ['left', 'left', 'left', 'left', 'left'];
      
      switch (formats[r]) {
        case 'title':
          bg = '#2E7D32'; size = 14; weight = 'bold'; color = '#FFFFFF';
          rowAlign = ['center', 'center', 'center', 'center', 'center'];
          summarySheet.getRange(r + 1, 1, 1, 5).merge();
          break;
        case 'subtitle':
          bg = '#E8F5E9'; size = 11; weight = 'normal'; color = '#2E7D32';
          rowAlign = ['center', 'center', 'center', 'center', 'center'];
          summarySheet.getRange(r + 1, 1, 1, 5).merge();
          break;
        case 'header':
          bg = '#37474F'; size = 10; weight = 'bold'; color = '#FFFFFF';
          rowAlign = ['center', 'center', 'center', 'center', 'center'];
          break;
        case 'data':
          size = 10;
          rowAlign = ['center', 'left', 'center', 'center', 'center'];
          break;
        case 'total':
          bg = '#1B5E20'; size = 12; weight = 'bold'; color = '#FFFFFF';
          rowAlign = ['center', 'center', 'center', 'center', 'center'];
          break;
      }
      
      bgs.push([bg, bg, bg, bg, bg]);
      sizes.push([size, size, size, size, size]);
      weights.push([weight, weight, weight, weight, weight]);
      colors.push([color, color, color, color, color]);
      aligns.push(rowAlign);
    }
    
    if (formats.length > 0) {
      var totalRange = summarySheet.getRange(1, 1, formats.length, 5);
      totalRange.setBackgrounds(bgs);
      totalRange.setFontSizes(sizes);
      totalRange.setFontWeights(weights);
      totalRange.setFontColors(colors);
      totalRange.setHorizontalAlignments(aligns);
    }
    
    SpreadsheetApp.flush();
    console.log('✅ Зведену таблицю овочів оновлено');
    
  } catch (e) {
    console.error('❌ generateSummaryReport: ' + e.toString());
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

function formatRawDataSheet() {
  var ss = getSpreadsheet();
  var raw = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  if (!raw || raw.getLastRow() < 1) return;
  
  var lastRow = raw.getLastRow();
  
  var headers = [['Дата', 'Час', 'Адрес ТТ', 'Назва овочу', 'Ціна/кг', 'Кількість (кг)', 'Сума']];
  raw.getRange(1, 1, 1, 7).setValues(headers)
    .setFontWeight('bold')
    .setBackground('#2E7D32')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center')
    .setFontSize(10);
  
  raw.setColumnWidth(1, 100);
  raw.setColumnWidth(2, 80);
  raw.setColumnWidth(3, 280);
  raw.setColumnWidth(4, 250);
  raw.setColumnWidth(5, 80);
  raw.setColumnWidth(6, 120);
  raw.setColumnWidth(7, 100);
  
  if (lastRow >= 2) {
    var dataRange = raw.getRange(2, 1, lastRow - 1, 7);
    dataRange.setFontSize(9)
      .setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true, '#D0D0D0', SpreadsheetApp.BorderStyle.SOLID);
    
    raw.getRange(2, 1, lastRow - 1, 1).setHorizontalAlignment('center');
    raw.getRange(2, 2, lastRow - 1, 1).setHorizontalAlignment('center');
    raw.getRange(2, 3, lastRow - 1, 1).setHorizontalAlignment('left');
    raw.getRange(2, 4, lastRow - 1, 1).setHorizontalAlignment('left');
    raw.getRange(2, 5, lastRow - 1, 1).setHorizontalAlignment('center').setNumberFormat('0.00');
    raw.getRange(2, 6, lastRow - 1, 1).setHorizontalAlignment('center').setNumberFormat('0');
    raw.getRange(2, 7, lastRow - 1, 1).setHorizontalAlignment('center').setNumberFormat('0.00');
  }
  
  raw.setFrozenRows(1);
  SpreadsheetApp.flush();
}

// ============================================================
// УДАЛЕНИЕ ЗАКАЗОВ
// ============================================================

function deleteOrderForStoreFromDialog(storeAddress) {
  try {
    const ss = getSpreadsheet();
    const rawOrderSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);

    if (!rawOrderSheet || rawOrderSheet.getLastRow() < 2) {
      throw new Error('Немає даних для видалення');
    }

    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
    const normalizedStore = normalizeAddress(storeAddress, false);

    const lastRow = rawOrderSheet.getLastRow();
    const allData = rawOrderSheet.getRange(2, 1, lastRow - 1, 3).getValues();
    const displayDates = rawOrderSheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    const rowsToDelete = [];

    for (let i = allData.length - 1; i >= 0; i--) {
      var storeFromSheet = String(allData[i][2] || '').trim();
      var normalizedFromSheet = normalizeAddress(storeFromSheet, false);
      var dateMatch = false;

      // Вариант 1: Date объект
      if (allData[i][0] instanceof Date) {
        var rowDateFormatted = Utilities.formatDate(allData[i][0], Session.getScriptTimeZone(), 'dd.MM.yyyy');
        if (rowDateFormatted === today) dateMatch = true;
      }
      
      // Вариант 2: текстовая дата
      if (!dateMatch) {
        var displayed = String(displayDates[i][0]).trim();
        if (displayed === today) dateMatch = true;
      }
      
      // Вариант 3: сырое значение как строка
      if (!dateMatch) {
        var rawVal = String(allData[i][0] || '').trim();
        if (rawVal === today) dateMatch = true;
      }

      if (dateMatch && normalizedFromSheet === normalizedStore) {
        rowsToDelete.push(i + 2);
      }
    }

    if (rowsToDelete.length === 0) {
      throw new Error('Замовлення для "' + storeAddress + '" не знайдено');
    }

    // Удаляем снизу вверх
    for (var d = 0; d < rowsToDelete.length; d++) {
      rawOrderSheet.deleteRow(rowsToDelete[d]);
    }

    SpreadsheetApp.flush();
    
    // Сбрасываем кеш чтобы триггер не пропустил обновление
    scriptProperties.deleteProperty('lastProcessedRowCount_Veg');
    // Знімаємо блокування, щоб ТТ могла замовити знову одразу
    scriptProperties.deleteProperty('lastOrder_Veg_' + normalizedStore);

    // Принудительно обновляем оба отчёта
    generateFormattedOrdersReport();
    generateSummaryReport();

    return 'Видалено ' + rowsToDelete.length + ' позицій для "' + storeAddress + '". ТТ може замовити знову.';

  } catch (error) {
    logError('deleteOrderForStoreFromDialog', error, { storeAddress });
    throw error;
  }
}

// ============================================================
// ЛОГИРОВАНИЕ
// ============================================================

function logError(functionName, error, additionalInfo) {
  try {
    const ss = getSpreadsheet();
    let errorLog = ss.getSheetByName('_Лог_Помилок_Овочі');
    
    if (!errorLog) {
      errorLog = ss.insertSheet('_Лог_Помилок_Овочі');
      errorLog.appendRow(['Дата і час', 'Функція', 'Помилка', 'Додаткова інформація', 'Stack Trace']);
      errorLog.hideSheet();
      errorLog.getRange(1, 1, 1, 5)
        .setBackground('#FF0000').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
    }
    
    errorLog.appendRow([
      new Date(),
      functionName,
      error.toString(),
      JSON.stringify(additionalInfo || {}),
      error.stack || 'Немає stack trace'
    ]);
    
  } catch (e) {
    console.error('Не вдалося записати помилку в лог:', e);
  }
}

// ============================================================
// ЭКСПОРТ EXCEL
// ============================================================

function getExcelExportUrl(sheetName) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('Лист "' + sheetName + '" не знайдено');
    
    return 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx&gid=' + sheet.getSheetId();
  } catch (error) {
    logError('getExcelExportUrl', error, { sheetName: sheetName });
    throw error;
  }
}

function exportOrdersToExcel() {
  return getExcelExportUrl(FORMATTED_ORDERS_SHEET_NAME);
}

function exportSummaryToExcel() {
  return getExcelExportUrl(SUMMARY_SHEET_NAME);
}

// ============================================================
// МЕНЮ ТАБЛИЦЫ
// ============================================================

function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('🥬 Овочі')
      .addItem('📅 Фільтр за датою', 'showDateFilterDialog')
      .addItem('🔄 Оновити звіти', 'forceGenerateReports')
      .addItem('🎨 Форматувати сирі дані', 'formatRawDataSheet')
      .addSeparator()
      .addItem('📊 Експорт замовлень в Excel', 'downloadOrdersAsExcel')
      .addItem('📊 Експорт зведеної в Excel', 'downloadSummaryAsExcel')
      .addSeparator()
      .addItem('🗑️ Видалити замовлення ТТ', 'showDeleteOrderDialog')
      .addSeparator()
      .addItem('➕ Додати позицію в асортимент', 'showAddProductDialog')
      .addItem('➖ Вимкнути/Увімкнути позицію', 'showToggleProductDialog')
      .addItem('📋 Переглянути асортимент', 'showCurrentAssortment')
      .addSeparator()
      .addItem('🧹 Очистити лог помилок', 'clearErrorLog')
      .addToUi();
  } catch (error) {
    console.error('Помилка створення меню:', error);
  }
}

function forceGenerateReports() {
  generateFormattedOrdersReport();
  generateSummaryReport();
  formatRawDataSheet();
  SpreadsheetApp.getUi().alert('Звіти оновлено!');
}

function downloadOrdersAsExcel() {
  try {
    const url = exportOrdersToExcel();
    const html = '<html><body><h3>Експорт замовлень овочів</h3><a href="' + url + '" target="_blank" style="font-size:16px;">📥 Завантажити Excel</a><br><br><button onclick="google.script.host.close()">Закрити</button></body></html>';
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(html).setWidth(400).setHeight(150),
      'Експорт в Excel'
    );
  } catch (error) {
    SpreadsheetApp.getUi().alert('Помилка: ' + error.toString());
  }
}

function downloadSummaryAsExcel() {
  try {
    const url = exportSummaryToExcel();
    const html = '<html><body><h3>Експорт зведеної овочів</h3><a href="' + url + '" target="_blank" style="font-size:16px;">📥 Завантажити Excel</a><br><br><button onclick="google.script.host.close()">Закрити</button></body></html>';
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(html).setWidth(400).setHeight(150),
      'Експорт в Excel'
    );
  } catch (error) {
    SpreadsheetApp.getUi().alert('Помилка: ' + error.toString());
  }
}

function showDeleteOrderDialog() {
  try {
    const ui = SpreadsheetApp.getUi();
    const ss = getSpreadsheet();
    const rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    
    if (!rawSheet || rawSheet.getLastRow() < 2) {
      ui.alert('Інформація', 'На сьогодні немає замовлень для видалення.', ui.ButtonSet.OK);
      return;
    }
    
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
    var lastRow = rawSheet.getLastRow();
    var allData = rawSheet.getRange(2, 1, lastRow - 1, 3).getValues();
    var displayDates = rawSheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    
    var storesList = [];
    var seen = {};
    
    for (var i = 0; i < allData.length; i++) {
      var dateMatch = false;
      
      // Date объект
      if (allData[i][0] instanceof Date) {
        var rowDate = Utilities.formatDate(allData[i][0], Session.getScriptTimeZone(), 'dd.MM.yyyy');
        if (rowDate === today) dateMatch = true;
      }
      // Текстовая дата через displayValues
      if (!dateMatch) {
        var displayed = String(displayDates[i][0]).trim();
        if (displayed === today) dateMatch = true;
      }
      // Сырое значение как строка
      if (!dateMatch) {
        var rawVal = String(allData[i][0] || '').trim();
        if (rawVal === today) dateMatch = true;
      }
      
      if (dateMatch) {
        var addr = String(allData[i][2] || '').trim();
        if (addr && !seen[addr]) {
          seen[addr] = true;
          storesList.push(addr);
        }
      }
    }
    
    if (storesList.length === 0) {
      ui.alert('Інформація', 'На сьогодні немає замовлень для видалення.', ui.ButtonSet.OK);
      return;
    }
    
    storesList.sort(function(a, b) { return a.localeCompare(b, 'uk'); });
    
    const html = `
      <html><head><base target="_top"><style>
        body{font-family:Arial,sans-serif;padding:20px}
        select{width:100%;padding:10px;font-size:14px;margin-bottom:20px;border:2px solid #ddd;border-radius:4px}
        .btns{display:flex;gap:10px;justify-content:flex-end}
        button{padding:10px 20px;font-size:14px;border:none;border-radius:4px;cursor:pointer}
        #del{background:#d32f2f;color:#fff}#del:hover{background:#b71c1c}
        #cancel{background:#757575;color:#fff}
        .warning{background:#fff3cd;border:1px solid #ffc107;padding:15px;border-radius:4px;margin-bottom:20px;color:#856404}
      </style></head><body>
        <div class="warning"><strong>⚠️ Увага:</strong> Видалення дозволить магазину замовити знову. Дія незворотна!</div>
        <label><strong>Оберіть магазин:</strong></label>
        <select id="ss"><option value="">-- Оберіть --</option>
          ${storesList.map(s => '<option value="' + s + '">' + s + '</option>').join('')}
        </select>
        <div class="btns">
          <button id="cancel" onclick="google.script.host.close()">Скасувати</button>
          <button id="del" onclick="del()">🗑️ Видалити</button>
        </div>
        <script>
          function del(){
            var v=document.getElementById('ss').value;
            if(!v){alert('Оберіть магазин');return}
            if(!confirm('Видалити замовлення "'+v+'"?'))return;
            document.getElementById('del').disabled=true;document.getElementById('del').textContent='Видалення...';
            google.script.run.withSuccessHandler(function(m){alert(m);google.script.host.close()})
              .withFailureHandler(function(e){alert('Помилка: '+e.message);document.getElementById('del').disabled=false;document.getElementById('del').textContent='🗑️ Видалити'})
              .deleteOrderForStoreFromDialog(v);
          }
        </script>
      </body></html>`;
    
    ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(500).setHeight(300), '🗑️ Видалення замовлення');
    
  } catch (error) {
    SpreadsheetApp.getUi().alert('Помилка: ' + error.toString());
  }
}

function clearErrorLog() {
  try {
    const ui = SpreadsheetApp.getUi();
    const response = ui.alert('Підтвердження', 'Очистити лог помилок?', ui.ButtonSet.YES_NO);
    
    if (response === ui.Button.YES) {
      const ss = getSpreadsheet();
      const errorLog = ss.getSheetByName('_Лог_Помилок_Овочі');
      if (errorLog) {
        errorLog.clearContents();
        errorLog.appendRow(['Дата і час', 'Функція', 'Помилка', 'Додаткова інформація', 'Stack Trace']);
        errorLog.getRange(1, 1, 1, 5).setBackground('#FF0000').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
        ui.alert('Лог очищено');
      } else {
        ui.alert('Лог не знайдено');
      }
    }
  } catch (error) {
    SpreadsheetApp.getUi().alert('Помилка: ' + error.toString());
  }
}

// ============================================================
// АВТОМАТИЧЕСКОЕ ОБНОВЛЕНИЕ ОТЧЁТОВ (триггер каждую минуту)
// ============================================================

function autoMaintenance() {
  var now = new Date();
  var hour = now.getHours();
  
  if (hour < 9 || hour >= 20) return;
  
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  
  try {
    var ss = getSpreadsheet();
    var raw = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    if (!raw || raw.getLastRow() < 2) return;
    
    var currentRowCount = raw.getLastRow();
    var lastProcessedCount = scriptProperties.getProperty('lastProcessedRowCount_Veg');
    if (lastProcessedCount && parseInt(lastProcessedCount) === currentRowCount) return;
    
    generateFormattedOrdersReport();
    generateSummaryReport();
    
    scriptProperties.setProperty('lastProcessedRowCount_Veg', currentRowCount.toString());
    console.log('✅ Звіти овочів оновлено о ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm:ss'));
  } catch (e) {
    console.error('❌ Помилка генерації: ' + e.toString());
  } finally {
    lock.releaseLock();
  }
}

function updateTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });
  
  ScriptApp.newTrigger('autoMaintenance')
    .timeBased()
    .everyMinutes(5)
    .create();
  
  ScriptApp.newTrigger('archiveOldOrders')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();
  
  console.log('✅ Тригери оновлено: autoMaintenance (5 хв) + archiveOldOrders (щоночі о 3:00)');
}

// ============================================================
// ФИЛЬТР ПО ДАТЕ
// ============================================================

function getAvailableDates() {
  var ss = getSpreadsheet();
  var uniqueDates = {};

  function collectFromSheet(sheetName) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return;
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var cell = vals[i][0];
      var d, display;
      if (cell instanceof Date) {
        d = Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        display = Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd.MM.yyyy');
      } else {
        var txt = String(cell || '').trim();
        if (!txt) continue;
        var parts = txt.split('.');
        if (parts.length !== 3) continue;
        d = parts[2] + '-' + parts[1] + '-' + parts[0];
        display = txt;
      }
      if (!uniqueDates[d]) uniqueDates[d] = { value: d, display: display, count: 0 };
      uniqueDates[d].count++;
    }
  }

  collectFromSheet(HIDDEN_RAW_DATA_SHEET_NAME);
  collectFromSheet('_Архів_Овочі');

  return Object.values(uniqueDates).sort(function(a, b) { return b.value.localeCompare(a.value); });
}

function showDateFilterDialog() {
  var dates = getAvailableDates();
  if (dates.length === 0) {
    SpreadsheetApp.getUi().alert('Немає даних для фільтрації');
    return;
  }
  
  var html = '<style>'
    + 'body{font-family:Arial;padding:15px;}'
    + 'button{display:block;width:100%;padding:10px;margin:6px 0;border:none;border-radius:8px;'
    + 'font-size:15px;font-weight:bold;cursor:pointer;}'
    + '.date-btn{background:#E8F5E9;color:#2E7D32;}'
    + '.date-btn:hover{background:#C8E6C9;}'
    + '.all-btn{background:#4CAF50;color:#fff;}'
    + '.all-btn:hover{background:#388E3C;}'
    + '.status{text-align:center;margin-top:10px;font-size:13px;color:#666;}'
    + '</style>'
    + '<button class="all-btn" onclick="filterDate(\'ALL\')">📋 Показати всі дати</button>';
  
  for (var i = 0; i < dates.length; i++) {
    html += '<button class="date-btn" onclick="filterDate(\'' + dates[i].value + '\')">📅 ' + dates[i].display + ' (' + dates[i].count + ')</button>';
  }
  
  html += '<div class="status" id="status"></div>'
    + '<script>'
    + 'function filterDate(d){'
    + 'document.getElementById("status").innerText="Фільтрую...";'
    + 'google.script.run.withSuccessHandler(function(r){'
    + 'document.getElementById("status").innerText=r;'
    + '}).withFailureHandler(function(e){'
    + 'document.getElementById("status").innerText="Помилка: "+e.message;'
    + '}).applyDateFilter(d);'
    + '}'
    + '</script>';
  
  var ui = HtmlService.createHtmlOutput(html)
    .setTitle('📅 Фільтр за датою')
    .setWidth(250);
  SpreadsheetApp.getUi().showSidebar(ui);
}

function applyDateFilter(dateStr) {
  var ss = getSpreadsheet();
  var raw = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');

  // ALL — показать все строки рабочего листа
  if (dateStr === 'ALL') {
    if (!raw || raw.getLastRow() < 2) return 'Робочий лист порожній (дивіться історію по датах)';
    var filter = raw.getFilter();
    if (filter) filter.remove();
    raw.showRows(2, raw.getLastRow() - 1);
    SpreadsheetApp.flush();
    return '✅ Показано всі поточні рядки (' + (raw.getLastRow() - 1) + ')';
  }

  // Конвертируем yyyy-MM-dd -> dd.MM.yyyy
  var parts = dateStr.split('-');
  var targetDate = parts[2] + '.' + parts[1] + '.' + parts[0];

  // === СЕГОДНЯ: фильтруем строки прямо в рабочем листе (как раньше) ===
  if (targetDate === today) {
    if (!raw || raw.getLastRow() < 2) return 'Сьогодні замовлень ще немає';
    var f = raw.getFilter();
    if (f) f.remove();
    var lastRow = raw.getLastRow();
    raw.showRows(2, lastRow - 1);

    var allDates = raw.getRange(2, 1, lastRow - 1, 1).getValues();
    var shown = 0, i = 0;
    while (i < allDates.length) {
      var cell = allDates[i][0];
      var match = (cell instanceof Date)
        ? Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd.MM.yyyy') === targetDate
        : String(cell || '').trim() === targetDate;
      if (!match) {
        var blockStart = i + 2, blockLen = 1; i++;
        while (i < allDates.length) {
          var c2 = allDates[i][0];
          var m2 = (c2 instanceof Date)
            ? Utilities.formatDate(c2, Session.getScriptTimeZone(), 'dd.MM.yyyy') === targetDate
            : String(c2 || '').trim() === targetDate;
          if (!m2) { blockLen++; i++; } else break;
        }
        raw.hideRows(blockStart, blockLen);
      } else { shown++; i++; }
    }
    SpreadsheetApp.flush();
    raw.activate();
    return '✅ ' + targetDate + ' (поточний лист): ' + shown + ' рядків';
  }

  // === ПРОШЛАЯ ДАТА: строим отчёт из архива на отдельном листе ===
  var arch = ss.getSheetByName('_Архів_Овочі');
  if (!arch || arch.getLastRow() < 2) return 'Архів порожній';

  var archData = arch.getRange(2, 1, arch.getLastRow() - 1, 7).getValues();
  var rows = [];
  for (var a = 0; a < archData.length; a++) {
    var cell = archData[a][0];
    var d = (cell instanceof Date)
      ? Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd.MM.yyyy')
      : String(cell || '').trim();
    if (d === targetDate) rows.push(archData[a]);
  }

  if (rows.length === 0) return 'За ' + targetDate + ' у архіві немає даних';

  // Группируем по ТТ
  var storeOrders = {};
  var grandTotalQty = 0, grandTotalSum = 0;
  rows.forEach(function(r) {
    var addr = String(r[2] || '').trim();
    if (!addr) return;
    if (!storeOrders[addr]) storeOrders[addr] = [];
    var qty = Number(r[5]) || 0, sum = Number(r[6]) || 0;
    storeOrders[addr].push({ name: String(r[3] || ''), price: Number(r[4]) || 0, qty: qty, sum: sum });
    grandTotalQty += qty; grandTotalSum += sum;
  });

  var view = ss.getSheetByName('_Перегляд_Історії');
  if (!view) view = ss.insertSheet('_Перегляд_Історії');
  view.clear();

  var out = [];
  out.push(['Історія замовлень — ' + targetDate, '', '', '', '']);
  out.push(['Всього ТТ: ' + Object.keys(storeOrders).length + ' | ' + grandTotalQty + ' кг | ' + grandTotalSum.toFixed(2) + ' грн', '', '', '', '']);
  out.push(['', '', '', '', '']);
  out.push(['№', 'Назва овочу', 'Ціна/кг', 'Кількість (кг)', 'Сума (грн)']);

  var num = 1;
  Object.keys(storeOrders).sort(function(a, b) { return a.localeCompare(b, 'uk'); }).forEach(function(store) {
    out.push(['📍 ' + store, '', '', '', '']);
    var st = 0, sq = 0;
    storeOrders[store].sort(function(a, b) { return a.name.localeCompare(b.name, 'uk'); });
    storeOrders[store].forEach(function(it) {
      st += it.sum; sq += it.qty;
      out.push([num++, it.name, it.price.toFixed(2), it.qty, it.sum.toFixed(2)]);
    });
    out.push(['', 'Разом по ТТ:', '', sq + ' кг', st.toFixed(2) + ' грн']);
    out.push(['', '', '', '', '']);
  });
  out.push(['', 'ЗАГАЛОМ:', '', grandTotalQty + ' кг', grandTotalSum.toFixed(2) + ' грн']);

  view.getRange(1, 1, out.length, 5).setValues(out);
  view.getRange(1, 1, 1, 5).merge().setFontSize(14).setFontWeight('bold')
    .setHorizontalAlignment('center').setBackground('#37474F').setFontColor('#FFFFFF');
  view.getRange(2, 1, 1, 5).merge().setFontSize(11).setHorizontalAlignment('center')
    .setBackground('#ECEFF1').setFontColor('#37474F');
  view.getRange(4, 1, 1, 5).setFontWeight('bold').setBackground('#37474F').setFontColor('#FFFFFF').setHorizontalAlignment('center');
  view.setColumnWidth(1, 50); view.setColumnWidth(2, 300); view.setColumnWidth(3, 100);
  view.setColumnWidth(4, 130); view.setColumnWidth(5, 130);
  view.setFrozenRows(4);

  SpreadsheetApp.flush();
  view.activate();
  return '✅ ' + targetDate + ': ' + rows.length + ' рядків показано на листі "_Перегляд_Історії"';
}

// ============================================================
// ДЕБАГ
// ============================================================

function debugPriceSheet() {
  var products = getPricesFromExternalSheet();
  console.log('Товарів у прайсі: ' + products.length);
  if (products.length > 0) {
    console.log('Перші 5:');
    for (var i = 0; i < Math.min(5, products.length); i++) {
      console.log('  ' + products[i].name + ' — поставщик: ' + products[i].supplierPrice + ' грн/кг, продажна: ' + products[i].displayPrice + ' грн/кг');
    }
  }
}

function debugStores() {
  var ss = getSpreadsheet();
  var storesSheet = ss.getSheetByName(ROUTES_STORES_SHEET_NAME);
  console.log('Лист адресів: ' + (storesSheet ? 'ЗНАЙДЕНО' : 'НЕ ЗНАЙДЕНО'));
  
  if (storesSheet) {
    console.log('Останній рядок: ' + storesSheet.getLastRow());
  }
  
  var result = getStoresOrderStatus();
  console.log('Доступних: ' + result.available.length + ', Із замовленнями: ' + result.ordered.length);
}
function fixSetup() {
  var ss = getSpreadsheet();
  
  // 1. Создаём лист "Зведена Овочі" если нет
  var summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!summarySheet) {
    summarySheet = ss.insertSheet(SUMMARY_SHEET_NAME);
    console.log('✅ Створено лист "' + SUMMARY_SHEET_NAME + '"');
  } else {
    console.log('ℹ️ Лист "' + SUMMARY_SHEET_NAME + '" вже існує');
  }
  
  // 2. Сбрасываем кеш
  scriptProperties.deleteProperty('lastProcessedRowCount_Veg');
  console.log('✅ Кеш скинуто');
  
  // 3. Принудительно генерируем оба отчёта
  generateFormattedOrdersReport();
  generateSummaryReport();
  console.log('✅ Звіти згенеровано');
  
  // 4. Проверяем все листы
  var allSheets = ss.getSheets();
  console.log('\n📋 Всі листи в таблиці:');
  allSheets.forEach(function(sheet) {
    console.log('  "' + sheet.getName() + '" — рядків: ' + sheet.getLastRow() + ', прихований: ' + sheet.isSheetHidden());
  });
  
  SpreadsheetApp.getUi().alert('✅ Готово!\n\nЛист "' + SUMMARY_SHEET_NAME + '" створено.\nЗвіти оновлено.\nКеш скинуто.');
}
// ============================================================
// УПРАВЛЕНИЕ АССОРТИМЕНТОМ (через меню)
// ============================================================

/**
 * Показывает текущий ассортимент с ценами из прайса
 */
function showCurrentAssortment() {
  var ui = SpreadsheetApp.getUi();
  
  try {
    var allowed = getAllowedProductsList();
    var products = getPricesFromExternalSheet();
    
    // Читаем все позиции (включая стоп)
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Налаштування');
    var allItems = [];
    if (sheet && sheet.getLastRow() >= 2) {
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < data.length; i++) {
        var name = String(data[i][0] || '').trim();
        var status = String(data[i][1] || '').trim();
        if (name) allItems.push({ name: name, status: status });
      }
    }
    
    var priceMap = {};
    products.forEach(function(p) {
      priceMap[p.name.toLowerCase()] = p;
    });
    
    var lines = [];
    lines.push('📋 ПОТОЧНИЙ АСОРТИМЕНТ (' + allItems.length + ' позицій)\n');
    lines.push('✅ Активних: ' + allowed.length);
    lines.push('🛑 Вимкнених: ' + (allItems.length - allowed.length));
    lines.push('💰 Знайдено в прайсі: ' + products.length + '\n');
    
    allItems.forEach(function(item, idx) {
      var icon = item.status === 'стоп' ? '🛑' : '✅';
      var price = priceMap[item.name.toLowerCase()];
      var priceStr = price 
        ? ' — ' + price.supplierPrice + ' грн (продажна: ' + price.displayPrice + ' грн)' 
        : ' — ⚠️ НЕ ЗНАЙДЕНО В ПРАЙСІ';
      lines.push((idx + 1) + '. ' + icon + ' ' + item.name + priceStr);
    });
    
    ui.alert('📋 Асортимент', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Помилка: ' + e.toString());
  }
}

/**
 * Диалог добавления новой позиции
 */
function showAddProductDialog() {
  var ui = SpreadsheetApp.getUi();
  
  try {
    // Получаем все позиции из прайса поставщика (без фильтра)
    var priceSS = SpreadsheetApp.openById(PRICE_SPREADSHEET_ID);
    var priceSheet = priceSS.getSheets()[0];
    var lastRow = priceSheet.getLastRow();
    var lastCol = priceSheet.getLastColumn();
    var allData = priceSheet.getRange(1, 1, lastRow, lastCol).getValues();
    
    // Собираем все названия из прайса
    var allPriceProducts = [];
    for (var r = 0; r < allData.length; r++) {
      for (var c = 0; c < allData[r].length - 1; c++) {
        var cellText = String(allData[r][c] || '').trim();
        var cellNext = allData[r][c + 1];
        var nextNum = parseFloat(String(cellNext || '').replace(',', '.'));
        if (cellText.length > 2 && !isNaN(nextNum) && nextNum > 0) {
          allPriceProducts.push({ name: cellText, price: nextNum });
        }
      }
    }
    
    // Получаем уже добавленные
    var allowed = getAllowedProductsList();
    var ss = getSpreadsheet();
    var settingsSheet = ss.getSheetByName('Налаштування');
    var existingAll = [];
    if (settingsSheet && settingsSheet.getLastRow() >= 2) {
      var sData = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 1).getValues();
      existingAll = sData.map(function(r) { return String(r[0] || '').toLowerCase().trim(); });
    }
    
    // Фильтруем — показываем только те, которых ещё нет в настройках
    var available = allPriceProducts.filter(function(p) {
      return existingAll.indexOf(p.name.toLowerCase().trim()) === -1;
    });
    
    if (available.length === 0) {
      ui.alert('Інформація', 'Всі позиції з прайсу вже додані в асортимент.', ui.ButtonSet.OK);
      return;
    }
    
    var html = `
      <html><head><base target="_top"><style>
        body{font-family:Arial,sans-serif;padding:20px}
        select{width:100%;padding:10px;font-size:14px;margin-bottom:15px;border:2px solid #ddd;border-radius:4px}
        .btns{display:flex;gap:10px;justify-content:flex-end}
        button{padding:10px 20px;font-size:14px;border:none;border-radius:4px;cursor:pointer}
        #add{background:#2E7D32;color:#fff}#add:hover{background:#1B5E20}
        #cancel{background:#757575;color:#fff}
        .info{background:#E8F5E9;border:1px solid #A5D6A7;padding:12px;border-radius:4px;margin-bottom:15px;color:#2E7D32;font-size:13px}
      </style></head><body>
        <div class="info">Оберіть позицію з прайсу поставщика для додавання в асортимент продавців.</div>
        <label><strong>Позиція з прайсу:</strong></label>
        <select id="pp">
          <option value="">-- Оберіть --</option>
          ${available.map(function(p) { return '<option value="' + p.name + '">' + p.name + ' — ' + p.price + ' грн/кг</option>'; }).join('')}
        </select>
        <div class="btns">
          <button id="cancel" onclick="google.script.host.close()">Скасувати</button>
          <button id="add" onclick="addProduct()">➕ Додати</button>
        </div>
        <script>
          function addProduct(){
            var v=document.getElementById('pp').value;
            if(!v){alert('Оберіть позицію');return}
            document.getElementById('add').disabled=true;document.getElementById('add').textContent='Додаю...';
            google.script.run.withSuccessHandler(function(m){alert(m);google.script.host.close()})
              .withFailureHandler(function(e){alert('Помилка: '+e.message);document.getElementById('add').disabled=false;document.getElementById('add').textContent='➕ Додати'})
              .addProductToSettings(v);
          }
        </script>
      </body></html>`;
    
    ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(500).setHeight(280), '➕ Додати позицію');
    
  } catch (e) {
    ui.alert('Помилка: ' + e.toString());
  }
}

/**
 * Добавляет позицию в лист настроек
 */
function addProductToSettings(productName) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Налаштування');
  if (!sheet) throw new Error('Лист "Налаштування" не знайдено');
  
  var name = String(productName || '').trim();
  if (!name) throw new Error('Порожня назва');
  
  // Проверяем дубликат
  if (sheet.getLastRow() >= 2) {
    var existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0]).toLowerCase().trim() === name.toLowerCase().trim()) {
        throw new Error('Позиція "' + name + '" вже є в асортименті');
      }
    }
  }
  
  var newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1, 1, 3).setValues([[name, '', '']]);
  
  // Добавляем валидацию статуса
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['', 'стоп'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(newRow, 2).setDataValidation(statusRule);
  
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('veg_prices_cache');
  return '✅ Додано: "' + name + '"\n\nПозиція одразу доступна для замовлення (без нового деплою).';
}

/**
 * Диалог включения/выключения позиции
 */
function showToggleProductDialog() {
  var ui = SpreadsheetApp.getUi();
  
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Налаштування');
    if (!sheet || sheet.getLastRow() < 2) {
      ui.alert('Інформація', 'Асортимент порожній.', ui.ButtonSet.OK);
      return;
    }
    
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    var items = [];
    for (var i = 0; i < data.length; i++) {
      var name = String(data[i][0] || '').trim();
      var status = String(data[i][1] || '').trim();
      if (name) items.push({ name: name, status: status, row: i + 2 });
    }
    
    var html = `
      <html><head><base target="_top"><style>
        body{font-family:Arial,sans-serif;padding:20px}
        select{width:100%;padding:10px;font-size:14px;margin-bottom:15px;border:2px solid #ddd;border-radius:4px}
        .btns{display:flex;gap:10px;justify-content:flex-end;margin-top:10px}
        button{padding:10px 20px;font-size:14px;border:none;border-radius:4px;cursor:pointer}
        .btn-stop{background:#d32f2f;color:#fff}
        .btn-start{background:#2E7D32;color:#fff}
        #cancel{background:#757575;color:#fff}
        .info{padding:10px;border-radius:4px;margin-bottom:15px;font-size:13px}
      </style></head><body>
        <div class="info" style="background:#FFF3E0;border:1px solid #FFB74D;color:#E65100;">
          🛑 <strong>Стоп</strong> — позиція не відображається у продавців<br>
          ✅ <strong>Активна</strong> — позиція доступна для замовлення
        </div>
        <label><strong>Оберіть позицію:</strong></label>
        <select id="pp">
          <option value="">-- Оберіть --</option>
          ${items.map(function(item) { 
            var icon = item.status === 'стоп' ? '🛑' : '✅';
            return '<option value="' + item.name + '">' + icon + ' ' + item.name + '</option>'; 
          }).join('')}
        </select>
        <div class="btns">
          <button id="cancel" onclick="google.script.host.close()">Скасувати</button>
          <button class="btn-stop" onclick="toggle('стоп')">🛑 Вимкнути</button>
          <button class="btn-start" onclick="toggle('')">✅ Увімкнути</button>
        </div>
        <script>
          function toggle(status){
            var v=document.getElementById('pp').value;
            if(!v){alert('Оберіть позицію');return}
            var action = status === 'стоп' ? 'вимкнути' : 'увімкнути';
            if(!confirm(action.charAt(0).toUpperCase()+action.slice(1)+' "'+v+'"?'))return;
            google.script.run.withSuccessHandler(function(m){alert(m);google.script.host.close()})
              .withFailureHandler(function(e){alert('Помилка: '+e.message)})
              .toggleProductStatus(v, status);
          }
        </script>
      </body></html>`;
    
    ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(500).setHeight(320), '➖ Вимкнути/Увімкнути позицію');
    
  } catch (e) {
    ui.alert('Помилка: ' + e.toString());
  }
}

/**
 * Переключает статус позиции
 */
function toggleProductStatus(productName, newStatus) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Налаштування');
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Асортимент порожній');
  
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var found = false;
  
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === String(productName).toLowerCase().trim()) {
      sheet.getRange(i + 2, 2).setValue(newStatus);
      found = true;
      break;
    }
  }
  
  if (!found) throw new Error('Позицію "' + productName + '" не знайдено');
  
  SpreadsheetApp.flush();
  
  var action = newStatus === 'стоп' ? '🛑 Вимкнено' : '✅ Увімкнено';
  CacheService.getScriptCache().remove('veg_prices_cache');
  return action + ': "' + productName + '"\n\nЗміни одразу діють (без нового деплою).';
}
function archiveOldOrders() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var ss = getSpreadsheet();
    var raw = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    if (!raw || raw.getLastRow() < 2) return;

    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
    var lastRow = raw.getLastRow();
    var data = raw.getRange(2, 1, lastRow - 1, 7).getValues();

    var keep = [];   // сегодняшние — остаются
    var archive = []; // старые — в архив
    for (var i = 0; i < data.length; i++) {
      var cell = data[i][0];
      var isToday = false;
      if (cell instanceof Date) {
        if (Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd.MM.yyyy') === today) isToday = true;
      } else if (String(cell || '').trim() === today) isToday = true;

      if (isToday) keep.push(data[i]); else archive.push(data[i]);
    }

    if (archive.length === 0) { console.log('Нема чого архівувати'); return; }

    // Пишем в архив
    var arch = ss.getSheetByName('_Архів_Овочі');
    if (!arch) {
      arch = ss.insertSheet('_Архів_Овочі');
      arch.getRange(1, 1, 1, 7).setValues([['Дата','Час','Адрес ТТ','Назва овочу','Ціна/кг','Кількість','Сума']]);
      arch.hideSheet();
    }
    arch.getRange(arch.getLastRow() + 1, 1, archive.length, 7).setValues(archive);

    // Перезаписываем рабочий лист только сегодняшними
    raw.getRange(2, 1, lastRow - 1, 7).clearContent();
    if (keep.length > 0) {
      raw.getRange(2, 1, keep.length, 7).setValues(keep);
    }
    SpreadsheetApp.flush();
    console.log('Архівовано ' + archive.length + ' рядків, залишилось ' + keep.length);
  } catch (e) {
    console.error('archiveOldOrders: ' + e.toString());
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}
// ============================================================
// ЗАХИСТ ВІД ПОВТОРНИХ ЗАМОВЛЕНЬ
// ============================================================

/**
 * Повертає карту сьогоднішніх замовлень:
 * нормалізована адреса -> { address, firstTime, positions, kg, supplierSum }
 */
function getTodayOrdersMap() {
  var map = {};
  try {
    var ss = getSpreadsheet();
    var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    if (!rawSheet || rawSheet.getLastRow() < 2) return map;

    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
    var data = rawSheet.getRange(2, 1, rawSheet.getLastRow() - 1, 7).getValues();

    for (var i = 0; i < data.length; i++) {
      var cell = data[i][0];
      var dateStr = (cell instanceof Date)
        ? Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd.MM.yyyy')
        : String(cell || '').trim();
      if (dateStr.indexOf(today) !== 0) continue;

      var addr = String(data[i][2] || '').trim();
      if (!addr || addr.length < 5) continue;

      var key = normalizeAddress(addr, false);
      if (!map[key]) {
        map[key] = {
          address: addr,
          firstTime: String(data[i][1] || '').substring(0, 5),
          positions: 0,
          kg: 0,
          supplierSum: 0
        };
      }
      map[key].positions++;
      map[key].kg += Number(data[i][5]) || 0;
      map[key].supplierSum += Number(data[i][6]) || 0;
    }
  } catch (e) {
    console.error('getTodayOrdersMap: ' + e.toString());
  }
  return map;
}

/**
 * Викликається з форми при виборі ТТ — жива перевірка "чи вже замовляли сьогодні"
 */
function checkStoreOrderStatus(storeAddress) {
  try {
    var norm = normalizeAddress(String(storeAddress || ''), false);
    if (!norm) return { ordered: false };

    var info = getTodayOrdersMap()[norm];
    if (!info) return { ordered: false };

    return {
      ordered: true,
      address: info.address,
      time: info.firstTime,
      positions: info.positions,
      kg: info.kg,
      sum: Math.round(info.supplierSum * PRICE_MARKUP * 100) / 100
    };
  } catch (e) {
    console.error('checkStoreOrderStatus: ' + e.toString());
    return { ordered: false };
  }
}
