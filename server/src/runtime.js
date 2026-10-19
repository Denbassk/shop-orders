// Збирає бойове оточення /api: Supabase + читання прайсу овочей з Google. Створюється один раз на процес.
const { loadEnv } = require('./env');
const { supabase } = require('./db');
const { createData } = require('./data');
const { createVegPrices } = require('./vegPrices');
const { getValues, firstSheetTitle, a1q } = require('./google');
const { DIRECTIONS } = require('./directions');

function createRuntime() {
  loadEnv();
  const data = createData(supabase());
  const priceId = DIRECTIONS.veg.priceSpreadsheetId;
  let title = null;                                   // назва першого листа дзеркала - не змінюється
  const veg = createVegPrices({
    readPriceSheet: async () => {
      if (!title) title = await firstSheetTitle(priceId);
      return getValues(priceId, a1q(title, 'A1:Z'));
    },
    savePrices: data.saveVegPrices,
  });
  return { getEnv: () => ({ at: new Date(), data, veg }) };
}

module.exports = { createRuntime };
