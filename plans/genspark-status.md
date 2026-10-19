# Состояние работы в Genspark (обновлять каждый шаг)

Обновлено: 19.10.2026. Task 8 (списания), шаг 6.

## Как продолжить в новом чате
Прислать: содержимое этого файла + вывод `git log --oneline -5` + `git status --short`.

## Правила (кратко)
- Переносим app/*.gs почти дословно; тексты продавца дословно (укр.); логику не «улучшаем».
- Сначала красный тест, потом код. Тесты: `npm test` в server/.
- Списание ВК: +20% (WO_MARKUP 0.20), не 15%.
- Нельзя: деплой на Fly, import-reference.js, supabase db push, секреты в коде/чате,
  git add -A / git add . (только точные пути), менять app/, push без команды владельца.
- Не трогать неотслеживаемые: app/VkDiag.gs, server/test/fixtures/*-2026-10-19.json,
  server/test/reports-golden.test.js (Task 7, докоммитит Claude Code в четверг).
- Падают 2 теста «золото bread», «золото nbhz» (из reports-golden) - ожидаемо.
- Каждый шаг Genspark даёт готовый блок PowerShell (cd + запись файлов в UTF-8).
- Crawler не может скачать середину app/WriteOff.gs (raw 400) - тексты брать из вывода у владельца.

## Ветка
genspark/task-8 от migration/node-supabase. PR - в migration/node-supabase, не в main.

## Task 8 - план и статус
1. [готово] Ветка, базовый прогон: 227 тестов, 225 pass, 2 fail (золото Task 7).
2. [готово] server/test/api-writeoff.test.js, server/src/api/writeoff.js,
   server/src/api/index.js (case woProducts/woSubmit/woMine/woDelete). 12/12 зелёные.
2г. [готово] Все 16 текстов есть в writeoff.js. Коммит 2e011f7 (без push).
3. [в работе] 3а: сверка порядка проверок и полей ответа с оригиналом; 3б: тесты-оракул: настоящий app/WriteOff.gs в vm (server/scripts/gas-oracle.js) против writeoff.js.
4. Миграция supabase/migrations/20261019000005_writeoff.sql: writeoffs, writeoff_lines,
   admin_log, функция submit_writeoff_tx (повтор doc_id -> duplicate). Только файл, НЕ применять.
5. server/src/woData.js - слой данных Supabase для списаний (тесты с базой без секретов пропускаются).
6. server/src/export/writeoff.js - выгрузка в лист «Списания» (подменный Google) + тесты.
7. Подключение: runtime.js (queueWoExport), jobs.js (tick), raw.js при необходимости.
8. Полный npm test, PR genspark/task-8 -> migration/node-supabase.
Четверг (владелец/Claude Code): supabase db push, проверка submit_writeoff_tx,
import-reference.js, тестовая вкладка «Списания», POST /jobs/tick.

## Принятые решения Task 8
- Источник правды: writeoffs/writeoff_lines; лист «Списания» - только выгрузка.
- costCol=true: в списке товары с себестоимостью > 0, «стоп» не важен.
- woMine: окно 31 день (WO_KEEP_DAYS). time в ответе HH:mm.
- BREAD_EDRPOU = '44413718' константой. Удаления пишутся в admin_log.
- До переключения (Task 11) выгрузка идёт в тестовую таблицу.
- Блокировки (lock.tryLock) не переносим: их заменяет транзакция.

## Тексты ошибок WriteOff.gs (оригинал, номер строки)
368 Для цієї ТТ списання випічки не передбачене
392 Оновіть сторінку і спробуйте ще раз   (docId !~ /^[a-z0-9]{8,40}$/i)
394 Прийом списань на сьогодні закрито о ' + WO_DEADLINE + '. Подати можна завтра до ' + WO_DEADLINE + '.
398 Списання подається лише за сьогодні - оновіть сторінку
403 Вкажіть прізвище продавця, який подає списання
412 Для цієї точки ще не налаштовано прийом списань. Повідомте керівника.
420 Товар не знайдено в асортименті - оновіть сторінку
426 Не вибрано жодного товару                      [сверено]
427 Забагато позицій в одному списанні             [сверено]
434 Перевірте кількість: ' + p.name + ' - ' + q
501 Після ' + WO_DEADLINE + ' видалити списання вже не можна. Зверніться до керівника.
504 Це списання іншої точки
506 Видалити можна лише списання, подане сьогодні
508 Списання не знайдено - можливо, його вже видалили  [сверено]
516 Невірний ID списання   (woDelete, docId !~ /^[a-z0-9]{8,40}$/i)
Не переносим: 52/450/520 (lock), 456 (лист), 117 (setup), 562 (архив, Task 10), 807 (пульт, Task 9).
## Оригинал apiWo*_ (WriteOff.gs, строки 360-524) - ключевое
- woStoreChecked_: нет bakery у точки -> 'Для цієї ТТ списання випічки не передбачене'.
- woProducts ответ: products [{id,name,category}] БЕЗ цен, categories, costCol, dates, closed, deadline, hasBook.
- woSubmit порядок: docId /^[a-z0-9]{8,40}$/i -> точка -> woClosed_ -> date в woAllowedDates_().v
  -> seller (пробелы схлопнуть, trim, 2..40, 2 буквы подряд) -> повтор oid_wo_ (duplicate:true)
  -> книга юрлица по ЄДРПОУ -> товары: неизвестный id = ошибка; qty с запятой; q<=0 пропуск;
  одинаковые id складываются (округл. 0.001) -> пусто -> >WO_MAX_ITEMS -> по позиции q>WO_MAX_QTY.
  Сумма позиции round(price*q*100)/100, колонка woPlus_(s). Строка листа (14 кол.):
  docId, now, wdate, label, code, category, barcode, name, q, price, s, woPlus_(s), seller, store.id.
  result: docId, store(label), woDate, seller, positions, qty, total, time HH:mm, date=woToday_(); duplicate:false.
- woMine: docs точки; canDelete = !closed && подано сегодня; total за всё; month с 1-го числа;
  items только {name, qty}; + closed, deadline, keepDays.
- woDelete: точка -> closed ('Після ...') -> docId ('Невірний ID списання') -> чужая точка -> не сегодня
  -> не найдено. adminLog('Продавець видалив списання', label + ' - за ' + date + ', позицій ' + removed
  + ', ' + total + ' грн (ID ' + docId + ')'). Возврат res из woDeleteDoc_.
## Сверка 3а (итог) - writeoff.js против оригинала
- Совпадает: порядок проверок woSubmit/woDelete, фамилия, запятая в qty, q<=0 пропуск, слияние id,
  поля ответов, canDelete/month, формат at, текст журнала.
- ИСПРАВИТЬ (шаги 4-5): после удаления docId можно подать заново (оригинал удаляет oid_wo_).
  woResult - игнорировать удалённые; уникальность doc_id - частичный индекс where deleted_at is null.
- Выяснить: тело woOpenedAll_ (у меня wo_late === сегодня); окно woMine (оригинал: всё до архива, у меня 31 день).
- Отступления (оставлены): дедлайн из settings.wo_deadline с запасным WO_DEADLINE;
  items не массив -> 'Не вибрано жодного товару' вместо TypeError.
- СЛОМАН мной: тест «диспетчер: невідома дія як в Apps Script» (после замены api/index.js) - чинить первым.
- Тесты сейчас: 239 / 236 pass / 3 fail (диспетчер + 2 золото).
## Шаг 3б-4 (итог)
- Тест диспетчера чинён в app.test.js: он был заглушкой «woSubmit = Невідома дія» до Task 8;
  теперь ждёт 'Оновіть сторінку і спробуйте ще раз'. api/index.js менялся только 4 case.
- woOpenedAll_ = wo_late === woToday_() (ДД.ММ.РРРР) - совпадает. settings: wo_late строка ДД.ММ.РРРР,
  wo_books {edrpou: {id, name}}.
- woMine: оригинал читает только лист «Списания» (архив ночью уносит старше 31 дня) = окно 31 день.
- Шаг 4 [готово, НЕ применено]: supabase/migrations/20261019000005_writeoff.sql - products.cost,
  writeoffs (deleted_at, exported_at, частичный unique doc_id), writeoff_lines, admin_log,
  submit_writeoff_tx (advisory lock + unique_violation -> duplicate). Тест: server/test/migration-writeoff.test.js.
- Дальше шаг 5: server/src/data.js - woResult (без удалённых), submitWriteoffTx, woDocsOfStore,
  woFind, woMarkDeleted (update ... where deleted_at is null), adminLog; тесты с базой - пропуск,
  если таблицы writeoffs нет (миграция ещё не применена). Проверить, что import-reference заполняет products.cost.
- Четверг владельцу: supabase db push (000005), затем import-reference (cost), затем тесты БД списаний.

## Шаг 5 (итог)
- Шаг 4 закоммичен дважды (368d468, f014371 - блок вставлен 2 раза); код верный, 243/241/2.
- data.js: woResult, submitWriteoffTx, woDocsOfStore (gte wo_date), woFind, woMarkDeleted, adminLog.
  Тест: server/test/data-writeoff.test.js (подменный Supabase).
- import/parse.js: costIdxOf(header) + parseSheetProducts(..., header) -> products.cost для bakery.
  Тест: server/test/parse-cost.test.js. ОСТАЛОСЬ: reference.js должен передать строку заголовка и
  читать лист до колонки себестоимости (шаг 6). Импорт с cost - только ПОСЛЕ db push 000005.
- Известные отличия от woProducts_ (для пульта, Task 9): парсер отбрасывает не-«стоп» без штрихкода/цены,
  хотя с себестоимостью оригинал бы их взял; дубли id в оригинале -> id#r, в базе (dir,id) уникален.
- Дальше: 6 - reference.js (cost); 7 - export/writeoff.js (лист «Списания», 14 колонок WO_HEAD) + тесты;
  8 - runtime.js (queueWoExport), jobs.js (tick); 9 - полный прогон, PR.
## Шаг 6 (итог)
- scripts/import-reference.js: випечка читается 'A1:Z' с шапкой -> parseSheetProducts(..., header) -> cost;
  нет колонки себестоимости -> warning. Хлеб без изменений (A2:F).
- DEFAULT_SETTINGS + wo_books {} и wo_late '' (ignoreDuplicates - живые значения не затираются).
  Тест: server/test/import-reference-cost.test.js (google через require.cache).
- ЧЕТВЕРГ ВЛАДЕЛЬЦУ (порядок): 1) supabase db push (000005); 2) в Apps Script выполнить
  Logger.log(PropertiesService.getScriptProperties().getProperty('wo_books')) и вставить JSON
  в settings.wo_books (Table Editor); 3) import-reference --dry -> проверить «випічка» и нет warning
  о себестоимости; 4) import-reference --force (затрёт правки stores/products из Table Editor!).
- Дальше шаг 7: export/writeoff.js - выгрузка writeoffs в лист «Списания» (WO_HEAD, 14 колонок) + тесты.