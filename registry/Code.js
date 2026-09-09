// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================
const REGISTRY_SHEET = 'ТТ';

const TARGETS = {
  bread: {
    title: 'Хліб ЧП Рома',
    id: '1QJca7XlvZbIWfEIyxBxC64dSD6RkrlWoZOSmem2tix4',
    sheet: 'Маршруты и Магазины',
    cols: 3,
    addrCol: 1,          // индекс колонки с адресом в целевом листе (0-based)
    flag: 'bread',
    alias: 'addrBread',
    build: (r, addr) => [r.route, addr, r.code]
  },
  bakery: {
    title: 'Випічка і кулінарія',
    id: '1THdB-b4JkXzAKsaVPw8DLrXATlycpFkTgolTmqCOXWo',
    sheet: 'Адреса ТТ',
    cols: 1,
    addrCol: 0,
    flag: 'bakery',
    alias: 'addrBakery',
    build: (r, addr) => [addr]
  },
  veg: {
    title: 'Овочі і фрукти',
    id: '1HbvDCuMMJe7GI4zQyDxkyqVWahTPtWf5vNuMFLEXIC0',
    sheet: 'Адреса ТТ',
    cols: 1,
    addrCol: 0,
    flag: 'veg',
    alias: 'addrVeg',
    build: (r, addr) => [addr]
  }
};

// ============================================================
// МЕНЮ
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Довідник ТТ')
    .addItem('1. Перевірити довідник', 'validateRegistry')
    .addItem('2. Що буде змінено (без запису)', 'previewSync')
    .addSeparator()
    .addItem('3. Синхронізувати з таблицями', 'syncStoresToLegacy')
    .addSeparator()
    .addItem('Структура робочих таблиць', 'inspectTargets')
    .addToUi();
}

// ============================================================
// ЧТЕНИЕ
// ============================================================
function readRegistry() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTRY_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];

  return sh.getRange(2, 1, sh.getLastRow() - 1, 13).getValues()
    .map((r, i) => ({
      line: i + 2,
      active: r[0] === true,
      label: String(r[1] || '').trim(),
      address: String(r[2] || '').trim(),
      code: String(r[3] || '').trim(),
      route: String(r[4] || '').trim(),
      type: String(r[5] || 'Магазин').trim(),
      bread: r[6] === true,
      bakery: r[7] === true,
      veg: r[8] === true,
      note: String(r[9] || '').trim(),
      addrBread: String(r[10] || '').trim(),
      addrBakery: String(r[11] || '').trim(),
      addrVeg: String(r[12] || '').trim()
    }))
    .filter(r => r.address);
}

/** Адрес для конкретной таблицы: алиас, если задан, иначе основной */
function addrFor_(row, target) {
  return row[target.alias] || row.address;
}

function canonicalKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[\u2019'`]/g, '')
    .replace(/[^a-zа-яіїєґ0-9]+/gi, ' ')
    .replace(/\b(м|вул|пр\s*т|просп|пров|пл|буд|шосе)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================
// ПРОВЕРКА
// ============================================================
function validateRegistry(silent) {
  const rows = readRegistry();
  const problems = [];
  const seen = {};

  if (!rows.length) problems.push('Довідник порожній');

  rows.forEach(r => {
    const key = canonicalKey(r.address);
    if (seen[key]) problems.push('Рядок ' + r.line + ': дубль адреси з рядком ' + seen[key]);
    else seen[key] = r.line;

    if (!r.label) problems.push('Рядок ' + r.line + ': немає назви для продавця');
    if (r.active && !r.bread && !r.bakery && !r.veg)
      problems.push('Рядок ' + r.line + ': активна точка без жодного напрямку');
    if (r.active && r.bread && !r.code)
      problems.push('Рядок ' + r.line + ': хліб є, але немає облікового номера');
    if (r.type === 'Виробництво' && (r.bread || r.bakery))
      problems.push('Рядок ' + r.line + ': виробництво не замовляє хліб або випічку');
    if (['Магазин', 'Виробництво'].indexOf(r.type) === -1)
      problems.push('Рядок ' + r.line + ': невідомий тип "' + r.type + '"');
  });

  const codes = {};
  rows.filter(r => r.code).forEach(r => {
    if (codes[r.code]) problems.push('Рядок ' + r.line + ': обліковий номер ' + r.code +
      ' повторюється (рядок ' + codes[r.code] + ')');
    else codes[r.code] = r.line;
  });

  const stat = 'Активних: ' + rows.filter(r => r.active).length +
    '  |  хліб ' + rows.filter(r => r.active && r.bread).length +
    ', випічка ' + rows.filter(r => r.active && r.bakery).length +
    ', овочі ' + rows.filter(r => r.active && r.veg).length;

  console.log(problems.length ? problems.join('\n') : 'OK. ' + stat);
  if (!silent) {
    const ui = SpreadsheetApp.getUi();
    ui.alert(problems.length ? 'Проблем: ' + problems.length : 'Довідник у порядку',
      problems.length ? problems.slice(0, 25).join('\n') : stat, ui.ButtonSet.OK);
  }
  return problems;
}

// ============================================================
// ПРЕДПРОСМОТР
// ============================================================
function previewSync() {
  const rows = readRegistry();
  const report = [];

  Object.keys(TARGETS).forEach(k => {
    const t = TARGETS[k];
    let current = [];
    try {
      const sh = SpreadsheetApp.openById(t.id).getSheetByName(t.sheet);
      if (!sh) { report.push(t.title + ': ЛИСТ "' + t.sheet + '" НЕ ЗНАЙДЕНО'); return; }
      if (sh.getLastRow() > 1)
        current = sh.getRange(2, 1, sh.getLastRow() - 1, t.cols).getValues();
    } catch (e) {
      report.push(t.title + ': помилка доступу — ' + e.message); return;
    }

    const planned = rows.filter(r => r[t.flag]);
    const cur = {}, nw = {};
    current.forEach(r => { const a = canonicalKey(r[t.addrCol]); if (a) cur[a] = String(r[t.addrCol]); });
    planned.forEach(r => { const a = canonicalKey(addrFor_(r, t)); if (a) nw[a] = addrFor_(r, t); });

    const added = Object.keys(nw).filter(a => !cur[a]).map(a => nw[a]);
    const gone = Object.keys(cur).filter(a => !nw[a]).map(a => cur[a]);

    report.push(t.title + ': ' + current.length + ' → ' + planned.length +
      (added.length ? '\n   + додається: ' + added.join('; ') : '') +
      (gone.length ? '\n   − ЗНИКАЄ: ' + gone.join('; ') : '') +
      (!added.length && !gone.length ? '\n   склад точок не змінюється' : ''));
  });

  const text = report.join('\n\n');
  console.log(text);
  SpreadsheetApp.getUi().alert('Що буде змінено', text, SpreadsheetApp.getUi().ButtonSet.OK);
}

// ============================================================
// СИНХРОНИЗАЦИЯ
// ============================================================
function syncStoresToLegacy() {
  const ui = SpreadsheetApp.getUi();
  if (validateRegistry(true).length) {
    ui.alert('Скасовано', 'Спочатку виправте помилки: меню → пункт 1.', ui.ButtonSet.OK);
    return;
  }
  if (ui.alert('Підтвердження',
      'Списки точок у трьох робочих таблицях будуть перезаписані з довідника.\n' +
      'Копії таблиць створені? Продовжити?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const rows = readRegistry();
  const log = [];

  Object.keys(TARGETS).forEach(k => {
    const t = TARGETS[k];
    // Неактивные точки тоже пишем: звіти шукають за адресою обліковий номер
    const values = rows.filter(r => r[t.flag]).map(r => t.build(r, addrFor_(r, t)));
    try {
      const sh = SpreadsheetApp.openById(t.id).getSheetByName(t.sheet);
      if (!sh) throw new Error('не знайдено лист "' + t.sheet + '"');
      const last = sh.getLastRow();
      if (last > 1) sh.getRange(2, 1, last - 1, t.cols).clearContent();
      if (values.length) sh.getRange(2, 1, values.length, t.cols).setValues(values);
      SpreadsheetApp.flush();
      log.push(t.title + ': записано ' + values.length);
    } catch (e) {
      log.push(t.title + ': ПОМИЛКА — ' + e.message);
    }
  });

  console.log(log.join('\n'));
  ui.alert('Результат', log.join('\n'), ui.ButtonSet.OK);
}

// ============================================================
// ДИАГНОСТИКА
// ============================================================
function inspectTargets() {
  const out = [];
  Object.keys(TARGETS).forEach(k => {
    const t = TARGETS[k];
    try {
      const sh = SpreadsheetApp.openById(t.id).getSheetByName(t.sheet);
      if (!sh) { out.push(t.title + ': листа "' + t.sheet + '" немає'); return; }
      const w = Math.min(Math.max(sh.getLastColumn(), 1), 6);
      out.push(t.title + ' → "' + t.sheet + '"\n   рядків ' + sh.getLastRow() +
        ', колонок ' + sh.getLastColumn() +
        '\n   шапка: ' + sh.getRange(1, 1, 1, w).getValues()[0].join(' | ') +
        (sh.getLastRow() > 1 ? '\n   1-й рядок: ' +
          sh.getRange(2, 1, 1, w).getValues()[0].join(' | ') : ''));
    } catch (e) {
      out.push(t.title + ': помилка доступу — ' + e.message);
    }
  });
  const text = out.join('\n\n');
  console.log(text);
  SpreadsheetApp.getUi().alert('Структура таблиць', text, SpreadsheetApp.getUi().ButtonSet.OK);
}

// ============================================================
// API ДЛЯ МАЙБУТНЬОГО ДОДАТКУ
// ============================================================
function getStoresForApp() {
  return readRegistry().filter(r => r.active).map(r => ({
    label: r.label,
    address: r.address,
    code: r.code,
    route: r.route,
    type: r.type,
    addrBread: r.addrBread || r.address,
    addrBakery: r.addrBakery || r.address,
    addrVeg: r.addrVeg || r.address,
    directions: [r.bread && 'bread', r.bakery && 'bakery', r.veg && 'veg'].filter(Boolean)
  }));
}
