// ============================================================
// КОНФІГУРАЦІЯ НАПРЯМКІВ
// ============================================================
const REGISTRY_ID = '1noOXYRRdxIuY6gd9kicI2OxGU0vJ_kfvLbcVTyqXi6o';
const REGISTRY_SHEET = 'ТТ';

const DIRECTIONS = {
  bread: {
    key: 'bread',
    title: 'Хліб',
    subtitle: 'ЧП Рома',
    icon: 'bread',
    color: '#8D6E63',
    spreadsheetId: '1QJca7XlvZbIWfEIyxBxC64dSD6RkrlWoZOSmem2tix4',
    productsSheet: 'Ассортимент',
    rawSheet: '_Сырые_Заказы',
    unit: 'шт',
    minOrder: 350,
    markup: 1,
    hasCategories: false,
    hasBarcodes: true,
    addressAlias: 'addrBread',
    // Фактичний порядок колонок: дата, маршрут, адреса, штрихкод, назва, ціна, кількість
    // (шапка в листі зсунута - не орієнтуватися на неї)
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.store.route, ctx.shortAddress,
              p.barcode, p.name, p.price, p.qty];
    }
  },

  bakery: {
    key: 'bakery',
    title: 'Випічка і кулінарія',
    subtitle: 'власне виробництво',
    icon: 'bakery',
    color: '#E65100',
    spreadsheetId: '1THdB-b4JkXzAKsaVPw8DLrXATlycpFkTgolTmqCOXWo',
    productsSheet: 'Ассортимент',
    rawSheet: '_Сырые_Заказы_ВК',
    unit: 'шт',
    minOrder: 0,
    markup: 1,
    hasCategories: true,
    hasBarcodes: true,
    addressAlias: 'addrBakery',
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.timeStr, ctx.address,
              p.category, p.barcode, p.name, p.price, p.qty];
    }
  },

  veg: {
    key: 'veg',
    title: 'Овочі і фрукти',
    subtitle: 'від постачальника',
    icon: 'veg',
    color: '#2E7D32',
    spreadsheetId: '1HbvDCuMMJe7GI4zQyDxkyqVWahTPtWf5vNuMFLEXIC0',
    rawSheet: '_Сырые_Заказы_Овочі',
    priceSpreadsheetId: '1WnxkoU_aHZg6WjrkT4cdCFrk6tMlbIsdYDGkvlaDV7w',
    unit: 'кг',
    minOrder: 500,   // мінімум постачальника
    markup: 1.5,     // продавець бачить ціни та мінімум x1.5
    hasCategories: false,
    hasBarcodes: false,
    addressAlias: 'addrVeg',
    // У таблицю пишеться ЦІНА ПОСТАЧАЛЬНИКА (без націнки)
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.timeStr, ctx.address,
              p.name, p.price, p.qty, Math.round(p.price * p.qty * 100) / 100];
    }
  }
};

function dirCfg_(key) {
  const c = DIRECTIONS[key];
  if (!c) throw new Error('Невідомий напрямок: ' + key);
  return c;
}