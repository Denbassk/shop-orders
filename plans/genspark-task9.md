# Состояние Genspark (Task 9, обновлено 20.10.2026)

## Как продолжить
- Прислать: этот файл + `git log --oneline -5` + `git status --short`.
- История Task 8 подробно: plans/genspark-status.md в ветке genspark/task-8.

## Правила
- app/*.gs переносить почти дословно; тексты дословно (укр.); логику не «улучшать».
- Сначала красный тест, потом код. Тесты: `npm test` в server/.
- Нельзя: деплой на Fly, import-reference.js, supabase db push, секреты в коде/чате, git add -A / git add . (только точные пути), менять app/, push без команды владельца.
- Не трогать неотслеживаемые: app/VkDiag.gs, server/test/fixtures/*-2026-10-19.json, server/test/reports-golden.test.js (Task 7, докоммитит Claude Code в четверг). Падают 2 теста «золото bread/nbhz» - ожидаемо.
- Блоки PowerShell: без многострочных if/elseif; git add - пути от корня (cd D:\shop-orders); [Console]::OutputEncoding = UTF8.

## Task 8 - итог
- Ветка genspark/task-8 запушена (b99c765), PR в migration/node-supabase (черновик), НЕ сливать до четверга.
- 273 теста, 271 pass, 2 «золото» fail. app/ не тронут, секретов нет.
- Четверг (владелец/Claude Code): supabase db push 000005, settings.wo_books, import-reference --dry/--force, вкладка «Списания» в тестовой таблице, POST /jobs/tick; затем слить PR.

## Task 9 - пульт владельца и страница закупщицы
- Ветка genspark/task-9 от migration/node-supabase (5f01f55). PR - в migration/node-supabase.
- Пульт: AdminJs.html call(action,payload) -> adminApi (Admin.gs:119) -> adm*_ (Admin.gs, AdminTools.gs, Restore.gs, WriteOff.gs: 39 функций).
- Вход сейчас: PIN (adminPin_/adminLogin_/adminCheck_/adminFailCheck_). По плану: ADMIN_PASSWORD_HASH, cookie с подписью (jsonwebtoken + cookie-parser); /buyer/<dir> - BUYER_<DIR>_HASH; admin_cancel_day, admin_set_qty (ставят changed_at -> выгрузка).
- WriteOffAdminJs.html / admWo*_ - последними, после слияния Task 8.
- 1 [готово] Разведка: списки функций UI и сервера.
- 1б [в работе] Чтение adminApi, входа и обёртки call.
## План Task 9
- 1 модуль входа (src/admin/auth.js) | 2 /admin/api: конверт {ok,data,ms}, cookie, login, счётчик в базе | 3 чтение: today, stores, dirStores, store, schedule, log, report | 4 изменения + миграция 000006 (admin_cancel_day, admin_set_qty): cancelOrder, editOrder, clearMark, openStore, openAll, closeAll, setDirEnabled, card, cardSave | 5 health, healthClear, restore*, dup*, batch | 6 UI server/public/admin (fetch) | 7 /buyer/<dir> | 8 wo* после слияния Task 8 | 9 PR.

## Шаг 1 (итог)
- src/admin/auth.js: login(role, pin) / check(token, role). Поле pin и тексты как в Admin.gs ('Невірний PIN', 'Забагато спроб. Спробуйте за годину.', 'PIN ще не задано...'); 5 попыток/час от первой; JWT HS256 12 ч, роль admin | buyer:<dir>; хеш scrypt$salt$hex.
- Новые секреты (на Fly, в четверг, НЕ в чате): ADMIN_JWT_SECRET, ADMIN_PASSWORD_HASH, BUYER_<DIR>_HASH. Хеш: node scripts/hash-password.js.
- Зависимости: jsonwebtoken, cookie-parser. Тест server/test/admin-auth.test.js.

## Шаг 2 (итог)
- POST /admin/api (app.js): только application/json (иначе 415); login {pin} -> cookie adm (JWT, HttpOnly, Secure, SameSite=Strict, Path=/admin, 12 ч), в теле data {} без token; без/с плохой cookie -> {ok:false,error:'AUTH'}; POST /admin/logout стирает cookie.
- src/admin/index.js createAdminApi(handlers): {ok,data,ms}, 'Невідома дія: x', AUTH не логируется. healthNoteError_ - шаг 5.
- src/admin/fails.js: счётчик в settings 'admin_fail:<роль>' (без миграции). src/admin/runtime.js: секреты ADMIN_JWT_SECRET, ADMIN_PASSWORD_HASH, BUYER_<DIR>_HASH; data.js/runtime.js НЕ тронуты (меньше конфликтов с Task 8).
- Для шага 6 (UI): login возвращает {} вместо {token}; запросы fetch JSON с credentials; logout -> POST /admin/logout.

## Решения владельца (20.10)
- PR Task 8: https://github.com/Denbassk/shop-orders/pull/7 (открыт, НЕ сливать до четверга).
- Пароль пульта: те же 4 цифры, пользуется только владелец; хеш scrypt (node scripts/hash-password.js) -> секрет ADMIN_PASSWORD_HASH на Fly в четверг.
- 3 [в работе] Чтение: today, stores, dirStores, store, schedule, log, report.

## Шаг 3а (итог)
- src/admin/read.js: admToday, admDays, admSchedule, admStores - дословно из Admin.gs; 'заказала' = orders в базе по store_id; порядок направлений как в DIRECTIONS; reportAt пока '' (env.reportAt - источник выяснить в 3б).
- src/admin/runtime.js: действия today, schedule, stores. Тест server/test/admin-read.test.js.
- 3б: dirStores, store (строки заказа за день из базы вместо сырого листа), log (admin_log - таблица из миграции Task 8!), report (rebuild + xlsx gid).

## Миграция 000005 применена владельцем (20.10, SQL Editor, одной транзакцией)
- В базе: writeoffs, writeoff_lines, admin_log, вью writeoffs_export_pending, products.cost, submit_writeoff_tx; строка 20261019000005 в supabase_migrations.schema_migrations - db push её пропустит. Код Task 8 на Fly НЕ задеплоен, import-reference НЕ запускался (products.cost пуст).
- Новые миграции Task 9 (000006) - тоже через SQL Editor: один блок begin..commit + запись в журнал + проверка.

## Шаг 3б (итог)
- src/admin/data.js: dayOrders(dir, day) (активные заказы дня с строками), logRows(n) (admin_log). data.js общий НЕ тронут.
- read.js: admDirStores, admStore, admLogRead. Отличия: из базы вместо сырого листа; store.rows[].row = order_lines.id (для editOrder), sheet '' и firstRow = id первой строки; marked = есть активный заказ; xlsx/sheetUrl через env.links (пока не подключено -> ''); STORE_NOT_FOUND временный - сверить с findStore_.
- 3в: report (rebuild + ссылки xlsx через target), текст findStore_.

## Шаг 3в (итог)
- src/admin/links.js: xlsx листа отчёта (bread 'Заказы', bakery 'Заказы ВК', veg 'Замовлення Овочі', nbhz 'Вивантаження дд.мм.рррр') и /edit - в цель EXPORT_TARGET (до Task 11 тестовая); нет листа/сбой -> ''.
- read.js admReport: dirCfg -> 'Невідомий напрямок' -> rebuildReports(force) -> settings report_at_<dir> (ISO) -> admin_log 'Зібрано звіт' (сбой журнала/времени не ломает) -> {at, xlsx}. reportAtOf: HH:mm если сегодня. STORE_NOT_FOUND = текст findStore_ дословно.
- ОТЛОЖЕНО до слияния PR #7: report_at обновлять и при автосборке (общий runtime.js/rebuild.js - меняет Task 8).
- Для шага 6 (UI): AdminJs.html:540 'лист «' + d.sheet + '»' и 'с N-й строки' - sheet теперь '', firstRow = id строки в базе -> убрать/заменить текст.
- Чтение (шаг 3) готово: today, schedule, stores, dirStores, store, log, report. Дальше шаг 4: изменения + миграция 000006.

## Шаг 4б (итог)
- src/admin/write.js: cancelOrder, openStore, openAll, closeAll, setDirEnabled - тексты и журнал дословно (Admin.gs).
- cancelOrder: orders active -> cancelled (changed_at), removed = строки отменённых; строки из листа убирает выгрузка; queueExport из общего runtime через app.js (runtime.js не тронут).
- openStore = data.approveLate, left = 30. openAll/closeAll = settings.late_all[dir]. setDirEnabled = settings.dirs_off.
- clearMark НЕ переносится: отдельной отметки нет, «уже заказала» = активный заказ в базе (транзакция). Кнопку убрать в шаге 6.
- Пульт читает settings без кеша; продавец видит смену в течение 10 с (кеш data.js).
- Не перенесено пока: safeNoteDeleted_ (лист «Видалення замовлення»), nbhz_export_dirty - не нужен (выгрузка сама).
- Дальше: шаг 5 - editOrder, card/cardSave, health, restore*, dup*, batch.
## Шаг 5б (итог)
- editOrder: row = order_lines.id; сверка (есть/название/старое кол-во) до записи; 0 -> строка удалена; пустой заказ -> cancelled; changed_at -> выгрузка перестроит строки точки. Тексты AdminTools.gs дословно.
- Без транзакции: параллельная смена посреди записи -> ошибка «змінився», уже записанное помечено для выгрузки. Пульт - только владелец.
- orders.total после правки не пересчитывается (отчёты/выгрузка считают по строкам).
- batch: ADM_BATCH_OK, до 8, параллельно.
- НЕ переносятся: restoreScan/restoreApply, dupScan/dupApply (чинили лист; на сервере правда - база, выгрузка без дублей), clearMark. Кнопки убрать в шаге 6.
- cardSave отложен до Task 11 (Довідник ТТ - мастер для боя; писать в него с теста нельзя). card (чтение из базы) - шаг 5в.
- Дальше 5в: health/healthClear/healthNoteError (без триггеров и буфера), card.
## Шаг 5в (итог)
- src/admin/tools.js: health (уровни/тексты AdminTools.gs; без триггеров/буфера/замков; HEALTH_STALE_MIN из app), healthClear, noteError -> settings.health_err (20, 300 симв.), card из базы (row=null, note='').
- Ошибки пульта (кроме AUTH) пишутся в health_err в фоне (runtime.js apiNoted).
- ВАЖНО шаг 9 (после слияния PR #7): автосборка отчётов должна писать settings report_at_<dir> (adm.setReportAt), иначе health = «отчёт не собирался».
- cardSave - Task 11.
- Дальше шаг 6: UI пульта server/public/admin/ (fetch /admin/api), убрать кнопки clearMark/restore/dup/сохранение карточки.