// ============================================================
// АВАРІЙНЕ ВІДКРИТТЯ ПРИЙОМУ НА СЬОГОДНІ
// Знімає дедлайн для всіх точок напрямку і чистить позначки
// "вже замовляли" - потрібно, коли рядки замовлень затерлись,
// а позначка лишилась і продавець не може відправити заново.
//
// Дозвіл закупниці не потрібен. Діє до кінця дня.
// ============================================================

function z09_reopenBakeryToday() { reopenToday_('bakery'); }
function z10_reopenBreadToday()  { reopenToday_('bread'); }
function z11_reopenNbhzToday()   { reopenToday_('nbhz'); }
function z12_reopenVegToday()    { reopenToday_('veg'); }

// Повернути звичайний режим (дедлайн знову діє)
function z13_closeBakeryToday()  { closeLate_('bakery'); invalidateAppCache(); }

function reopenToday_(dirKey) {
  var cfg = dirCfg_(dirKey);
  var props = PropertiesService.getScriptProperties();

  // 1. знімаємо дедлайн для ВСІХ точок до кінця дня
  allowLate_(dirKey);

  // 2. чистимо позначки "вже замовляли"
  //    Точки, у яких рядки в таблиці лишились, все одно будуть
  //    заблоковані перевіркою листа - дублів не буде.
  var all = props.getProperties();
  var prefix = 'sub_' + dirKey + '_';
  var killed = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(prefix) === 0) { props.deleteProperty(k); killed++; }
  });

  // 3. знімаємо активні запити і дозволи, щоб плашка не плутала
  props.deleteProperty('late_q_' + dirKey);

  invalidateAppCache();

  console.log('=== ' + cfg.title + ' ВІДКРИТО ДО КІНЦЯ ДНЯ ===');
  console.log('Дедлайн ' + cfg.deadline + ' більше не діє сьогодні.');
  console.log('Знято позначок "вже замовляли": ' + killed);
  console.log('Дозвіл закупниці НЕ потрібен - продавці можуть відправляти одразу.');
  console.log('');
  console.log('Хто зараз може замовляти:');

  var can = 0, blocked = [];
  loadStores_().forEach(function (s) {
    if (s.directions.indexOf(dirKey) < 0) return;
    if (!dayAllowed_(dirKey, s)) { blocked.push(s.label + ' (не той день)'); return; }
    if (isOrderedToday_(dirKey, s)) { blocked.push(s.label + ' (рядки в таблиці є)'); return; }
    can++;
  });
  console.log('   можуть відправити: ' + can);
  if (blocked.length) {
    console.log('   заблоковані (' + blocked.length + '):');
    blocked.forEach(function (b) { console.log('      ' + b); });
  }
  console.log('');
  console.log('Повернути звичайний режим: z13_closeBakeryToday()');
}

// --- Точкове зняття позначки по списку адрес ---
// Якщо треба відкрити НЕ всім, а лише цим точкам: впишіть їх нижче,
// запустіть, і дедлайн лишиться для решти.
function z14_clearMarksForList() {
  var DIR = 'bakery';
  var LIST = [
    'Михайля Семенка, 17',
    'Гарібальді, 1',
    'Бучми, 32Б1',
    'Краснодарська, 171/З',
    'Олімпійська, 9А',
    'Героїв Харкова, 160',
    'Іскринський, 19 В',
    'Ньютона, 102',
    'Шевченко, 341',
    'Бучми, 52',
    'Роганська, 148',
    'Гвардій Широнінців, 54',
    'Астрономічна, 44 Г',
    'Валентинівська, 50 А',
    'Салтівське Шосе, 264 В',
    'Бучми, 32',
    'Петра Григоренка, 37',
    'Нескорених, 4 Д',
    'Ньютона, 111',
    'Роганська, 130/4',
    'Амосова, 5А'
  ];

  var props = PropertiesService.getScriptProperties();
  var stores = loadStores_().filter(function (s) {
    return s.directions.indexOf(DIR) >= 0;
  });

  var done = 0, miss = [];
  LIST.forEach(function (q) {
    var needle = q.trim().toLowerCase();
    var hit = stores.filter(function (s) {
      return s.label.toLowerCase().indexOf(needle) >= 0;
    });
    if (hit.length !== 1) { miss.push(q + (hit.length ? ' - знайдено ' + hit.length : ' - не знайдено')); return; }
    props.deleteProperty(orderMarkKey_(DIR, hit[0]));
    done++;
  });

  invalidateAppCache();
  console.log('Позначок знято: ' + done + ' із ' + LIST.length);
  if (miss.length) {
    console.log('НЕ ЗІСТАВЛЕНО:');
    miss.forEach(function (m) { console.log('   ' + m); });
  }
  console.log('Дедлайн при цьому НЕ знято - для цього потрібен z09_reopenBakeryToday()');
}
