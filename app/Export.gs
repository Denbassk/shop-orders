
// ============================================================
// ВИВАНТАЖЕННЯ В EXCEL
//
// 1. Хліб Рома: лист "Завантаження" у таблиці хліба з посиланням,
//    яке качає ТІЛЬКИ лист "Заказы" (а не всю книгу, як Файл -> Завантажити).
//    Лист "Заказы" перезбирається на тому ж місці (clear, а не видалення),
//    тож його gid не міняється і посилання постійне.
//    Оновлюється з buildBreadReports (тригер refreshBreadReports).
//
// 2. НБХЗ: старі листи "Вивантаження дд.мм.рррр" самі переїжджають
//    в окрему таблицю "АРХІВ Вивантаження НБХЗ". У робочій лишаються
//    останні NBHZ_EXPORT_KEEP_DAYS днів. Лист спершу копіюється,
//    звіряється кількість рядків, і лише тоді видаляється.
//    Запускається з refreshNbhzExport раз на день.
// ============================================================

var BREAD_DOWNLOAD_SHEET = 'Завантаження';
var BREAD_LINK_DATE_KEY  = 'bread_link_date';

var NBHZ_EXPORT_KEEP_DAYS    = 3;            // сьогодні + 2 попередні дні
var NBHZ_EXPORT_ARCHIVE_KEY  = 'nbhz_export_archive_ss';
var NBHZ_EXPORT_ARCHIVED_KEY = 'nbhz_export_archived';

function xlsxUrl_(ssId, sheet) {
  return 'https://docs.google.com/spreadsheets/d/' + ssId +
         '/export?format=xlsx&gid=' + sheet.getSheetId();
}

// Посилання через RichText - не залежить від локалі таблиці (; чи ,)
function setLinkCell_(range, text, url, size) {
  var style = SpreadsheetApp.newTextStyle()
    .setFontSize(size || 14).setBold(true)
    .setForegroundColor('#1a73e8').setUnderline(true).build();
  range.setRichTextValue(SpreadsheetApp.newRichTextValue()
    .setText(text).setLinkUrl(url).setTextStyle(style).build());
}

// ============================================================
// ХЛІБ РОМА - лист "Завантаження"
// force=false: повністю переписує лист лише раз на день (або якщо його
// немає), решту разів тільки ставить час останньої збірки звіту.
// ============================================================
function writeBreadDownloadSheet_(force) {
  var ssId = dirCfg_('bread').spreadsheetId;
  var ss = SpreadsheetApp.openById(ssId);
  var props = PropertiesService.getScriptProperties();
  var today = formatDateDMY_(new Date());
  var stamp = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'HH:mm');

  var sh = ss.getSheetByName(BREAD_DOWNLOAD_SHEET);
  if (!force && sh && props.getProperty(BREAD_LINK_DATE_KEY) === today) {
    sh.getRange(9, 1).setValue('Звіт перезібрано о ' + stamp);
    return;
  }

  var orders = ss.getSheetByName(BREAD_ORDERS_SHEET);
  if (!orders) throw new Error('Немає листа "' + BREAD_ORDERS_SHEET + '" - спершу h01_breadReport()');
  var summary = ss.getSheetByName(BREAD_SUMMARY_SHEET);

  if (!sh) sh = ss.insertSheet(BREAD_DOWNLOAD_SHEET, 0);
  sh.clear();

  sh.getRange(1, 1).setValue('ЗАМОВЛЕННЯ ХЛІБ РОМА')
    .setFontSize(16).setFontWeight('bold');
  sh.getRange(2, 1).setValue('за ' + today).setFontColor('#6b7280');

  setLinkCell_(sh.getRange(4, 1),
    '⬇  ЗАВАНТАЖИТИ EXCEL «' + BREAD_ORDERS_SHEET + '» за ' + today,
    xlsxUrl_(ssId, orders), 14);
  if (summary) setLinkCell_(sh.getRange(5, 1),
    '⬇  «' + BREAD_SUMMARY_SHEET + '» (зведення по позиціях)',
    xlsxUrl_(ssId, summary), 11);

  sh.getRange(7, 1).setValue(
    'Файл міститиме ТІЛЬКИ вибраний лист - решта листів у нього не потрапляє.');
  sh.getRange(8, 1).setValue(
    'Звіт оновлюється кожні 5 хвилин, посилання постійне - можна покласти в закладки.');
  sh.getRange(9, 1).setValue('Звіт перезібрано о ' + stamp);
  sh.getRange(7, 1, 3, 1).setFontColor('#6b7280').setFontSize(10);

  sh.setColumnWidth(1, 620);
  sh.setHiddenGridlines(true);
  props.setProperty(BREAD_LINK_DATE_KEY, today);
}

// ============================================================
// НБХЗ - архів старих листів вивантаження
// ============================================================

// Таблиця-архів. Створюється лише один раз; якщо id є, а таблиця
// тимчасово не відкривається - помилка, нову НЕ створюємо.
function nbhzExportArchiveSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(NBHZ_EXPORT_ARCHIVE_KEY);
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.create('АРХІВ Вивантаження НБХЗ');
  props.setProperty(NBHZ_EXPORT_ARCHIVE_KEY, ss.getId());
  console.log('Створено архів вивантажень НБХЗ: ' + ss.getUrl());
  return ss;
}

// Дата з назви "Вивантаження дд.мм.рррр", інакше null
function nbhzExportDate_(name) {
  var m = String(name).match(/^Вивантаження (\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

// Повертає кількість перенесених листів.
// keepDays - скільки днів лишити (1 = тільки сьогодні); без аргументу NBHZ_EXPORT_KEEP_DAYS
function archiveOldNbhzExports(keepDays) {
  var keep = (typeof keepDays === 'number' && keepDays >= 1) ? keepDays : NBHZ_EXPORT_KEEP_DAYS;
  var ss = nbhzSS_();
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  var old = [];
  ss.getSheets().forEach(function (sh) {
    var d = nbhzExportDate_(sh.getName());
    if (!d) return;
    var age = Math.round((today - d) / 86400000);
    if (age >= keep) old.push({ sh: sh, d: d });
  });
  if (!old.length) { console.log('Старих вивантажень НБХЗ немає'); return 0; }

  old.sort(function (a, b) { return a.d - b.d; });
  var arc = nbhzExportArchiveSS_();
  var moved = 0;

  old.forEach(function (o) {
    var name = o.sh.getName();
    try {
      var copy = o.sh.copyTo(arc);
      // ім'я вже зайняте в архіві - не видаляємо старе, додаємо (2), (3)...
      var target = name, k = 2;
      while (arc.getSheetByName(target)) target = name + ' (' + (k++) + ')';
      copy.setName(target);
      SpreadsheetApp.flush();

      if (copy.getLastRow() !== o.sh.getLastRow() ||
          copy.getLastColumn() !== o.sh.getLastColumn())
        throw new Error('копія не збіглася з оригіналом - лист лишено на місці');

      ss.deleteSheet(o.sh);
      moved++;
    } catch (e) {
      console.error('Архів НБХЗ, "' + name + '": ' + e.message);
    }
  });

  // прибрати порожній стартовий лист нової таблиці
  arc.getSheets().forEach(function (sh) {
    if (arc.getSheets().length > 1 &&
        sh.getLastRow() === 0 && sh.getLastColumn() === 0) arc.deleteSheet(sh);
  });

  console.log('Перенесено в архів: ' + moved + ' з ' + old.length +
              '. Архів: ' + arc.getUrl());
  return moved;
}

// Раз на день, з тригера refreshNbhzExport. Помилка не ламає вивантаження.
function archiveNbhzExportsDaily_() {
  var props = PropertiesService.getScriptProperties();
  var today = formatDateDMY_(new Date());
  if (props.getProperty(NBHZ_EXPORT_ARCHIVED_KEY) === today) return;
  try {
    archiveOldNbhzExports();
    props.setProperty(NBHZ_EXPORT_ARCHIVED_KEY, today);
  } catch (e) {
    console.error('Архів вивантажень НБХЗ: ' + e.message);
  }
}

function showNbhzExportArchive_() {
  var id = PropertiesService.getScriptProperties().getProperty(NBHZ_EXPORT_ARCHIVE_KEY);
  if (!id) { console.log('Архіву ще немає - створиться при першому перенесенні'); return; }
  var arc = SpreadsheetApp.openById(id);
  console.log('Архів: ' + arc.getUrl());
  arc.getSheets().forEach(function (sh) { console.log('   ' + sh.getName()); });
}
