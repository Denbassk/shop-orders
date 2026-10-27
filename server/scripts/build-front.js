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

// Точкова правка Index.html: якщо місця нема (Index.html змінився) - збірка падає, а не мовчки лишає стару поведінку.
function patch(html, from, to) {
  if (!html.includes(from)) throw new Error('Не знайдено місце правки в Index.html: ' + from.slice(0, 70).replace(/\n/g, '\\n'));
  return html.replace(from, () => to);
}

// Зміна відправленого замовлення (див. scripts/front-change.js): добавок нема, лише заміна з підставленим замовленням.
function applyChangeOrder(html) {
  // 1. openDir: підтвердження для вже відправленого і скидання режиму зміни
  html = patch(html, "'Відкрити, щоб переглянути або попросити дозвіл на добавку?')) return;",
    "'Відкрити, щоб подивитись або змінити його?')) return;");
  html = patch(html, "S.oid=uuid(); S.mode='add';", "S.oid=uuid(); S.mode='new'; S.edit=false; S.editInfo=null;");
  // 2. червоний напис "вже відправлено" лише коли змінити не можна; інакше замість нього кнопка "Змінити замовлення"
  html = patch(html, "if (d.alreadyOrdered && d.lateRequest !== 'approved')", "if (d.alreadyOrdered && d.lateRequest !== 'approved' && !d.windowOpen)");
  // 3. мінімалка діє завжди (знімає її лише сервер для першого замовлення за дозволом - вона вже в minOrder);
  //    відправка вимкнена, поки замовлення не підставлено кнопкою "Змінити замовлення"
  html = patch(html, "  // добавка з дозволу закупниці мінімалкою не обмежена\n  var min = (S.prod.lateRequest === 'approved') ? 0 : (S.prod.minOrder || 0);",
    "  var min = S.prod.minOrder || 0;");
  html = patch(html, "(!n||low||S.prod.locked ? ' disabled' : '')", "(!n||low||sendLocked() ? ' disabled' : '')");
  // 4. підтвердження перед відправкою і текст кнопки після помилки
  html = patch(html, "  var head = (S.mode === 'replace')\n    ? 'УВАГА: попереднє замовлення за сьогодні буде ВИДАЛЕНО\\nі замінене на це.\\n\\n'\n    : '';",
    "  var head = replaceHead();");
  html = patch(html, "b.disabled=false; b.textContent='Відправити'; }", "b.disabled=false; b.textContent=sendLabel(); }");
  // кнопка внизу: у режимі зміни "Зберегти" (а не "Замінити" - це збиває з пантелику, ніби замовлення вводять заново)
  html = patch(html, "(S.mode === 'replace' ? 'Замінити' : 'Відправити') + '</button>", "sendLabel() + '</button>");
  html = patch(html, "'\\n\\nВідправити?')) return;\n  var b=el('send'); b.disabled=true; b.textContent='Відправка…';",
    "'\\n\\n' + (S.mode === 'replace' ? 'Зберегти зміни?' : 'Відправити?'))) return;\n  var b=el('send'); b.disabled=true; b.textContent=(S.mode === 'replace' ? 'Збереження…' : 'Відправка…');");
  // екран після відправки: після зміни - "Зміни збережено" без слів про видалення/заміну рядків
  html = patch(html, "'<h2>Замовлення прийнято</h2><p><b>'", "'<h2>' + (r.replaced ? 'Зміни збережено' : 'Замовлення прийнято') + '</h2><p><b>'");
  html = patch(html, "    (r.replaced ? '<p style=\"color:#7a5200\">Попереднє замовлення замінено' +\n                  (r.removed ? ' (прибрано рядків: ' + r.removed + ')' : '') + '</p>' : '') +\n", '');
  // разове оголошення про зміну замовлення: після кожного малювання екрана товарів (див. changeNotice у front-change.js)
  html = patch(html, "  try { injectLate(); } catch (e) {}\n};", "  try { injectLate(); } catch (e) {}\n  try { changeNotice(); } catch (e) {}\n};");
  // 5. lateHtml/setMode (режими "Дозамовити"/"Переробити все") -> код front-change.js; плашка збирається lateBoxHtml
  const a = html.indexOf('function lateHtml(d){'), b = html.indexOf('function injectLate(){');
  if (a < 0 || b < a) throw new Error('Не знайдено lateHtml/injectLate в Index.html');
  html = html.slice(0, a) + fs.readFileSync(path.join(__dirname, 'front-change.js'), 'utf8').replace(/\r\n/g, '\n').replace(/^\/\*[\s\S]*?\*\/\n/, '') + html.slice(b);
  html = patch(html, 'var html = lateHtml(S.prod);', 'var html = lateBoxHtml(S.prod);');
  return html;
}

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

  // 3б. зміна відправленого замовлення: заміна замість добавок
  html = applyChangeOrder(html);

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
