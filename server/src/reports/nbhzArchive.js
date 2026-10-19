// Архів вигрузок НБХЗ. Перенос app/Export.gs (archiveOldNbhzExports, archiveNbhzExportsDaily_, nbhzExportDate_):
// листи «Вивантаження дд.мм.рррр» старші за NBHZ_EXPORT_KEEP_DAYS (сьогодні + 2 попередні дні) переїжджають в окрему
// таблицю-архів. Лист спершу копіюється, звіряється кількість рядків і колонок, і лише тоді видаляється з робочої.
// Різниця від Apps Script: таблицю-архів сервер сам не створює (сервісний акаунт не може створювати файли) -
// її id береться з NBHZ_ARCHIVE_SPREADSHEET_ID; без id архівування пропускається, листи лишаються на місці.
const KEEP_DAYS = 3;
const EXPORT_RE = /^Вивантаження (\d{2})\.(\d{2})\.(\d{4})$/;

const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000;
function exportDayNum(name) {
  const m = String(name).match(EXPORT_RE);
  return m ? dayNum(+m[3], +m[2], +m[1]) : null;
}
const todayNum = (day) => dayNum(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10));       // day = 'РРРР-ММ-ДД'

const a1 = (title, range) => `'${String(title).replace(/'/g, "''")}'!${range}`;
async function extent(google, spreadsheetId, title) {
  const v = await google.getValues(spreadsheetId, a1(title, 'A:ZZ'));
  return { rows: v.length, cols: v.reduce((m, r) => Math.max(m, r.length), 0) };
}

// env = { google: { sheetList, copySheetTo, batchUpdate, getValues }, spreadsheetId, archiveId, day 'РРРР-ММ-ДД' }
// Повертає { moved, total, failed: [{ name, error }] } або { skipped, total }
async function archiveOldExports(env, keepDays = KEEP_DAYS) {
  const { google, spreadsheetId, archiveId } = env;
  const today = todayNum(env.day);
  const old = (await google.sheetList(spreadsheetId))
    .map((s) => ({ ...s, n: exportDayNum(s.title) }))
    .filter((s) => s.n != null && Math.round(today - s.n) >= keepDays)
    .sort((a, b) => a.n - b.n);
  if (!old.length) return { moved: 0, total: 0, failed: [] };
  if (!archiveId) return { skipped: 'таблицю-архів не задано (NBHZ_ARCHIVE_SPREADSHEET_ID)', total: old.length, moved: 0, failed: [] };

  const taken = new Set((await google.sheetList(archiveId)).map((s) => s.title));
  let moved = 0;
  const failed = [];
  for (const o of old) {
    let copy = null;
    try {
      copy = await google.copySheetTo(spreadsheetId, o.sheetId, archiveId);
      // ім'я вже зайняте в архіві - не видаляємо старе, додаємо (2), (3)...
      let target = o.title, k = 2;
      while (taken.has(target)) target = o.title + ' (' + (k++) + ')';
      await google.batchUpdate(archiveId, [{ updateSheetProperties: { properties: { sheetId: copy.sheetId, title: target }, fields: 'title' } }]);
      taken.add(target);

      const [a, b] = [await extent(google, spreadsheetId, o.title), await extent(google, archiveId, target)];
      if (a.rows !== b.rows || a.cols !== b.cols) throw new Error('копія не збіглася з оригіналом - лист лишено на місці');

      await google.batchUpdate(spreadsheetId, [{ deleteSheet: { sheetId: o.sheetId } }]);
      moved++;
    } catch (e) {
      failed.push({ name: o.title, error: e.message });
      console.error('Архів НБХЗ, "' + o.title + '": ' + e.message);
      // непотрібну (невірну) копію прибираємо, щоб наступний запуск не додавав (2), (3)...
      if (copy) { try { await google.batchUpdate(archiveId, [{ deleteSheet: { sheetId: copy.sheetId } }]); taken.delete(o.title); } catch (e2) { /* лишається */ } }
    }
  }

  // прибрати порожній стартовий лист нової таблиці-архіву
  try {
    const arc = await google.sheetList(archiveId);
    if (arc.length > 1) {
      for (const s of arc) {
        if (!/^(Sheet1|Лист1|Аркуш1)$/.test(s.title)) continue;
        if ((await extent(google, archiveId, s.title)).rows === 0) await google.batchUpdate(archiveId, [{ deleteSheet: { sheetId: s.sheetId } }]);
      }
    }
  } catch (e) { console.error('Архів НБХЗ (стартовий лист): ' + e.message); }

  return { moved, total: old.length, failed };
}

// Раз на день (у памʼяті процесу; після рестарту перший запуск лише перевіряє, чи є що переносити). Помилка не ламає вигрузку.
const doneDay = {};
async function archiveDaily(env) {
  const key = env.spreadsheetId;
  if (doneDay[key] === env.day) return { skipped: 'сьогодні вже перевірено' };
  try {
    const res = await archiveOldExports(env);
    if (!res.skipped && !res.failed.length) doneDay[key] = env.day;
    return res;
  } catch (e) {
    console.error('Архів вигрузок НБХЗ: ' + e.message);
    return { error: e.message };
  }
}

module.exports = { KEEP_DAYS, exportDayNum, archiveOldExports, archiveDaily };
