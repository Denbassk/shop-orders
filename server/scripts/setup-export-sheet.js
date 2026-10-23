#!/usr/bin/env node
// Готує порожню таблицю «shop-orders ТЕСТ вигрузки» (створена вручну, сервісний акаунт - Редактор):
// вкладки з назвами сирих листів усіх напрямків, шапки скопійовано з бойових листів (лише читання бойових),
// часовий пояс як у бойових (Europe/Kiev), локаль ru_RU. Повторний запуск безпечний: вкладки, що вже є, лишаються.
//   node scripts/setup-export-sheet.js <spreadsheetId>
const { DIRECTIONS } = require('../src/directions');
const { getValues, batchUpdate, sheetsClient, a1q } = require('../src/google');

(async () => {
  const id = process.argv[2];
  if (!id) throw new Error('використання: setup-export-sheet.js <spreadsheetId>');
  if (Object.values(DIRECTIONS).some((d) => d.spreadsheetId === id)) throw new Error('це БОЙОВА таблиця напрямку - відмова');

  const meta = await sheetsClient().spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(title,sheetId)' });
  const have = new Set(meta.data.sheets.map((s) => s.properties.title));
  const requests = [{ updateSpreadsheetProperties: { properties: { timeZone: 'Europe/Kiev', locale: 'ru_RU' }, fields: 'timeZone,locale' } }];
  Object.keys(DIRECTIONS).forEach((k, i) => {
    const title = DIRECTIONS[k].rawSheet;
    if (!have.has(title)) requests.push({ addSheet: { properties: { title, sheetId: 100 + i, gridProperties: { frozenRowCount: 1 } } } });
  });
  await batchUpdate(id, requests);

  const data = [];
  for (const k of Object.keys(DIRECTIONS)) {
    const cfg = DIRECTIONS[k];
    const head = (await getValues(cfg.spreadsheetId, a1q(cfg.rawSheet, 'A1:J1'), { formatted: true }))[0] || [];
    data.push({ range: a1q(cfg.rawSheet, 'A1'), values: [head] });
  }
  await sheetsClient().spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data } });
  if (have.has('Лист1')) {
    const s = meta.data.sheets.find((x) => x.properties.title === 'Лист1');
    await batchUpdate(id, [{ deleteSheet: { sheetId: s.properties.sheetId } }]);
  }
  const after = await sheetsClient().spreadsheets.get({ spreadsheetId: id, fields: 'properties(title,locale,timeZone),sheets.properties(title,gridProperties)' });
  console.log(JSON.stringify(after.data.properties));
  after.data.sheets.forEach((s) => console.log(' -', s.properties.title, JSON.stringify(s.properties.gridProperties)));
  for (const k of Object.keys(DIRECTIONS)) console.log(k, JSON.stringify((await getValues(id, a1q(DIRECTIONS[k].rawSheet, 'A1:J1')))[0]));
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
