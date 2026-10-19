// Сторінка, що відкривається з листа закупниці (lateApprovePage_ з app/LateRequest.gs).
// Повертає { status, html }: 403 - підпис не збігся, 400 - інша причина відмови, 200 - дозволено.
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

// env = { at, data, late }
async function approvePage(query, env) {
  query = query || {};
  const dirKey = String(query.dir || query.ok || '');      // ok= - назва параметра в листах Apps Script
  const storeId = String(query.st || '');
  const day = String(query.d || '');
  const sig = String(query.s || '');
  const fail = (status, message) => ({ status, html: render(false, 'Не вийшло', esc(message)) });

  if (!storeId || !env.late.verify(dirKey, storeId, day, sig)) return fail(403, 'Посилання недійсне');
  if (day !== R.kyivNow(env.at).day)
    return fail(400, 'Посилання діє лише в день запиту. Попросіть продавця натиснути кнопку ще раз.');

  let cfg;
  try { cfg = R.dirCfg(dirKey, { directions: await env.data.directions() }); }
  catch (e) { return fail(400, e.message); }

  try { await env.data.approveLate(dirKey, storeId, day, env.at); }
  catch (e) { console.error('дозвіл не записано: ' + e.message); return fail(500, 'Не вдалося записати дозвіл. Спробуйте ще раз.'); }

  let label = storeId;
  try {
    const s = (await env.data.stores()).find((x) => x.id === storeId);
    if (s) label = s.label;
  } catch (e) { /* лишаємо id */ }

  return {
    status: 200,
    html: render(true, 'Дозволено на ' + R.LATE_TTL_MIN + ' хв',
      '<b>' + esc(cfg.title) + '</b><br>' + esc(label) +
      '<br><br>Продавець зможе відправити замовлення протягом хвилини.<br>' +
      'Через ' + R.LATE_TTL_MIN + ' хвилин прийом закриється знову.'),
  };
}

module.exports = { approvePage };
