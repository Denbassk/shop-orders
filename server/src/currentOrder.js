// Зведення активних замовлень пари (точка + напрямок) за день: основне + добавки (старі, до відмови від добавок) разом.
// Потрібне для підстановки поточного замовлення при заміні, для листа закупниці і сторінки /ok.
const money = (n) => Math.round(n * 100) / 100;

// lines = [{ product_id, name, price (ціна постачальника), qty }]; total - з націнкою напрямку, як у відповіді продавцю
function summarize(cfg, lines) {
  if (!lines || !lines.length) return null;
  const sum = lines.reduce((s, l) => s + Number(l.price) * Number(l.qty), 0);
  return { positions: lines.length, total: cfg.hidePrice ? 0 : money(sum * (cfg.markup || 1)), hidePrice: !!cfg.hidePrice, lines };
}

// null, якщо замовлення нема або читання не вдалось: лист і сторінка /ok не повинні ламатись через це
async function currentOrderOf(env, cfg, storeId, day) {
  if (!env.data || typeof env.data.activeOrderLines !== 'function') return null;
  try { return summarize(cfg, await env.data.activeOrderLines(cfg.key, storeId, day)); }
  catch (e) { console.error('поточне замовлення не прочитано: ' + e.message); return null; }
}

// "2 поз., 400 грн" (без суми для напрямку без цін)
const currentText = (c) => c.positions + ' поз.' + (c.hidePrice || !c.total ? '' : ', ' + c.total + ' грн');

module.exports = { summarize, currentOrderOf, currentText };
