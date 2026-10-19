// Статичні поля DIRECTIONS з app/Config.gs (без функцій rawRow - вони підуть у export/raw.js).
// Ключі лишені як у Config.gs, щоб правила переносились дослівно.
const NBHZ_ID = '1ShyjK-P3xpe1ROsUPJwfpIzcNylgt05u_7r7ws6iHaY';

const DIRECTIONS = {
  bread: {
    key: 'bread', title: 'Хліб Рома', subtitle: 'ЧП Рома',
    color: '#8D6E63', deadline: '16:00', step: 1,
    spreadsheetId: '1QJca7XlvZbIWfEIyxBxC64dSD6RkrlWoZOSmem2tix4',
    productsSheet: 'Ассортимент',
    rawSheet: '_Сырые_Заказы', testSheet: '_Тест_Заказы_Хліб',
    unit: 'шт', minOrder: 350, markup: 1,
    minOrderChanges: [{ from: '01.10.2026', value: 400 }],
    hasCategories: false, hasBarcodes: true,
    addressAlias: 'addrBread', routeAlias: 'route', shortAddr: true,
    lateRequest: true,
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
    productLayout: 'nbhz',
    hidePrice: true,
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
    orderDays: true, dayCol: 18,
    dayOffTag: 'Вихідний',
    dayOffText: 'Кулінарія у суботу та неділю не працює.',
  },
  veg: {
    key: 'veg', title: 'Овочі і фрукти', subtitle: 'від постачальника',
    color: '#2E7D32', deadline: '18:00', step: 1,
    spreadsheetId: '1HbvDCuMMJe7GI4zQyDxkyqVWahTPtWf5vNuMFLEXIC0',
    rawSheet: '_Сырые_Заказы_Овочі', testSheet: '_Тест_Заказы_Овочі',
    // оригінал прайсу постачальника не розшарений для сервера - читаємо дзеркало
    // (IMPORTRANGE з 1WnxkoU_..., яке в Config.gs стоїть як priceSpreadsheetId)
    priceSpreadsheetId: '1MIp2thlmLMnw7ZHqO0Fz0s8dOxVVhv662ZJvixkyMnc',
    unit: 'кг', minOrder: 500, markup: 1.5,
    hasCategories: false, hasBarcodes: false,
    orderDays: true, dayCol: 17,
    dayOffTag: 'Не ваш день',
    dayOffText: 'Вибачте, не ваш день для замовлення.',
    addressAlias: 'addrVeg', routeAlias: 'route', shortAddr: false,
    lateRequest: true,
  },
};

const REGISTRY_ID = '1noOXYRRdxIuY6gd9kicI2OxGU0vJ_kfvLbcVTyqXi6o';
const REGISTRY_SHEET = 'ТТ';
const APP_VERSION = '2026-10-15-1';
const WO_DEADLINE = '13:00';

module.exports = { DIRECTIONS, REGISTRY_ID, REGISTRY_SHEET, APP_VERSION, WO_DEADLINE };
