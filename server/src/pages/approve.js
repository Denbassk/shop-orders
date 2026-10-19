// Сторінка, що відкривається з листа закупниці (lateApprovePage_ з app/LateRequest.gs).
// GET /ok  -> approveForm: перевіряє підпис і ПОКАЗУЄ кнопку "Дозволити" (нічого не змінює: поштові сканери
//             відкривають посилання самі).
// POST /ok -> approvePage: та сама перевірка HMAC, видає дозвіл.
// Обидві повертають { status, html }: 403 - підпис не збігся, 400 - інша причина відмови, 200 - успіх.
const R = require('../rules');
const { esc } = require('../mail');

function render(okState, head, body) {
  return '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + head + '</title></head>' +
    '<body style="margin:0;background:#eceef1;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">' +
    '<div style="max-width:420px;margin:0 auto;padding:56px 22px;text-align:center;color:#16181d">' +
    '<div style="width:82px;height:82px;border-radius:50%;line-height:82px;font-size:44px;color:#fff;' +
    'margin:0 auto;background:' + (okState ? '#2e7d32' : '#b3261e') + '">' +
    (okState ? '&#10003;' : '!') + '</div>' +
    '<h2 style="margin:18px 0 10px;font-size:24px">' + head + '</h2>' +
    '<p style="color:#5d626b;font-size:16px;line-height:1.5">' + body + '</p>' +
    '</div></body></html>';
}

function parseQuery(query) {
  query = query || {};
  return {
    dirKey: String(query.dir || query.ok || ''),      // ok= - назва параметра в листах Apps Script
    storeId: String(query.st || ''),
    day: String(query.d || ''),
    sig: String(query.s || ''),
  };
}

// Спільна перевірка: підпис -> день -> напрямок. Повертає { fail } або { cfg, ... }.
async function check(query, env) {
  const q = parseQuery(query);
  const fail = (status, message) => ({ fail: { status, html: render(false, 'Не вийшло', esc(message)) } });
  if (!q.storeId || !env.late.verify(q.dirKey, q.storeId, q.day, q.sig)) return fail(403, 'Посилання недійсне');
  if (q.day !== R.kyivNow(env.at).day)
    return fail(400, 'Посилання діє лише в день запиту. Попросіть продавця натиснути кнопку ще раз.');
  let cfg;
  try { cfg = R.dirCfg(q.dirKey, { directions: await env.data.directions() }); }
  catch (e) { return fail(400, e.message); }
  let store;
  try { store = (await env.data.stores()).find((x) => x.id === q.storeId); }
  catch (e) {
    console.error('/ok: точки не прочитано: ' + e.message);
    return fail(500, 'Не вдалося перевірити точку. Спробуйте ще раз.');
  }
  if (!store) return fail(400, 'Точку не знайдено. Попросіть продавця натиснути кнопку ще раз.');   // підпис вірний, але дозвіл нікому
  return { q, cfg, label: store.label };
}

// GET: форма з кнопкою. Дані запиту й підпис - у прихованих полях.
async function approveForm(query, env) {
  const c = await check(query, env);
  if (c.fail) return c.fail;
  const hidden = [['dir', c.q.dirKey], ['st', c.q.storeId], ['d', c.q.day], ['s', c.q.sig]]
    .map(([k, v]) => '<input type="hidden" name="' + k + '" value="' + esc(v) + '">').join('');
  const html = render(true, 'Дозволити замовлення?',
    '<b>' + esc(c.cfg.title) + '</b><br>' + esc(c.label) +
    '<div style="margin:26px 0 0"><form method="post" action="/ok">' + hidden +
    '<button type="submit" style="width:100%;background:#e11b22;color:#fff;border:0;padding:17px;border-radius:13px;' +
    'font-size:18px;font-weight:800;cursor:pointer">Дозволити</button></form></div>' +
    '<br>Дозвіл відкриє прийом на ' + R.LATE_TTL_MIN + ' хвилин. Нічого не натискати - значить не дозволити.');
  return { status: 200, html };
}

// POST: видає дозвіл. env = { at, data, late }
async function approvePage(query, env) {
  const c = await check(query, env);
  if (c.fail) return c.fail;
  const { dirKey, storeId, day } = c.q;

  try { await env.data.approveLate(dirKey, storeId, day, env.at); }
  catch (e) { console.error('дозвіл не записано: ' + e.message); return { status: 500, html: render(false, 'Не вийшло', 'Не вдалося записати дозвіл. Спробуйте ще раз.') }; }

  return {
    status: 200,
    html: render(true, 'Дозволено на ' + R.LATE_TTL_MIN + ' хв',
      '<b>' + esc(c.cfg.title) + '</b><br>' + esc(c.label) +
      '<br><br>Продавець зможе відправити замовлення протягом хвилини.<br>' +
      'Через ' + R.LATE_TTL_MIN + ' хвилин прийом закриється знову.'),
  };
}

module.exports = { approvePage, approveForm };
