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
    var tok = dirLockAcquire_(out.dir, 30000);
    out.waitMs = Date.now() - t0;

    if (!tok) {
      out.error = 'BUSY';
    } else {
      try {
        var t1 = Date.now();
        var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(LOAD_SHEET);
        if (!sh) throw new Error('немає листа ' + LOAD_SHEET + ' - спершу loadTest()');
        sh.getRange(sh.getLastRow() + 1, 1, 1, 4)
          .setValues([[new Date(), out.dir, out.n, out.waitMs]]);
        SpreadsheetApp.flush();
        out.writeMs = Date.now() - t1;
      } finally {
        dirLockRelease_(out.dir, tok);
      }
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
function loadTest(perDir) {
  perDir = perDir || 39;                      // скільки "магазинів" на напрямок
  var keys = Object.keys(DIRECTIONS);
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
              perDir + ' точок x ' + keys.length + ' напрямки)');
  console.log('Адреса: ' + url);

  var t0 = Date.now();
  var res = UrlFetchApp.fetchAll(reqs);
  var wall = Date.now() - t0;

  // --- розбір ---
  var byDir = {}, http = {}, parsed = 0, busy = 0, errs = {};
  keys.forEach(function (k) { byDir[k] = { wait: [], write: [], total: [], busy: 0, err: 0 }; });

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
      (b.busy ? '  ВІДМОВ: ' + b.busy : ''));
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
