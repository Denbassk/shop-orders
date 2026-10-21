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
## Шаг 6б (итог)
- scripts/build-admin.js: Admin.html + include -> public/admin/index.html; app/ui не меняется; блок в конце переопределяет callNet/doLogin/logout (fetch /admin/api, cookie). После правки app/ui: node scripts/build-admin.js (тест сверяет).
- GET /admin -> страница, Cache-Control: no-store.
- Дальше 6в: убрать clearMark/restore/dup/«Сохранить» карточки; wo* - шаг 8.
## Шаг 6в (итог)
- Кнопки бэкап/дубли/снять отметку/сохранить карточку скрыты CSS при сборке (app/ui не тронут); askCard/askClearMark -> подсказка.
- .env: ADMIN_JWT_SECRET, ADMIN_PASSWORD_HASH (новый PIN, не из чата). Четверг: те же -> fly secrets.
- Дальше шаг 7: страница закупщицы /buyer/<dir>.

## Шаг 7а (итог)
- src/buyer/api.js: today (delTodayOrders_/delSheetRefresh_: «N поз. · qty од. · HH:mm», время только ВК/овощи), remove (delCancelOrder_: тексты ✅/⚠ и журнал «Видалено з таблиці» дословно), products, setProduct (цена/стоп/наличие ВК; новое, оригинала нет; журнал «Змінено асортимент»).
- editOrder закупщицы = admEditOrder, dir только из cookie. admin/data.js: dirProducts, setProduct. runtime.js: buyerApi(dir).
- app.js: POST /buyer/<dir>/api, login {pin} -> BUYER_<DIR>_HASH, cookie buy с path /buyer/<dir>; без входа/чужой dir -> 401; неизвестный dir -> 404. Миграция не нужна.
- До Task 11 правку асортимента перезапишет import-reference --force. Продавец видит новую цену через <=30 с (кеш products).
- Дальше 7б: страница server/public/buyer/index.html (GET /buyer/<dir>).
## Шаг 7б (итог)
- server/public/buyer/index.html (GET /buyer/<dir>, no-store, неизвестный dir -> 404): вход PIN, «Замовили сьогодні» (Видалити с confirm, тексты ⏳/❌ DeleteSheet.gs, ответ ✅/⚠ с сервера; «Змінити кількість» -> editOrder), «Асортимент» (поиск, цена, стоп, наличие ВК). Данные в HTML - через esc(); confirm/toast - простой текст (textContent).
- Тест server/test/buyer-page.test.js. Посмотреть локально: в .env BUYER_<DIR>_HASH (например BUYER_BAKERY_HASH), localhost:3000/buyer/bakery.
- Дальше шаг 8: wo* в пульте (нужен код Task 8 - после слияния PR #7 или rebase), шаг 9: проверка и PR.
## Сверка с планом (21.10)
- Перечитаны plans/2026-10-18-node-supabase-migration.md и plans/HANDOFF-genspark.md.
- Task 8: PR #7 (genspark/task-8 -> migration/node-supabase) открыт, не слит. Миграция 000005 применена вручную через SQL Editor (журнал: 20261019000005; таблицы writeoffs, writeoff_lines, admin_log, вью writeoffs_export_pending, products.cost, submit_writeoff_tx).
- Task 9 готово: /admin (сборка из app/ui, fetch /admin/api, PIN -> JWT cookie), today/schedule/stores/dirStores/store/log, cancelOrder/openStore/openAll/closeAll/setDirEnabled, editOrder/batch, health/healthClear/card; /buyer (7а API, 7б страница).
- Отличие от плана: admin_cancel_day/admin_set_qty сделаны не RPC, а UPDATE с условием в admin/data.js; changed_at ставится -> выгрузка.
- РАСХОЖДЕНИЕ с HANDOFF: там вкладка «Точки» = правка stores (галочки, дни, маршрут, зона, примечание). У нас cardSave отложен до Task 11 -> решение владельца.
- Не переносятся: clearMark, restoreScan/Apply, dupScan/Apply (кнопки скрыты).
- Осталось Task 9: 7в вход закупщиц по ссылке; 8 wo* в пульте (woBrief, woStats, woStore, woDelete, woOpen, woArchive, woSetup) - после слияния PR #7; 9 report_at_<dir> из автосборки отчётов; 10 PR genspark/task-9.
- Task 10 (сайт продавца, build-front.js) можно делать в Genspark.
- Секреты Fly к четвергу: ADMIN_JWT_SECRET, ADMIN_PASSWORD_HASH, BUYER_LINK_SECRET (в план Global Constraints не внесены).
- PowerShell: r = псевдоним Invoke-History (не называть функции R); else писать на той же строке, что и }.
## Шаг 7в (итог)
- Решение владельца: закупщицам без PIN. Вход = секретная ссылка /buyer/<dir>/<ключ>, ключ = HMAC-SHA256(BUYER_LINK_SECRET, 'buyer|'+dir), base64url, 24 симв. (src/buyer/link.js).
- Без ключа / неверный / чужой dir -> 404. API: POST /buyer/<dir>/<ключ>/api. Cookie buy, login, BUYER_<DIR>_HASH не нужны.
- Ссылки: node scripts/buyer-links.js [https://адрес] - НЕ в чат. Смена BUYER_LINK_SECRET отзывает все ссылки. Локально секрет уже в .env.
- Страница: KEY из адреса, окно PIN и «Вийти» скрыты CSS (код входа остался мёртвым).
- Тесты: buyer-link.test.js (5), buyer-page: без ключа -> 404.
## Шаг 7г (итог)
- Ссылки закупщиц давали 404 локально: npm start = node src/app.js, .env при запуске не читался, BUYER_LINK_SECRET пуст -> все ключи отклоняются.
- Исправление: app.js (блок require.main) - process.loadEnvFile при запуске; без файла (Fly) - молча. Проверено фактом через npm start: 4 ссылки -> 200, чужой ключ -> 404.
## Пауза Task 9 (21.10)
- Последний коммит: 2d28f40. Тесты 324 / 322 / 2 («золото» Task 7). Ссылки закупщиц проверены фактом (npm start): 4 x 200, чужой ключ 404.
- Вкладка «Точки» (правка stores): вариант Б - пока Table Editor Supabase; в пульте позже (cardSave). Владелец может переиграть.
- Ждёт PR #7: шаг 8 (wo* в пульте), шаг 9 (report_at_<dir> из автосборки). Потом шаг 10: PR genspark/task-9 -> migration/node-supabase.
- Дальше Genspark: Task 10 (сайт продавца) в ветке genspark/task-10 от migration/node-supabase, память plans/genspark-task10.md.
- На ветке task-10 страницы закупщицы и пульта локально НЕТ (они в task-9) - это нормально.
## Шаг 8а (итог)
- Решение владельца 21.10: две закупщицы, одна ссылка на человека: /buyer/bakery/<ключ> (ВК, ключ прежний), /buyer/hlib/<ключ> (Хліб Рома, НБХЗ, Овочі). src/buyer/people.js (BUYERS, dirOf). Ссылки bread/nbhz/veg недействительны (не раздавались).
- API: payload.dir только из списка закупщицы, иначе 403; без dir - первое направление. Действие me - имя и направления.
- Новые действия: info, late (запросы дозволу за день вместо письма; adm.dayLate из src/buyer/data.js), approve/openAll/closeAll/report = функции пульта.
- Excel: GET /buyer/<код>/<ключ>/xlsx/<dir> через сервисный аккаунт (src/buyer/xlsx.js); google.js экспортирует loadCredentials. Живой Google не проверен.
- Почта: SMTP-секреты на Fly не задаём; код писем не удалён.
- PowerShell: не искать 'ℹ' в выводе (кодировка) - шаблон '(?m)\bfail (\d+)\s*$'.
- Дальше 8б: новая страница в стиле пульта.

## Шаг 8б (итог)
- public/buyer/index.html переписана в стиле пульта (CSS Admin.html): шапка с дедлайном и временем отчёта, чипы направлений у hlib (счётчик заявок, выбор в localStorage), вкладки Сьогодні / Дозволи / Прийом / Звіти / Асортимент; на экране шире 900px шире, Сьогодні в 2 колонки.
- Автообновление 30 с: заявки по всем направлениям закупщицы (бейдж, уведомление о новой), Сьогодні; не обновляет при открытой панели и скрытой вкладке.
- Excel: fetch /xlsx/<dir> -> blob, ошибка сервера -> текст в toast. Перезбирання: таймаут 150 с.
- Тексты: ⏳ Видаляю замовлення (DeleteSheet.gs), ответы ✅/⚠ с сервера; ❌ + текст ошибки. Данные из базы в HTML только через esc() (тест построчно).
- test/buyer-page.test.js переписан (4 теста).
- Не сделано: список точек «ещё не заказали», разрешение точке без её заявки.
- Дальше: шаг 9 (report_at_<dir> из автосборки, после PR #7), шаг 8 wo* в пульте (после PR #7), PR genspark/task-9.
