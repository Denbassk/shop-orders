#Requires -Version 5.1
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

$appDir = Join-Path $RepoRoot 'app'
$ordersPs = Join-Path $appDir 'Orders.gs'
$reportPs = Join-Path $appDir 'BakeryReport.gs'
$actionsPs = Join-Path $appDir 'Actions.gs'
$configPs = Join-Path $appDir 'Config.gs'
foreach ($f in @($ordersPs, $reportPs, $actionsPs, $configPs)) {
  if (-not (Test-Path $f)) { throw "Не знайдено $f" }
}
$fails = 0

# ============================================================
# 1. Orders.gs - головне виправлення
# ============================================================
$o = Read-Gs $ordersPs

$oldFn = LF @'
function apiAppend_(spreadsheetId, sheetName, rows) {
  Sheets.Spreadsheets.Values.append(
    { values: rows },
    spreadsheetId,
    "'" + sheetName + "'!A1",
    { valueInputOption: 'USER_ENTERED', insertDataOption: 'OVERWRITE' }
  );
}
'@

$newFn = LF @'
// ВАЖЛИВО. 14.09.2026 через OVERWRITE було ЗАТЕРТО замовлення
// Ньютона, 111 - у ті самі рядки записалось замовлення Богдана
// Хмельницького, 8, яке прийшло на годину пізніше.
//
// Чому: append шукає "таблицю" від якоря. Якщо в листі є РОЗРИВ
// (порожній рядок або рядки старого формату), таблицею вважається
// лише те, що ДО розриву, а все нижче для append - "порожнє місце",
// куди можна писати. Приклад: шапка, розрив - таблиця це один рядок,
// і кожне замовлення пише в рядок 2, поверх попереднього.
//
// insertDataOption:
//   OVERWRITE   - затирає вміст. Ніколи. Більше не використовуємо.
//   INSERT_ROWS - вставляє НОВІ рядки. Затерти чуже не може за
//                 визначенням. Формат успадковує від рядка вище,
//                 тому в даних листа не повинно бути чорної шапки -
//                 за це відповідає repairBakeryRawSheet().
//
// Плюс якір: не A1, а ОСТАННІЙ заповнений рядок. Тоді розриви вище
// не збивають визначення таблиці. getLastRow коштує ~50 мс і не
// ламає атомарність: межу таблиці Google перераховує у себе, тому
// навіть якщо якір трохи застарів через одночасну відправку,
// рядки все одно стануть у кінець.
function apiAppend_(spreadsheetId, sheetName, rows) {
  var anchor = 1;
  try {
    var sh = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
    if (sh) anchor = Math.max(sh.getLastRow(), 1);
  } catch (e) {}

  Sheets.Spreadsheets.Values.append(
    { values: rows },
    spreadsheetId,
    "'" + sheetName + "'!A" + anchor,
    { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' }
  );
}
'@

if ($o.Contains($oldFn)) { $o = $o.Replace($oldFn, $newFn); Say 'apiAppend_: OVERWRITE -> INSERT_ROWS + якір' 'Green' }
elseif ($o.Contains("insertDataOption: 'INSERT_ROWS'")) { Say 'apiAppend_: вже виправлено' 'DarkGray' }
else { Say 'apiAppend_: НЕ ЗНАЙДЕНО - правити руками!' 'Red'; $fails++ }

$oldCmt = LF @'
//   INSERT_ROWS - вставляє НОВІ рядки, і вони успадковують формат рядка
//                 вище. Перший запис успадковував чорну шапку, далі всі
//                 наступні - від нього. Звідси були чорні рядки.
//   OVERWRITE   - пише у вже наявні порожні рядки під таблицею, з їхнім
//                 звичайним форматом. Під сирим листом нічого немає,
//                 тож затирати нема чого.
'@
$newCmt = LF @'
//   Деталі щодо insertDataOption - у коментарі до apiAppend_ нижче.
'@
if ($o.Contains($oldCmt)) { $o = $o.Replace($oldCmt, $newCmt); Say 'старий коментар: прибрано' 'Green' }

Write-Gs $ordersPs $o

# ============================================================
# 2. BakeryReport.gs - ремонт сирого листа
# ============================================================
$r = Read-Gs $reportPs
if ($r.Contains('function repairBakeryRawSheet')) {
  Say 'repairBakeryRawSheet: вже є' 'DarkGray'
} else {
  $r = $r.TrimEnd() + "`n" + (LF @'


// ============================================================
// РЕМОНТ СИРОГО ЛИСТА
//
// Прибирає все, через що append писав не в кінець листа:
//   - рядки СТАРОГО формату (адреса в колонці A, без дати)
//   - порожні рядки всередині даних (саме вони і є "розрив")
// І вирівнює формати, щоб нові рядки успадковували нормальний
// вигляд, а не чорну шапку.
//
// Запускати один раз після переходу на INSERT_ROWS.
// ============================================================
function repairBakeryRawSheet() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh) { console.log('Лист "' + rawSheetName_(cfg) + '" не знайдено'); return; }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) { console.log('Лист зайнятий - спробуйте за хвилину'); return; }
  try {
    var last = sh.getLastRow();
    if (last < 2) { console.log('Даних немає'); return; }

    var vals = sh.getRange(2, 1, last - 1, 8).getValues();
    var bad = [], junk = 0, empty = 0, good = 0;
    vals.forEach(function (row, i) {
      var blank = row.join('').trim() === '';
      var dated = (row[0] instanceof Date) || !!parseDMY_(String(row[0]));
      if (blank) { empty++; bad.push(i + 2); return; }
      if (!dated) { junk++; bad.push(i + 2); return; }
      good++;
    });

    console.log('Рядків усього ' + (last - 1) + ': робочих ' + good +
                ', старого формату ' + junk + ', порожніх ' + empty);

    if (bad.length) {
      var ranges = [], start = bad[0], prev = bad[0];
      for (var j = 1; j < bad.length; j++) {
        if (bad[j] === prev + 1) { prev = bad[j]; continue; }
        ranges.push([start, prev]); start = bad[j]; prev = bad[j];
      }
      ranges.push([start, prev]);
      ranges.reverse();
      ranges.forEach(function (x) { sh.deleteRows(x[0], x[1] - x[0] + 1); });
      SpreadsheetApp.flush();
      console.log('Видалено рядків: ' + bad.length + ', відрізків: ' + ranges.length);
    } else {
      console.log('Видаляти нічого - лист уже чистий');
    }

    var n = Math.max(sh.getLastRow() - 1, 1);
    sh.getRange(2, 1, n, 8).setBackground(null).setFontColor('#000000')
      .setFontWeight('normal').setFontSize(10).setFontFamily('Arial');
    sh.getRange(2, 1, n, 1).setNumberFormat('dd.MM.yyyy');
    sh.getRange(2, 2, n, 1).setNumberFormat('HH:mm:ss');
    sh.getRange(2, 5, n, 1).setNumberFormat('@');
    sh.getRange(2, 7, n, 1).setNumberFormat('0.00');
    sh.getRange(2, 8, n, 1).setNumberFormat('0.###');
    SpreadsheetApp.flush();

    console.log('Формати вирівняно. Робочих рядків лишилось: ' + (sh.getLastRow() - 1));
    console.log('Тепер append дописує строго в кінець листа.');
  } finally { try { lock.releaseLock(); } catch (e) {} }
}
'@)
  Say 'repairBakeryRawSheet: додано' 'Green'
}
Write-Gs $reportPs $r

# ============================================================
# 3. Actions.gs
# ============================================================
$a = Read-Gs $actionsPs
if ($a.Contains('function g07_repairBakeryRaw')) {
  Say 'Actions.gs: g07 вже є' 'DarkGray'
} else {
  $a = $a.TrimEnd() + "`n" + (LF @'


/** РЕМОНТ сирого листа: прибрати рядки старого формату і порожні
 *  розриви, вирівняти формати. Запустити ОДИН раз після переходу
 *  apiAppend_ на INSERT_ROWS. */
function g07_repairBakeryRaw() {
  repairBakeryRawSheet();
}
'@)
  Say 'Actions.gs: g07 додано' 'Green'
}
Write-Gs $actionsPs $a

# ============================================================
# 4. APP_VERSION
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
if ($fails) { Say "УВАГА: не застосовано блоків: $fails" 'Red' }

# ============================================================
# 5. CLASP
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
# 6. GIT
# ============================================================
Push-Location $RepoRoot
try {
  & git add app/Orders.gs app/BakeryReport.gs app/Actions.gs app/Config.gs | Out-Null
  if (-not (& git diff --cached --name-only)) {
    Say 'Нічого комітити' 'Yellow'
  } else {
    $msg = @'
Виправлено затирання замовлень при записі

14.09 замовлення Ньютона, 111 було ЗАТЕРТО замовленням Богдана
Хмельницького, 8, яке прийшло на годину пізніше: три рядки в три
рядки, на тих самих місцях.

Причина - insertDataOption OVERWRITE в apiAppend_. Append шукає
таблицю від якоря A1; у листі був розрив із рядків старого формату,
через це таблицею вважалась лише шапка, а все нижче для append
було "порожнім місцем", куди можна писати. Кожне замовлення
намагалось лягти на початок листа, поверх чужого.

Тепер INSERT_ROWS - вставляє нові рядки і затерти чуже не може за
визначенням. Якір перенесено з A1 на останній заповнений рядок,
щоб розриви вище не збивали визначення таблиці.

repairBakeryRawSheet() прибирає рядки старого формату і порожні
розриви та вирівнює формати, щоб нові рядки не успадковували
чорну шапку.
'@
    $tmp = Join-Path $env:TEMP 'cm3.txt'
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
Say 'У редакторі, по порядку:' 'Cyan'
Say '   g07_repairBakeryRaw     - почистити лист (один раз)'
Say '   g06_showBakeryRawTail   - перевірити, що лишилось'
Say '   g01_bakeryReport        - перезібрати звіти'
Say ''
Say 'ОКРЕМО: замовлення Ньютона, 111 за 14.09 втрачено - переспитати телефоном' 'Yellow'
