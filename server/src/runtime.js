// Збирає бойове оточення /api: Supabase, прайс овочей з Google, пошта, підпис дозволів. Створюється один раз на процес.
const { loadEnv } = require('./env');
const { supabase } = require('./db');
const { createData } = require('./data');
const { createVegPrices } = require('./vegPrices');
const { createLate } = require('./late');
const { createMailer } = require('./mail');
const { approvePage } = require('./pages/approve');
const { queueExport } = require('./export/queue');
const { getValues, firstSheetTitle, a1q } = require('./google');
const { DIRECTIONS } = require('./directions');

function createMailTransport(user, pass) {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
}

function createRuntime() {
  loadEnv();
  const data = createData(supabase());
  const priceId = DIRECTIONS.veg.priceSpreadsheetId;
  let title = null;                                   // назва першого листа дзеркала - не змінюється
  const veg = createVegPrices({
    readPriceSheet: async () => {
      if (!title) title = await firstSheetTitle(priceId);
      return getValues(priceId, a1q(title, 'A1:Z'));
    },
    savePrices: data.saveVegPrices,
  });

  const late = createLate({ secret: process.env.LATE_SECRET, baseUrl: process.env.PUBLIC_URL || 'https://shop-orders.fly.dev' });

  const { SMTP_USER, SMTP_PASS } = process.env;
  const mailer = SMTP_USER && SMTP_PASS
    ? createMailer({ transport: createMailTransport(SMTP_USER, SMTP_PASS), user: SMTP_USER, testTo: process.env.LATE_MAIL_TEST || SMTP_USER })
    : { sendLateMail: async () => false };            // пошта не налаштована: запит записується, листа нема (mailed:false)

  const getEnv = () => ({ at: new Date(), data, veg, late, mailer, queueExport });
  return { getEnv, approve: (query) => approvePage(query, getEnv()) };
}

module.exports = { createRuntime };
