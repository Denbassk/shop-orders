#Requires -Version 5.1
<#
  Друга порція правок:
    - шапка і вид сирого листа _Сырые_Заказы_ВК
    - формати чисел у підсумкових рядках "Заказы ВК"
    - прибрано кострубату збірку рядка категорії
    - діагностика: показати хвіст сирого листа в лог
  Запуск:  powershell -ExecutionPolicy Bypass -File D:\shop-orders\patch2.ps1
#>
param(
  [string]$RepoRoot = 'D:\shop-orders',
  [switch]$NoPush,
  [switch]$NoClasp
)

$ErrorActionPreference = 'Stop'
$U8 = New-Object System.Text.UTF8Encoding($false)
function Read-Gs($p) { [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8).Replace("`r`n", "`n") }
function Write-Gs($p, $t) { [System.IO.File]::WriteAllText($p, $t.Replace("`r`n", "`n"), $U8) }
function LF($s) { $s.Replace("`r`n", "`n") }
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }

$appDir    = Join-Path $RepoRoot 'app'
$reportPs  = Join-Path $appDir 'BakeryReport.gs'
$actionsPs = Join-Path $appDir 'Actions.gs'
$configPs  = Join-Path $appDir 'Config.gs'

foreach ($f in @($reportPs, $actionsPs, $configPs)) {
  if (-not (Test-Path $f)) { throw "Не знайдено $f" }
}
$fails = 0

# ============================================================
# 1. BakeryReport.gs
# ============================================================
$r = Read-Gs $reportPs

# --- 1.1 рядок категорії: було в два приймання, стало в одне ---
$catOld = LF @'
        push([(BAKERY_CAT_ICONS[cat] || (cat + ': ')) + '', '', '', ''], 'cat');
        data[data.length - 1][0] = (BAKERY_CAT_ICONS[cat] ? cat : cat);
'@
$catNew = LF @'
        push([cat, '', '', ''], 'cat');
'@
if ($r.Contains($catOld)) { $r = $r.Replace($catOld, $catNew); Say 'категорія: спрощено' 'Green' }
elseif ($r.Contains("push([cat, '', '', ''], 'cat');")) { Say 'категорія: вже виправлено' 'DarkGray' }
else { Say 'категорія: блок не знайдено - пропускаю' 'Yellow'; $fails++ }

# --- 1.2 формати підсумкових рядків ---
$fmtOld = LF @'
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
'@
$fmtNew = LF @'
  if (g.total.length) {
    sh.getRangeList(bakeryRowList_(g.total, 'A', 'D'))
      .setBackground('#E8F5E9').setFontColor('#2E7D32').setFontWeight('bold');
    // 0.### - щоб кількість була "11", а не "11,00": формат
    // підтягувався від попереднього вмісту листа
    sh.getRangeList(bakeryRowList_(g.total, 'C', 'C'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
    sh.getRangeList(bakeryRowList_(g.total, 'D', 'D'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
  if (g.grand.length) {
    sh.getRangeList(bakeryRowList_(g.grand, 'A', 'D'))
      .setBackground('#388E3C').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(11);
    sh.getRangeList(bakeryRowList_(g.grand, 'C', 'C'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
    sh.getRangeList(bakeryRowList_(g.grand, 'D', 'D'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
'@
if ($r.Contains($fmtOld)) { $r = $r.Replace($fmtOld, $fmtNew); Say 'формати підсумків: виправлено' 'Green' }
elseif ($r.Contains("bakeryRowList_(g.grand, 'C', 'C')")) { Say 'формати підсумків: вже виправлено' 'DarkGray' }
else { Say 'формати підсумків: блок не знайдено - пропускаю' 'Yellow'; $fails++ }

# --- 1.3 нові функції ---
if ($r.Contains('function fixBakeryRawSheet')) {
  Say 'fixBakeryRawSheet: вже є' 'DarkGray'
} else {
  $r = $r.TrimEnd() + "`n" + (LF @'


// ============================================================
// СИРИЙ ЛИСТ: ПРИВЕСТИ ДО ЛАДУ
//
// У листі лишилась шапка СТАРОГО формату на 4 колонки
// ("Адрес ТТ | | Назва | Кількість"), хоча застосунок пише 8 -
// див. rawRow для bakery у Config.gs:
//   A дата | B час | C адреса | D категорія
//   E штрихкод | F назва | G ціна | H кіл-ть
// Дані від цього не страдають (звіт читає за позицією колонки),
// але дивитись на лист неможливо: підписи не від тих колонок.
//
// Заодно знімаємо фільтр і розкриваємо все приховане. Фільтр на
// сирому листі тільки шкодить: append дописує рядки НИЖЧЕ його
// діапазону, і свіжі замовлення просто не показуються.
// ============================================================
function fixBakeryRawSheet() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh) { console.log('Лист "' + rawSheetName_(cfg) + '" не знайдено'); return; }

  console.log('Було в шапці: ' + sh.getRange(1, 1, 1, 8).getValues()[0].join(' | '));

  try {
    var f = sh.getFilter();
    if (f) { f.remove(); console.log('Фільтр знято'); }
  } catch (e) { console.log('Фільтр: ' + e.message); }

  var maxR = sh.getMaxRows(), maxC = Math.max(sh.getMaxColumns(), 8);
  sh.showRows(1, maxR);
  sh.showColumns(1, maxC);
  console.log('Розкрито рядки 1-' + maxR + ' і колонки 1-' + maxC);

  var head = ['Дата', 'Час', 'Адреса ТТ', 'Категорія',
              'Штрих-код', 'Номенклатура', 'Ціна', 'Кількість'];
  sh.getRange(1, 1, 1, 8).setValues([head])
    .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(0);

  sh.setColumnWidth(1, 95);  sh.setColumnWidth(2, 75);
  sh.setColumnWidth(3, 280); sh.setColumnWidth(4, 110);
  sh.setColumnWidth(5, 140); sh.setColumnWidth(6, 330);
  sh.setColumnWidth(7, 80);  sh.setColumnWidth(8, 90);
  SpreadsheetApp.flush();

  console.log('Стало: ' + head.join(' | '));
  console.log('Останній рядок з даними: ' + sh.getLastRow() +
              ' (рядків з замовленнями ' + (sh.getLastRow() - 1) + ')');
  console.log('Усе, що нижче - порожній хвіст листа. Ctrl+Home - на початок.');
}

// --- Показати хвіст сирого листа прямо в лог ---
// Найнадійніший спосіб переконатись, що замовлення на місці:
// не залежить ні від прокрутки, ні від фільтрів, ні від шапки.
function showBakeryRawTail(n) {
  n = n || 25;
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) { console.log('Лист порожній'); return; }

  var last = sh.getLastRow();
  var take = Math.min(last - 1, n);
  var from = last - take + 1;
  var rows = sh.getRange(from, 1, take, 8).getValues();
  var today = formatDateDMY_(new Date());

  console.log('Лист "' + rawSheetName_(cfg) + '": рядків з даними ' + (last - 1) +
              ', показую останні ' + take + ' (рядки ' + from + '-' + last + ')');
  console.log('рядок | дата | час | адреса | категорія | назва | ціна | кіл-ть');
  rows.forEach(function (r, i) {
    var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
    console.log((from + i) + (d === today ? ' * ' : ' | ') +
                [d, r[1], r[2], r[3], r[5], r[6], r[7]].join(' | '));
  });
  console.log('--- рядки з * - сьогоднішні (' + today + ') ---');
  console.log('Архів старших замовлень - на листі "_Архів".');
}
'@)
  Say 'fixBakeryRawSheet + showBakeryRawTail: додано' 'Green'
}
Write-Gs $reportPs $r

# ============================================================
# 2. Actions.gs
# ============================================================
$a = Read-Gs $actionsPs
if ($a.Contains('function g05_fixBakeryRawSheet')) {
  Say 'Actions.gs: обгортки вже є' 'DarkGray'
} else {
  $a = $a.TrimEnd() + "`n" + (LF @'


/** Поправити сирий лист: шапка на 8 колонок, зняти фільтр,
 *  розкрити приховані рядки. Разово. */
function g05_fixBakeryRawSheet() {
  fixBakeryRawSheet();
}

/** Показати останні 25 рядків сирого листа в лог.
 *  Коли здається, що замовлень немає - запускати це. */
function g06_showBakeryRawTail() {
  showBakeryRawTail(25);
}
'@)
  Say 'Actions.gs: g05 + g06 додано' 'Green'
}
Write-Gs $actionsPs $a

# ============================================================
# 3. APP_VERSION
# ============================================================
$c = Read-Gs $configPs
$m = [regex]::Match($c, "const APP_VERSION = '([^']+)';")
if ($m.Success) {
  $old = $m.Groups[1].Value
  $today = Get-Date -Format 'yyyy-MM-dd'
  if ($old -like "$today-*") {
    $nm = [regex]::Match($old, '-(\d+)$')
    $next = if ($nm.Success) { [int]$nm.Groups[1].Value + 1 } else { 2 }
    $new = "$today-$next"
  } else { $new = "$today-1" }
  $c = $c.Replace("const APP_VERSION = '$old';", "const APP_VERSION = '$new';")
  Write-Gs $configPs $c
  Say "APP_VERSION: $old -> $new" 'Green'
}

if ($fails) { Say "УВАГА: не застосовано блоків: $fails - гляньте попередження вище" 'Yellow' }

# ============================================================
# 4. CLASP
# ============================================================
if (-not $NoClasp) {
  Push-Location $appDir
  try {
    if (Get-Command clasp -ErrorAction SilentlyContinue) {
      Say 'clasp push...' 'Cyan'
      & clasp push -f
      if ($LASTEXITCODE -ne 0) { throw "clasp push: код $LASTEXITCODE" }
      Say 'Залито в Apps Script' 'Green'
    } else { Say 'clasp не знайдено' 'Yellow' }
  } finally { Pop-Location }
}

# ============================================================
# 5. GIT  (повідомлення через файл - інакше лапки рвуть аргументи)
# ============================================================
Push-Location $RepoRoot
try {
  & git add app/BakeryReport.gs app/Actions.gs app/Config.gs | Out-Null
  if (-not (& git diff --cached --name-only)) {
    Say 'Нічого комітити' 'Yellow'
  } else {
    $msg = @'
Сирий лист випічки і формати підсумків

Шапка листа _Сырые_Заказы_ВК лишилась від старого формату на
4 колонки, хоча застосунок пише 8. Дані лягали правильно, але
підписи були не від тих колонок - через це здавалось, що
замовлень у листі немає. fixBakeryRawSheet() ставить справжню
шапку, знімає фільтр (append дописує рядки нижче його діапазону,
і свіжі замовлення не показувались) і розкриває приховані рядки.

showBakeryRawTail() виводить хвіст листа в лог - перевірка, що
не залежить від прокрутки і фільтрів.

Кількість у підсумкових рядках "Заказы ВК" тепер 0.### замість
успадкованого #,##0.00: було "11,00" замість "11".
'@
    $tmp = Join-Path $env:TEMP 'cm2.txt'
    [System.IO.File]::WriteAllText($tmp, $msg, $U8)
    & git commit -F $tmp | Out-Null
    Say 'Коміт створено' 'Green'
    if (-not $NoPush) {
      $br = (& git rev-parse --abbrev-ref HEAD).Trim()
      & git push origin $br
      if ($LASTEXITCODE -eq 0) { Say "Запушено в $br" 'Green' } else { Say 'push не вдався' 'Yellow' }
    }
  }
} finally { Pop-Location }

Say ''
Say 'У редакторі запустити по черзі:' 'Cyan'
Say '   g06_showBakeryRawTail   - побачити замовлення в лозі'
Say '   g05_fixBakeryRawSheet   - поправити шапку і вид листа'
Say '   g01_bakeryReport        - перезібрати звіти'
