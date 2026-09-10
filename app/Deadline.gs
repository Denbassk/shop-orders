// ============================================================
// ДЕДЛАЙНИ ПРИЙОМУ ЗАМОВЛЕНЬ
// Час рахуємо на сервері по Києву - переставити годинник на
// телефоні не допоможе.
// ============================================================

function nowKyiv_() {
  var s = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy-MM-dd HH:mm');
  return { day: s.slice(0, 10), hh: +s.slice(11, 13), mm: +s.slice(14, 16) };
}

function deadlinePassed_(dirKey) {
  var cfg = dirCfg_(dirKey);
  if (!cfg.deadline) return false;
  if (lateAllowed_(dirKey)) return false;      // закупниця відкрила вручну
  var n = nowKyiv_();
  var p = String(cfg.deadline).split(':');
  return (n.hh * 60 + n.mm) >= (+p[0] * 60 + +p[1]);
}

function lateAllowed_(dirKey) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty('late_' + dirKey);
    return !!v && v === nowKyiv_().day;        // дозвіл діє лише на сьогодні
  } catch (e) { return false; }
}

// --- Ручне відкриття прийому (запускати з редактора) ---
function allowLate_(dirKey) {
  var cfg = dirCfg_(dirKey);
  PropertiesService.getScriptProperties().setProperty('late_' + dirKey, nowKyiv_().day);
  console.log('ВІДКРИТО до кінця дня: ' + cfg.title);
}
function closeLate_(dirKey) {
  PropertiesService.getScriptProperties().deleteProperty('late_' + dirKey);
  console.log('Повернуто звичайний режим: ' + dirCfg_(dirKey).title);
}

function allowLateBread()  { allowLate_('bread'); }
function allowLateBakery() { allowLate_('bakery'); }
function allowLateVeg()    { allowLate_('veg'); }
function closeLateBread()  { closeLate_('bread'); }
function closeLateBakery() { closeLate_('bakery'); }
function closeLateVeg()    { closeLate_('veg'); }

function deadlineStatus() {
  var n = nowKyiv_();
  console.log('Київ: ' + n.day + ' ' + ('0'+n.hh).slice(-2) + ':' + ('0'+n.mm).slice(-2));
  Object.keys(DIRECTIONS).forEach(function (k) {
    var cfg = DIRECTIONS[k];
    console.log(cfg.title + ' — до ' + (cfg.deadline || 'без обмежень') + ' — ' +
      (deadlinePassed_(k) ? 'ЗАКРИТО' : 'відкрито') +
      (lateAllowed_(k) ? ' (відкрито вручну)' : ''));
  });
}
