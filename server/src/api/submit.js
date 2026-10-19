// Прийом замовлення і запит дозволу. Перенос apiSubmitOrder_ (app/Orders.gs) і apiRequestLate_ (app/LateRequest.gs).
// Порядок перевірок і тексти - дослівно. Запис - одна транзакція submit_order_tx (supabase/migrations/…_orders_tx.sql).
//
// env = { at, data, veg, late, mailer, queueExport? }; data додатково до read.js:
//   orderResult(orderId) -> збережена відповідь | null | hasOrderToday(dir, storeId, day) -> bool
//   submitOrderTx(p) -> jsonb | requestLate(dir, storeId, day, at)
const R = require('../rules');
const { randomUUID } = require('node:crypto');
const { queueExport: defaultQueueExport } = require('../export/queue');
const { sendAndMark } = require('../lateMail');

const money = (n) => Math.round(n * 100) / 100;

function alreadyText(cfg) {
  return 'Замовлення на "' + cfg.title + '" для цієї ТТ вже сьогодні відправлено.' +
    (cfg.lateRequest ? ' Для добавки натисніть "Попросити дозвіл".' : '');
}

async function loadCommon(env, dirKey, storeId) {
  const d = env.data;
  const [stores, settings, directions] = await Promise.all([d.stores(), d.settings(), d.directions()]);
  const ctx = { at: env.at, settings, directions, lateRows: [] };
  const cfg = R.dirCfg(dirKey, ctx);
  const store = stores.find((s) => s.id === String(storeId));
  if (!store) throw new Error('Торгову точку не знайдено. Оновіть сторінку.');
  return { settings, ctx, cfg, store };
}

async function apiSubmitOrder(payload, env) {
  payload = payload || {};
  const dirKey = String(payload.dir || '');
  const { settings, ctx, cfg, store } = await loadCommon(env, dirKey, payload.storeId);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const orderId = String(payload.orderId || '').slice(0, 60);
  const now = R.kyivNow(env.at);

  // повтор того самого замовлення (обрив зв'язку): збережена відповідь, ще до будь-яких перевірок
  if (orderId) {
    const prev = await env.data.orderResult(orderId);
    if (prev) return { ...prev, duplicate: true };
  }

  // вимкнений напрямок не приймає нових замовлень, навіть зі старого екрана
  if (!R.dirEnabled(dirKey, settings)) throw new Error('Напрямок "' + cfg.title + '" зараз вимкнено.');

  if (store.directions.indexOf(dirKey) < 0)
    throw new Error('Для цієї ТТ напрямок "' + cfg.title + '" не передбачений');

  const pairCtx = { ...ctx, lateRows: await env.data.lateRows(dirKey, store.id) };
  if (!R.dayAllowed(dirKey, store, pairCtx)) throw new Error(R.dayOffText(dirKey, store, pairCtx));

  // Дозвіл закупниці = зміни. Знімає ТРИ замки: дедлайн, повторне замовлення на сьогодні і мінімальну суму.
  const approvedNow = !!cfg.lateRequest && R.lateStatus(dirKey, store.id, pairCtx) === 'approved';

  // 'replace' - замовлення переписується з нуля: старі рядки за сьогодні скасовуються
  const replaceAll = approvedNow && String(payload.mode || '') === 'replace';

  if (R.deadlinePassed(dirKey, store.id, pairCtx)) {
    throw new Error(cfg.lateRequest
      ? 'Прийом на "' + cfg.title + '" закрито (до ' + cfg.deadline +
        '). Натисніть "Попросити дозвіл" або зателефонуйте закупниці.'
      : 'Прийом замовлень на "' + cfg.title + '" на сьогодні закрито (до ' + cfg.deadline +
        '). Замовлення можна передати телефоном закупниці.');
  }

  if (!items.length) throw new Error('Замовлення порожнє');
  if (items.length > 500) throw new Error('Занадто багато позицій');

  // Ціни беремо ЛИШЕ з сервера (активні позиції; овочі - з актуальним прайсом)
  let rows = (await env.data.products(dirKey)).filter((p) => p.status === 'active');
  if (dirKey === 'veg') rows = await env.veg.resolve(rows);
  const priceMap = {};
  rows.forEach((p) => { priceMap[String(p.id)] = p; });

  const lines = [];
  let totalSupplier = 0;
  items.forEach((it) => {
    if (!it || typeof it !== 'object') return;
    const p = priceMap[String(it.id)];
    if (!p) return;
    const qty = Math.round(parseFloat(it.qty) * 1000) / 1000;
    if (!(qty > 0)) return;
    if (qty > 5000) throw new Error('Завелика кількість для "' + p.name + '"');
    const price = Number(p.price);
    lines.push({ product_id: String(p.id), barcode: p.barcode || '', name: p.name, price, qty });
    totalSupplier += price * qty;
  });

  if (!lines.length) throw new Error('Не розпізнано жодної позиції');

  const minSupplier = approvedNow ? 0 : R.minOrderOf(cfg, env.at);
  if (minSupplier > 0 && totalSupplier < minSupplier - 0.01) {
    throw new Error('Мінімальне замовлення ' + money(minSupplier * cfg.markup) + ' грн. Зараз ' +
      money(totalSupplier * cfg.markup) + ' грн');
  }

  if (!approvedNow && await env.data.hasOrderToday(dirKey, store.id, now.day)) throw new Error(alreadyText(cfg));

  const totalShown = money(totalSupplier * cfg.markup);
  const result = {
    ok: true, positions: lines.length, total: totalShown,
    time: now.time, date: now.dmy,
    direction: cfg.title, store: store.label, test: !!settings.test_mode,
    replaced: replaceAll,
  };

  const res = await env.data.submitOrderTx({
    order_id: orderId || ('srv-' + randomUUID()),
    dir: dirKey, store_id: store.id, order_date: now.day,
    mode: replaceAll ? 'replace' : 'new', approved: approvedNow,
    total: totalShown, result, lines,
  });

  if (!res.ok) {
    if (res.reason === 'already') throw new Error(alreadyText(cfg));
    throw new Error('Не вдалося записати замовлення');
  }
  if (res.duplicate) return { ...res.result, duplicate: true };

  (env.queueExport || defaultQueueExport)(dirKey);
  return res.result;
}

// Запит дозволу після дедлайну: запис у late_requests + лист закупниці.
async function apiRequestLate(payload, env) {
  payload = payload || {};
  const dirKey = String(payload.dir || '');
  const { ctx, cfg, store } = await loadCommon(env, dirKey, payload.storeId);
  const pairCtx = { ...ctx, lateRows: await env.data.lateRows(dirKey, store.id) };

  if (R.lateStatus(dirKey, store.id, pairCtx) === 'approved')
    return { status: 'approved', mailed: true, leftMin: R.lateLeftMin(dirKey, store.id, pairCtx) };

  const day = R.kyivNow(env.at).day;
  await env.data.requestLate(dirKey, store.id, day, env.at);

  // Відповідь продавцю - одразу після запису; лист - у фоні. Помилку SMTP логуємо, mailed_at не ставимо:
  // /jobs/tick довідправить (jobs.resendLateMails). mailed:false лише коли листа не буде взагалі (немає адресата/пошти).
  const mailed = !!env.mailer.recipient(cfg, store);
  if (mailed) {
    const task = sendAndMark(env, cfg, store, day, env.at)
      .catch((e) => console.error('Лист про дозвіл не надіслано (довідправить tick): ' + e.message));
    (env.defer || ((p) => p))(task);
  }

  console.log('Запит дозволу: ' + cfg.title + ' / ' + store.label +
    (mailed ? ' - лист іде у фоні' : ' - БЕЗ листа (не налаштована пошта)'));
  return { status: 'pending', mailed, leftMin: 0 };
}

module.exports = { apiSubmitOrder, apiRequestLate };
