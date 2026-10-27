/* Зміна відправленого замовлення на сайті продавця (27.10.2026, інцидент Бучми 32б1: добавка з дозволу задвоїла позиції).
   build-front.js підставляє цей код у сторінку ЗАМІСТЬ lateHtml()/setMode() з app/ui/Index.html (сам app/ui не змінюється).
   Правила: добавок нема. Відправлене замовлення міняється лише заміною (mode 'replace') з підставленим поточним замовленням.
   До дедлайну (або коли закупниця відкрила прийом усім) - без запиту; після - потрібен дозвіл закупниці. Сервер перевіряє все сам. */
function lateHtml(d){
  if (!d || !d.canRequestLate) return '';
  if (d.lateRequest === 'approved')
    return 'Закупниця дозволила ' + (d.alreadyOrdered ? 'змінити замовлення' : 'відправити замовлення') +
      (d.lateLeftMin ? ' - ще <b>' + d.lateLeftMin + ' хв</b>' : '') + '.';
  if (d.lateRequest === 'pending')
    return 'Запит надіслано закупниці. Щойно вона дозволить - ' +
           (d.alreadyOrdered ? 'тут з\'явиться кнопка "Змінити замовлення"' : 'кнопка "Відправити" увімкнеться сама') +
           ', сторінку оновлювати не треба.' +
           (d.lateMailed === false
             ? '<br><br>Сповіщення ще не налаштоване - зателефонуйте закупниці.' : '');
  return 'Прийом на сьогодні закрито (до ' + esc(d.deadline) + '). ' +
         (d.alreadyOrdered ? 'Щоб змінити замовлення' : 'Щоб відправити замовлення') + ', потрібен дозвіл закупниці.' +
         '<button id="askbtn" onclick="askLate()">Попросити дозвіл</button>';
}

/* Замовлення вже є і змінювати його зараз можна (прийом відкритий або є дозвіл): кнопка "Змінити замовлення",
   а в режимі зміни - нагадування, що старе замовлення буде повністю замінене. */
function changeHtml(d){
  if (!d || !d.alreadyOrdered) return '';
  if (!(d.windowOpen || d.lateRequest === 'approved')) return '';
  if (S.edit){
    var i = S.editInfo || {};
    return 'Ви редагуєте замовлення. Було: <b>' + i.positions + ' поз.' +
           (d.hidePrice ? '' : ', ' + money(i.total) + ' грн') + '</b>.' +
           '<button id="cnlbtn" onclick="cancelEdit()">Скасувати</button>';
  }
  return 'Замовлення на сьогодні вже відправлено.' +
         '<button id="chgbtn" onclick="startEdit()">Змінити замовлення</button>';
}

/* Кнопка "Відправити/Замінити" вимкнена? Якщо замовлення вже є - лише поки не натиснули "Змінити замовлення" або коли змінювати
   вже не можна (дедлайн минув, дозвіл спливув). Серверний locked тут не годиться: для вже замовленої точки він завжди true. */
function sendLocked(){
  var d = S.prod;
  if (d.alreadyOrdered) return !(S.edit && (d.windowOpen || d.lateRequest === 'approved')) || !changeLines().length;   // без змін зберігати нічого
  return !!d.locked;
}

function lateBoxHtml(d){
  return [lateHtml(d), changeHtml(d)].filter(function(x){ return !!x; }).join('<br><br>');
}

/* Підставляє в кошик поточне замовлення (з сервера, а не з пам'яті телефону) і вмикає режим заміни. */
function startEdit(){
  var b = el('chgbtn');
  if (b){ b.disabled = true; b.textContent = 'Завантажуємо…'; }
  call('currentOrder', { dir:S.dir, storeId:S.store.id }).then(function(r){
    if (S.screen !== 'prod' || !S.prod) return;
    var known = {};
    S.prod.products.forEach(function(p){ known[p.id] = 1; });
    S.cart = {};
    (r.items || []).forEach(function(it){ if (known[it.id] && it.qty > 0) S.cart[it.id] = it.qty; });
    S.edit = true; S.mode = 'replace';
    S.editInfo = { positions:r.positions, total:r.total, gone:r.gone || [], orig:JSON.parse(JSON.stringify(S.cart)) };
    drawProd();
    if (r.gone && r.gone.length)
      alert('Цих позицій уже нема в асортименті, у нове замовлення вони не потраплять:\n' +
            r.gone.map(function(g){ return g.name + ' × ' + g.qty; }).join('\n'));
  }).catch(function(e){
    alert((e && e.message) || e);
    if (b){ b.disabled = false; b.textContent = 'Змінити замовлення'; }
  });
}

function cancelEdit(){
  S.edit = false; S.mode = 'new'; S.editInfo = null; S.cart = {};
  drawProd();
}

/* Напис на кнопці внизу: у режимі зміни "Зберегти" ("Замінити" збивало з пантелику - ніби замовлення вводять заново). */
function sendLabel(){
  return S.mode === 'replace' ? 'Зберегти' : 'Відправити';
}

/* Що змінилось проти відправленого замовлення: "Назва: 1 → 4", "+ Назва: 2" (додано), "- Назва" (прибрано). */
function changeLines(){
  var i = S.editInfo || {}, orig = i.orig || {}, names = {}, out = [];
  S.prod.products.forEach(function(p){ names[p.id] = p.name; });
  Object.keys(S.cart).forEach(function(id){
    var q = S.cart[id], o = orig[id];
    if (o == null) out.push('+ ' + names[id] + ': ' + q);
    else if (o !== q) out.push(names[id] + ': ' + o + ' → ' + q);
  });
  Object.keys(orig).forEach(function(id){ if (S.cart[id] == null) out.push('- ' + names[id]); });
  (i.gone || []).forEach(function(g){ out.push('- ' + g.name); });
  return out;
}

/* Початок підтвердження перед збереженням: список змін. */
function replaceHead(){
  if (S.mode !== 'replace') return '';
  var lines = changeLines(), shown = lines.slice(0, 12);
  if (lines.length > 12) shown.push('…і ще ' + (lines.length - 12));
  return 'ЗМІНИ:\n' + shown.join('\n') + '\n\n';
}

