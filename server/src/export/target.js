// Куди пише вигрузка. До переключення (Task 11) у бойові сирі листи пише Apps Script, тому за замовчуванням -
// ТЕСТОВА таблиця «shop-orders ТЕСТ вигрузки» (вкладки з тими самими назвами, що сирі листи, шапки скопійовано).
// 'live' вмикається ЛИШЕ точним EXPORT_TARGET=live.
const { DIRECTIONS } = require('../directions');

// id таблиці «shop-orders ТЕСТ вигрузки» (сервісний акаунт - Редактор)
const TEST_EXPORT_SPREADSHEET_ID = '1sTPM2vEiJrQnKvGZZuhYyEqL5PwSHihR9rk-q9d1V84';

function exportTargetMode(env = process.env) {
  return env.EXPORT_TARGET === 'live' ? 'live' : 'test';
}

// { mode, spreadsheetId(dir) }
function resolveTarget(mode = exportTargetMode()) {
  if (mode === 'live') return { mode, spreadsheetId: (dir) => DIRECTIONS[dir].spreadsheetId };
  return { mode: 'test', spreadsheetId: () => TEST_EXPORT_SPREADSHEET_ID };
}

module.exports = { TEST_EXPORT_SPREADSHEET_ID, exportTargetMode, resolveTarget };
