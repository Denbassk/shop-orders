// Правка і додавання точок у пульті (admCard_/admCardSave_ з app/AdminTools.gs + нова функція «Нова точка»).
// Джерело правди після переходу - таблиця stores. До переходу бойова система читає Довідник ТТ у Google, тому запис у бойові
// точки заблоковано (env.storeEdit = PULT_STORE_EDIT=on); тестові точки (id з "test") можна правити завжди - на них перевіряємо.
// env = { adm: { storeRow, allStores, updateStore, insertStore, maxStoreSort, adminLog }, storeEdit }
const R = require('../rules');
const { rowToStore } = require('../db');
const { STORE_NOT_FOUND } = require('./write');

const BREAD_EDRPOU = '44413718';
const DAYS_OK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const ZONES_OK = ['Салтовка', 'Новые дома', 'Центр', 'не возится'];
const BOOL = { active: 1, bread: 1, bakery: 1, veg: 1, nbhz: 1 };
// поле картки -> колонка stores
const COLS = { active: 'active', label: 'label', code: 'code', route: 'route', bread: 'bread', bakery: 'bakery', veg: 'veg', note: 'note',
  nbhz: 'nbhz', routeNbhz: 'route_nbhz', daysVeg: 'days_veg', daysBakery: 'days_bakery', zone: 'zone', edrpou: 'edrpou' };
const TITLES = { active: 'Активна', label: 'Назва', code: 'Обліковий номер', route: 'Маршрут', bread: 'Хліб Рома', bakery: 'Випічка',
  veg: 'Овочі', note: 'Примітка', nbhz: 'Хліб НБХЗ', routeNbhz: 'Маршрут НБХЗ', daysVeg: 'Дні овочів', daysBakery: 'Дні випічки',
  zone: 'Зона ВК', edrpou: 'ЄДРПОУ' };
const DIR_FLAGS = [['bread', 'Хліб Рома'], ['nbhz', 'Хліб НБХЗ'], ['bakery', 'Випічка'], ['veg', 'Овочі']];
const s = (v) => String(v == null ? '' : v).trim();
const normDays = (v) => { const t = s(v).split(/[\s,;]+/).filter(String); return DAYS_OK.filter((d) => t.includes(d)).join(', '); };
const fmt = (v) => (v === true ? 'так' : v === false ? 'ні' : (s(v) === '' ? 'пусто' : s(v)));

// поточні значення картки з рядка stores
function fieldsOf(r) {
  return { active: r.active === true, label: s(r.label), code: s(r.code), route: s(r.route),
    bread: r.bread === true, bakery: r.bakery === true, veg: r.veg === true, note: s(r.note),
    nbhz: r.nbhz === true, routeNbhz: s(r.route_nbhz), daysVeg: normDays(r.days_veg), daysBakery: normDays(r.days_bakery),
    zone: s(r.zone), edrpou: s(r.edrpou) };
}

function cardOf(r) {
  return { id: r.store_id, row: null, label: s(r.label), address: s(r.address),
    addr: { bread: s(r.addr_bread), bakery: s(r.addr_bakery), veg: s(r.addr_veg), nbhz: s(r.addr_nbhz) },
    f: fieldsOf(r), zones: ZONES_OK, defEdrpou: BREAD_EDRPOU };
}

// перевірка і нормалізація одного поля (тексти і порядок - як admCardSave_)
function clean(k, v) {
  if (BOOL[k]) return v === true;
  let t = s(v);
  if (k === 'label' && !t) throw new Error('Назва не може бути порожньою');
  if (k === 'code' && t && !/^\d+$/.test(t)) throw new Error('Обліковий номер - тільки цифри');
  if (k === 'edrpou' && t && !/^\d{8}$/.test(t)) throw new Error('ЄДРПОУ - 8 цифр або порожньо');
  if (k === 'zone' && t && !ZONES_OK.includes(t)) throw new Error('Невідома зона: ' + t);
  if (k === 'daysVeg' || k === 'daysBakery') {
    const parts = t ? t.split(/[\s,;]+/).filter(String) : [];
    parts.forEach((d) => { if (!DAYS_OK.includes(d)) throw new Error('Невідомий день: ' + d); });
    t = DAYS_OK.filter((d) => parts.includes(d)).join(', ');
    if (R.parseDays(t).length !== parts.length) throw new Error('Застосунок не розпізнає дні "' + t + '" - нічого не змінено');
  }
  return t;
}

function assertEditable(env, id) {
  if (env.storeEdit || /^test/i.test(String(id))) return;
  throw new Error('До переходу точки правте в Довіднику ТТ (Google): бойова система ще читає його. Редагування в пульті вмикається при переході.');
}

async function admCardSave(payload, env) {
  const id = s(payload.storeId), set = payload.set || {}, orig = payload.orig || {};
  assertEditable(env, id);
  const keys = Object.keys(set).filter((k) => COLS[k]);
  if (!keys.length) throw new Error('Змін немає');
  const val = {};
  keys.forEach((k) => { val[k] = clean(k, set[k]); });
  const row = await env.adm.storeRow(id);
  if (!row) throw new Error(STORE_NOT_FOUND);
  const cur = fieldsOf(row);
  keys.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(orig, k) && String(cur[k]) !== String(BOOL[k] ? orig[k] === true : (k.startsWith('days') ? normDays(orig[k]) : s(orig[k])))) {
      throw new Error('Поле «' + TITLES[k] + '» вже змінили (зараз: ' + fmt(cur[k]) + '). Оновіть картку.');
    }
  });
  const patch = {}, log = [];
  keys.forEach((k) => {
    if (String(cur[k]) === String(val[k])) return;
    patch[COLS[k]] = val[k];
    log.push(TITLES[k] + ': ' + fmt(cur[k]) + ' → ' + fmt(val[k]));
  });
  if (!log.length) return { changed: 0 };
  if (!(await env.adm.updateStore(id, patch))) throw new Error(STORE_NOT_FOUND);
  await env.adm.adminLog('Змінено картку точки', cur.label + ' (' + id + '): ' + log.join('; '));
  return { changed: log.length };
}

// нова точка: адреса обов'язкова, з неї будується id (як у Довіднику) і зіставлення з сирими листами
async function admCardAdd(payload, env) {
  const address = s(payload.address);
  if (!address) throw new Error('Адреса обов\'язкова');
  const id = R.canonKey(address);
  if (!id) throw new Error('Адреса має містити літери або цифри');
  assertEditable(env, id);
  const f = {};
  Object.keys(COLS).forEach((k) => { if (k !== 'active') f[k] = clean(k, k === 'label' ? (s(payload.label) || address) : payload[k]); });
  if (!DIR_FLAGS.some(([d]) => f[d])) throw new Error('Оберіть хоча б один напрямок');
  const addr = { bread: s(payload.addrBread) || address, bakery: s(payload.addrBakery) || address,
    veg: s(payload.addrVeg) || address, nbhz: s(payload.addrNbhz) || address };
  const existing = (await env.adm.allStores()).map((r) => ({ row: r, st: rowToStore(r) }));
  const same = existing.find((x) => x.row.store_id === id);
  if (same) throw new Error('Точка з такою адресою вже є: ' + s(same.row.label) + (same.row.active ? '' : ' (вимкнена - увімкніть її в картці)'));
  const cand = rowToStore({ store_id: id, label: f.label, address, code: f.code, route: f.route, type: 'Магазин', addr_bread: addr.bread, addr_bakery: addr.bakery,
    addr_veg: addr.veg, addr_nbhz: addr.nbhz, route_nbhz: f.routeNbhz, zone: f.zone, edrpou: f.edrpou, bread: f.bread, nbhz: f.nbhz, bakery: f.bakery, veg: f.veg,
    days_veg: f.daysVeg, days_bakery: f.daysBakery, note: f.note });
  DIR_FLAGS.forEach(([d, title]) => {
    if (!f[d]) return;
    const key = R.statusKey(d, cand);
    const clash = existing.find((x) => x.row.active && x.st.directions.includes(d) && R.statusKey(d, x.st) === key);
    if (clash) throw new Error('Адреса для напрямку «' + title + '» збігається з точкою «' + s(clash.row.label) + '» - змініть адресу цього напрямку');
  });
  const sort = ((await env.adm.maxStoreSort()) || 0) + 10;
  await env.adm.insertStore({ store_id: id, active: true, label: f.label, address, code: f.code, route: f.route, type: 'Магазин',
    addr_bread: addr.bread, addr_bakery: addr.bakery, addr_veg: addr.veg, addr_nbhz: addr.nbhz, route_nbhz: f.routeNbhz, zone: f.zone,
    edrpou: f.edrpou, bread: f.bread, nbhz: f.nbhz, bakery: f.bakery, veg: f.veg, days_veg: f.daysVeg, days_bakery: f.daysBakery, note: f.note, sort });
  await env.adm.adminLog('Додано точку', f.label + ' (' + id + '): ' + DIR_FLAGS.filter(([d]) => f[d]).map(([, t]) => t).join(', '));
  return { id, label: f.label };
}

module.exports = { admCardSave, admCardAdd, cardOf, fieldsOf, normDays, DAYS_OK, ZONES_OK };
