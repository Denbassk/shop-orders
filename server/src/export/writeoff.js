// Вигрузка списань з бази в лист «Списания» таблиці юрособи. Перенос запису apiWoSubmit_ і видалення woDeleteDoc_ (app/WriteOff.gs).
// Одиниця - подача (doc_id). Невигружене: exported_at is null або < changed_at (в'ю writeoffs_export_pending).
//   - видалене (deleted_at) -> усі рядки з цим ID у листі видаляються знизу вгору;
//   - живе -> дописується, якщо рядків з цим ID у листі ще нема (як запасна перевірка хвоста в apiWoSubmit_).
// Позначка exported_at = changed_at прочитаної версії. Таблиці - по черзі (у тестовому режимі вкладка спільна).
// До переключення (Task 11) - тестова таблиця; live - wo_books[ЄДРПОУ].id з settings.
const R = require('../rules');
const { exportTargetMode, TEST_EXPORT_SPREADSHEET_ID } = require('./target');

const WO_SHEET = 'Списания';
const BREAD_EDRPOU = '44413718';

const serialOfUtc = (ms) => ms / 86400000 + 25569;
function atSerial(iso) {                    // «Подано»: місцевий час Києва як число таблиці
  const k = R.kyivNow(new Date(iso));
  const [y, m, d] = k.day.split('-').map(Number);
  const [hh, mm, ss] = k.time.split(':').map(Number);
  return serialOfUtc(Date.UTC(y, m - 1, d, hh, mm, ss));
}
function dateSerial(day) {                  // «Дата списания»: опівдні, як woDateOf_
  const [y, m, d] = String(day).slice(0, 10).split('-').map(Number);
  return serialOfUtc(Date.UTC(y, m - 1, d, 12));
}
// текст з апострофом: штрихкод/№ не стають числом, «=...» не стає формулою (USER_ENTERED)
const txt = (v) => { const s = v == null ? '' : String(v); return s ? "'" + s : ''; };
const num = (v) => Number(v) || 0;

// рядок як values у apiWoSubmit_: docId, now, wdate, label, code, category, barcode, name, q, price, s, woPlus_(s), seller, store.id
function woRow(w, l) {
  return [txt(w.doc_id), atSerial(w.submitted_at), dateSerial(w.wo_date), txt(w.store_label), txt(w.store_code),
    txt(l.category), txt(l.barcode), txt(l.name), num(l.qty), num(l.price), num(l.amount), num(l.amount_plus),
    txt(w.seller), txt(w.store_id)];
}

function woBookOf(mode, settings, edrpou) {
  if (mode !== 'live') return { spreadsheetId: TEST_EXPORT_SPREADSHEET_ID };
  const b = ((settings || {}).wo_books || {})[edrpou];
  return b && b.id ? { spreadsheetId: b.id } : null;
}

function parseRows(res) {
  const m = String(((res || {}).updates || {}).updatedRange || '').match(/![A-Z]+(\d+)(?::[A-Z]+(\d+))?$/);
  return m ? { first: +m[1], last: +(m[2] || m[1]) } : null;
}

// формат як w01_setupWriteOffs (WriteOff.gs 186-193); s, e - 0-based рядки [s, e)
function formatRequests(sheetId, s, e) {
  const f = (c0, c1, type, pattern) => ({ repeatCell: {
    range: { sheetId, startRowIndex: s, endRowIndex: e, startColumnIndex: c0, endColumnIndex: c1 },
    cell: { userEnteredFormat: { numberFormat: { type, pattern } } }, fields: 'userEnteredFormat.numberFormat' } });
  return [f(0, 1, 'TEXT', '@'), f(1, 2, 'DATE_TIME', 'dd.MM.yyyy HH:mm'), f(2, 3, 'DATE', 'dd.MM.yyyy'),
    f(4, 6, 'TEXT', '@'), f(6, 7, 'TEXT', '@'), f(8, 9, 'NUMBER', '0.###'), f(9, 12, 'NUMBER', '0.00'), f(12, 13, 'TEXT', '@')];
}

// номери рядків (1-based) -> deleteDimension знизу вгору, суміжні склеєні
function deleteRequests(sheetId, nums) {
  const s = [...new Set(nums)].sort((a, b) => b - a), out = [];
  for (let j = 0; j < s.length;) {
    const end = s[j]; let start = end;
    while (j + 1 < s.length && s[j + 1] === start - 1) { j++; start--; }
    out.push({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: start - 1, endIndex: end } } });
    j++;
  }
  return out;
}

async function exportBook(env, mode, settings, edrpou, docs) {
  const book = woBookOf(mode, settings, edrpou);
  if (!book) throw new Error('немає таблиці списань для ЄДРПОУ ' + edrpou + ' (settings.wo_books)');
  const g = env.google, id = book.spreadsheetId, log = env.log || console.error;

  const colA = await g.getValues(id, g.a1q(WO_SHEET, 'A:A'));          // одне читання на таблицю
  const rowsOf = {};
  colA.forEach((r, i) => {
    if (i === 0) return;
    const v = String((r && r[0]) == null ? '' : r[0]).replace(/^'/, '').trim();
    if (v) (rowsOf[v] = rowsOf[v] || []).push(i + 1);
  });
  const dataRows = Math.max(colA.length - 1, 0);
  const sheetId = await g.sheetIdOf(id, WO_SHEET);

  const delIds = new Set(docs.filter((w) => w.deleted_at).map((w) => w.doc_id));
  const hits = [];
  delIds.forEach((d) => (rowsOf[d] || []).forEach((n) => hits.push(n)));
  if (hits.length) {
    const reqs = [];
    // таблиця не дає видалити всі незакріплені рядки - запасний (woDeleteDoc_)
    if (hits.length >= dataRows) reqs.push({ appendDimension: { sheetId, dimension: 'ROWS', length: 1 } });
    await g.batchUpdate(id, reqs.concat(deleteRequests(sheetId, hits)));
  }
  delIds.forEach((d) => { delete rowsOf[d]; });

  const values = [];
  docs.filter((w) => !w.deleted_at && !rowsOf[w.doc_id]).forEach((w) => {
    (w.lines || []).slice().sort((a, b) => a.line_no - b.line_no).forEach((l) => values.push(woRow(w, l)));
  });
  if (values.length) {
    const res = await g.appendValues(id, g.a1q(WO_SHEET, 'A1'), values);
    const r = parseRows(res);
    if (r) {
      try { await g.batchUpdate(id, formatRequests(sheetId, r.first - 1, r.last)); }
      catch (e) { log('формат списань ' + edrpou + ': ' + e.message); }
    }
  }
  await env.data.woMarkExported(docs.map((w) => ({ id: w.id, changed_at: w.changed_at })));
  return { deleted: hits.length, appended: values.length, marked: docs.length };
}

async function exportLocked(env) {
  const docs = await env.data.woExportSnapshot();
  const out = {};
  if (!docs.length) return out;
  const mode = env.mode || exportTargetMode();
  const settings = await env.data.settings();
  const by = {};
  docs.forEach((w) => { const e = String(w.edrpou || BREAD_EDRPOU).trim(); (by[e] = by[e] || []).push(w); });
  for (const e of Object.keys(by)) {
    try { out[e] = await exportBook(env, mode, settings, e, by[e]); }
    catch (err) { out[e] = { error: err.message }; (env.log || console.error)('вигрузка списань ' + e + ': ' + err.message); }
  }
  return out;
}

let chain = Promise.resolve();
function exportWriteoffs(env) {
  const run = chain.then(() => exportLocked(env));
  chain = run.catch(() => {});
  return run;
}

module.exports = { exportWriteoffs, woRow, formatRequests, deleteRequests, WO_SHEET };