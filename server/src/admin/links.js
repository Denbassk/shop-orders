// Посилання пульта: xlsx лише листа звіту напрямку і таблиця напрямку. Перенос admXlsxUrl_/admSheetUrl_ (app/Admin.gs).
// Таблиця - та сама ціль, що у вигрузки і звітів (EXPORT_TARGET: до Task 11 - тестова). Збій або нема листа -> ''.
const R = require('../rules');

const NAMES = { bread: () => 'Заказы', bakery: () => 'Заказы ВК', veg: () => 'Замовлення Овочі', nbhz: (dmy) => 'Вивантаження ' + dmy };
const BASE = 'https://docs.google.com/spreadsheets/d/';

function createLinks({ target, sheetIdOf, at = () => new Date() }) {
  async function xlsx(dir) {
    try {
      if (!NAMES[dir]) return '';
      const id = target.spreadsheetId(dir);
      const gid = await sheetIdOf(id, NAMES[dir](R.kyivNow(at()).dmy));
      if (gid == null) return '';
      return BASE + id + '/export?format=xlsx&gid=' + gid;
    } catch (e) { return ''; }
  }
  async function sheetUrl(dir) {
    try { return BASE + target.spreadsheetId(dir) + '/edit'; } catch (e) { return ''; }
  }
  return { xlsx, sheetUrl };
}

module.exports = { createLinks };