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
    return 'Ви змінюєте замовлення: було <b>' + i.positions + ' поз.' +
           (d.hidePrice ? '' : ', ' + money(i.total) + ' грн') + '</b>.<br>' +
           'Після відправки воно <b>повністю замінюється</b> тим, що зараз у кошику.' +
           '<button id="cnlbtn" onclick="cancelEdit()">Скасувати зміну</button>';
  }
  return 'Замовлення на сьогодні вже відправлено.' +
         '<button id="chgbtn" onclick="startEdit()">Змінити замовлення</button>';
}

/* Кнопка "Відправити/Замінити" вимкнена? Якщо замовлення вже є - лише поки не натиснули "Змінити замовлення" або коли змінювати
   вже не можна (дедлайн минув, дозвіл спливув). Серверний locked тут не годиться: для вже замовленої точки він завжди true. */
function sendLocked(){
  var d = S.prod;
  if (d.alreadyOrdered) return !(S.edit && (d.windowOpen || d.lateRequest === 'approved'));
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
    S.editInfo = { positions:r.positions, total:r.total };
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

/* Початок підтвердження перед відправкою: у режимі заміни показує, що саме замінюється. */
function replaceHead(){
  if (S.mode !== 'replace') return '';
  var i = S.editInfo || {};
  return 'УВАГА: попереднє замовлення (' + i.positions + ' поз.' +
         (S.prod.hidePrice ? '' : ', ' + money(i.total) + ' грн') + ')\nбуде ПОВНІСТЮ ЗАМІНЕНЕ на це.\n\n';
}

