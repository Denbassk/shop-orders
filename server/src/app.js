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

  // Сторінка пульта (зібрана з app/ui скриптом scripts/build-admin.js)
  app.get(['/admin', '/admin/'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(require('path').join(__dirname, '..', 'public', 'admin', 'index.html'));
  });

  // Пульт: POST /admin/api { action, payload } -> { ok, data, ms } (adminApi з app/Admin.gs). Вхід - action 'login' { pin };
  // сесія - підписаний JWT у cookie adm (HttpOnly, Secure, SameSite=Strict, 12 год). Лише application/json (захист від чужих форм).
  let adminRt = null;
  const getAdminRt = () => adminRt || (adminRt = require('./admin/runtime').createAdminRuntime({ queueExport: (d) => runtime().getEnv().queueExport(d) }));
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
  app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('помилка запиту:', err && err.message);
    res.status(500).json({ ok: false, error: 'Помилка сервера' });
  });
  return app;
}

if (require.main === module) {
  const port = +process.env.PORT || 3000;
  createApp().listen(port, '0.0.0.0', () => console.log(`shop-orders слухає :${port}`));
}

module.exports = { createApp };
