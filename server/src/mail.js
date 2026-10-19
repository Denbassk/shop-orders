// Лист закупниці з кнопкою "ДОЗВОЛИТИ" (sendLateMail_ з app/LateRequest.gs) через Gmail SMTP (nodemailer).
const R = require('./rules');

// Кому слати листи. Кілька адрес - через кому.
const LATE_MAIL = {
  bread:  'svetlanalesakor@gmail.com',
  nbhz:   'svetlanalesakor@gmail.com',
  veg:    'svetlanalesakor@gmail.com',
  bakery: 'haikora1004@gmail.com',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildLateMail(cfg, store, { url, at, to }) {
  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:460px;' +
    'margin:0 auto;padding:22px 18px;color:#16181d">' +
    '<div style="font-size:13px;color:#6b7280">Замовлення після дедлайну</div>' +
    '<div style="font-size:22px;font-weight:800;margin:6px 0 2px">' + esc(store.label) + '</div>' +
    '<div style="font-size:16px;margin:8px 0 2px">' + esc(cfg.title) + '</div>' +
    '<div style="font-size:13px;color:#6b7280;margin-bottom:22px">запит о ' +
      R.kyivNow(at).time + ', дедлайн був ' + esc(cfg.deadline) + '</div>' +
    '<a href="' + url + '" style="display:block;text-align:center;background:#e11b22;color:#fff;' +
    'text-decoration:none;padding:17px;border-radius:13px;font-size:18px;font-weight:800">' +
    'ДОЗВОЛИТИ</a>' +
    '<div style="font-size:13px;color:#6b7280;margin-top:18px;line-height:1.5">' +
    'Дозвіл відкриє прийом на <b>' + R.LATE_TTL_MIN + ' хвилин</b> і лише для цієї точки ' +
    'та цього напрямку. Потім знову закриється.<br>' +
    'Нічого не робити - значить не дозволити.</div></div>';
  return { to: to !== undefined ? to : String(LATE_MAIL[cfg.key] || '').trim(), subject: 'Дозвіл: ' + cfg.title + ' - ' + store.label, html };
}

const isTestStore = (store) => String(store.id).startsWith('test-');

// transport - nodemailer-транспорт ({ sendMail }); user - адреса відправника.
// Тестові точки (store_id 'test-…') НІКОЛИ не пишуть закупницям: лист іде на testTo (або не йде зовсім).
function createMailer({ transport, user, testTo = '', lateMail = LATE_MAIL }) {
  // кому піде лист за цією парою ('' - нікому)
  const recipient = (cfg, store) =>
    String(isTestStore(store) ? testTo : lateMail[cfg.key] || '').trim();

  async function sendLateMail(cfg, store, { url, at }) {
    const test = isTestStore(store);
    const to = recipient(cfg, store);
    if (!to) return false;
    const m = buildLateMail(cfg, store, { url, at, to });
    await transport.sendMail({
      from: '"Замовлення Фемелі Маркет" <' + user + '>',
      to: m.to,
      subject: (test ? '[ТЕСТ] ' : '') + m.subject,
      html: m.html,
    });
    return true;
  }
  return { sendLateMail, recipient };
}

module.exports = { LATE_MAIL, esc, buildLateMail, createMailer };
