// Пульт: нові позиції для «Овочі і фрукти» - те, що є в прайсі постачальника, але ще не в асортименті (products).
// vegPrices.js (ціни на льоту для продавців) лише ОНОВЛЮЄ ціни вже існуючих позицій - нових туди не додає,
// тож нова позиція в прайсі постачальника сама собою в пульт не потрапляє (саме так загубився «Мандарин»,
// коли його додали в прайс/«Налаштування», а products у базі не оновили).
// Тут - ручна перевірка в пульті: перегляд (свіжий запит до прайсу через env.vegPriceRows) і додавання вибраних,
// завжди зі статусом "стоп" - активними їх робить власник сам (як і решту асортименту), окремою дією.
const { nameKey } = require('../import/parse');
const { cfgOf, logSafe } = require('./write');

const DIR = 'veg';
const MAX_ROWS = 200;
const LOG_ITEMS = 8;
const LOG_MAX = 900;
const NOT_FOUND = 'Позиції «%s» вже немає серед нових у прайсі. Оновіть екран.';

// products: dirProducts(veg); priceRows: [{name, price}] (readVegPriceRows) - те, чого ще нема в products (за nameKey), за абеткою
function planNew(products, priceRows) {
  const known = new Set(products.map((p) => nameKey(p.name)));
  return priceRows.filter((r) => !known.has(nameKey(r.name))).sort((a, b) => a.name.localeCompare(b.name, 'uk'));
}

async function admVegNewPreview(payload, env) {
  const products = await env.adm.dirProducts(DIR);
  const rows = planNew(products, await env.vegPriceRows());
  return { dir: DIR, rows, n: rows.length };
}

// payload: { names: [...] } - назви, відмічені в перегляді
async function admVegNewApply(payload, env) {
  payload = payload || {};
  const names = Array.isArray(payload.names) ? payload.names.map(String) : [];
  if (!names.length) throw new Error('Оберіть позиції');
  if (names.length > MAX_ROWS) throw new Error('Позицій не більше ' + MAX_ROWS + ' за раз');
  if (new Set(names.map(nameKey)).size !== names.length) throw new Error('Позиція вказана двічі');

  const products = await env.adm.dirProducts(DIR);
  const fresh = new Map(planNew(products, await env.vegPriceRows()).map((r) => [nameKey(r.name), r]));
  const maxSort = products.filter((x) => Number(x.sort) < 1000).reduce((m, x) => Math.max(m, Number(x.sort) || 0), 0);
  const todo = names.map((name) => {
    const r = fresh.get(nameKey(name));
    if (!r) throw new Error(NOT_FOUND.replace('%s', name));
    return r;
  });

  const cfg = cfgOf(DIR);
  const done = [];
  let failed = null;
  try {
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      const row = { dir: DIR, id: r.name, name: r.name, price: r.price, status: 'stop', sort: maxSort + 1 + i };
      try { await env.adm.addProduct(row); } catch (e) { failed = r; throw e; }
      done.push(row);
    }
  } finally {
    if (done.length) {
      const names8 = done.slice(0, LOG_ITEMS).map((r) => r.name).join('; ') + (done.length > LOG_ITEMS ? '; …ще ' + (done.length - LOG_ITEMS) : '');
      const head = cfg.title + ': з прайсу (стоп) - ' + done.length + ' поз.' + (failed ? ' (збій на «' + failed.name + '», решту не додано)' : '');
      await logSafe(env, 'Додано в асортимент', (head + ': ' + names8).slice(0, LOG_MAX));
    }
  }
  return { added: done.length, products: done.map((r) => ({ id: r.id, name: r.name, price: r.price })) };
}

module.exports = { admVegNewPreview, admVegNewApply, planNew };
