// Збирає бойове оточення /api: Supabase, прайс овочей з Google, пошта, підпис дозволів. Створюється один раз на процес.
const { loadEnv } = require('./env');
const { supabase } = require('./db');
const { createData } = require('./data');
const { createAdminData } = require('./admin/data');
const { createVegPrices } = require('./vegPrices');
const { createLate } = require('./late');
const { createMailer } = require('./mail');
const { approvePage, approveForm } = require('./pages/approve');
const { createExportQueue } = require('./export/queue');
const { exportDir, exportAll } = require('./export/raw');
const { resolveTarget, exportTargetMode } = require('./export/target');
const { rebuildReports: rebuildDir, rebuildAllReports, exportThenReports } = require('./reports/rebuild');
const { tick } = require('./jobs');
const { noteError } = require('./admin/tools');
const { errorText, collectTickErrors } = require('./errors');
const { exportWriteoffs } = require('./export/writeoff');
const googleApi = require('./google');
const { getValues, firstSheetTitle, a1q } = googleApi;
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
    : { sendLateMail: async () => false, recipient: () => '' };   // пошта не налаштована: запит записується, листа нема (mailed:false)

  // фонові завдання (лист про дозвіл): помилки вже оброблені в задачі, тут лише щоб не було unhandled rejection
  const defer = (p) => { Promise.resolve(p).catch(() => {}); };

  // Вигрузка в сирі листи. EXPORT_TARGET: 'test' (за замовчуванням) або 'live'.
  // EXPORT_GOOGLE_OFF=1 - перевірочна підміна: Google «лежить» (замовлення лишаються невигруженими до наступного tick).
  const target = resolveTarget(exportTargetMode());
  console.log('вигрузка в сирі листи: ' + target.mode);
  const googleForExport = {
    ...googleApi,
    ...Object.fromEntries(['getValues', 'appendValues', 'batchUpdate', 'sheetIdOf', 'sheetMeta', 'sheetList', 'sheetDims', 'copySheetTo'].map((m) => [m, (...a) => {
      if (process.env.EXPORT_GOOGLE_OFF) return Promise.reject(new Error('Google вимкнено (EXPORT_GOOGLE_OFF)'));
      return googleApi[m](...a);
    }])),
  };
  const exportEnv = () => ({ data, google: googleForExport, target, at: new Date() });
  // Звіти напрямків (ВК, хліб, овочі, вигрузка НБХЗ) збираються з бази в ту саму ціль, що й вигрузка. Після вигрузки напрямку -
  // перебудова його звітів з дебаунсом 30 с (не на кожне замовлення: перше замовлення відкриває вікно, усі наступні в ньому
  // входять в одну перебудову); у tick - усі напрямки (змінене - пишеться, без змін - пропуск).
  // NBHZ_ARCHIVE_SPREADSHEET_ID - таблиця-архів вигрузок НБХЗ (її створює власник: сервісний акаунт файлів не створює).
  const adm = createAdminData(supabase());
  const reportEnv = () => ({ data, google: googleForExport, target, at: new Date(), markReport: (dir, at) => adm.setReportAt(dir, at.toISOString()), archive: { spreadsheetId: process.env.NBHZ_ARCHIVE_SPREADSHEET_ID || '' } });
  const rebuildReports = () => rebuildAllReports(reportEnv());
  // «Сервісне меню»: помилки фонових задач йдуть у екран «Здоров'я» пульта (settings.health_err), не лише в лог
  const noteErr = (where) => (dir, e) => noteError(adm, where + (dir ? ' ' + dir : ''), errorText(e));
  const queueReports = createExportQueue({ run: (dir) => rebuildDir(dir, reportEnv()), delayMs: Number(process.env.REPORTS_DEBOUNCE_MS) || 30000, onError: noteErr('звіт') });
  const queueExport = createExportQueue({ run: exportThenReports((dir) => exportDir(dir, exportEnv()), queueReports), onError: noteErr('вигрузка') });
  // Вигрузка списань у лист «Списания» (export/writeoff.js): одна черга 'wo', 2 с як у замовлень; недовигружене підхопить tick.
  const woExport = () => exportWriteoffs(exportEnv());
  const queueWoExport = createExportQueue({ run: woExport, onError: noteErr('списання') });

  const getEnv = () => ({ at: new Date(), data, veg, late, mailer, queueExport, queueWoExport, defer });
  const tickJob = async () => {
    const res = await tick({ ...getEnv(), ...exportEnv(), rebuildReports, exportWriteoffs: woExport }, exportAll);
    for (const x of collectTickErrors(res)) await noteError(adm, 'tick: ' + x.where, x.msg);
    return res;
  };
  return { getEnv, tick: tickJob, approve: (query) => approvePage(query, getEnv()), approveForm: (query) => approveForm(query, getEnv()) };
}

module.exports = { createRuntime };
