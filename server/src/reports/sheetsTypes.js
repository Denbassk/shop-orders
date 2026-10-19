// Типи значень, які Google Sheets (локаль ru_RU) отримує від Apps Script через setValues і які ми повторюємо в наших запитах.
// Спостережено в бойових листах хліба (Заказы, Данные Заказов):
//   - рядок "19.10.2026" стає датою: число 46314 + формат dd.mm.yyyy;
//   - рядок з цифр у комірці з автоматичним форматом стає числом (штрихкод у зведенні: 4820041526118);
//   - setNumberFormat('@') ПІСЛЯ запису перетворює числа на текст ("198"); API-запит з форматом TEXT значення не міняє,
//     тож текстове значення задаємо явно (asText).
// Ведучі нуль не губимо: цифровий рядок стає числом, лише якщо від цього не змінюється запис (numberLike).

// Серійний номер дати Google ("19.10.2026" -> 46314)
function serialOfDmy(dmy) {
  const m = String(dmy).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) throw new Error('не дата ДД.ММ.РРРР: ' + dmy);
  return Math.round(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000) + 25569;
}

// Цифровий рядок, який Sheets перетворить на число без втрат ("4820041526118" так, "0103" ні)
const numberLike = (s) => typeof s === 'string' && /^-?\d+$/.test(s) && String(Number(s)) === s && Math.abs(Number(s)) <= Number.MAX_SAFE_INTEGER;

// Комірка з автоматичним форматом: цифрові рядки - числами
const asEntered = (v) => (numberLike(v) ? Number(v) : v);

// Комірка з форматом '@': число -> текст
const asText = (v) => (typeof v === 'number' ? String(v) : v);

module.exports = { serialOfDmy, numberLike, asEntered, asText };
