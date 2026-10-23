// Збирає сайт продавця з app/ui у server/public/index.html: розкриває шаблонні вставки Apps Script (<? ?>), вбудовує WriteOff.html і
// логотип (LOGO_DATA_URI з app/Logo.gs), замінює call() (google.script.run) на fetch('/api') з тайм-аутом 20 с.
// Файли app/ui і app/*.gs не змінюються. Запуск: node scripts/build-front.js (після кожної зміни Index.html / WriteOff.html / Logo.gs).
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'app');
const OUT = path.join(__dirname, '..', 'public', 'index.html');
const PWA_URL = 'https://denbassk.github.io/shop-orders/';        // Config.gs: PWA_URL (іконки лежать в оболонці GitHub Pages)

// Замість call() з google.script.run. Відповідь сервера {ok,data}|{ok:false,error}; мережа/тайм-аут/не JSON - один текст.
const CALL_SNIPPET = `var CALL_TIMEOUT_MS = 20000;
function call(action, payload){
  return new Promise(function(res, rej){
    var ctl = new AbortController();
    var timer = setTimeout(function(){ ctl.abort(); }, CALL_TIMEOUT_MS);
    fetch('/api', { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: action, payload: payload || {} }), signal: ctl.signal })
      .then(function(r){ return r.json(); })
      .then(function(r){ clearTimeout(timer); r && r.ok ? res(r.data) : rej(new Error(r && r.error ? r.error : 'Помилка')); },
            function(){ clearTimeout(timer); rej(new Error('Сервер не відповідає, спробуйте ще раз')); });
  });
}`;

function build() {
  const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
  const logo = (read('Logo.gs').match(/var LOGO_DATA_URI = '(data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)'/) || [])[1];
  if (!logo) throw new Error('Не знайдено LOGO_DATA_URI в app/Logo.gs');

  let html = read('ui/Index.html').replace(/\r\n/g, '\n');

  // 1. LOGO: <? var LOGO ... ?> -> нічого; <? if (LOGO) { ?> A <? } else { ?> B <? } ?> -> A з вбудованим логотипом
  html = html.replace(/<\? var LOGO = ''; try \{ LOGO = LOGO_DATA_URI; \} catch \(e\) \{ LOGO = ''; \} \?>\n?/, '');
  const logoRe = /[ \t]*<\? if \(LOGO\) \{ \?>\n([\s\S]*?)[ \t]*<\? \} else \{ \?>\n[\s\S]*?<\? \} \?>\n/;
  if (!logoRe.test(html)) throw new Error('Не знайдено блок if (LOGO) в Index.html');
  html = html.replace(logoRe, (_, a) => a.replace('<?!= LOGO ?>', logo));

  // 2. include('ui/WriteOff')
  html = html.replace(/<\?!= include\('ui\/(\w+)'\) \?>/g, (_, n) => read('ui/' + n + '.html').replace(/\r\n/g, '\n'));

  // 3. call(): google.script.run -> fetch
  const a = html.indexOf('function call(action, payload){');
  const b = html.indexOf('function esc(s)', a);
  if (a < 0 || b < 0) throw new Error('Не знайдено call() в Index.html');
  html = html.slice(0, a) + CALL_SNIPPET + '\n' + html.slice(b);

  // 4. голова сторінки: назва, viewport без масштабування, іконка (HtmlService додавав їх у doGet)
  html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<title>Замовлення Фемелі Маркет</title>\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">\n' +
    '<link rel="icon" href="' + PWA_URL + 'icon-192.png">');

  // 5. доопрацювання вигляду (scripts/front-overlay.html): лише CSS поверх app/ui/Index.html, який не змінюється
  const OV = path.join(__dirname, 'front-overlay.html');
  if (fs.existsSync(OV)) {
    const css = fs.readFileSync(OV, 'utf8').replace(/\r\n/g, '\n').replace(/^<!--[\s\S]*?-->\s*/, '').trim();
    html = html.replace('</head>', () => css + '\n</head>');
  }

  if (/<\?/.test(html)) throw new Error('Лишилась шаблонна вставка <? в збірці');
  if (html.includes('google.script')) throw new Error('Лишився google.script в збірці');
  return html;
}

module.exports = { build, OUT, CALL_SNIPPET };

if (require.main === module) {
  const html = build();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log(`server/public/index.html: ${(html.length / 1024).toFixed(0)} КБ`);
}
