// ============================================================
// ГРАФІК ЗАМОВЛЕННЯ ОВОЧІВ ПО ДНЯХ ТИЖНЯ
//
// Кожна точка замовляє овочі лише у свій день. В інший день напрямок
// сірий, а при спробі відкрити пишеться "Вибачте, не ваш день".
//
// Джерело даних - колонка Q Довідника ТТ ("Дні овочів").
// Заповнити її один раз: e05_setupVegDays() у Actions.gs.
// Далі графік міняється прямо в Довіднику, код чіпати не треба.
//
// Формат колонки: "Пн", "Пн, Ср", "Ср, Нд" - будь-які з
// Пн Вт Ср Чт Пт Сб Нд через кому. Порожньо = без обмежень.
// ============================================================

var VEG_DAYS_COL = 17;              // колонка Q

// Кулінарія не працює у суботу та неділю - однаково для всіх магазинів.
// Записується в колонку R, щоб графік був видно в Довіднику і його
// можна було правити там без коду.
var BAKERY_DAYS_COL = 18;           // колонка R
var BAKERY_DAYS = 'Пн, Вт, Ср, Чт, Пт';

// [ адреса як у Довіднику, дні, (необов'язково) частина НАЗВИ точки ]
// Якщо адреса порожня - рядок шукається за назвою. Це потрібно там,
// де адреса в Довіднику записана інакше, ніж у графіку.
var VEG_DAYS = [
  ['м. Харків вул. Амосова, 5А',                'Пн'],
  ['м. Харків вул. Богдана Хмельницького, 8',   'Пн'],
  ['м. Харків вул. Валентинівська, 50 А',       'Пн'],
  ['м. Харків вул. Гарібальді, 1',              'Пн'],
  ['м. Харків вул. Грозненська, 38',            'Пн'],
  ['м. Харків вул. Качанівська,19',             'Пн'],
  ['м. Харків вул. Ньютона, 102',               'Пн'],
  ['м. Харків вул. Ньютона, 111',               'Пн'],
  ['м. Харків вул. Олімпійська, 9А',            'Пн'],
  ['м. Харків вул. Роганська, 130/4',           'Пн'],
  ['м. Харків вул. Роганська, 148',             'Пн'],
  ['м. Харків вул. Салтівське Шосе, 264 В',     'Пн'],
  ['м. Харків вул. Танкопія, 16',               'Пн'],
  ['м. Харків пр-т Байрона, 138/1',             'Пн'],
  ['м. Харків пр-т Байрона, 156',               'Пн'],
  ['м. Харків пр-т Байрона, 163 А',             'Пн'],
  ['м. Харків пр-т Героїв Харкова, 160',        'Пн'],
  ['м. Харків пр-т Петра Григоренка, 37',       'Пн'],
  ['м. Харків вул. Бучми, 52',                  'Пн'],
  ['м. Харків вул. Зубенка, 31В5',              'Пн'],
  ['м. Харків вул. Краснодарська, 171/З',       'Пн'],
  ['м. Харків пр-т Ювілейний, 67',              'Пн'],
  ['м. Харків вул. Зернова, 6/5',               'Пн'],

  ['м. Харків вул. Валентинівська, 24 Б',       'Вт'],
  ['м. Харків вул. Гвардій Широнінців, 54',     'Вт'],
  ['м. Харків вул. Нескорених, 33',             'Вт'],
  ['м. Харків вул. Нескорених, 4 Д',            'Вт'],
  ['м. Харків вул. Шевченко, 341',              'Вт'],
  ['м. Харків пр-т Тракторобудівників, 95',     'Вт'],
  ['м. Харків вул. Астрономічна, 44 Г',         'Вт'],
  ['м. Харків вул. Бучми, 32',                  'Вт'],
  ['м. Харків вул. Бучми, 32Б1',                'Вт'],
  ['м. Харків вул. Зубенка, 23',                'Вт'],

  ['м. Харків вул. Переяславська, 23',          'Ср'],

  // єдині дві точки, що замовляють і в неділю
  ['м. Харків пл. Героїв Небесної Сотні, 14/1', 'Ср, Нд'],
  ['м. Харків пров. Іскринський, 19 В',         'Ср, Нд'],

  // Семенка 17: магазин і виробництво - два різні рядки Довідника,
  // дні однакові. Виробництво шукаємо за НАЗВОЮ, бо адреса в нього своя.
  ['м. Харків вул. Михайля Семенка 17',         'Пн, Ср'],
  ['',                                          'Пн, Ср', 'виробництво']
];

var DAY_KEYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];   // індекс = getDay()

// "Пн, Ср" -> [1, 3]
function parseDays_(s) {
  var t = String(s || '').toLowerCase();
  var out = [];
  for (var i = 0; i < 7; i++) if (t.indexOf(DAY_KEYS[i]) >= 0) out.push(i);
  return out;
}

// День тижня за Києвом: 0 нд ... 6 сб
function todayDow_() {
  var s = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy/MM/dd').split('/');
  return new Date(+s[0], +s[1] - 1, +s[2]).getDay();
}

// Дні прийому цієї точки по цьому напрямку
function storeDays_(dirKey, store) {
  return ((store.days || {})[dirKey]) || [];
}

// Чи можна цій точці замовляти цей напрямок сьогодні
function dayAllowed_(dirKey, store) {
  var cfg = dirCfg_(dirKey);
  if (!cfg.orderDays) return true;
  var days = storeDays_(dirKey, store);
  if (!days.length) return true;              // день не заданий - не обмежуємо
  if (LATE_OVERRIDES_DAY && cfg.lateRequest &&
      lateRequestStatus_(dirKey, store.id) === 'approved') return true;
  return days.indexOf(todayDow_()) >= 0;
}

var DAY_FULL = { 0: 'неділя', 1: 'понеділок', 2: 'вівторок', 3: 'середа',
                 4: 'четвер', 5: 'пʼятниця', 6: 'субота' };

function dayNamesOf_(dirKey, store) {
  return storeDays_(dirKey, store).map(function (d) { return DAY_FULL[d]; }).join(', ');
}

// Текст, який бачить продавець у чужий день
function dayOffText_(dirKey, store) {
  var cfg = dirCfg_(dirKey);
  var base = cfg.dayOffText || 'Сьогодні цей напрямок не приймає замовлень.';
  var days = dayNamesOf_(dirKey, store);
  return days ? base + ' Ваші дні: ' + days + '.' : base;
}

// ============================================================
// РАЗОВЕ ЗАПОВНЕННЯ КОЛОНКИ Q
// ============================================================
function setupVegDays() {
  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var n = sh.getLastRow() - 1;
  if (n < 1) throw new Error('Довідник порожній');

  sh.getRange(1, VEG_DAYS_COL).setValue('Дні овочів')
    .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  sh.setColumnWidth(VEG_DAYS_COL, 110);

  var labels = sh.getRange(2, 2, n, 1).getValues();
  var addrs = sh.getRange(2, 3, n, 1).getValues();
  var vegOn = sh.getRange(2, 9, n, 1).getValues();          // I - Овочі

  // адреса -> список рядків Довідника
  var byAddr = {};
  for (var i = 0; i < n; i++) {
    var a = String(addrs[i][0] || '').trim();
    if (!a) continue;
    var k = addrKey_(a);
    (byAddr[k] = byAddr[k] || []).push({
      row: i + 2, idx: i,
      label: String(labels[i][0] || '').trim(),
      veg: vegOn[i][0] === true
    });
  }

  var values = new Array(n);
  for (var v = 0; v < n; v++) values[v] = [''];

  var done = {}, notFound = [];

  // усі рядки, щоб шукати за назвою
  var allRows = [];
  Object.keys(byAddr).forEach(function (k) {
    byAddr[k].forEach(function (c) { allRows.push(c); });
  });

  VEG_DAYS.forEach(function (e) {
    var addr = String(e[0] || '').trim();
    var days = e[1];
    var mark = String(e[2] || '').trim().toLowerCase();
    var what = addr || ('назва містить "' + mark + '"');
    var pick = null;

    if (!addr) {
      // шукаємо за назвою точки
      var byName = allRows.filter(function (c) {
        return c.label.toLowerCase().indexOf(mark) >= 0;
      });
      if (byName.length === 1) pick = byName[0];
      else if (byName.length > 1) {
        notFound.push(what + '  ->  ' + days + '  (знайдено кілька: ' +
          byName.map(function (c) { return c.label; }).join(' / ') + ')');
        return;
      }
    } else {
      var cand = byAddr[addrKey_(addr)] || [];
      if (cand.length === 1) pick = cand[0];
      else if (cand.length > 1 && mark) {
        var want = cand.filter(function (c) {
          return c.label.toLowerCase().indexOf(mark) >= 0;
        });
        if (want.length === 1) pick = want[0];
      } else if (cand.length > 1) {
        // кілька рядків з однією адресою і без уточнення - беремо той,
        // що НЕ виробництво
        var plain = cand.filter(function (c) {
          var L = c.label.toLowerCase();
          return L.indexOf('вироб') < 0 && L.indexOf('произв') < 0;
        });
        if (plain.length === 1) pick = plain[0];
      }
    }

    if (!pick) { notFound.push(what + '  ->  ' + days); return; }
    if (done[pick.row]) {
      notFound.push(what + '  ->  ' + days + '  (цей рядок уже зайнятий: ' +
        pick.label + ' = ' + values[pick.idx][0] + ')');
      return;
    }

    values[pick.idx] = [days];
    done[pick.row] = true;
  });

  sh.getRange(2, VEG_DAYS_COL, n, 1).setValues(values);
  SpreadsheetApp.flush();
  invalidateAppCache();

  // --- звіт ---
  var filled = Object.keys(done).length;
  console.log('Заповнено днів: ' + filled + ' із ' + VEG_DAYS.length + ' рядків графіка');

  if (notFound.length) {
    console.log('НЕ ЗНАЙДЕНО В ДОВІДНИКУ (' + notFound.length + ') - перевірте написання адреси:');
    notFound.forEach(function (s) { console.log('   ' + s); });
  }

  var noDay = [];
  for (var j = 0; j < n; j++) {
    if (vegOn[j][0] !== true) continue;
    if (!values[j][0]) noDay.push(String(labels[j][0] || '').trim() + '  |  ' +
                                  String(addrs[j][0] || '').trim());
  }
  if (noDay.length) {
    console.log('ОВОЧІ УВІМКНЕНІ, АЛЕ ДНЯ НЕМАЄ (' + noDay.length +
                ') - вони зможуть замовляти будь-коли:');
    noDay.forEach(function (s) { console.log('   ' + s); });
  }
  console.log('---');
  console.log('Далі графік редагується прямо в Довіднику, колонка Q.');
}

// --- Проставити дні кулінарії всім точкам ---
function setupBakeryDays() {
  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var n = sh.getLastRow() - 1;
  if (n < 1) throw new Error('Довідник порожній');

  sh.getRange(1, BAKERY_DAYS_COL).setValue('Дні випічки')
    .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  sh.setColumnWidth(BAKERY_DAYS_COL, 150);

  var on = sh.getRange(2, 8, n, 1).getValues();        // H - Випічка
  var vals = [], cnt = 0;
  for (var i = 0; i < n; i++) {
    if (on[i][0] === true) { vals.push([BAKERY_DAYS]); cnt++; }
    else vals.push(['']);
  }
  sh.getRange(2, BAKERY_DAYS_COL, n, 1).setValues(vals);
  SpreadsheetApp.flush();
  invalidateAppCache();

  console.log('Дні кулінарії проставлено: ' + cnt + ' точок, "' + BAKERY_DAYS + '"');
  console.log('Субота і неділя - вихідні. Міняється прямо в Довіднику, колонка R.');
}

// Показати графік так, як його бачить застосунок
function showVegDays() { showDaysFor_('veg'); }
function showBakeryDays() { showDaysFor_('bakery'); }

function showDaysFor_(dirKey) {
  console.log('=== ' + dirCfg_(dirKey).title + ' ===');
  var byDay = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] }, free = [];
  loadStores_().forEach(function (s) {
    if (s.directions.indexOf(dirKey) < 0) return;
    var d = storeDays_(dirKey, s);
    if (!d.length) { free.push(s.label); return; }
    d.forEach(function (x) { byDay[x].push(s.label); });
  });
  var names = { 1: 'Понеділок', 2: 'Вівторок', 3: 'Середа', 4: 'Четвер',
                5: 'Пʼятниця', 6: 'Субота', 0: 'Неділя' };
  [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
    if (!byDay[d].length) return;
    console.log(names[d] + ' (' + byDay[d].length + '):');
    byDay[d].sort().forEach(function (l) { console.log('   ' + l); });
  });
  if (free.length) {
    console.log('Без обмеження (' + free.length + '):');
    free.sort().forEach(function (l) { console.log('   ' + l); });
  }
  console.log('---');
  console.log('Сьогодні: ' + names[todayDow_()]);
}
