// ============================================================
// СОБІВАРТІСТЬ ДЛЯ СПИСАНЬ - заповнення колонки "Себестоимость"
// у листі "Ассортимент" випічки з довідки бухгалтерії (xlsx, вкладки
// "Випічка" і "Кулінарія", шапка блоку: назва / собів / ціна / нац).
//
// Назви в довідці і в "Ассортименті" пишуться по-різному ("Борщ 0,450г"
// проти "Борщ 450г", "прованс." проти "прованськими"), тому зіставлення:
//   1) однакова назва без ваги + однакова вага  -> точно;
//   2) схожа назва (слова, скорочення з крапкою) + та сама вага  -> впевнено;
//   3) схожа назва + та сама продажна ціна, що в колонці D  -> впевнено.
// Решта НЕ пишеться, а виводиться списком "не знайшлось" / "під питанням".
//
// w05_previewCosts() - лише показати, що з чим зіставилось (нічого не пише)
// w06_fillCosts()    - записати впевнені збіги в колонку "Себестоимость"
// Нова довідка: замінити рядки в COST_SOURCE і запустити ще раз.
// ============================================================

// [вкладка, назва як у довідці, собівартість, продажна ціна з довідки]
var COST_SOURCE = [
  ['Випічка', 'Піца з ковбасками 350г', 33.21, 55],
  ['Випічка', 'Хліб Мюнхенський 500г', 11.07, 36],
  ['Випічка', 'Хліб Козацький 500г', 12.38, 38.5],
  ['Випічка', 'Пампушка з часником 300г', 12.65, 37.5],
  ['Випічка', 'Хліб Селянський 400г', 9.57, 28.7],
  ['Випічка', 'Чіабатта з прованс.травами 450г', 10.79, 29.5],
  ['Випічка', 'Чіабатта з сиром 530г', 10.79, 39.5],
  ['Випічка', 'Сосиска в тісті, 1шт', 11.49, 29.5],
  ['Кулінарія', 'Обід Картопля+рубл.котлета 300г', 27.53, 70],
  ['Кулінарія', 'Окрошка 500г', 26.61, 69.6],
  ['Кулінарія', 'Салат з крабовими паличками 180гр', 24.01, 45],
  ['Кулінарія', 'Салат з курячим філе та сиром 175г', 35.88, 62],
  ['Кулінарія', 'Салат Олів\'є 165г', 12.22, 43],
  ['Кулінарія', 'Салат Оселедець п/шубою 195г', 21.7, 50],
  ['Кулінарія', 'Обід Гречана каша з нагетсами+соус 380г', 44.44, 80],
  ['Кулінарія', 'Борщ 0,450г', 22.85, 48],
  ['Кулінарія', 'Салат Буряк з часником 180г', 8.5, 20],
  ['Кулінарія', 'Солянка 0,330г', 32.68, 65],
  ['Кулінарія', 'Вінегрет 0,250г', 10.92, 40],
  ['Кулінарія', 'Салат Гриби з куркою0,180гр', 35.67, 65],
  ['Кулінарія', 'Салат з серцем 0,175гр', 12.06, 50]
];

// Вага в грамах: "350г", "180гр", "0,450г" (= 450 г), "1,2кг", "500мл"
function costWeight_(s) {
  var m = String(s).toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(кг|гр|г|мл|л)(?![а-яіїєґa-z])/);
  if (!m) return 0;
  var v = parseFloat(m[1].replace(',', '.'));
  var u = m[2];
  if (u === 'кг' || u === 'л' || v < 5) v = v * 1000;     // 0,450г - це 450 г
  return Math.round(v);
}

// Латинські літери-двійники в кириличній назві ("Чiабата" з латинською i)
var COST_LAT = { a: 'а', c: 'с', e: 'е', i: 'і', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в' };

// Слова назви без ваги, штук, чисел і розділових знаків
function costWords_(s) {
  return String(s).toLowerCase()
    .replace(/[aceiopxykmthb]/g, function (ch) { return COST_LAT[ch] || ch; })
    .replace(/[\u00a0\u2009\u202f]/g, ' ')
    .replace(/[’ʼ'`"«»]/g, '')
    .replace(/(\d+(?:[.,]\d+)?)\s*(кг|гр|г|мл|л|шт)(?![а-яіїєґa-z])/g, ' ')
    .replace(/\.(?=[a-zа-яіїєґ])/g, '. ')               // "прованс.травами" -> два слова
    .replace(/[^a-zа-яіїєґ0-9.]+/g, ' ')
    .split(' ')
    .map(function (w) { return w.replace(/\.+$/, ''); })
    .filter(function (w) { return w && !/\d/.test(w) && w !== 'з' && w !== 'та' && w !== 'і' && w !== 'в' && w !== 'и' && w !== 'с'; });
}

// Слова збігаються: однакові, одне - скорочення іншого (від 4 літер),
// або різняться лише закінченням ("пампушка" / "пампушки")
function costWordEq_(a, b) {
  if (a === b) return true;
  var s = a.length < b.length ? a : b, l = a.length < b.length ? b : a;
  if (s.length >= 4 && l.indexOf(s) === 0) return true;
  var k = 0;
  while (k < s.length && s[k] === l[k]) k++;
  return s.length >= 5 && k >= s.length - 1 && l.length - s.length <= 1;
}

// Частка слів, що збіглися (0..1), по більшій з двох назв
function costScore_(a, b) {
  var wa = costWords_(a), wb = costWords_(b);
  if (!wa.length || !wb.length) return 0;
  var used = {}, hit = 0;
  wa.forEach(function (x) {
    for (var j = 0; j < wb.length; j++) {
      if (used[j] || !costWordEq_(x, wb[j])) continue;
      used[j] = 1; hit++; break;
    }
  });
  return hit / Math.max(wa.length, wb.length);
}

// Зіставлення довідки з "Ассортиментом". Повертає план без запису.
function costPlan_() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(cfg.productsSheet);
  if (!sh || sh.getLastRow() < 2) throw new Error('Лист "' + cfg.productsSheet + '" порожній');
  var w = Math.max(sh.getLastColumn(), 6);
  var data = sh.getRange(1, 1, sh.getLastRow(), w).getValues();
  var col = -1;
  data[0].forEach(function (h, i) { if (col < 0 && /собів|себест/i.test(String(h))) col = i; });
  if (col < 0) throw new Error('Немає колонки "Себестоимость" - спершу запустіть w04_addCostColumn');

  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var name = String(data[r][4] || '').trim();
    if (!name) continue;
    var cat = String(data[r][1] || '').trim();
    // у назві спереду буває категорія ("Кулінарія Борщ ...") - для порівняння її прибрати
    var bare = name.replace(/^(випічка|кулінарія)\s+/i, '');
    if (cat && bare.toLowerCase().indexOf(cat.toLowerCase() + ' ') === 0) bare = bare.slice(cat.length + 1);
    rows.push({ row: r + 1, name: name, bare: bare, cat: cat,
                price: parseFloat(String(data[r][3] || '').replace(',', '.')) || 0,
                weight: costWeight_(name), old: data[r][col] });
  }

  var sure = [], doubt = [], none = [];
  COST_SOURCE.forEach(function (src) {
    var sw = costWeight_(src[1]);
    var best = [], bestScore = 0;
    rows.forEach(function (x) {
      var sc = costScore_(src[1], x.bare);
      if (sc <= 0) return;
      var wOk = !sw || !x.weight || sw === x.weight;
      var pOk = src[3] > 0 && Math.abs(x.price - src[3]) < 0.011;
      // вага різна - це інший товар (180г і 250г), навіть якщо назва та сама;
      // але та сама назва і та сама ціна - той самий товар, вагу записали по-різному
      var wDiff = sw && x.weight && sw !== x.weight;
      if (wDiff && !(sc === 1 && pOk)) sc = sc * 0.5;
      var how = (sc === 1 && wDiff) ? 'та сама назва і ціна, вага різна: ' + sw + 'г / ' + x.weight + 'г'
              : (sc === 1 && wOk) ? 'точно'
              : (sc >= 0.75 && wOk) ? 'схожа назва, та сама вага'
              : (sc >= 0.5 && pOk) ? 'схожа назва, та сама ціна'
              : '';
      var key = sc + (pOk ? 0.01 : 0);
      if (key > bestScore) { bestScore = key; best = [{ x: x, how: how, sc: sc }]; }
      else if (key === bestScore) best.push({ x: x, how: how, sc: sc });
    });
    var item = { tab: src[0], name: src[1], cost: src[2], price: src[3] };
    if (!best.length) { none.push(item); return; }
    if (best[0].how && best.length <= 2) {
      best.forEach(function (b) { sure.push({ src: item, row: b.x.row, name: b.x.name, how: b.how, old: b.x.old }); });
    } else {
      doubt.push({ src: item, cands: best.slice(0, 3).map(function (b) {
        return b.x.name + ' (рядок ' + b.x.row + ', ціна ' + b.x.price + ', вага ' + b.x.weight +
               'г / в довідці ' + sw + 'г, схожість ' + Math.round(b.sc * 100) + '%)';
      }) });
    }
  });
  return { sheet: sh, col: col + 1, sure: sure, doubt: doubt, none: none };
}

function costReport_(p) {
  console.log('ЗІСТАВИЛОСЬ (' + p.sure.length + '):');
  p.sure.forEach(function (m) {
    console.log('  рядок ' + m.row + ': ' + m.name + '  <-  ' + m.src.name + ' = ' + m.src.cost +
                ' грн  [' + m.how + ']' + (m.old !== '' && m.old != null ? ' (було ' + m.old + ')' : ''));
  });
  if (p.doubt.length) {
    console.log('ПІД ПИТАННЯМ - не пишу (' + p.doubt.length + '):');
    p.doubt.forEach(function (d) {
      console.log('  ' + d.src.name + ' = ' + d.src.cost + '  ?  ' + d.cands.join(' | '));
    });
  }
  if (p.none.length) {
    console.log('НЕ ЗНАЙШЛОСЬ в "Ассортименті" (' + p.none.length + '):');
    p.none.forEach(function (n) { console.log('  ' + n.tab + ': ' + n.name + ' = ' + n.cost); });
  }
}
