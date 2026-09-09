// ============================================================
// АСОРТИМЕНТ
// ============================================================

function loadProducts_(dirKey) {
  var cached = cacheGet_('prod_' + dirKey);
  if (cached) return cached;
  var list = (dirKey === 'veg') ? loadVegProducts_() : loadSheetProducts_(dirKey);
  cachePut_('prod_' + dirKey, list, 600);
  return list;
}

// Хліб і випічка - лист "Ассортимент"
// хліб:    A статус | B № | C штрихкод | D ціна | E номенклатура | F шт в ящику
// випічка: A статус | B категорія | C штрихкод | D ціна | E назва | F наявність
function loadSheetProducts_(dirKey) {
  var cfg = dirCfg_(dirKey);
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(cfg.productsSheet);
  if (!sh || sh.getLastRow() < 2) return [];

  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  var out = [];

  rows.forEach(function (r) {
    var stop = String(r[0] || '').trim().toLowerCase() === 'стоп';
    var barcode = String(r[2] || '').trim();
    var price = parseFloat(String(r[3] || '').replace(',', '.'));
    var name = String(r[4] || '').trim();
    if (stop || !name || !barcode || !(price > 0)) return;

    var item = { id: barcode, barcode: barcode, name: name, price: price };

    if (dirKey === 'bakery') {
      item.category = String(r[1] || '').trim() || 'Інше';
      var av = String(r[5] || '').trim().toLowerCase();
      if (av) item.availability = av;   // "немає" / "мало" тощо
    } else {
      item.box = String(r[5] || '').trim();   // шт в ящику - підказка продавцю
    }
    out.push(item);
  });

  out.sort(function (a, b) {
    if (a.category && b.category && a.category !== b.category)
      return a.category.localeCompare(b.category, 'uk');
    return a.name.localeCompare(b.name, 'uk');
  });
  return out;
}

// Овочі: дозволені позиції з листа "Налаштування", ціни - із прайсу постачальника
function loadVegProducts_() {
  var cfg = dirCfg_('veg');
  var ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  var setSh = ss.getSheetByName('Налаштування');
  if (!setSh || setSh.getLastRow() < 2) throw new Error('Лист "Налаштування" порожній');

  var allowed = {}, order = [];
  setSh.getRange(2, 1, setSh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var name = String(r[0] || '').trim();
    if (!name) return;
    if (String(r[1] || '').trim().toLowerCase() === 'стоп') return;
    var k = nameKey_(name);
    if (allowed[k]) return;          // дублі в довіднику ігноруємо
    allowed[k] = name;
    order.push(k);
  });

  var prices = readVegPriceSheet_();
  var out = [];
  order.forEach(function (k) {
    if (prices[k] > 0) out.push({ id: allowed[k], name: allowed[k], price: prices[k] });
  });

  if (!out.length) throw new Error('Не знайдено жодної позиції в прайсі постачальника');
  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'uk'); });
  return out;
}

// Прайс постачальника: структура плаває, тому шукаємо пари "текст + число"
function readVegPriceSheet_() {
  var cfg = dirCfg_('veg');
  var sh = SpreadsheetApp.openById(cfg.priceSpreadsheetId).getSheets()[0];
  if (!sh || sh.getLastRow() < 1) return {};

  var data = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 2)).getValues();
  var found = {};

  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length - 1; c++) {
      var name = String(data[r][c] || '').trim();
      if (name.length < 3) continue;
      if (/^\d+([.,]\d+)?$/.test(name)) continue;      // це число, не назва
      var raw = data[r][c + 1];
      var num = (typeof raw === 'number') ? raw : parseFloat(String(raw || '').replace(',', '.'));
      if (!(num > 0) || num > 5000) continue;
      var k = nameKey_(name);
      if (!found[k]) found[k] = Math.round(num * 100) / 100;
    }
  }
  return found;
}

function nameKey_(s) {
  return String(s || '').toLowerCase()
    .replace(/[\u2019''`"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}