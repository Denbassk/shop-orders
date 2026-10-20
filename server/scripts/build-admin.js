// Збирає сторінку пульта з app/ui (Admin.html + include) у server/public/admin/index.html.
// Файли app/ui не змінюються. Зв'язок з Apps Script (google.script.run, токен у localStorage)
// перевизначається блоком у кінці сторінки: fetch('/admin/api'), вхід - cookie (HttpOnly).
// Запуск: node scripts/build-admin.js (після кожної зміни app/ui/Admin*.html, WriteOffAdminJs.html).
const fs = require('node:fs');
const path = require('node:path');

const UI = path.join(__dirname, '..', '..', 'app', 'ui');
const OUT = path.join(__dirname, '..', 'public', 'admin', 'index.html');

const SHIM = `<!-- shop-orders: на сервері немає: бэкап, дублі, позначка, збереження картки - кнопки приховано -->
<style>
#t-restore,[onclick*="'restore'"],[onclick*="'dups'"],[onclick*="askClearMark"],[onclick="askCard()"]{display:none!important}
</style>
<script>
function askCard(){ toast('Сохранение карточки - после переезда. Пока правьте Довідник ТТ.'); }
function askClearMark(){ toast('Отметок больше нет: отмените заказ или откройте приём точке.'); }
// ===== shop-orders: зв'язок з сервером замість Apps Script (вхід - cookie, токена в сторінці немає) =====
function adminPost_(action, payload) {
  return fetch('/admin/api', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action, payload: payload || {} })
  }).then(function (r) {
    return r.json().catch(function () { return { ok: false, error: 'Ошибка связи (' + r.status + ')' }; });
  });
}
function callNet(action, payload) {
  var t0 = Date.now();
  return adminPost_(action, payload).then(function (r) {
    perfLog(action, t0, r);
    if (r && r.ok) return r.data;
    if (r && r.error === 'AUTH') { logout(); throw new Error('Нужно войти заново'); }
    throw new Error((r && r.error) || 'Ошибка связи');
  }, function (e) { perfLog(action, t0, null); throw e; });
}
function logout() {
  TOKEN = '';
  try { localStorage.removeItem('adm_token'); } catch (e) {}
  try { fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
  document.getElementById('app').style.display = 'none';
  document.getElementById('login').style.display = 'block';
}
function doLogin() {
  var pin = document.getElementById('pin').value;
  var err = document.getElementById('pinerr');
  err.textContent = 'Проверяю…';
  adminPost_('login', { pin: pin }).then(function (r) {
    if (!r || !r.ok) { err.textContent = (r && r.error) || 'Ошибка'; return; }
    err.textContent = '';
    TOKEN = 'cookie';
    start();
  }, function (e) { err.textContent = String(e.message || e); });
}
// вже увійшли (cookie діє) -> одразу в пульт
adminPost_('today', {}).then(function (r) {
  if (r && r.ok && document.getElementById('app').style.display !== 'block') { TOKEN = 'cookie'; start(); }
}, function () {});
</script>
`;

function build() {
  const read = (n) => fs.readFileSync(path.join(UI, n + '.html'), 'utf8');
  let html = read('Admin').replace(/<\?!=\s*include\('ui\/(\w+)'\)\s*\?>/g, (_, n) => read(n));
  if (/<\?/.test(html)) throw new Error('Невідома шаблонна вставка в Admin.html');
  if (!/<title>/i.test(html)) html = html.replace(/<head>/i, '<head>\n<title>Пульт Фемелі Маркет</title>');
  if (!/name="viewport"/i.test(html)) html = html.replace(/<head>/i,
    '<head>\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">');
  if (!/<\/body>/i.test(html)) throw new Error('Немає </body> в Admin.html');
  return html.replace(/<\/body>/i, SHIM + '</body>');
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, build(), 'utf8');
  console.log('Зібрано: ' + OUT);
}

module.exports = { build, OUT };