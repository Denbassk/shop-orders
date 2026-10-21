# Node-сервер (перенос з Apps Script) і сторінка закупниці

Стан на 21.10.2026. Перенос: Node 22 + Express + Supabase + Fly.io, код у `server\`.
План: plans/2026-10-18-node-supabase-migration.md. Правила Genspark: plans/HANDOFF-genspark.md.
Статус: genspark/task-8 -> plans/genspark-status.md; genspark/task-9 -> plans/genspark-task9.md.

## Як запускати

- Усе з `D:\shop-orders\server` (там package.json). З `D:\shop-orders` npm дає ENOENT.
- `npm start` (сервер), `node scripts/buyer-links.js` (посилання закупниць).
- Тести `node --test "test/**/*.test.js"`; 2 падіння «золото bread/nbhz» очікувані (Task 7).
- `git commit -q` мовчить, номер коміту видно через `git log --oneline -1`.
- git add лише точними шляхами. Не чіпати: app/VkDiag.gs, test/fixtures/*-2026-10-19.json,
  test/reports-golden.test.js (докомітить Claude Code).

## Заборонено в Genspark

Змінювати app/ (бойовий Apps Script), clasp push, деплой на Fly, Task 11, push у main.
src/reports має збігатися з боєм (reports-golden), логіку не «покращувати».

## Закупниці (src/buyer, Task 9)

- bakery = Юля (випічка); hlib = Світлана (хліб, НБХЗ, овочі). Підпис посилань HMAC, BUYER_LINK_SECRET у .env.
- Вкладки: Сьогодні, Дозволи, Прийом, Звіти, Асортимент; автооновлення 30 с.
- sheets.js: каталог листів (звіти + службові), НБХЗ = останні 3 «Вивантаження ДД.ММ.РРРР»;
  clean() прибирає «3,» -> «3» лише для цілих. summary.js: зведення на «Сьогодні». xlsx.js: Excel листа.
- buyer-page.test.js: дані в HTML лише через esc( прямо в рядку виклику.

## Формат «3,»

Причина: формат 0.### (розділювач показується завжди). Excel і таблиці поки з комою.
Виправлення лише в четвер: app/ + src/reports разом, clasp push, нові фікстури.
## Excel без «3,» і пульт (21.10.2026, вечір)

- Excel листа збирає сервер (src/buyer/xlsxLocal.js) з очищених значень sheets.read, без залежностей.
  Цілі до 7 цифр і числа з комою - числами; довші цифри (штрихкоди, ЄДРПОУ) - текстом.
  Шапка закріплена, рядки РАЗОМ/ВСЬОГО/ЗАГАЛОМ жирні. Підключено через fetchFn у createXlsx
  (ім'я файлу і перевірки старі). Не вдалось - Google, як раніше (лог «[xlsxLocal] fallback»).
  BUYER_XLSX=google у .env - завжди Google. app/ і бойові таблиці не чіпали.
- Пульт (server/public/admin, вхід за паролем) - ТІЛЬКИ для власника (Денис).
  Закупниці працюють лише на /buyer за своїм посиланням; пульт їм не дають.
- Точки: редагування через Supabase Table Editor (коміт 7b52219).