// ============================================================
// БУФЕР ЗАМОВЛЕНЬ (18.10.2026)
//
// Таблиця напрямку не відповідає (запобіжник SheetsFast.gs) або запис у неї
// впав - замовлення НЕ губимо і продавця не тримаємо: кладемо його у
// властивості скрипта (окреме сховище Google, не таблиця) і відповідаємо
// "прийнято". Тригер bufDrain щохвилини переносить буфер у таблицю, щойно
// вона ожила, і сам себе знімає, коли буфер порожній.
//
// Дублі: перед записом bufDrain дивиться, чи рядків замовлення вже немає в
// листі (orderRowsInTail_ - та сама дата, адреса, час, назва, кількість).
// Основне замовлення (не добавка) при будь-яких рядках точки за цей день не
// пишеться: адміну йде лист із вмістом буфера, щоб звірити руками.
// Нічого не видаляється з буфера, поки запис не підтверджено.
//
// Перегляд з редактора: z_bufShow. Ручний перенос: bufDrain.
// ============================================================
var BUF_INDEX = 'buf_index';          // JSON-масив orderId у буфері
var BUF_PREFIX = 'bufq_';             // заголовок запису; частини - bufq_<id>#<n>
var BUF_PART = 8000;                  // властивість - до 9 КБ
var BUF_DRAIN_LOCK = 'buf_drain';     // {ts}: один перенос за раз
var BUF_DRAIN_TTL_MS = 7 * 60 * 1000; // довше за ліміт виконання (6 хв)
var BUF_ALERT_MIN = 20;

// --- стиснене зберігання обʼєкта у властивостях (кілька частин) ---
function packEncode_(obj) {
  return Utilities.base64Encode(Utilities.gzip(
    Utilities.newBlob(JSON.stringify(obj), 'application/json')).getBytes());
}
function packDecode_(s) {
  return JSON.parse(Utilities.ungzip(
    Utilities.newBlob(Utilities.base64Decode(s), 'application/x-gzip')).getDataAsString());
}
// Повертає {ключ: значення} для setProperties: частини + заголовок (meta + n)
function packMap_(key, obj, meta) {
  var s = packEncode_(obj), n = Math.max(Math.ceil(s.length / BUF_PART), 1), map = {};
  for (var i = 0; i < n; i++) map[key + '#' + i] = s.substr(i * BUF_PART, BUF_PART);
  meta = meta || {};
  meta.n = n;
  map[key] = JSON.stringify(meta);
  return map;
}
function packRead_(props, key, meta) {
  var s = '';
  for (var i = 0; i < meta.n; i++) {
    var p = props.getProperty(key + '#' + i);
    if (p == null) throw new Error('немає частини ' + key + '#' + i);
    s += p;
  }
  return packDecode_(s);
}
function packDelete_(props, key, meta) {
  for (var i = 0; i < ((meta && meta.n) || 0); i++) {
    try { props.deleteProperty(key + '#' + i); } catch (e) {}
  }
  try { props.deleteProperty(key); } catch (e) {}
}

// Date у рядках -> {__d: мс} і назад (JSON не зберігає дати)
function bufRowsOut_(values) {
  return values.map(function (r) {
    return r.map(function (v) { return (v instanceof Date) ? { __d: v.getTime() } : v; });
  });
}
function bufRowsIn_(rows) {
  return rows.map(function (r) {
    return r.map(function (v) { return (v && typeof v === 'object' && v.__d) ? new Date(v.__d) : v; });
  });
}

// --- індекс буфера (під коротким ScriptLock: два звернення до властивостей) ---
function bufIndex_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(BUF_INDEX) || '[]'); }
  catch (e) { return []; }
}
function bufIndexEdit_(fn) {
  var g = LockService.getScriptLock();
  if (!g.tryLock(15000)) throw new Error('BUSY: сервер зайнятий');
  try {
    var props = PropertiesService.getScriptProperties();
    var ids = [];
    try { ids = JSON.parse(props.getProperty(BUF_INDEX) || '[]'); } catch (e) {}
    ids = fn(ids);
    if (ids.length) props.setProperty(BUF_INDEX, JSON.stringify(ids));
    else props.deleteProperty(BUF_INDEX);
  } finally { try { g.releaseLock(); } catch (e) {} }
}

function bufHas_(orderId) {
  if (!orderId) return null;
  try {
    var v = PropertiesService.getScriptProperties().getProperty(BUF_PREFIX + orderId);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}

// Повторна відправка замовлення, яке вже лежить у буфері
function bufResult_(h, first) {
  var r = JSON.parse(JSON.stringify(h.result || {}));
  r.ok = true; r.buffered = true; r.duplicate = !first;
  return r;
}

// Прийняти замовлення в буфер. values - рядки для сирого листа (як для appendRows_).
// Кидає помилку, якщо навіть буфер не записався - тоді продавець бачить помилку
// і повторює (orderId той самий, позначка "вже замовляли" повтор пропускає).
function bufAccept_(orderId, dirKey, store, values, result, addon, why) {
  var props = PropertiesService.getScriptProperties();
  var key = BUF_PREFIX + orderId;
  var meta = { oid: orderId, dir: dirKey, sk: statusKey_(dirKey, store), label: store.label,
               addon: !!addon, ts: Date.now(), result: result, why: String(why || '').slice(0, 300),
               tries: 0 };
  props.setProperties(packMap_(key, bufRowsOut_(values), meta));   // заголовок разом із частинами
  bufIndexEdit_(function (ids) { if (ids.indexOf(orderId) < 0) ids.push(orderId); return ids; });
  bufEnsureTrigger_();
  console.error('БУФЕР: ' + dirKey + ' / ' + store.label + ' - ' + values.length +
                ' рядків, orderId ' + orderId + ' (' + meta.why + ')');
  return bufResult_(meta, true);
}

function bufEnsureTrigger_() {
  try {
    var has = ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === 'bufDrain';
    });
    if (!has) ScriptApp.newTrigger('bufDrain').timeBased().everyMinutes(1).create();
  } catch (e) { console.error('тригер bufDrain: ' + e.message); }
}

function bufDropTrigger_() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'bufDrain') ScriptApp.deleteTrigger(t);
    });
  } catch (e) { console.error('зняти bufDrain: ' + e.message); }
}

// Один перенос за раз: висяча ВК може тримати виконання до 6 хв,
// і другий перенос, не побачивши ще рядків, записав би дубль.
function bufDrainLock_() {
  var g = LockService.getScriptLock();
  if (!g.tryLock(10000)) return null;
  try {
    var props = PropertiesService.getScriptProperties();
    var cur = Number(props.getProperty(BUF_DRAIN_LOCK) || 0);
    if (cur && Date.now() - cur < BUF_DRAIN_TTL_MS) return null;
    var tok = String(Date.now());
    props.setProperty(BUF_DRAIN_LOCK, tok);
    return tok;
  } finally { try { g.releaseLock(); } catch (e) {} }
}

function bufDrain() {
  var ids = bufIndex_();
  if (!ids.length) { bufDropTrigger_(); return; }
  var tok = bufDrainLock_();
  if (!tok) { console.log('bufDrain: інший перенос ще йде'); return; }
  var props = PropertiesService.getScriptProperties();
  var alerts = [];
  try {
    ids.forEach(function (oid) {
      var h = bufHas_(oid);
      if (!h) { bufIndexEdit_(function (a) { return a.filter(function (x) { return x !== oid; }); }); return; }
      if (dirStuck_(h.dir)) return;            // хтось зараз висить на цій таблиці
      try {
        var res = bufWriteOne_(props, h);
        console.log('bufDrain: ' + h.dir + ' / ' + h.label + ' - ' + res);
        if (/^УВАГА/.test(res)) alerts.push(h.label + ' (' + h.dir + '): ' + res);
        bufRemove_(props, oid, h);
      } catch (e) {
        h.tries = (h.tries || 0) + 1;
        h.err = String(e.message || e).slice(0, 300);
        console.error('bufDrain: ' + h.dir + ' / ' + h.label + ' - ' + h.err);
        if (!h.alerted && Date.now() - h.ts > BUF_ALERT_MIN * 60000) {
          h.alerted = true;
          alerts.push(h.label + ' (' + h.dir + '): ще в буфері ' +
                      Math.round((Date.now() - h.ts) / 60000) + ' хв, ' + h.err);
        }
        try { props.setProperty(BUF_PREFIX + oid, JSON.stringify(h)); } catch (e2) {}
      }
    });
  } finally {
    try { if (props.getProperty(BUF_DRAIN_LOCK) === tok) props.deleteProperty(BUF_DRAIN_LOCK); } catch (e) {}
  }
  if (alerts.length) {
    var msg = alerts.join('\n') + '\n\nЗапустіть z_bufShow у редакторі, щоб побачити вміст буфера.';
    try { MailApp.sendEmail(SAFE_ALERT_TO, 'ЗАМОВЛЕННЯ: буфер', msg); } catch (e) {}
  }
  if (!bufIndex_().length) bufDropTrigger_();
}

function bufRemove_(props, oid, h) {
  packDelete_(props, BUF_PREFIX + oid, h);
  bufIndexEdit_(function (a) { return a.filter(function (x) { return x !== oid; }); });
}

// Записати одне замовлення з буфера. Повертає текст для журналу.
function bufWriteOne_(props, h) {
  var cfg = dirCfg_(h.dir);
  var sheetName = rawSheetName_(cfg);
  var values = bufRowsIn_(packRead_(props, BUF_PREFIX + h.oid, h));
  var rows = values.map(function (r) {
    var o = r.slice();
    if (o[0] instanceof Date) o[0] = formatDateDMY_(o[0]);
    return o;
  });
  var dmy = String(rows[0][0]);

  // що з цього замовлення і взагалі від цієї точки вже лежить у листі
  var seen = guardedDir_(h.dir, function () {
    var tail = rawTailApi_(cfg, 'C').rows.filter(function (r) {
      return dmyApi_(r[0]) === dmy && addrKey_(cellStr_(r[2])) === h.sk;
    });
    return { storeRows: tail.length,
             present: orderRowsInTail_(cfg.spreadsheetId, sheetName, h.dir, rows) };
  }, true);

  var missing = missingOrderLines_(h.dir, rows, seen.present);
  if (!missing.length) { rememberOrder_(h.oid, h.result); return 'вже в листі, не пишемо'; }
  if (!h.addon && seen.storeRows > seen.present.total) {
    // у точки за цей день уже є ІНШІ рядки (напр., перша спроба записалась з іншим часом)
    rememberOrder_(h.oid, h.result);
    return 'УВАГА: у точки вже є ' + seen.storeRows + ' рядків за ' + dmy +
           ', буфер не записано. Буфер: ' + rows.map(function (r) {
             var c = rawCols_(h.dir); return r[c.name] + ' x ' + r[c.qty];
           }).join('; ');
  }

  var used = {}, toWrite = [];
  values.forEach(function (v, i) {
    var k = lineKey_(h.dir, rows[i]);
    used[k] = (used[k] || 0) + 1;
    if (used[k] > (seen.present.keys[k] || 0)) toWrite.push(v);
  });
  guardedDir_(h.dir, function () {
    appendRows_(cfg, h.dir, toWrite, function () { rememberOrder_(h.oid, h.result); });
  }, true);
  if (!APPEND_STATE_.notified) rememberOrder_(h.oid, h.result);
  try { CacheService.getScriptCache().remove('status_v4'); } catch (e) {}
  if (h.dir === 'nbhz') {
    try { props.setProperty('nbhz_export_dirty', formatDateDMY_(new Date())); } catch (e) {}
  }
  return 'записано рядків ' + toWrite.length + ' з ' + values.length;
}

// Вміст буфера - у журнал (запуск з редактора)
function z_bufShow() {
  var props = PropertiesService.getScriptProperties();
  var ids = bufIndex_();
  console.log('У буфері замовлень: ' + ids.length);
  ids.forEach(function (oid) {
    var h = bufHas_(oid);
    if (!h) { console.log(oid + ': заголовка немає'); return; }
    var lines = '';
    try {
      var c = rawCols_(h.dir);
      lines = packRead_(props, BUF_PREFIX + oid, h).map(function (r) {
        return r[c.name] + ' x ' + r[c.qty];
      }).join('; ');
    } catch (e) { lines = 'не читається: ' + e.message; }
    console.log(h.dir + ' | ' + h.label + ' | ' +
                Utilities.formatDate(new Date(h.ts), 'Europe/Kyiv', 'dd.MM HH:mm:ss') +
                ' | спроб ' + (h.tries || 0) + (h.err ? ' | ' + h.err : '') + ' | ' + lines);
  });
}
