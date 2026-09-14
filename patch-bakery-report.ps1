#Requires -Version 5.1
<#
  Переносить збірку звітів "Заказы ВК" / "Сводная ВК" зі старого проєкту
  (legacy/bakery) у новий застосунок. Після цього стара копія скрипта
  більше не потрібна.

  Запуск із кореня репозиторію:
      .\patch-bakery-report.ps1
      .\patch-bakery-report.ps1 -NoPush          # без git push
      .\patch-bakery-report.ps1 -NoClasp         # без clasp push
      .\patch-bakery-report.ps1 -DeploymentId ID # ще й перерозгорнути
#>
param(
  [string]$RepoRoot = $PSScriptRoot,
  [string]$DeploymentId = '',
  [switch]$NoPush,
  [switch]$NoClasp
)

$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($false)   # UTF-8 без BOM - для .gs

function Read-Text($p) { [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8) }
function Write-Text($p, $t) { [System.IO.File]::WriteAllText($p, $t, $enc) }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

$appDir     = Join-Path $RepoRoot 'app'
$actionsPs  = Join-Path $appDir 'Actions.gs'
$configPs   = Join-Path $appDir 'Config.gs'
$reportPs   = Join-Path $appDir 'BakeryReport.gs'

foreach ($f in @($actionsPs, $configPs)) {
  if (-not (Test-Path $f)) { throw "Не знайдено $f. Запускайте скрипт із кореня репозиторію shop-orders." }
}
Say "Репозиторій: $RepoRoot" 'Cyan'

# ============================================================
# 1. НОВИЙ ФАЙЛ app/BakeryReport.gs
# ============================================================
$report = @'
// ============================================================
// ЗВІТИ ВИПІЧКИ: "Заказы ВК" і "Сводная ВК"
//
// Раніше їх збирав ОКРЕМИЙ проєкт Apps Script (legacy/bakery),
// привязаний до тієї самої таблиці, своїм тригером autoMaintenance.
// Щойно той тригер не відпрацьовував - повар бачив учорашні цифри,
// хоча замовлення в сирому листі лежали.
//
// Тепер усе в одному застосунку:
//   джерело  - _Сырые_Заказы_ВК (той самий лист, куди пише застосунок)
//   список ТТ - Довідник ТТ, а не окремий лист "Адреса ТТ"
//   тригер   - refreshBakeryReports, кожні 5 хвилин (d06_installTriggers)
//
// Старий проєкт після цього треба ВИКЛЮЧИТИ: видалити в ньому
// тригер autoMaintenance, інакше два проєкти перезаписуватимуть
// одні й ті самі два листи.
// ============================================================

var BAKERY_ORDERS_SHEET  = 'Заказы ВК';
var BAKERY_SUMMARY_SHEET = 'Сводная ВК';
var BAKERY_CAT_ORDER = ['Випічка', 'Кулінарія'];
var BAKERY_CAT_ICONS = { 'Випічка': 'Випічка: ', 'Кулінарія': 'Кулінарія: ' };

// Колонки сирого листа випічки (див. rawRow у Config.gs):
// A дата | B час | C адреса | D категорія | E штрихкод | F назва | G ціна | H кіл-ть

// --- Сьогоднішні робочі рядки сирого листа ---
function bakeryTodayRows_() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) return [];

  var last = sh.getLastRow();
  var take = Math.min(last - 1, RAW_TAIL_ROWS);
  var rows = sh.getRange(last - take + 1, 1, take, 8).getValues();
  var today = formatDateDMY_(new Date());

  return rows.filter(function (r) {
    var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim().slice(0, 10);
    if (d !== today) return false;
    // рядки старого формату (без дати, 4 значення) відкидаються саме тут
    return String(r[5] || '').trim() && (Number(r[7]) || 0) > 0;
  });
}

// Підпис стану: рядки | точки | сумарна кількість.
// Стара защіпка порівнювала getLastRow() - після архівування, коли
// лист схлопнувся з 20 000 рядків до 595, вона стала безглуздою
// і блокувала перезбірку. Тут порівнюється сам ВМІСТ за сьогодні.
function bakerySignature_(rows) {
  var qty = 0, addr = {};
  rows.forEach(function (r) {
    qty += Number(r[7]) || 0;
    addr[addrKey_(String(r[2] || '').trim())] = 1;
  });
  return formatDateDMY_(new Date()) + '|' + rows.length + '|' +
         Object.keys(addr).length + '|' + qty;
}

// --- Функція для тригера: перезбирає, лише якщо щось змінилось ---
function refreshBakeryReports() {
  var rows = bakeryTodayRows_();
  var sig = bakerySignature_(rows);
  var props = PropertiesService.getScriptProperties();

  var ss = SpreadsheetApp.openById(dirCfg_('bakery').spreadsheetId);
  var have = ss.getSheetByName(BAKERY_ORDERS_SHEET) && ss.getSheetByName(BAKERY_SUMMARY_SHEET);

  if (have && props.getProperty('bakery_report_sig') === sig) return;

  buildBakeryReports();
}

// --- Зібрати обидва звіти ПРЯМО ЗАРАЗ, у будь-якому разі ---
function buildBakeryReports() {
  var rows = bakeryTodayRows_();
  buildBakeryOrdersSheet_(rows);
  buildBakerySummarySheet_(rows);
  PropertiesService.getScriptProperties()
    .setProperty('bakery_report_sig', bakerySignature_(rows));
}

// ТТ напрямку з Довідника - лише ті, у кого сьогодні робочий день
function bakeryStoresToday_() {
  return loadStores_().filter(function (s) {
    return s.directions.indexOf('bakery') >= 0 && dayAllowed_('bakery', s);
  });
}

// Категорії у потрібному порядку: Випічка, Кулінарія, далі решта
function bakeryCats_(obj) {
  var cats = BAKERY_CAT_ORDER.filter(function (c) { return obj[c] && obj[c].length; });
  Object.keys(obj).forEach(function (c) {
    if (BAKERY_CAT_ORDER.indexOf(c) < 0 && obj[c] && obj[c].length) cats.push(c);
  });
  return cats;
}

function bakeryRowList_(rows, c1, c2) {
  return rows.map(function (r) { return c1 + r + ':' + (c2 || c1) + r; });
}

// ============================================================
// ЛИСТ "Заказы ВК"
// ============================================================
function buildBakeryOrdersSheet_(rows) {
  var today = formatDateDMY_(new Date());

  var byStore = {};
  rows.forEach(function (r) {
    var addr = String(r[2] || '').trim();
    if (!addr) return;
    var cat = String(r[3] || '').trim() || 'Інше';
    byStore[addr] = byStore[addr] || {};
    byStore[addr][cat] = byStore[addr][cat] || [];
    byStore[addr][cat].push({
      name: String(r[5] || '').trim(),
      price: Number(r[6]) || 0,
      qty: Number(r[7]) || 0
    });
  });

  var ordered = {};
  Object.keys(byStore).forEach(function (a) { ordered[addrKey_(a)] = true; });

  var all = bakeryStoresToday_();
  var missing = all.filter(function (s) {
    return !ordered[addrKey_(s.addrBakery)];
  }).map(function (s) { return s.label; });

  var data = [], g = { title: [], sub: [], head: [], store: [], cat: [],
                       row: [], total: [], grand: [], missHead: [], miss: [] };
  function push(v, t) { data.push(v); if (t) g[t].push(data.length); }

  push(['Замовлення випічки та кулінарії - ' + today, '', '', ''], 'title');
  push(['ТТ із замовленнями: ' + Object.keys(byStore).length + ' з ' + all.length +
        '   (оновлено ' + formatTime_(new Date()) + ')', '', '', ''], 'sub');
  push(['', '', '', ''], null);
  push(['№', 'Назва товару', 'Кіл-ть', 'Сума, грн'], 'head');

  var num = 1, grandQty = 0, grandSum = 0;

  Object.keys(byStore).sort(function (a, b) { return a.localeCompare(b, 'uk'); })
    .forEach(function (store) {
      push([store, '', '', ''], 'store');
      var sQty = 0, sSum = 0;

      bakeryCats_(byStore[store]).forEach(function (cat) {
        push([(BAKERY_CAT_ICONS[cat] || (cat + ': ')) + '', '', '', ''], 'cat');
        data[data.length - 1][0] = (BAKERY_CAT_ICONS[cat] ? cat : cat);
        byStore[store][cat].forEach(function (it) {
          var sum = Math.round(it.price * it.qty * 100) / 100;
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
    missing.sort(function (a, b) { return a.localeCompare(b, 'uk'); })
      .forEach(function (s) { push(['   ' + s, '', '', ''], 'miss'); });
  }

  var ss = SpreadsheetApp.openById(dirCfg_('bakery').spreadsheetId);
  var sh = ss.getSheetByName(BAKERY_ORDERS_SHEET) || ss.insertSheet(BAKERY_ORDERS_SHEET);
  sh.clear();
  sh.clearConditionalFormatRules();

  var n = data.length;
  sh.getRange(1, 1, n, 4).setValues(data);

  sh.getRange(1, 1, n, 4).setFontFamily('Arial').setFontSize(10)
    .setVerticalAlignment('middle').setFontColor('#212121').setBackground('#FFFFFF');
  sh.setRowHeights(1, n, 24);

  if (g.title.length) sh.getRangeList(bakeryRowList_(g.title, 'A', 'D'))
    .setBackground('#1565C0').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  if (g.sub.length) sh.getRangeList(bakeryRowList_(g.sub, 'A', 'D'))
    .setBackground('#E3F2FD').setFontColor('#1565C0').setFontSize(11);
  if (g.head.length) sh.getRangeList(bakeryRowList_(g.head, 'A', 'D'))
    .setBackground('#37474F').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center');
  if (g.store.length) sh.getRangeList(bakeryRowList_(g.store, 'A', 'D'))
    .setBackground('#1976D2').setFontColor('#FFFFFF').setFontWeight('bold');
  if (g.cat.length) sh.getRangeList(bakeryRowList_(g.cat, 'A', 'D'))
    .setBackground('#FFF8E1').setFontColor('#E65100').setFontWeight('bold');

  if (g.row.length) {
    var even = g.row.filter(function (_, i) { return i % 2 === 1; });
    if (even.length) sh.getRangeList(bakeryRowList_(even, 'A', 'D')).setBackground('#F8F9FA');
    sh.getRangeList(bakeryRowList_(g.row, 'A', 'A')).setHorizontalAlignment('center');
    sh.getRangeList(bakeryRowList_(g.row, 'C', 'C'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
    sh.getRangeList(bakeryRowList_(g.row, 'D', 'D'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
  if (g.total.length) {
    sh.getRangeList(bakeryRowList_(g.total, 'A', 'D'))
      .setBackground('#E8F5E9').setFontColor('#2E7D32').setFontWeight('bold');
    sh.getRangeList(bakeryRowList_(g.total, 'C', 'C')).setHorizontalAlignment('center');
    sh.getRangeList(bakeryRowList_(g.total, 'D', 'D'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
  if (g.grand.length) {
    sh.getRangeList(bakeryRowList_(g.grand, 'A', 'D'))
      .setBackground('#388E3C').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(11);
    sh.getRangeList(bakeryRowList_(g.grand, 'D', 'D')).setNumberFormat('#,##0.00');
  }
  if (g.missHead.length) sh.getRangeList(bakeryRowList_(g.missHead, 'A', 'D'))
    .setBackground('#FFEBEE').setFontColor('#C62828').setFontWeight('bold');
  if (g.miss.length) sh.getRangeList(bakeryRowList_(g.miss, 'A', 'A')).setFontColor('#C62828');

  sh.setColumnWidth(1, 50);
  sh.setColumnWidth(2, 420);
  sh.setColumnWidth(3, 90);
  sh.setColumnWidth(4, 120);
  sh.setFrozenRows(4);
  SpreadsheetApp.flush();

  console.log('Заказы ВК: рядків ' + n + ', позицій ' + (num - 1) +
              ', ТТ ' + Object.keys(byStore).length + ' з ' + all.length +
              ', без замовлень ' + missing.length);
}

// ============================================================
// ЛИСТ "Сводная ВК"
// ============================================================
function buildBakerySummarySheet_(rows) {
  var today = formatDateDMY_(new Date());

  var sum = {}, grandQty = 0, grandSum = 0;
  rows.forEach(function (r) {
    var cat = String(r[3] || '').trim() || 'Інше';
    var name = String(r[5] || '').trim();
    var qty = Number(r[7]) || 0;
    var price = Number(r[6]) || 0;
    sum[cat] = sum[cat] || {};
    sum[cat][name] = sum[cat][name] || { qty: 0, sum: 0 };
    sum[cat][name].qty += qty;
    sum[cat][name].sum = Math.round((sum[cat][name].sum + price * qty) * 100) / 100;
    grandQty += qty;
    grandSum = Math.round((grandSum + price * qty) * 100) / 100;
  });

  var data = [], g = { title: [], head: [], cat: [], row: [], total: [] };
  function push(v, t) { data.push(v); if (t) g[t].push(data.length); }

  push(['Зведена таблиця - ' + today +
        '   (оновлено ' + formatTime_(new Date()) + ')', '', '', ''], 'title');
  push(['Асортимент', 'Кількість, шт', 'Сума, грн', '% від заг.'], 'head');

  if (!rows.length) {
    push(['Замовлень на сьогодні ще немає', '', '', ''], 'cat');
  } else {
    var catNames = {};
    Object.keys(sum).forEach(function (c) { catNames[c] = Object.keys(sum[c]); });

    bakeryCats_(catNames).forEach(function (cat) {
      var items = sum[cat], cQty = 0, cSum = 0;
      Object.keys(items).forEach(function (nm) {
        cQty += items[nm].qty;
        cSum = Math.round((cSum + items[nm].sum) * 100) / 100;
      });
      push([cat, cQty, cSum,
            grandQty ? (cQty / grandQty * 100).toFixed(1) + '%' : '0%'], 'cat');

      Object.keys(items).sort(function (a, b) { return a.localeCompare(b, 'uk'); })
        .forEach(function (nm) {
          var d = items[nm];
          push([nm, d.qty, d.sum,
                grandQty ? (d.qty / grandQty * 100).toFixed(1) + '%' : '0%'], 'row');
        });
      push(['', '', '', ''], null);
    });
    push(['ЗАГАЛОМ', grandQty, grandSum, '100%'], 'total');
  }

  var ss = SpreadsheetApp.openById(dirCfg_('bakery').spreadsheetId);
  var sh = ss.getSheetByName(BAKERY_SUMMARY_SHEET) || ss.insertSheet(BAKERY_SUMMARY_SHEET);
  sh.clear();
  sh.clearConditionalFormatRules();

  var n = data.length;
  sh.getRange(1, 1, n, 4).setValues(data);
  sh.getRange(1, 1, n, 4).setFontFamily('Arial').setFontSize(10)
    .setVerticalAlignment('middle').setFontColor('#212121').setBackground('#FFFFFF');
  sh.setRowHeights(1, n, 24);

  // формати задаємо явно, щоб % з колонки D не перетікав у C
  sh.getRange(1, 1, n, 1).setNumberFormat('@');
  sh.getRange(1, 2, n, 1).setNumberFormat('0.###');
  sh.getRange(1, 3, n, 1).setNumberFormat('#,##0.00');
  sh.getRange(1, 4, n, 1).setNumberFormat('@');

  if (g.title.length) sh.getRangeList(bakeryRowList_(g.title, 'A', 'D'))
    .setBackground('#1565C0').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  if (g.head.length) sh.getRangeList(bakeryRowList_(g.head, 'A', 'D'))
    .setBackground('#37474F').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center');
  if (g.cat.length) sh.getRangeList(bakeryRowList_(g.cat, 'A', 'D'))
    .setBackground('#FFF8E1').setFontColor('#E65100').setFontWeight('bold');
  if (g.total.length) sh.getRangeList(bakeryRowList_(g.total, 'A', 'D'))
    .setBackground('#388E3C').setFontColor('#FFFFFF').setFontWeight('bold');

  sh.setColumnWidth(1, 420);
  sh.setColumnWidth(2, 120);
  sh.setColumnWidth(3, 120);
  sh.setColumnWidth(4, 100);
  sh.setFrozenRows(2);
  SpreadsheetApp.flush();

  console.log('Сводная ВК: позицій ' + Math.max(n - 2, 0) +
              ', разом ' + grandQty + ' шт / ' + grandSum + ' грн');
}

// ============================================================
// ПРИБИРАННЯ СМІТТЯ В СИРОМУ ЛИСТІ
// Рядки старого формату: без дати в колонці A, адреса в першій
// колонці, чотири значення замість восьми. Звіт їх і так відкидає.
// ============================================================
function cleanBakeryRawJunk() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) { console.log('Лист порожній'); return; }

  var last = sh.getLastRow();
  var vals = sh.getRange(2, 1, last - 1, 8).getValues();
  var bad = [];
  vals.forEach(function (r, i) {
    var hasDate = (r[0] instanceof Date) || !!parseDMY_(String(r[0]));
    if (!hasDate && r.join('').trim()) bad.push(i + 2);
  });

  if (!bad.length) { console.log('Смітникових рядків немає'); return; }
  console.log('Видаляю рядків: ' + bad.length);
  bad.forEach(function (r) { console.log('   ' + r + ': ' + vals[r - 2].join(' | ')); });

  for (var i = bad.length - 1; i >= 0; i--) sh.deleteRow(bad[i]);
  SpreadsheetApp.flush();
  console.log('Готово. У роботі лишилось рядків: ' + (sh.getLastRow() - 1));
}

// --- Діагностика: що саме бачить звіт ---
function whyNoBakeryReport() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  console.log('Таблиця: ' + cfg.spreadsheetId);
  console.log('Сирий лист "' + rawSheetName_(cfg) + '": ' +
              (sh ? (sh.getLastRow() - 1) + ' рядків' : 'НЕ ЗНАЙДЕНО'));

  var rows = bakeryTodayRows_();
  console.log('Робочих рядків за сьогодні: ' + rows.length);
  var addr = {};
  rows.forEach(function (r) { addr[String(r[2] || '').trim()] = true; });
  Object.keys(addr).sort().forEach(function (a) { console.log('   ' + a); });

  var all = bakeryStoresToday_();
  console.log('ТТ напрямку з робочим днем: ' + all.length);
  console.log('Асортимент доступний: ' + loadProducts_('bakery').length + ' позицій');
  console.log('Підпис стану: ' + bakerySignature_(rows));
  console.log('Записаний підпис: ' +
    PropertiesService.getScriptProperties().getProperty('bakery_report_sig'));
}
'@

Write-Text $reportPs $report
Say 'app/BakeryReport.gs - записано' 'Green'

# ============================================================
# 2. ПАТЧ app/Actions.gs
# ============================================================
$a = Read-Text $actionsPs
$changed = 0

# 2.1 карта файлів у шапці
$mapOld = '//   Archive.gs      - архівування сирих листів'
if ($a.Contains($mapOld) -and -not $a.Contains('BakeryReport.gs')) {
  $a = $a.Replace($mapOld, $mapOld + "`n//   BakeryReport.gs - звіти випічки: Заказы ВК, Сводная ВК")
  $changed++
}

# 2.2 список власних тригерів у d06
$mineOld = "  var mine = { d01_archive: 1, d02_cleanupProps: 1, e03_nbhzExport: 1,`r`n               e04_refreshExport: 1 };"
$mineOldLf = $mineOld.Replace("`r`n", "`n")
$mineNew = "  var mine = { d01_archive: 1, d02_cleanupProps: 1, e03_nbhzExport: 1,`n               e04_refreshExport: 1, refreshBakeryReports: 1 };"
if ($a.Contains($mineOld))        { $a = $a.Replace($mineOld, $mineNew); $changed++ }
elseif ($a.Contains($mineOldLf))  { $a = $a.Replace($mineOldLf, $mineNew); $changed++ }
elseif (-not $a.Contains('refreshBakeryReports: 1')) {
  Say 'УВАГА: не вдалось знайти список mine у d06_installTriggers - додайте refreshBakeryReports: 1 руками' 'Yellow'
}

# 2.3 сам тригер кожні 5 хвилин
$trigAnchor = "  console.log('Розклад поставлено:');"
if (-not $a.Contains("newTrigger('refreshBakeryReports')")) {
  $trigNew = "  // звіти випічки перезбираються самі, як тільки в сирому листі щось змінилось`n" +
             "  ScriptApp.newTrigger('refreshBakeryReports').timeBased().everyMinutes(5).create();`n`n" +
             $trigAnchor
  if ($a.Contains($trigAnchor)) { $a = $a.Replace($trigAnchor, $trigNew); $changed++ }
  else { Say 'УВАГА: не знайдено якір у d06_installTriggers - додайте тригер руками' 'Yellow' }
}

# 2.4 розділ запуску руками
if (-not $a.Contains('function g01_bakeryReport')) {
  $a = $a.TrimEnd() + @'


// ============ 7. ЗВІТИ ВИПІЧКИ ============

/** Зібрати "Заказы ВК" і "Сводная ВК" ПРЯМО ЗАРАЗ, у будь-якому разі.
 *  Саме це замінює запуск generateFormattedOrdersReport() у старому проєкті. */
function g01_bakeryReport() {
  buildBakeryReports();
}

/** Перезібрати, лише якщо в сирому листі щось змінилось.
 *  Стоїть на тригері кожні 5 хвилин - руками не потрібне. */
function g02_refreshBakeryReport() {
  refreshBakeryReports();
}

/** Чому звіт порожній: що бачить у сирому листі, скільки ТТ і позицій. */
function g03_whyNoBakeryReport() {
  whyNoBakeryReport();
}

/** Прибрати зі сирого листа рядки старого формату (без дати). Разово. */
function g04_cleanBakeryRaw() {
  cleanBakeryRawJunk();
}
'@ + "`n"
  $changed++
}

Write-Text $actionsPs $a
Say "app/Actions.gs - правок застосовано: $changed" 'Green'

# ============================================================
# 3. APP_VERSION - щоб телефони перезавантажились
# ============================================================
$c = Read-Text $configPs
$m = [regex]::Match($c, "const APP_VERSION = '([^']+)';")
if ($m.Success) {
  $today = Get-Date -Format 'yyyy-MM-dd'
  $old = $m.Groups[1].Value
  if ($old -like "$today-*") {
    $nm = [regex]::Match($old, '-(\d+)$')
    $nextNum = if ($nm.Success) { [int]$nm.Groups[1].Value + 1 } else { 2 }
    $new = "$today-$nextNum"
  } else { $new = "$today-1" }
  $c = $c.Replace("const APP_VERSION = '$old';", "const APP_VERSION = '$new';")
  Write-Text $configPs $c
  Say "APP_VERSION: $old -> $new" 'Green'
} else {
  Say 'УВАГА: APP_VERSION не знайдено в Config.gs' 'Yellow'
}

# ============================================================
# 4. CLASP PUSH
# ============================================================
if (-not $NoClasp) {
  Push-Location $appDir
  try {
    $clasp = Get-Command clasp -ErrorAction SilentlyContinue
    if (-not $clasp) {
      Say 'clasp не знайдено. Встановити: npm i -g @google/clasp, далі clasp login' 'Yellow'
    } else {
      Say 'clasp push...' 'Cyan'
      & clasp push -f
      if ($LASTEXITCODE -ne 0) { throw "clasp push завершився з кодом $LASTEXITCODE" }
      Say 'Залито в Apps Script' 'Green'

      if ($DeploymentId) {
        Say "clasp deploy -i $DeploymentId ..." 'Cyan'
        & clasp deploy -i $DeploymentId -d "bakery reports in-app $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
        if ($LASTEXITCODE -ne 0) { Say 'Перерозгортання не вдалось - зробіть через редактор' 'Yellow' }
        else { Say 'Розгортання оновлено, адреса /exec не змінилась' 'Green' }
      }
    }
  } finally { Pop-Location }
}

# ============================================================
# 5. GIT
# ============================================================
Push-Location $RepoRoot
try {
  & git add app/BakeryReport.gs app/Actions.gs app/Config.gs | Out-Null
  $staged = & git diff --cached --name-only
  if (-not $staged) {
    Say 'Змін для коміту немає - усе вже було пропатчено' 'Yellow'
  } else {
    $msg = @'
Звіти випічки переїхали в застосунок

"Заказы ВК" і "Сводная ВК" збирав окремий старий проєкт (legacy/bakery)
своїм тригером autoMaintenance. Тригер не відпрацював - повар бачив
учорашні цифри, хоча сьогоднішні замовлення в сирому листі лежали.
Плюс защіпка старого проєкту порівнювала getLastRow(), а після
архівування лист схлопнувся з ~20 000 рядків до 595, і порівняння
стало безглуздим.

Тепер обидва листи збирає новий застосунок: BakeryReport.gs,
тригер refreshBakeryReports кожні 5 хвилин, порівнюється вміст
за сьогодні, а не кількість рядків. Список ТТ - з Довідника.
Старий проєкт можна вимикати.
'@
    & git commit -m $msg | Out-Null
    Say 'Коміт створено' 'Green'
    if (-not $NoPush) {
      $br = (& git rev-parse --abbrev-ref HEAD).Trim()
      Say "git push origin $br ..." 'Cyan'
      & git push origin $br
      if ($LASTEXITCODE -ne 0) { Say 'push не вдався - перевірте доступ до origin' 'Yellow' }
      else { Say 'Запушено' 'Green' }
    }
  }
} finally { Pop-Location }

Say ''
Say '=== ЛИШИЛОСЬ ЗРОБИТИ РУКАМИ (3 кроки) ===' 'Cyan'
Say '1. Редактор нового проєкту -> g01_bakeryReport  (листи наповняться одразу)'
Say '2. Там само -> d06_installTriggers  (поставить тригер на 5 хвилин)'
Say '3. СТАРИЙ проєкт випечки -> Тригери -> видалити autoMaintenance,'
Say '   інакше два проєкти перезаписуватимуть ті самі два листи.'
