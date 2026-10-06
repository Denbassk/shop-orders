// ============================================================
// КОНФІГУРАЦІЯ НАПРЯМКІВ
// ============================================================

// Міняти при КОЖНОМУ деплої - телефони самі перезавантажаться.
const APP_VERSION = '2026-10-06-2';

// true - замовлення падають у тестові листи і нікуди не йдуть
const TEST_MODE = false;

// Скільки останніх рядків сирого листа читати. Сьогоднішні замовлення
// завжди в кінці, тож немає сенсу тягнути весь лист за всю історію -
// саме це з часом і починає підвисати.
// Архівування (Archive.gs) лишає в робочому листі лише останній тиждень,
// тож цей хвіст - просто страховка на випадок, якщо архів не відпрацював.
const RAW_TAIL_ROWS = 5000;

// Чи знімає дозвіл закупниці обмеження по дню тижня (див. VegDays.gs).
// false - день тижня це логістика маршруту, його дозволом не обходять.
const LATE_OVERRIDES_DAY = false;

// Оболонка на GitHub Pages: саме її продавці ставлять на телефон як застосунок.
// Порожньо - у storeLinks() будуть звичайні посилання на /exec.
const PWA_URL = 'https://denbassk.github.io/shop-orders/';

const REGISTRY_ID = '1noOXYRRdxIuY6gd9kicI2OxGU0vJ_kfvLbcVTyqXi6o';
const REGISTRY_SHEET = 'ТТ';
const NBHZ_ID = '1ShyjK-P3xpe1ROsUPJwfpIzcNylgt05u_7r7ws6iHaY';

const DIRECTIONS = {
  bread: {
    key: 'bread', title: 'Хліб Рома', subtitle: 'ЧП Рома',
    color: '#8D6E63', deadline: '16:00', step: 1,
    spreadsheetId: '1QJca7XlvZbIWfEIyxBxC64dSD6RkrlWoZOSmem2tix4',
    productsSheet: 'Ассортимент',
    rawSheet: '_Сырые_Заказы', testSheet: '_Тест_Заказы_Хліб',
    unit: 'шт', minOrder: 350, markup: 1,
    // з 01.10.2026 мінімалка піднімається до 400 грн - спрацює само,
    // нічого руками міняти не треба. Дивитись minOrderOf_() нижче.
    minOrderChanges: [{ from: '01.10.2026', value: 400 }],
    hasCategories: false, hasBarcodes: true,
    addressAlias: 'addrBread', routeAlias: 'route', shortAddr: true,
    lateRequest: true,
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.route, ctx.shortAddress,
              p.barcode, p.name, p.price, p.qty];
    }
  },

  nbhz: {
    key: 'nbhz', title: 'Хліб НБХЗ', subtitle: 'Новобаварський хлібозавод',
    color: '#5D4037', deadline: '17:30', step: 1,
    spreadsheetId: NBHZ_ID,
    productsSheet: 'Ассортимент',
    rawSheet: '_Сырые_Заказы_НБХЗ', testSheet: '_Тест_Заказы_НБХЗ',
    unit: 'шт', minOrder: 0, markup: 1,
    hasCategories: false, hasBarcodes: true,
    addressAlias: 'addrNbhz', routeAlias: 'routeNbhz', shortAddr: true,
    lateRequest: true, allowNoPrice: true, keepOrder: true,
    // Лист "Ассортимент" НБХЗ - лише 3 колонки: Статус | № | Номенклатура
    productLayout: 'nbhz',
    // Замовлення кількісне: цін немає - і в застосунку їх не показуємо
    hidePrice: true,
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.route, ctx.shortAddress,
              p.barcode, p.name, p.price, p.qty];
    }
  },

  bakery: {
    key: 'bakery', title: 'Випічка і кулінарія', subtitle: 'власне виробництво',
    color: '#E65100', deadline: '13:00', step: 1,
    spreadsheetId: '1THdB-b4JkXzAKsaVPw8DLrXATlycpFkTgolTmqCOXWo',
    productsSheet: 'Ассортимент',
    rawSheet: '_Сырые_Заказы_ВК', testSheet: '_Тест_Заказы_ВК',
    unit: 'шт', minOrder: 0, markup: 1,
    hasCategories: true, hasBarcodes: true,
    addressAlias: 'addrBakery', routeAlias: 'route', shortAddr: false,
    lateRequest: true,
    // дні прийому - колонка R Довідника, порожньо = без обмежень
    orderDays: true, dayCol: 18,
    dayOffTag: 'Вихідний',
    dayOffText: 'Кулінарія у суботу та неділю не працює.',
    // У колонці D - ЗОНА ДОСТАВКИ (Салтовка / Новые дома / Центр),
    // колонка S Довідника. Так закупниця бачить маршрут прямо в сирому
    // листі. Категорію (Випічка / Кулінарія) звіти беруть з листа
    // "Ассортимент" по штрихкоду - див. bakeryCatByBarcode_.
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.timeStr, ctx.address,
              (ctx.store && ctx.store.zone) || '', p.barcode, p.name, p.price, p.qty];
    }
  },

  veg: {
    key: 'veg', title: 'Овочі і фрукти', subtitle: 'від постачальника',
    color: '#2E7D32', deadline: '18:00', step: 1,
    spreadsheetId: '1HbvDCuMMJe7GI4zQyDxkyqVWahTPtWf5vNuMFLEXIC0',
    rawSheet: '_Сырые_Заказы_Овочі', testSheet: '_Тест_Заказы_Овочі',
    priceSpreadsheetId: '1WnxkoU_aHZg6WjrkT4cdCFrk6tMlbIsdYDGkvlaDV7w',
    unit: 'кг', minOrder: 500, markup: 1.5,
    hasCategories: false, hasBarcodes: false,
    // графік по днях тижня - колонка Q Довідника
    orderDays: true, dayCol: 17,
    dayOffTag: 'Не ваш день',
    dayOffText: 'Вибачте, не ваш день для замовлення.',
    addressAlias: 'addrVeg', routeAlias: 'route', shortAddr: false,
    lateRequest: true,
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.timeStr, ctx.address,
              p.name, p.price, p.qty, Math.round(p.price * p.qty * 100) / 100];
    }
  }
};

// Адреса розгорнутого застосунку.
// ScriptApp.getService().getUrl() у РЕДАКТОРІ віддає адресу чернетки (/dev),
// а не робочого розгортання - у неї інший ідентифікатор і вона вимагає
// входу в акаунт. Тому робочу адресу зберігаємо окремо: a03_setWebAppUrl().
// Під час справжнього запиту від продавця getUrl() віддає правильну /exec,
// тож властивість потрібна тільки для запусків з редактора.
// Під час СПРАВЖНЬОГО запиту getUrl() віддає правильну /exec - запам'ятовуємо.
// Достатньо один раз відкрити застосунок у браузері після нового
// розгортання, і адреса оновиться сама.
function rememberAppUrl_() {
  try {
    var u = ScriptApp.getService().getUrl();
    if (!u || u.indexOf('/exec') < 0) return;
    var p = PropertiesService.getScriptProperties();
    if (p.getProperty('WEB_APP_URL') !== u) {
      p.setProperty('WEB_APP_URL', u);
      console.log('Записано робочу адресу: ' + u);
    }
  } catch (e) {}
}

function appUrl_() {
  try {
    var saved = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
    if (saved) return saved;
  } catch (e) {}
  return ScriptApp.getService().getUrl();
}

function dirCfg_(key) {
  const c = DIRECTIONS[key];
  if (!c) throw new Error('Невідомий напрямок: "' + key + '". Доступні: ' +
    Object.keys(DIRECTIONS).join(', ') +
    '. Якщо запускали з редактора - беріть функцію з Actions.gs, вона без аргументів.');
  return c;
}

function rawSheetName_(cfg) {
  return TEST_MODE ? cfg.testSheet : cfg.rawSheet;
}

// Мінімальне замовлення з урахуванням запланованої зміни в майбутньому.
// minOrderChanges: [{from: 'ДД.ММ.РРРР', value: N}, ...] - діє з 00:00 цієї
// дати за Києвом. Дат у майбутньому - береться базовий cfg.minOrder, дата
// настала - береться найновіша з тих, що вже настали. Нічого вмикати
// руками не треба: значення міняється саме собою в потрібний день.
function minOrderOf_(cfg) {
  var v = cfg.minOrder;
  if (cfg.minOrderChanges && cfg.minOrderChanges.length) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var best = null;
    cfg.minOrderChanges.forEach(function (ch) {
      var d = parseDMY_(ch.from);
      if (d && today >= d && (!best || d > best.d)) best = { d: d, value: ch.value };
    });
    if (best) v = best.value;
  }
  return v;
}

// ============================================================
// УВІМКНЕННЯ / ВИМКНЕННЯ НАПРЯМКУ ЦІЛКОМ
//
// Вимкнений напрямок зникає з меню продавця ОДНИМ КЛІКОМ з пульта -
// не "закрито до дедлайну", а взагалі не приходить у bootstrap, ні в
// список напрямків, ні як цятка на плитці ТТ. Перемикається без деплою
// коду: прапорець лежить у ScriptProperties, а не в Config.gs.
//
// Існуючі замовлення і звіти напрямок не чіпає - вимикається лише
// ПРИЙОМ НОВИХ замовлень від продавців. Керування і списки пульта
// (admStores_, admDirStores_ тощо) його так само бачать.
// ============================================================
var DIR_OFF_KEY = 'dirs_off';   // ScriptProperties: JSON-масив вимкнених ключів напрямків

function disabledDirections_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(DIR_OFF_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    var map = {};
    arr.forEach(function (k) { map[k] = true; });
    return map;
  } catch (e) { return {}; }
}

function dirEnabled_(key) {
  return !disabledDirections_()[key];
}

// Перемкнути напрямок. Викликає пульт (одна кнопка) або f10_toggleDirectionHere.
function setDirEnabled_(key, on) {
  if (!DIRECTIONS[key]) throw new Error('Невідомий напрямок: "' + key + '"');
  var off = disabledDirections_();
  if (on) delete off[key]; else off[key] = true;
  PropertiesService.getScriptProperties().setProperty(DIR_OFF_KEY, JSON.stringify(Object.keys(off)));
  invalidateAppCache();
}

function statusKey_(dirKey, store) {
  const cfg = dirCfg_(dirKey);
  const a = store[cfg.addressAlias];
  return addrKey_(cfg.shortAddr ? shortenAddress_(a) : a);
}
