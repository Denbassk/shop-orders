// ============================================================
// КОНФІГУРАЦІЯ НАПРЯМКІВ
// ============================================================

// Міняти при КОЖНОМУ деплої - телефони самі перезавантажаться.
const APP_VERSION = '2026-09-10-9';

const TEST_MODE = true;

const REGISTRY_ID = '1noOXYRRdxIuY6gd9kicI2OxGU0vJ_kfvLbcVTyqXi6o';
const REGISTRY_SHEET = 'ТТ';
const NBHZ_ID = '1ShyjK-P3xpe1ROsUPJwfpIzcNylgt05u_7r7ws6iHaY';

const DIRECTIONS = {
  bread: {
    key: 'bread', title: 'Хліб Рома', subtitle: 'ЧП Рома',
    color: '#8D6E63', deadline: '16:00', step: 1,
    spreadsheetId: '1QJca7XlvZbIWfEIyxBxC64dSD6RkrlWoZOSmem2tix4',
    productsSheet: 'Ассортимент',
    rawSheet: '_Сырые_Заказы', testSheet: '_Тест_Заказы_Хліб',
    unit: 'шт', minOrder: 350, markup: 1,
    hasCategories: false, hasBarcodes: true,
    addressAlias: 'addrBread', routeAlias: 'route', shortAddr: true,
    lateRequest: true,
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.route, ctx.shortAddress,
              p.barcode, p.name, p.price, p.qty];
    }
  },

  nbhz: {
    key: 'nbhz', title: 'Хліб НБХЗ', subtitle: 'Новобаварський хлібозавод',
    color: '#5D4037', deadline: '17:30', step: 1,
    spreadsheetId: NBHZ_ID,
    productsSheet: 'Ассортимент',
    rawSheet: '_Сырые_Заказы_НБХЗ', testSheet: '_Тест_Заказы_НБХЗ',
    unit: 'шт', minOrder: 0, markup: 1,
    hasCategories: false, hasBarcodes: true,
    addressAlias: 'addrNbhz', routeAlias: 'routeNbhz', shortAddr: true,
    lateRequest: true, allowNoPrice: true, keepOrder: true,
    // Лист "Ассортимент" НБХЗ - лише 3 колонки: Статус | № | Номенклатура
    productLayout: 'nbhz',
    // Замовлення кількісне: цін немає - і в застосунку їх не показуємо
    hidePrice: true,
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.route, ctx.shortAddress,
              p.barcode, p.name, p.price, p.qty];
    }
  },

  bakery: {
    key: 'bakery', title: 'Випічка і кулінарія', subtitle: 'власне виробництво',
    color: '#E65100', deadline: '13:00', step: 1,
    spreadsheetId: '1THdB-b4JkXzAKsaVPw8DLrXATlycpFkTgolTmqCOXWo',
    productsSheet: 'Ассортимент',
    rawSheet: '_Сырые_Заказы_ВК', testSheet: '_Тест_Заказы_ВК',
    unit: 'шт', minOrder: 0, markup: 1,
    hasCategories: true, hasBarcodes: true,
    addressAlias: 'addrBakery', routeAlias: 'route', shortAddr: false,
    lateRequest: true,
    rawRow: function (ctx, p) {
      return [ctx.dateStr, ctx.timeStr, ctx.address,
              p.category, p.barcode, p.name, p.price, p.qty];
    }
  },

  veg: {
    key: 'veg', title: 'Овочі і фрукти', subtitle: 'від постачальника',
    color: '#2E7D32', deadline: '18:00', step: 1,
    spreadsheetId: '1HbvDCuMMJe7GI4zQyDxkyqVWahTPtWf5vNuMFLEXIC0',
    rawSheet: '_Сырые_Заказы_Овочі', testSheet: '_Тест_Заказы_Овочі',
    priceSpreadsheetId: '1WnxkoU_aHZg6WjrkT4cdCFrk6tMlbIsdYDGkvlaDV7w',
    unit: 'кг', minOrder: 500, markup: 1.5,
    hasCategories: false, hasBarcodes: false,
    addressAlias: 'addrVeg', routeAlias: 'route', shortAddr: false,
    lateRequest: true,
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

function rawSheetName_(cfg) {
  return TEST_MODE ? cfg.testSheet : cfg.rawSheet;
}

function statusKey_(dirKey, store) {
  const cfg = dirCfg_(dirKey);
  const a = store[cfg.addressAlias];
  return addrKey_(cfg.shortAddr ? shortenAddress_(a) : a);
}
