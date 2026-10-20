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
