/* Сервісні повідомлення продавцям з пульту (settings.service_notice -> S.boot.notices з bootstrap і refresh): банер угорі (#nbox) і, якщо
   у повідомленні стоїть modal, одноразове вікно на пристрої (fm_notice_seen). build-front.js вставляє цей код у сторінку окремим <script>
   і обгортає screenStore / openStore / drawProd, щоб банер перемальовувався на кожному екрані; beat() оновлює S.boot.notices з refresh.
   Лише читає S.boot / S.store / S.dir, нічого не відправляє. Тексти повідомлень завжди екрануються (esc), HTML з пульту не потрапляє. */
var NTC_SEEN_KEY = 'fm_notice_seen';
var ntcSeenMem = {};

function ntcSeenIds(){
  try { var a = JSON.parse(localStorage.getItem(NTC_SEEN_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function ntcIsSeen(id){ return !!ntcSeenMem[id] || ntcSeenIds().indexOf(id) >= 0; }
function ntcMarkSeen(id){
  ntcSeenMem[id] = true;                                   // localStorage недоступний - тримаємо до перезавантаження
  try {
    var a = ntcSeenIds();
    if (a.indexOf(id) < 0) a.push(id);
    localStorage.setItem(NTC_SEEN_KEY, JSON.stringify(a.slice(-50)));
  } catch (e) {}
}

/* Що показувати зараз: повідомлення для всіх; напрямкове - якщо точку ще не обрано, або в точки є цей напрямок, або це екран цього напрямку;
   напрямок, вимкнений у пульті (нема в bootstrap.directions), не показується. */
function noticesFor(){
  var list = (S.boot && S.boot.notices) || [];
  var dirs = (S.boot && S.boot.directions) || {};
  var mine = S.store && S.store.directions;
  return list.filter(function(n){
    if (!n || !n.text) return false;
    if (!n.dir) return true;
    if (!dirs[n.dir]) return false;
    return !mine || mine.indexOf(n.dir) >= 0 || S.dir === n.dir;
  });
}

function ntcText(s){ return esc(s).replace(/\n/g, '<br>'); }

function noticeBannerHtml(list){
  return list.map(function(n){
    return '<div class="nbn"><span class="nbi">i</span><span class="nbt">' + ntcText(n.text) + '</span></div>';
  }).join('');
}

/* Вікно - по одному непрочитаному (modal && не бачили); не поверх нагадування "до дедлайну" і не вдруге при перемальовуванні. */
function noticeModal(list){
  if (el('ntc-ov') || el('rem-ov') || el('chg-ov')) return;
  var n = null;
  for (var i = 0; i < list.length; i++){ if (list[i].modal && !ntcIsSeen(list[i].id)) { n = list[i]; break; } }
  if (!n) return;
  var o = document.createElement('div');
  o.id = 'ntc-ov'; o.className = 'rem-ov';
  o.innerHTML = '<div class="rem-box ntc-box" role="dialog" aria-modal="true" aria-labelledby="ntc-h">' +
    '<h3 id="ntc-h">Повідомлення</h3><p>' + ntcText(n.text) + '</p>' +
    '<button class="rem-go ntc-ok">Зрозуміло</button></div>';
  o.addEventListener('click', function(e){
    var t = e.target, c = (t && t.className) || '';
    if (t !== o && String(c).indexOf('ntc-ok') < 0) return;
    ntcMarkSeen(n.id);
    if (o.parentNode) o.parentNode.removeChild(o);
    renderNotices();                                       // наступне непрочитане, якщо є
  });
  document.body.appendChild(o);
}

function renderNotices(){
  var box = el('nbox');
  if (!box) return;
  var list = noticesFor();
  box.innerHTML = noticeBannerHtml(list);
  noticeModal(list);
}
