// Порівняння моделей листів (shadow.js) і розбір відповіді Google (modelFromGridData).
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareModels, mask } = require('../src/reports/shadow');
const { newSheet, modelFromGridData, applyRequests } = require('../src/reports/sheetModel');
const { writerFor } = require('../src/reports/sheetWriter');

const model = (cells, extra = {}) => ({ ...newSheet('x', 1), cells, ...extra });

test('mask: час збирання, id таблиці і gid у посиланнях не рахуються розбіжністю', () => {
  assert.equal(mask('ТТ: 5 (оновлено 12:56:19)'), 'ТТ: 5 (оновлено *)');
  assert.equal(mask('Звіт перезібрано о 15:42'), 'Звіт перезібрано о *');
  assert.equal(mask('https://docs.google.com/spreadsheets/d/1ABC/export?format=xlsx&gid=77'), 'https://docs.google.com/spreadsheets/d/*/export?format=xlsx&gid=*');
});

test('compareModels: однакові - 0; штамп і посилання маскуються; значення/оформлення/відсутній лист рахуються окремо', () => {
  const live = { A: model({ '1,1': { v: 'Звіт (оновлено 12:00:00)', bg: '#ffffff', bold: true }, '2,1': { v: 5 } }, { colW: { 1: 100, 2: 100, 3: 100 } }),
    B: model({ '1,1': { v: 'x' } }), C: model({}) };
  const ours = { A: model({ '1,1': { v: 'Звіт (оновлено 13:30:59)', bg: '#ffffff', bold: true }, '2,1': { v: 5 } }, { colW: { 1: 100 } }),
    B: model({ '1,1': { v: 'x' } }) };
  let r = compareModels({ A: live.A, B: live.B }, ours);
  assert.deepEqual([r.totalValue, r.totalFormat], [0, 0], 'розміри інших колонок live не порівнюються (onlyDimsOf b)');

  ours.A.cells['2,1'].v = '5';                         // число стало текстом - значення
  ours.A.cells['1,1'].bg = '#fffffe';                  // колір - оформлення
  ours.A.colW[1] = 101;                                 // ширина - оформлення
  r = compareModels(live, ours);
  assert.equal(r.sheets.A.valueDiffs.length, 1);
  assert.equal(r.sheets.A.formatDiffs.length, 2);
  assert.equal(r.sheets.C.missing, true);
  assert.equal(r.totalValue, 2, 'значення + відсутній лист');
});

test('compareModels: назва листа в нашій таблиці інша (Завантаження НБХЗ)', () => {
  const r = compareModels({ 'Завантаження': model({ '1,1': { v: 'a' } }) }, { 'Завантаження НБХЗ': model({ '1,1': { v: 'a' } }) }, { 'Завантаження': 'Завантаження НБХЗ' });
  assert.equal(r.totalValue + r.totalFormat, 0);
});

test('modelFromGridData: те, що Google віддає для комірок, -> та сама модель, що з наших запитів', () => {
  // наші запити
  const w = writerFor({ properties: { sheetId: 5, gridProperties: { rowCount: 1000, columnCount: 26 } } }, [['Шапка', 'Кіл-ть'], ['Хліб', 2.5]], 2);
  w.fmt([1], 'A', 'B', { bg: '#FFFF00', bold: true, halign: 'center' }).fmt([2], 'B', 'B', { num: '0.###', color: '#C62828', size: 12 }).border([2], 'A', 'B').colWidths([120, 90]).frozen(1);
  const ours = applyRequests(newSheet('o', 5), w.requests());
  // відповідь Google для тих самих комірок
  const b = { style: 'SOLID', color: {} };
  const api = { properties: { sheetId: 5, gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 } },
    data: [{ rowData: [
      { values: [{ userEnteredValue: { stringValue: 'Шапка' }, userEnteredFormat: { backgroundColor: { red: 1, green: 1 }, textFormat: { bold: true }, horizontalAlignment: 'CENTER' } },
        { userEnteredValue: { stringValue: 'Кіл-ть' }, userEnteredFormat: { backgroundColor: { red: 1, green: 1 }, textFormat: { bold: true }, horizontalAlignment: 'CENTER' } }] },
      { values: [{ userEnteredValue: { stringValue: 'Хліб' }, userEnteredFormat: { borders: { top: b, bottom: b, left: b, right: b } } },
        { userEnteredValue: { numberValue: 2.5 }, userEnteredFormat: { borders: { top: b, bottom: b, left: b, right: b }, numberFormat: { type: 'NUMBER', pattern: '0.###' },
          textFormat: { foregroundColor: { red: 0xC6 / 255, green: 0x28 / 255, blue: 0x28 / 255 }, fontSize: 12 } } }] },
    ], columnMetadata: [{ pixelSize: 120 }, { pixelSize: 90 }, { pixelSize: 100 }], rowMetadata: [{ pixelSize: 21 }, { pixelSize: 21 }] }] };
  const live = modelFromGridData(api, 'o');
  const r = compareModels({ o: live }, { o: ours });
  assert.deepEqual(r.sheets.o.valueDiffs.concat(r.sheets.o.formatDiffs), []);
});

test('залишок формату числа в порожніх комірках бойового листа (clear() його не скидає) не є розбіжністю; у комірках зі значенням - є', () => {
  const live = { S: model({ '1,1': { v: 5, nf: '0.###' }, '2,3': { nf: '#,##0.00' }, '3,3': { v: 7, nf: '#,##0.00' }, '4,1': { v: 'x', nf: '@' } }) };
  const ours = { S: model({ '1,1': { v: 5, nf: '0.###' }, '3,3': { v: 7 }, '4,1': { v: 'x' } }) };
  const tally = {};
  const r = compareModels(live, ours, {}, { liveTextFormat: true, tally });
  assert.equal(r.sheets.S.formatDiffs.length, 1, 'лише (3,3): значення є, а формату нема');
  assert.equal(r.sheets.S.formatDiffs[0].cell, '3,3');
  assert.equal(tally.residual, 2, 'порожня (2,3) і текст "x" з "@"');
});

test('результат формули: помилка в нашому листі (#ERROR!) - розбіжність, навіть якщо текст формули збігається', () => {
  const live = { S: model({ '1,1': { formula: '=HYPERLINK("u"; "t")', fv: 't' } }) };
  const bad = { S: model({ '1,1': { formula: '=HYPERLINK("u"; "t")', fv: '#ERROR: Formula parse error.' } }) };
  const ok = { S: model({ '1,1': { formula: '=HYPERLINK("u", "t")', fv: 't' } }) };
  assert.equal(compareModels(live, ok).totalValue, 0, 'роздільник ; і , в тексті формули не розбіжність, а результат однаковий');
  assert.ok(compareModels(live, bad).totalValue >= 1);
});
