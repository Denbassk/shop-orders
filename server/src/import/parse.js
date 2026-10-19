// Чисті правила розбору таблиць Google -> об'єкти для бази. Без мережі і без бази.
// Перенос з app/Registry.gs (loadStores_), app/Products.gs, app/VegDays.gs (parseDays_).

const { canonKey, parseDays } = require('../rules');

const UK = 'uk';
const cmp = (a, b) => String(a).localeCompare(String(b), UK);

function nameKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[’'`"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const str = (v) => String(v == null ? '' : v).trim();

// rows: Довідник, діапазон A2:T, значення UNFORMATTED (галочки = true/false).
// Повертає об'єкти рівно в формі loadStores_().
function parseStores(rows, dropped = []) {
  return rows
    .filter((r, i) => {
      if (!r.some((c) => str(c))) return false;                       // порожній рядок - не звітуємо
      const name = str(r[1]) || str(r[2]);
      if (r[0] !== true) { dropped.push({ dir: 'ТТ', row: i + 2, reason: 'неактивна', name }); return false; }
      if (!str(r[2])) { dropped.push({ dir: 'ТТ', row: i + 2, reason: 'немає адреси', name }); return false; }
      return true;
    })
    .map((r) => {
      const addr = str(r[2]);
      return {
        id: canonKey(addr),
        label: str(r[1]) || addr,
        address: addr,
        code: str(r[3]),
        route: str(r[4]),
        type: str(r[5] || 'Магазин'),
        addrBread: str(r[10]) || addr,
        addrBakery: str(r[11]) || addr,
        addrVeg: str(r[12]) || addr,
        addrNbhz: str(r[15]) || addr,
        routeNbhz: str(r[14]),
        zone: str(r[18]),
        edrpou: str(r[19]),
        days: { veg: parseDays(r[16]), bakery: parseDays(r[17]) },
        // сирий текст з Довідника ("Пн, Ср") і примітка (колонка J) - у базу йдуть як є
        daysText: { veg: str(r[16]), bakery: str(r[17]) },
        note: str(r[9]),
        directions: [r[6] === true && 'bread', r[13] === true && 'nbhz',
                     r[7] === true && 'bakery', r[8] === true && 'veg'].filter(Boolean),
      };
    })
    .filter((s) => {
      if (!s.directions.length) dropped.push({ dir: 'ТТ', row: null, reason: 'немає жодного напрямку', name: s.label });
      return s.directions.length;
    })
    .sort((a, b) => cmp(a.label, b.label));
}

function storeToRow(s, sort) {
  return {
    store_id: s.id, active: true, label: s.label, address: s.address, code: s.code,
    route: s.route, type: s.type, addr_bread: s.addrBread, addr_bakery: s.addrBakery,
    addr_veg: s.addrVeg, addr_nbhz: s.addrNbhz, route_nbhz: s.routeNbhz, zone: s.zone,
    edrpou: s.edrpou,
    bread: s.directions.includes('bread'), nbhz: s.directions.includes('nbhz'),
    bakery: s.directions.includes('bakery'), veg: s.directions.includes('veg'),
    days_veg: s.daysText.veg, days_bakery: s.daysText.bakery, note: s.note, sort,
  };
}

const STOP_OFFSET = 1000;   // стоп-позиції йдуть після активних

function product(o) {
  return {
    id: o.id, barcode: o.barcode || '', name: o.name, price: o.price || 0,
    category: o.category == null ? null : o.category,
    availability: o.availability == null ? null : o.availability,
    box: o.box == null ? null : o.box,
    status: o.status, sort: 0,
  };
}

// Лист "Ассортимент": A статус | B № (випічка - категорія) | C штрихкод | D ціна | E номенклатура | F шт в ящику
// (випічка - наявність). Правила loadSheetProducts_; відрізняється тим, що «стоп» не відкидається,
// а потрапляє в базу зі status='stop'. Невалідні (без назви; без штрихкоду/ціни) пропускаються, як і в Apps Script.
function parseSheetProducts(dirKey, cfg, rows, dropped = []) {
  const act = [], stop = [];
  rows.forEach((r, i) => {
    const isStop = str(r[0]).toLowerCase() === 'стоп';
    const barcode = str(r[2]);
    let price = parseFloat(String(r[3] == null ? '' : r[3]).replace(',', '.'));
    if (!(price > 0)) price = 0;
    const name = str(r[4]);
    const drop = (reason) => dropped.push({ dir: dirKey, row: i + 2, reason, name: name || '(без назви)' });
    if (!name) { if (r.some((c) => str(c))) drop('немає назви'); return; }
    if (!isStop && !cfg.allowNoPrice && !barcode) return drop('немає штрихкоду');
    if (!isStop && !cfg.allowNoPrice && !(price > 0)) return drop('немає ціни');

    const item = { id: barcode || nameKey(name), barcode, name, price, status: isStop ? 'stop' : 'active' };
    if (dirKey === 'bakery') {
      item.category = str(r[1]) || 'Інше';
      const av = str(r[5]).toLowerCase();
      if (av) item.availability = av;
    } else {
      item.box = str(r[5]);
    }
    (isStop ? stop : act).push(product(item));
  });

  // keepOrder: порядок рядків у таблиці = порядок колонок у формі заводу
  if (!cfg.keepOrder) {
    act.sort((a, b) => {
      if (a.category && b.category && a.category !== b.category) return cmp(a.category, b.category);
      return cmp(a.name, b.name);
    });
  }
  return numbered(act, stop);
}

// НБХЗ: A Статус | B № | C Номенклатура. Без цін і штрихкодів, порядок рядків збережено.
function parseNbhzProducts(rows, dropped = []) {
  const act = [], stop = [];
  rows.forEach((r, i) => {
    const name = str(r[2]);
    if (!name) {
      if (r.some((c) => str(c))) dropped.push({ dir: 'nbhz', row: i + 2, reason: 'немає назви', name: '(без назви)' });
      return;
    }
    const isStop = str(r[0]).toLowerCase() === 'стоп';
    (isStop ? stop : act).push(product({ id: nameKey(name), name, status: isStop ? 'stop' : 'active' }));
  });
  return numbered(act, stop);
}

// Прайс постачальника: будь-яка пара "назва | число" у таблиці (readVegPriceSheet_).
function readVegPrices(data) {
  const found = {};
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length - 1; c++) {
      const name = str(data[r][c]);
      if (name.length < 3) continue;
      if (/^\d+([.,]\d+)?$/.test(name)) continue;
      const raw = data[r][c + 1];
      const num = (typeof raw === 'number') ? raw : parseFloat(String(raw == null ? '' : raw).replace(',', '.'));
      if (!(num > 0) || num > 5000) continue;
      const k = nameKey(name);
      if (!found[k]) found[k] = Math.round(num * 100) / 100;
    }
  }
  return found;
}

// Овочі (loadVegProducts_): дозволені позиції з листа "Налаштування" (A назва | B 'стоп'),
// ціни - з прайсу. Позиції без ціни в прайсі пропускаються, як в Apps Script.
function parseVegProducts(settingsRows, prices, dropped = []) {
  const seen = {}, order = [];
  settingsRows.forEach((r, i) => {
    const name = str(r[0]);
    if (!name) return;
    const k = nameKey(name);
    if (seen[k]) { dropped.push({ dir: 'veg', row: i + 2, reason: 'дубль у "Налаштування"', name }); return; }
    seen[k] = { name, stop: str(r[1]).toLowerCase() === 'стоп' };
    order.push(k);
  });
  const act = [], stop = [];
  order.forEach((k) => {
    const { name, stop: isStop } = seen[k];
    if (!(prices[k] > 0)) { dropped.push({ dir: 'veg', row: null, reason: 'немає ціни в прайсі', name }); return; }
    (isStop ? stop : act).push(product({ id: name, name, price: prices[k], status: isStop ? 'stop' : 'active' }));
  });
  act.sort((a, b) => cmp(a.name, b.name));
  stop.sort((a, b) => cmp(a.name, b.name));
  return numbered(act, stop);
}

function numbered(act, stop) {
  act.forEach((p, i) => { p.sort = i; });
  stop.forEach((p, i) => { p.sort = STOP_OFFSET + i; });
  return act.concat(stop);
}

module.exports = {
  canonKey, parseDays, nameKey, parseStores, storeToRow,
  parseSheetProducts, parseNbhzProducts, readVegPrices, parseVegProducts,
};
