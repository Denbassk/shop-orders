// ============================================================
// НАВАНТАЖУВАЛЬНИЙ ТЕСТ - "усі магазини разом, усі напрямки разом"
//
// Це НЕ імітація. loadTest() через UrlFetchApp.fetchAll() б'є по
// адресі веб-застосунку сотнею одночасних запитів. Кожен запит -
// окреме виконання скрипта на серверах Google, з тим самим замком
// напрямку, тим самим записом у таблицю і тим самим flush.
//
// Пише у службовий лист "_Навантаження" кожної таблиці напрямку -
// справжніх замовлень і позначок "вже замовляли" не чіпає.
// Після тесту: loadTestCleanup()
//
// ПОРЯДОК:
//   1) clasp push + НОВИЙ ДЕПЛОЙ (без нього тест б'є по старій версії)
//   2) loadTest()          - залп 39 точок x 4 напрямки
//   3) loadTestCleanup()   - прибрати службові листи
// ============================================================

var LOAD_SHEET = '_Навантаження';

// --- те, що виконується на боці сервера при кожному запиті ---
function loadProbe_(p) {
  var out = { dir: String(p.load || ''), n: String(p.n || '') };
  var t0 = Date.now();
  try {
    if (String(p.k || '') !== loadProbeToken_()) throw new Error('forbidden');
    var cfg = dirCfg_(out.dir);

    // Точно той самий шлях, що й у справжньої відправки:
    // коротко глобальний замок на перевірку, потім запис без замка.
    var g = LockService.getScriptLock();
    var got = g.tryLock(SUBMIT_WAIT_MS);
    out.waitMs = Date.now() - t0;
    if (!got) { out.error = 'BUSY'; }
    else {
      try {
        PropertiesService.getScriptProperties().getProperty('probe_' + out.dir);
      } finally { try { g.releaseLock(); } catch (e) {} }

      var t1 = Date.now();
      if (typeof Sheets === 'undefined') throw new Error('Sheets API не увімкнено');
      var row = [[formatDateDMY_(new Date()), out.dir, out.n, out.waitMs]];
      // apiAppend_ уже з OVERWRITE - формат шапки не успадковується
      out.quota = 0;
      for (var att = 0; att < 2; att++) {
        try { apiAppend_(cfg.spreadsheetId, LOAD_SHEET, row); break; }
        catch (e) {
          if (!isQuotaError_(e)) throw e;
          out.quota++;
          if (att === 0) { Utilities.sleep(700 + Math.floor(Math.random() * 1500)); continue; }
          out.fallback = 1;
          var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(LOAD_SHEET);
          var gg = LockService.getScriptLock();
          if (gg.tryLock(20000)) {
            try { sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setValues(row); SpreadsheetApp.flush(); }
            finally { try { gg.releaseLock(); } catch (e2) {} }
          } else { out.error = 'BUSY'; }
        }
      }
      out.writeMs = Date.now() - t1;
    }
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  out.totalMs = Date.now() - t0;
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// Проба відкрита анонімно, як і весь застосунок - тому за токеном
function loadProbeToken_() {
  return lateToken_('__loadprobe__', 'x', nowKyiv_().day);
}

// --- сам залп ---
// perDir  - скільки "магазинів" на напрямок
// onlyDir - якщо вказано, стріляємо лише по цьому напрямку
//
// РЕАЛЬНИЙ ПІК: усі 39 точок одного напрямку в одну секунду -> loadTest(39, 'bread').
// СУДНИЙ ДЕНЬ:  39 точок одразу по всіх чотирьох -> loadTest(39).
//   Такого не буває: дедлайни рознесені 13:00 / 16:00 / 17:30 / 18:00.
//   Цей режим упреться у квоту Sheets API (60 записів за хвилину) і піде
//   запасним шляхом через замок - тобто триватиме кілька хвилин. Це не
//   зависання, це і є поведінка під немислимим навантаженням.
function loadTest(perDir, onlyDir) {
  perDir = perDir || 39;
  var keys = onlyDir ? [onlyDir] : Object.keys(DIRECTIONS);
  var url = appUrl_().replace(/\/dev$/, '/exec');
  var token = loadProbeToken_();
  if (url.indexOf('/exec') < 0) {
    console.log('СТОП: не знаю робочої адреси застосунку. Запустіть a03_setWebAppUrl().');
    return;
  }

  // службові листи створюємо заздалегідь, щоб їх не створювали 156 виконань одночасно
  keys.forEach(function (k) {
    var ss = SpreadsheetApp.openById(DIRECTIONS[k].spreadsheetId);
    var sh = ss.getSheetByName(LOAD_SHEET);
    if (!sh) sh = ss.insertSheet(LOAD_SHEET);
    sh.clear();
    sh.getRange(1, 1, 1, 4).setValues([['Час', 'Напрямок', '№', 'Чекав замок, мс']])
      .setFontWeight('bold');
  });
  SpreadsheetApp.flush();

  // пробний постріл: перевіряємо, що адреса взагалі відповідає нашим JSON
  var probe = UrlFetchApp.fetch(url + '?load=bread&n=probe&k=' +
    encodeURIComponent(token), { muteHttpExceptions: true });
  var probeBody = probe.getContentText();
  var probeOk = false;
  try { probeOk = !!JSON.parse(probeBody).dir; } catch (e) {}
  if (!probeOk) {
    console.log('СТОП: пробний запит не повернув JSON.');
    console.log('Адреса: ' + url);
    console.log('Код відповіді: ' + probe.getResponseCode());
    console.log('Початок відповіді: ' + probeBody.slice(0, 300));
    console.log('---');
    if (probeBody.indexOf('accounts.google.com') >= 0 || probeBody.indexOf('signin') >= 0) {
      console.log('Google повернув сторінку входу. Отже розгортання закрите:');
      console.log('   Розгорнути -> Керувати розгортаннями -> олівець ->');
      console.log('   "Хто має доступ" = УСІ (не "Тільки я" і не "Будь-хто з акаунтом Google").');
      console.log('Це ж стосується і продавців: із закритим доступом застосунок');
      console.log('вимагатиме входу в Google на кожному телефоні.');
    } else if (probe.getResponseCode() === 404) {
      console.log('404: за цією адресою розгортання вже немає - схоже, створено нове.');
      console.log('Відкрийте застосунок у браузері за актуальним посиланням -');
      console.log('адреса запишеться сама. Потім a04_checkWebApp().');
      PropertiesService.getScriptProperties().deleteProperty('WEB_APP_URL');
    } else {
      console.log('Схоже, розгорнуто стару версію коду, яка не знає про loadProbe_.');
      console.log('   Розгорнути -> Керувати розгортаннями -> олівець -> Версія: Нова.');
    }
    console.log('Перевірити адресу: a04_checkWebApp()');
    return;
  }
  console.log('Пробний запит пройшов, стріляємо.');

  // запити впереміш, як у житті: не всі хлібні підряд
  var reqs = [];
  for (var i = 0; i < perDir; i++) {
    keys.forEach(function (k) {
      reqs.push({ url: url + '?load=' + encodeURIComponent(k) + '&n=' + i +
                       '&k=' + encodeURIComponent(token),
                  muteHttpExceptions: true });
    });
  }
  for (var j = reqs.length - 1; j > 0; j--) {          // перемішати
    var r = Math.floor(Math.random() * (j + 1));
    var tmp = reqs[j]; reqs[j] = reqs[r]; reqs[r] = tmp;
  }

  console.log('Залп: ' + reqs.length + ' одночасних запитів (' +
              perDir + ' точок x ' + keys.length + ' напрямк(и))');
  if (reqs.length > 60)
    console.log('УВАГА: більше 60 записів за хвилину - частина впреться у квоту ' +
                'Sheets API і піде через замок. Залп триватиме кілька хвилин.');
  console.log('Адреса: ' + url);

  var t0 = Date.now();
  var res = UrlFetchApp.fetchAll(reqs);
  var wall = Date.now() - t0;

  // --- розбір ---
  var byDir = {}, http = {}, parsed = 0, busy = 0, errs = {};
  keys.forEach(function (k) {
    byDir[k] = { wait: [], write: [], total: [], busy: 0, err: 0, quota: 0, fallback: 0 };
  });

  res.forEach(function (r) {
    var code = r.getResponseCode();
    http[code] = (http[code] || 0) + 1;
    var o = null;
    try { o = JSON.parse(r.getContentText()); } catch (e) {}
    if (!o || !byDir[o.dir]) { return; }
    parsed++;
    var b = byDir[o.dir];
    if (o.error) {
      b.err++;
      if (o.error === 'BUSY') { b.busy++; busy++; }
      errs[o.error] = (errs[o.error] || 0) + 1;
      return;
    }
    b.wait.push(o.waitMs || 0);
    b.write.push(o.writeMs || 0);
    b.total.push(o.totalMs || 0);
    if (o.quota) b.quota += o.quota;
    if (o.fallback) b.fallback++;
  });

  function stat(a) {
    if (!a.length) return { n: 0, p50: 0, p90: 0, max: 0 };
    var s = a.slice().sort(function (x, y) { return x - y; });
    return { n: s.length, p50: s[Math.floor(s.length * 0.5)],
             p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] };
  }

  console.log('=====================================');
  console.log('УВЕСЬ ЗАЛП: ' + wall + ' мс (' + (wall / 1000).toFixed(1) + ' с)');
  console.log('HTTP-коди: ' + JSON.stringify(http));
  console.log('розібрано відповідей: ' + parsed + ' з ' + reqs.length);
  console.log('відмов "зайнято": ' + busy);
  if (Object.keys(errs).length) console.log('помилки: ' + JSON.stringify(errs));
  console.log('-------------------------------------');
  console.log('напрямок | ok | чекав замок p50/p90/max | запис p50/max');
  keys.forEach(function (k) {
    var b = byDir[k];
    var w = stat(b.wait), wr = stat(b.write);
    console.log(dirCfg_(k).title + ' | ' + w.n + ' | ' +
      w.p50 + ' / ' + w.p90 + ' / ' + w.max + ' мс | ' +
      wr.p50 + ' / ' + wr.max + ' мс' +
      (b.busy ? '  ВІДМОВ: ' + b.busy : '') +
      (b.quota ? '  впертись у квоту: ' + b.quota : '') +
      (b.fallback ? ', з них пішли через замок: ' + b.fallback : ''));
  });

  var allTotal = [];
  keys.forEach(function (k) { allTotal = allTotal.concat(byDir[k].total); });
  var t = stat(allTotal);
  console.log('-------------------------------------');
  console.log('час одного замовлення від запиту до запису:');
  console.log('   половина вклалась у ' + t.p50 + ' мс');
  console.log('   90% вклались у ' + t.p90 + ' мс');
  console.log('   найдовше ' + t.max + ' мс');
  console.log('=====================================');
  console.log('Як читати: "чекав замок" - це і є черга. Якщо вона мала, а');
  console.log('відмов нуль - застосунок витримує одночасний залп усіх точок.');
  console.log('Далі: loadTestCleanup()');

  return { wallMs: wall, http: http, busy: busy, byDir: byDir };
}

// --- прибрати за собою ---
function loadTestCleanup() {
  Object.keys(DIRECTIONS).forEach(function (k) {
    try {
      var ss = SpreadsheetApp.openById(DIRECTIONS[k].spreadsheetId);
      var sh = ss.getSheetByName(LOAD_SHEET);
      if (!sh) return;
      ss.deleteSheet(sh);
      console.log('Прибрано "' + LOAD_SHEET + '" з ' + DIRECTIONS[k].title);
    } catch (e) { console.log(DIRECTIONS[k].title + ': ' + e.message); }
  });
  clearDirLocks();
  console.log('Готово');
}
