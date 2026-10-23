// Express-сервер shop-orders: /health, POST /api (дії продавця), GET /ok (кнопка "Дозволити" з листа).
const express = require('express');
const cookieParser = require('cookie-parser');
const { ADMIN_TOKEN_TTL } = require('./admin/auth');

// opts.api - (action, payload) => Promise<конверт>; opts.approve - (query) => Promise<{status, html}>.
// За замовчуванням бойові, створюються при першому запиті.
function createApp(opts = {}) {
  const app = express();
  app.disable('x-powered-by');

  let rt = null;
  const runtime = () => {
    if (!rt) rt = require('./runtime').createRuntime();
    return rt;
  };
  let api = opts.api;
  const getApi = () => {
    if (!api) api = require('./api').createApi(runtime().getEnv);
    return api;
  };
  const approve = opts.approve || ((query) => runtime().approve(query));
  const approveForm = opts.approveForm || ((query) => runtime().approveForm(query));

  // POST /jobs/tick (x-jobs-secret): вигрузка всіх напрямків + довідправка листів про дозвіл. Викликає cron у GitHub Actions.
  const tick = opts.tick || (() => runtime().tick());
  app.post('/jobs/tick', async (req, res, next) => {
    try {
      const secret = opts.jobsSecret !== undefined ? opts.jobsSecret : process.env.JOBS_SECRET;
      if (!secret) return res.status(503).json({ ok: false, error: 'JOBS_SECRET не задано' });
      const got = String(req.get('x-jobs-secret') || '');
      const a = Buffer.from(got), b = Buffer.from(secret);
      if (a.length !== b.length || !require('node:crypto').timingSafeEqual(a, b)) return res.status(403).json({ ok: false, error: 'Forbidden' });
      res.json({ ok: true, ...(await tick()) });
    } catch (e) { next(e); }
  });

  app.get('/health', (req, res) => {
    res.json({ ok: true, region: process.env.FLY_REGION || null, time: new Date().toISOString() });
  });

  // Застосунок шле JSON з Content-Type: text/plain (як до Apps Script); розбираємо самі, як doPost:
  // не JSON -> порожнє тіло -> "Невідома дія: undefined"
  app.post('/api', express.text({ type: () => true, limit: '1mb' }), async (req, res) => {
    let body = {};
    try { body = JSON.parse(req.body) || {}; } catch (e) { body = {}; }
    res.json(await getApi()(body.action, body.payload));
  });

  // GET лише показує форму з кнопкою; дозвіл видає POST (поштові сканери відкривають лише GET)
  const sendPage = (res, { status, html }) =>
    res.status(status).set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).type('html').send(html);

  app.get('/ok', async (req, res, next) => {
    try { sendPage(res, await approveForm(req.query)); } catch (e) { next(e); }
  });

  app.post('/ok', express.urlencoded({ extended: false, limit: '8kb' }), async (req, res, next) => {
    try { sendPage(res, await approve(req.body)); } catch (e) { next(e); }
  });

  // Сайт продавця (зібраний з app/ui скриптом scripts/build-front.js)
  app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(require('path').join(__dirname, '..', 'public', 'index.html'));
  });

  // Сторінка пульта (зібрана з app/ui скриптом scripts/build-admin.js)
  app.get(['/admin', '/admin/'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(require('path').join(__dirname, '..', 'public', 'admin', 'index.html'));
  });

  // Пульт: POST /admin/api { action, payload } -> { ok, data, ms } (adminApi з app/Admin.gs). Вхід - action 'login' { pin };
  // сесія - підписаний JWT у cookie adm (HttpOnly, Secure, SameSite=Strict, 12 год). Лише application/json (захист від чужих форм).
  let adminRt = null;
  const getAdminRt = () => adminRt || (adminRt = require('./admin/runtime').createAdminRuntime({ queueExport: (d) => runtime().getEnv().queueExport(d), queueWoExport: (k) => runtime().getEnv().queueWoExport(k) }));
  const adminAuth = () => opts.adminAuth || getAdminRt().auth;
  const adminApi = () => opts.adminApi || getAdminRt().api;
  const ADM_COOKIE = 'adm';
  const admCookie = { httpOnly: true, secure: true, sameSite: 'strict', path: '/admin' };
  app.post('/admin/api', cookieParser(), express.json({ limit: '1mb' }), async (req, res, next) => {
    try {
      if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Unsupported Media Type' });
      const t0 = Date.now();
      const { action, payload } = req.body || {};
      if (action === 'login') {
        let token;
        try { token = await adminAuth().login('admin', payload && payload.pin); }
        catch (e) { return res.json({ ok: false, error: e.message, ms: Date.now() - t0 }); }
        res.cookie(ADM_COOKIE, token, { ...admCookie, maxAge: ADMIN_TOKEN_TTL });
        return res.json({ ok: true, data: {}, ms: Date.now() - t0 });
      }
      try { adminAuth().check(req.cookies && req.cookies[ADM_COOKIE], 'admin'); }
      catch (e) { return res.json({ ok: false, error: 'AUTH', ms: Date.now() - t0 }); }
      res.json(await adminApi()(action, payload));
    } catch (e) { next(e); }
  });
  app.post('/admin/logout', (req, res) => { res.clearCookie(ADM_COOKIE, admCookie); res.json({ ok: true }); });
  // Сторінки закупниць: секретне посилання /buyer/<код>/<ключ> без PIN (src/buyer/link.js, src/buyer/people.js).
  // Код - закупниця: bakery - ВК; hlib - хліб Рома, НБХЗ, овочі. Невідомий код, невірний або чужий ключ -> 404.
  // Дії: POST /buyer/<код>/<ключ>/api { action, payload: { dir, ... } } -> { ok, data, ms }; dir - лише зі свого списку, інакше 403.
  // Excel: GET /buyer/<код>/<ключ>/xlsx/<dir> - файл листа звіту бере сервер (сервісний акаунт).
  const buyerLink = require('./buyer/link');
  const people = require('./buyer/people');
  const DIRS_ALL = require('./directions').DIRECTIONS;
  const linkSecret = () => (opts.buyerLinkSecret !== undefined ? opts.buyerLinkSecret : process.env.BUYER_LINK_SECRET || '');
  const linkOk = (req) => buyerLink.verifyBuyerKey(req.params.code, req.params.key, linkSecret());
  const buyerApi = (dir) => (opts.buyerApi ? opts.buyerApi(dir) : getAdminRt().buyerApi(dir));
  const buyerWoReport = (dir, p) => (opts.buyerWoReport ? opts.buyerWoReport(dir, p) : require('./buyer/woReport').dayReport(dir, p));
  const buyerXlsx = (dir, key) => (opts.buyerXlsx ? opts.buyerXlsx(dir, key) : getAdminRt().buyerXlsx(dir, key));
  const noStore = (res) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); };
  app.get('/buyer/:code/:key', (req, res) => {
    if (!linkOk(req)) return res.status(404).json({ ok: false, error: 'Not found' });
    noStore(res);
    res.sendFile(require('path').join(__dirname, '..', 'public', 'buyer', 'index.html'));
  });
  app.post('/buyer/:code/:key/api', express.json({ limit: '1mb' }), async (req, res, next) => {
    try {
      if (!linkOk(req)) return res.status(404).json({ ok: false, error: 'Посилання недійсне' });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Unsupported Media Type' });
      const { action, payload } = req.body || {};
      const who = people.buyerOf(req.params.code);
      if (action === 'me') {
        return res.json({ ok: true, ms: 0, data: { code: req.params.code, title: who.title,
          dirs: who.dirs.map((d) => ({ dir: d, title: DIRS_ALL[d].title, color: DIRS_ALL[d].color || '', unit: DIRS_ALL[d].unit || '' })) } });
      }
      const dir = people.dirOf(req.params.code, (payload || {}).dir);
      if (!dir) return res.status(403).json({ ok: false, error: 'Цей напрямок недоступний за посиланням' });
      res.json(await buyerApi(dir)(action, payload));
    } catch (e) { next(e); }
  });
  app.get('/buyer/:code/:key/xlsx/:dir', async (req, res) => {
    if (!linkOk(req)) return res.status(404).json({ ok: false, error: 'Not found' });
    const dir = people.dirOf(req.params.code, req.params.dir);
    if (!dir || dir !== req.params.dir) return res.status(404).json({ ok: false, error: 'Not found' });
    try {
      const f = await buyerXlsx(dir, typeof req.query.key === 'string' ? req.query.key.slice(0, 40) : undefined);
      noStore(res);
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', 'attachment; filename="report.xlsx"; filename*=UTF-8\'\'' + encodeURIComponent(f.name));
      res.send(f.buf);
    } catch (e) { res.status(502).json({ ok: false, error: (e && e.message) || 'Помилка сервера' }); }
  });

  // Звіт про списання ВК за день для друку: GET /buyer/<код>/<ключ>/writeoff-report/bakery?date=ГГГГ-ММ-ДД&entity=<юрособа>
  app.get('/buyer/:code/:key/writeoff-report/:dir', async (req, res) => {
    if (!linkOk(req)) return res.status(404).json({ ok: false, error: 'Not found' });
    const dir = people.dirOf(req.params.code, req.params.dir);
    if (!dir || dir !== req.params.dir) return res.status(404).json({ ok: false, error: 'Not found' });
    const q = (k) => (typeof req.query[k] === 'string' ? req.query[k].slice(0, 80) : '');
    try {
      const f = await buyerWoReport(dir, { date: q('date'), entity: q('entity') });
      noStore(res);
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', 'attachment; filename="report.xlsx"; filename*=UTF-8\'\'' + encodeURIComponent(f.name));
      res.send(f.buf);
    } catch (e) {
      const user = e && e.name === 'ReportError';
      if (!user) console.error('звіт про списання: ' + ((e && e.message) || e));
      res.status(user ? 400 : 502).json({ ok: false, error: (e && e.message) || 'Помилка сервера' });
    }
  });

  app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('помилка запиту:', err && err.message);
    res.status(500).json({ ok: false, error: 'Помилка сервера' });
  });
  return app;
}

if (require.main === module) {
  try { process.loadEnvFile(require('path').join(__dirname, '..', '.env')); } catch (e) { /* .env немає (Fly) - секрети з оточення */ }
  const port = +process.env.PORT || 3000;
  createApp().listen(port, '0.0.0.0', () => console.log(`shop-orders слухає :${port}`));
}

module.exports = { createApp };
