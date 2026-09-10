// ============================================================
// КОНФІГУРАЦІЯ НАПРЯМКІВ
// ============================================================

// ТЕСТОВИЙ РЕЖИМ: true - замовлення пишуться в листи "_Тест_*",
// робочі дані не чіпаються. Перед бойовим запуском поставити false.
const TEST_MODE = true;

const REGISTRY_ID = '1noOXYRRdxIuY6gd9kicI2OxGU0vJ_kfvLbcVTyqXi6o';
const REGISTRY_SHEET = 'ТТ';

const DIRECTIONS = {
  bread: {
    key: 'bread',
    title: 'Хліб',
    subtitle: 'ЧП Рома',
    color: '#8D6E63',
    deadline: '',
    step: 1,
    spreadsheetId: '1QJca7XlvZbIWfEIyxBxC64dSD6RkrlWoZOSmem2tix4',
    productsSheet: 'Ассортимент',
    rawSheet: '_Сырые_Заказы',
    testSheet: '_Тест_Заказы_Хліб',
    unit: 'шт',
    minOrder: 350,
    markup: 1,
    hasCategories: false,
    hasBarcodes: true,
    addressAlias: 'addrBread',
    shortAddr: true,
    // Порядок колонок: дата, маршрут, адреса, штрихкод, назва, ціна, кількість
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.store.route, ctx.shortAddress,
              p.barcode, p.name, p.price, p.qty];
    }
  },

  bakery: {
    key: 'bakery',
    title: 'Випічка і кулінарія',
    subtitle: 'власне виробництво',
    color: '#E65100',
    deadline: '13:00',
    step: 1,
    spreadsheetId: '1THdB-b4JkXzAKsaVPw8DLrXATlycpFkTgolTmqCOXWo',
    productsSheet: 'Ассортимент',
    rawSheet: '_Сырые_Заказы_ВК',
    testSheet: '_Тест_Заказы_ВК',
    unit: 'шт',
    minOrder: 0,
    markup: 1,
    hasCategories: true,
    hasBarcodes: true,
    addressAlias: 'addrBakery',
    shortAddr: false,
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.timeStr, ctx.address,
              p.category, p.barcode, p.name, p.price, p.qty];
    }
  },

  veg: {
    key: 'veg',
    title: 'Овочі і фрукти',
    subtitle: 'від постачальника',
    color: '#2E7D32',
    deadline: '18:00',
    step: 0.5,
    spreadsheetId: '1HbvDCuMMJe7GI4zQyDxkyqVWahTPtWf5vNuMFLEXIC0',
    rawSheet: '_Сырые_Заказы_Овочі',
    testSheet: '_Тест_Заказы_Овочі',
    priceSpreadsheetId: '1WnxkoU_aHZg6WjrkT4cdCFrk6tMlbIsdYDGkvlaDV7w',
    unit: 'кг',
    minOrder: 500,   // мінімум постачальника (продавець бачить x1.5 = 750)
    markup: 1.5,
    hasCategories: false,
    hasBarcodes: false,
    addressAlias: 'addrVeg',
    shortAddr: false,
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

// Куди реально писати і звідки читати статус
function rawSheetName_(cfg) {
  return TEST_MODE ? cfg.testSheet : cfg.rawSheet;
}

// Ключ статусу для конкретної ТТ і напрямку
function statusKey_(dirKey, store) {
  const cfg = dirCfg_(dirKey);
  const a = store[cfg.addressAlias];
  return addrKey_(cfg.shortAddr ? shortenAddress_(a) : a);
}
