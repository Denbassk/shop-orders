// ============================================================
// ПАНЕЛЬ ЗАПУСКУ
//
// Усе, що треба запускати руками - тут, і БЕЗ АРГУМЕНТІВ.
// Вибрали функцію у списку зверху, натиснули "Виконати", читаєте лог.
//
// Функції з аргументами (whyNoProducts('bakery') і подібні) з редактора
// не запускаються - Google передає undefined. Тому всі обгортки тут.
//
// ------------------------------------------------------------
// ДЕ ЩО ЛЕЖИТЬ
//   Actions.gs      - цей файл, точки входу без аргументів
//   Config.gs       - напрямки, дедлайни, ID таблиць, APP_VERSION
//   Code.gs         - doGet / doPost, bootstrap, heartbeat
//   Orders.gs       - асортимент для клієнта, приймання замовлень, замки
//   Products.gs     - читання листів "Ассортимент"
//   Registry.gs     - Довідник ТТ, статуси, кеш
//   Address.gs      - нормалізація адрес
//   Deadline.gs     - дедлайни, ручне відкриття прийому
//   LateRequest.gs  - дозвіл на дозамовлення, листи закупницям
//   Nbhz.gs         - НБХЗ: листи, зіставлення маршрутів, вивантаження
//   Nbhz_Seed.gs    - дані НБХЗ: асортимент і маршрути
//   Archive.gs      - архівування сирих листів
//   Maintenance.gs  - перевірки, заміри, посилання на ТТ, прибирання
//   LoadTest.gs     - навантажувальний тест
//   Logo.gs         - логотип у base64
//   ui/Index.html   - весь інтерфейс
// ------------------------------------------------------------
// ============================================================


// ============ 1. ПІСЛЯ КОЖНОГО ДЕПЛОЮ ============

/** Видати скрипту дозвіл на пошту і зовнішні запити. Запустити раз. */
function a01_authorize() {
  authorizeMail();
  try {
    UrlFetchApp.fetch(ScriptApp.getService().getUrl(), { muteHttpExceptions: true });
    console.log('Зовнішні запити дозволені - навантажувальний тест запрацює.');
  } catch (e) { console.log('Зовнішні запити: ' + e.message); }
}

/** Скинути кеш - після правок у Довіднику чи асортименті. */
function a02_clearCache() {
  invalidateAppCache();
}


// ============ 2. ПЕРЕВІРКИ ============

/** Чому напрямок показує нуль позицій. Розбір усіх чотирьох листів. */
function b01_checkProducts() {
  whyNoProducts();
}

/** Скільки рядків у роботі і скільки в архіві. */
function b02_showSizes() {
  showRawSizes();
}

/** Стан НБХЗ: галочки, маршрути, адреси в Довіднику. */
function b03_checkNbhz() {
  whyNoNbhz();
  console.log('');
  showNbhzInRegistry();
}

/** Дедлайни: що зараз відкрито, що закрито. */
function b04_checkDeadlines() {
  deadlineStatus();
}

/** Активні дозволи на дозамовлення і хто чекає. */
function b05_showLate() {
  showLateToday();
}

/** Дублі в сьогоднішніх замовленнях. */
function b06_auditToday() {
  auditToday();
}


// ============ 3. ЗАМІРИ ============

/** Загальні заміри швидкості: bootstrap, heartbeat, асортимент. */
function c01_benchmark() {
  benchmarkApp();
}

/** Реальна вартість одного запису в таблицю - по всіх напрямках. */
function c02_measureWrite() {
  measureWriteAll();
}

/** ЗАЛП: 39 точок x 4 напрямки одночасно. Потрібен свіжий деплой. */
function c03_loadTest() {
  loadTest();
}

/** Прибрати службові листи після залпу. */
function c04_loadTestCleanup() {
  loadTestCleanup();
}


// ============ 4. ОБСЛУГОВУВАННЯ ============

/** Архівувати все старше тижня. Повісити тригером раз на тиждень. */
function d01_archive() {
  archiveRawSheets();
  console.log('');
  showRawSizes();
}

/** Прибрати старі ключі у властивостях. Тригером раз на добу. */
function d02_cleanupProps() {
  cleanupOldOrderIds();
}

/** Лист "Посилання" в Довіднику: персональне посилання на кожну ТТ. */
function d03_storeLinks() {
  writeStoreLinksSheet();
}

/** Прибрати тестові листи і старі листи "Дозволи". Разово. */
function d04_dropOldSheets() {
  dropTestSheets();
  dropLateSheets();
}


// ============ 5. НБХЗ ============

/** Повне встановлення НБХЗ: листи, асортимент, маршрути, Довідник. */
function e01_installNbhz() {
  installNbhz();
}

/** Перезібрати зіставлення маршрутів з Довідником. */
function e02_matchNbhzRoutes() {
  matchNbhzRoutes();
}

/** Вивантаження для заводу за сьогодні. */
function e03_nbhzExport() {
  buildNbhzExport();
}


// ============ 6. АВАРІЙНЕ ============

/** Зняти замки напрямків, якщо щось зависло. */
function f01_clearLocks() {
  clearDirLocks();
}

/** Скасувати всі активні дозволи на дозамовлення. */
function f02_resetLate() {
  resetLateToday();
}

/** Відкрити прийом ВСІМ точкам до кінця дня. Впишіть напрямок нижче. */
function f03_openAllToday() {
  var DIR = 'bread';        // bread | nbhz | bakery | veg
  allowLate_(DIR);
}

/** Повернути звичайний режим після f03. Впишіть напрямок нижче. */
function f04_closeAllToday() {
  var DIR = 'bread';        // bread | nbhz | bakery | veg
  closeLate_(DIR);
}

/** Посилання "Дозволити" вручну. Впишіть напрямок і частину назви точки. */
function f05_lateLinkHere() {
  var DIR = 'nbhz';         // bread | nbhz | bakery | veg
  var STORE = 'амосова';    // частина назви ТТ
  lateLinkFor(DIR, STORE);
}

/** Зняти позначку "точка вже замовляла сьогодні".
 *  Потрібно лише якщо рядки замовлення видалили з листа руками. */
function f06_clearOrderMarkHere() {
  var DIR = 'bread';        // bread | nbhz | bakery | veg
  var STORE = 'амосова';    // частина назви ТТ
  clearOrderMark(DIR, STORE);
}
