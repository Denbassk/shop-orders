# Перенос замовлень з Apps Script на Node + Supabase - план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** увесь застосунок (сайт продавця, списання, пульт, сторінка закупниці, звіти) працює на Node.js + Supabase; Google лишається лише як (а) куди пишуться сирі листи і звіти закупницям, (б) прайс постачальника овочів, який читаємо. Apps Script вимикається.

**Architecture:**
- `server/` - Node 22, Express (як `D:\Shifts-api`), один процес: статика (сайт, пульт), `POST /api` (той самий конверт `{ok,data}|{ok,error}`, ті самі дії, що `api()` у `app/Code.gs`), `POST /admin/api`, `POST /jobs/*` (секрет у заголовку), сторінка схвалення дозволу.
- Правила і звіти - перенесені з `app/*.gs` майже дослівно (той самий JS); `Sheets.Spreadsheets.*` → `googleapis` (`sheets.spreadsheets.*`, ті самі JSON-запити, що `apiSheetWriter_`), `PropertiesService` → таблиці бази.
- Атомарні записи (замовлення + рядки, заміна, скасування) - plpgsql-функції, які сервер викликає через `supabase-js` `rpc()`; решта - звичайні `select/insert` через `supabase-js` з `service_role`.
- Вигрузка в Google: одразу після відповіді продавцю (в тому ж процесі) + страховка `POST /jobs/tick` з GitHub Actions кожні 10 хв 7:00-22:00 (машина Fly спить між запитами - `auto_stop_machines="suspend"`, `min_machines_running=0`).
- Fly `fra` (поруч із Supabase eu-central-1). Деплой - GitHub Action при push у `main`, як у зарплатному проекті. Бекап - нічний GitHub Action за зразком `D:\Shifts-api\Shifts-api\scripts\backup-db.cjs` (Supabase → Google Drive).

**Tech Stack:** Node 22, express, @supabase/supabase-js, googleapis (сервісний акаунт), nodemailer (Gmail SMTP з паролем застосунку), node:test, Supabase CLI, flyctl, GitHub Actions.

**Spec:** домовленості в чаті 18.10.2026:
- продавці нічого не помічають, без PIN; адреса сайту може змінитись;
- Довідник і асортимент - у Supabase: власник править у Table Editor, закупниці - на своїй сторінці;
- видаляє замовлення закупниця;
- сирі листи ніхто не править - ставимо захист;
- Fly - безкоштовно або копійки (машина спить);
- переключення ввечері після всіх дедлайнів з імпортом сьогоднішніх замовлень;
- бекап як у зарплатному проекті.

## Global Constraints

- Тексти, які бачать продавець і закупниця, - дослівно з `app/*.gs` і `app/ui/*.html` (українською); відповіді `/api` - ті самі поля, що повертають відповідні `api*_` у Apps Script.
- Час і дата - Europe/Kyiv (`Intl.DateTimeFormat` з `timeZone:'Europe/Kyiv'`), дата в базі `date`, у листах `ДД.ММ.РРРР`, час `HH:mm:ss`.
- Ключ точки - `store_id` = `canonKey_(адреса)` як у `loadStores_`; ключ сирого листа - `statusKey_`/`addrKey_`/`shortenAddress_`, перенесені без змін.
- Секрети - лише у `fly secrets` і GitHub Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SA_JSON`, `SMTP_USER`, `SMTP_PASS`, `JOBS_SECRET`, `ADMIN_PASSWORD_HASH`. Локально - `server/.env` (у `.gitignore`). У git і в чаті - нічого.
- Таблиці бази з RLS без політик (браузер у базу напряму не ходить, лише через сервер).
- Тестові дані: `store_id` з префіксом `test-`; вигрузка в Google їх пропускає.
- Fly: деплой лише `fly deploy --remote-only --ha=false` (одна машина; без `--ha=false` Fly створює другу, а нам потрібна одна, що спить). У `server-deploy.yml` це вже так.
- Apps Script не вимикається, поки не пройде Task 11; до того бойовий `/exec` = `@67`.

## Review Focus

1. Fly присипляє машину, поки вигрузка після відповіді ще йде → рядки не дописані. Що очікує людина: замовлення в листі за ≤ 10 хв. Тест у Task 5: вигрузка ідемпотентна (дедуп), `/jobs/tick` дописує невигружене.
2. Таблиця ВК висить (як 18.10) → продавець цього не помічає, решта напрямків вигружаються. Тест у Task 5: тайм-аут запиту до Google 30 с, напрямок пропускається до наступного тіка.
3. Перший запит після сну Fly → продавець чекає не довше ~2-3 с. Перевірка в Task 11 (заміри з телефона).
4. Звіт закупниці виглядає інакше, ніж з Apps Script (порядок, суми, форматування). Тест у Task 6-7: золоті тести - той самий день, ті самі рядки, порівняння значень комірок з листами, які побудував Apps Script.
5. Дві відправки однієї точки одночасно → рівно одне замовлення (унікальний індекс). Тест у Task 4.

---

### Task 0 (власник, 15 хв): доступи

- [ ] Google Cloud → IAM → Service Accounts → створити `shop-orders`, ключ JSON → зберегти як `%USERPROFILE%\.secrets\shop-orders-sa.json`.
- [ ] Надати email сервісного акаунта права «Редактор» на таблиці: Довідник, хліб, НБХЗ, ВК, овочі, прайс овочів (читання), бекап.
- [ ] Gmail → Пароль застосунку для пошти, з якої йдуть листи закупницям → `%USERPROFILE%\.secrets\shop-orders-smtp.txt`.
- [ ] Supabase: Project Settings → API Keys → secret key → `%USERPROFILE%\.secrets\shop-orders-sb.env` (`SUPABASE_URL=…`, `SUPABASE_SERVICE_ROLE_KEY=…`).

### Task 1: Схема бази і разовий імпорт довідників

**Files:**
- Create: `supabase/migrations/20261019000001_schema.sql`, `server/package.json`, `server/src/google.js`, `server/scripts/import-reference.js`, `server/test/import.test.js`

**Interfaces:**
- Produces (таблиці):
  - `stores(store_id text pk, active bool, label, address, code, route, type, addr_bread, addr_bakery, addr_veg, addr_nbhz, route_nbhz, zone, edrpou, bread/nbhz/bakery/veg bool, days_veg text, days_bakery text, note text, sort int)` - колонки як у Довіднику ТТ (міграція `20261019000002_stores_columns.sql`); `days_*` - текст «Пн, Ср» як у листі, у масиви розбирає код (`parseDays` у `rules.js`, `rowToStore` у `db.js` дає об'єкт у формі `loadStores_()`);
  - `products(dir text, id text, barcode, name, price numeric(12,2), category, availability, box, status text default 'active' check in ('active','stop'), sort int, primary key(dir,id))`;
  - `directions(dir pk, cfg jsonb)` - статичні поля `DIRECTIONS` з `app/Config.gs` + `min_order_changes`;
  - `settings(key pk, value jsonb)` - `dirs_off`, `late_all`, `app_version`, `test_mode`, `wo_deadline`;
  - `orders(id uuid pk default gen_random_uuid(), order_id text not null unique, dir text not null → directions, store_id text not null, order_date date not null, status text not null default 'active' check in ('active','cancelled'), is_addon bool not null default false, total numeric(12,2) not null default 0, result jsonb, created_at timestamptz default now(), changed_at timestamptz default now(), exported_at timestamptz)` - `order_id` = ключ ідемпотентності від клієнта, `result` = збережена відповідь для повтору; `store_id` без FK (тестові точки `test-…`); частковий унікальний індекс `orders_one_active_per_day (dir, store_id, order_date) where status='active' and not is_addon`; індекс вигрузки `orders_export_idx (dir, changed_at) where exported_at is null or exported_at < changed_at`;
  - `order_lines(id bigint identity pk, order_pk uuid not null → orders(id) on delete cascade, line_no int not null, product_id text not null, barcode text default '', name text not null, price numeric(12,2) default 0, qty numeric(12,3) not null check (qty > 0))`;
  - `late_requests(id uuid pk, dir → directions, store_id text, req_date date, status text default 'pending' check in ('pending','approved'), requested_at timestamptz default now(), approved_at timestamptz, unique(dir, store_id, req_date))`.
  - RLS увімкнено на всіх семи таблицях, політик немає. Фактична міграція - `supabase/migrations/20261019000001_schema.sql` (Task 4 опирається на неї, а не на цей опис).
- Produces: `server/src/google.js` - `sheetsClient()` (сервісний акаунт з `GOOGLE_SA_JSON` або файлу), `getValues(id, a1, {formatted})`, `batchUpdate(id, requests)`, `appendValues(id, a1, rows)`; тайм-аут 30 с.
- Produces: `node server/scripts/import-reference.js [--dry]` - читає Довідник (`A2:T`, правила `loadStores_`) і листи «Ассортимент» напрямків (правила `loadSheetProducts_`/`loadNbhzSheetProducts_`, разом з `стоп` → `status='stop'`), пише в базу; `--dry` друкує кількості.
- [ ] **Step 1:** `npx supabase init`, `npx supabase link --project-ref gfbmeevfgxwcgcervdum`, міграція, `npx supabase db push`.
- [ ] **Step 2: Тест (падає):** `import.test.js` - на фікстурі рядків Довідника (3 точки, одна неактивна, одна з днями «Пн, Ср») парсер дає ті самі об'єкти, що `loadStores_` (2 точки, `days.veg=[1,3]`, `directions` з колонок G/N/H/I).
- [ ] **Step 3:** реалізація; тест OK.
- [ ] **Step 4:** `--dry` на бойових таблицях: кількість точок = кількість у `bootstrap` поточного `/exec`; потім без `--dry`.
- [ ] **Step 5:** commit «перенос: схема бази і імпорт довідників».

### Task 2: Каркас сервера, правила календаря, деплой на Fly

**Files:**
- Create: `server/src/app.js`, `server/src/rules.js`, `server/src/db.js`, `server/Dockerfile`, `server/fly.toml`, `.github/workflows/server-deploy.yml`, `server/test/rules.test.js`

**Interfaces:**
- Produces `rules.js` (перенос з `Deadline.gs`, `VegDays.gs`, `LateRequest.gs`, `Config.gs`): `kyivNow(at?)`, `deadlinePassed(dir, storeId, ctx)`, `dayAllowed(dir, store, ctx)`, `dayOffText(dir, store)`, `minOrderOf(cfg, at)`, `lateStatus(dir, storeId, ctx) -> 'none'|'pending'|'approved'`, `lateLeftMin(...)`, `statusKey(dir, store)`, `addrKey`, `shortenAddress`, `canonKey`. `ctx` = `{at: Date, settings, lateRows}` - без звернень до бази всередині.
- `fly.toml`: app `shop-orders`, `primary_region='fra'`, `internal_port=3000`, `auto_stop_machines="suspend"`, `auto_start_machines=true`, `min_machines_running=0`, 256 МБ.
- [ ] **Step 1: Тест (падає):** `rules.test.js` - дедлайн 13:00: 12:59 Київ false, 13:00 true; `late_all` на сьогодні → false; дозвіл 30 хв (31-ша хвилина → знову закрито); тексти `dayOffText` дослівно; `minOrderOf` з `minOrderChanges [{from:'01.10.2026', value:400}]` → 30.09 = 350, 01.10 = 400; `shortenAddress`/`addrKey` - 5 реальних адрес із Довідника дають ті самі ключі, що Apps Script (значення взяти з `app` журналом `Maintenance.gs` або з колонки C сирого листа).
- [ ] **Step 2-4:** реалізація; `node --test server/test` → OK.
- [ ] **Step 5:** `fly launch --no-deploy` (власник логіниться у flyctl), `fly secrets set …`, `fly deploy`; `GET /health` → 200 з `fra`.
- [ ] **Step 6:** commit «перенос: каркас сервера, правила, Fly».

### Task 3: `/api` - bootstrap, refresh, products

**Files:** Create `server/src/api/read.js`, `server/test/api-read.test.js`
**Interfaces:** `apiBootstrap(ctx)`, `apiRefresh(payload, ctx)`, `apiProducts(payload, ctx)` - повертають рівно ті поля, що `apiBootstrap_`/`apiRefresh_`/`apiProducts_`; `ordered` - з `orders` за сьогодні (active).
- [ ] **Step 1: Тест (падає):** набір ключів відповіді = набір ключів з поточного `/exec` (зняти JSON з бойового `bootstrap` і `products` у фікстуру `server/test/fixtures/`); вимкнений напрямок зникає з `directions` і `stores[].directions`; ціни × `markup`, округлення 0,01; `stop`-товарів немає; `locked/alreadyOrdered/canRequestLate/lateLeftMin` за правилами `apiProducts_`.
- [ ] **Step 2-4:** реалізація, тест OK. **Step 5:** commit.

### Task 4: `/api` - submitOrder, requestLate, схвалення

**Files:** Create `supabase/migrations/20261019000003_orders_tx.sql`, `server/src/api/submit.js`, `server/src/mail.js`, `server/src/pages/approve.js`, `server/test/api-submit.test.js`
**Interfaces:**
- SQL `submit_order_tx(p jsonb) returns jsonb` - в одній транзакції: повтор `order_id` → збережений `result` + `duplicate:true`; `replace` → активні замовлення точки за день у `cancelled`, `removed` = їхні рядки; вставка; конфлікт унікального індексу → `{ok:false, reason:'already'}`.
- `apiSubmitOrder(payload, ctx)` - порядок і тексти перевірок з `apiSubmitOrder_` (вимкнено; не той напрямок; день; дедлайн - два тексти; порожнє; > 500; ціни з `products`; qty до 0,001, > 5000; мінімалка; «вже сьогодні відправлено»), потім `submit_order_tx`, потім `queueExport(dir)` (Task 5) без очікування.
- `apiRequestLate` → `late_requests` + лист через `mail.js` (Gmail SMTP) закупниці з `LATE_MAIL` (`app/LateRequest.gs`); `GET /ok?dir&st&d&s` - HMAC як `lateToken_`, сторінка «Дозволено» як `lateApprovePage_`.
- [ ] **Step 1: Тест (падає):** кожна перевірка - окремий кейс з дослівним текстом; два паралельні `submitOrder` однієї точки → рівно один `ok`; повтор order_id → `duplicate:true`; дозвіл знімає мінімалку, дедлайн і «вже відправлено»; неправильний підпис `/ok` → 403.
- [ ] **Step 2-4:** реалізація, тест OK (тести з `test-` точками на справжній базі). **Step 5:** commit.

### Task 5: Вигрузка в сирі листи

**Files:** Create `server/src/export/raw.js`, `server/src/jobs.js`, `.github/workflows/server-tick.yml`, `server/test/export.test.js`
**Interfaces:**
- `exportDir(dir) -> {written, deleted, skipped}` - замовлення з `exported_at is null or exported_at < changed_at`: нове active → рядки через `rawRow` з `app/Config.gs` → дедуп (дата+адреса+час+назва+кількість, як `orderRowsInTail_`/`missingOrderLines_`) → `append`; змінене/скасоване → видалити рядки точки за день (`deleteDimension`, знизу вгору) і дописати active; позначка `exported_at`. Один запуск на напрямок одночасно (in-process mutex).
- `queueExport(dir)` - запуск `exportDir` у фоні з дебаунсом 2 с; `POST /jobs/tick` (заголовок `x-jobs-secret`) - усі напрямки + `rebuildReports` (Task 6-7) для змінених.
- `server-tick.yml`: cron `*/10 4-19 * * *` (UTC = 7:00-22:00 Київ узимку) → `curl -X POST …/jobs/tick`.
- [ ] **Step 1: Тест (падає)** з підмінним Google-клієнтом: нове → рядки дописані, `exported_at` стоїть; повтор після «вбитого» запуску (рядки є, позначки немає) → рядків не побільшало; скасоване → рядки зникли; Google кидає тайм-аут на `bakery` → `bread` вигружено, `bakery` лишився невигруженим.
- [ ] **Step 2-4:** реалізація, тест OK. **Step 5:** commit.

### Task 6: Звіти ВК (замовлення, зведення, маршрути по зонах)

**Files:** Create `server/src/reports/bakery.js` (перенос `app/BakeryReport.gs` + `app/BakeryZones.gs`), `server/src/reports/sheetWriter.js` (перенос `apiSheetWriter_`, `apiFmtReq_`, `gridRange_` з `app/SheetsFast.gs`), `server/test/reports-bakery.test.js`, `server/test/fixtures/bakery-<дата>.json`
**Interfaces:** `buildBakeryReports(rows, opts) -> {requests per sheet}`; `rebuildBakeryReports({target:'live'|'test'})` - `test` пише в листи «ТЕСТ …» (як `d11_testBakeryReportsApi`).
- [ ] **Step 1: Золотий тест (падає):** фікстура = сирі рядки ВК за 16.10 (165 рядків) + значення комірок листів «Замовлення», «Зведення», маршрутів, які побудував Apps Script того дня (зняти через `getValues`) → `buildBakeryReports` дає ті самі значення, той самий порядок.
- [ ] **Step 2-4:** перенос, тест OK; `rebuildBakeryReports({target:'test'})` на бойовій ВК - візуально як оригінал. **Step 5:** commit.

### Task 7: Звіти хліба, овочів, НБХЗ і вигрузка НБХЗ

**Files:** Create `server/src/reports/bread.js` (`BreadReport.gs`), `veg.js` (`VegReport.gs`, `VegOverride.gs`), `nbhz.js` (`Nbhz.gs`, `Export.gs`), тести з золотими фікстурами за один день кожного.
**Interfaces:** `rebuildBreadReports`, `rebuildVegReports`, `rebuildNbhz` з тим самим `{target}`; овочі читають прайс постачальника (`priceSpreadsheetId`) правилами `readVegPriceSheet_` - раз на 10 хв у кеш процесу.
- [ ] **Step 1-4:** як у Task 6 для кожного звіту. **Step 5:** commit.

### Task 8: Списання

**Files:** Create `supabase/migrations/20261019000004_writeoff.sql`, `server/src/api/writeoff.js` (`WriteOff.gs`, `WriteOffCosts.gs`), `server/src/export/writeoff.js`, тест.
**Interfaces:** дії `/api` `woProducts`, `woSubmit`, `woMine`, `woDelete` - ті самі поля і тексти; дедлайн `WO_DEADLINE`; вигрузка в той самий лист, куди пише Apps Script.
- [ ] **Step 1-4:** тести на кожну дію і дедлайн, реалізація. **Step 5:** commit.

### Task 9: Пульт власника і сторінка закупниці

**Files:** Create `server/public/admin/` (з `app/ui/Admin.html`, `AdminJs.html`, `AdminToolsJs.html`, `WriteOffAdminJs.html`; `google.script.run` → `fetch('/admin/api')`), `server/src/api/admin.js`, `server/public/buyer/` (нова сторінка: замовлення за сьогодні по точках з кнопкою «Видалити»; асортимент свого напрямку - ціна, `стоп`, наявність), тести.
**Interfaces:** `/admin/api` - вхід за паролем (`ADMIN_PASSWORD_HASH`, cookie з підписом, як у зарплатному проекті - `jsonwebtoken` + `cookie-parser`); `/buyer/<dir>` - вхід за паролем закупниці напрямку (`BUYER_<DIR>_HASH`); видалення → `admin_cancel_day`, правка кількості → `admin_set_qty`, обидва ставлять `changed_at` → вигрузка.
- [ ] **Step 1-4:** тести на вхід (без cookie → 401), скасування, правку, зміну ціни; реалізація. **Step 5:** commit.

### Task 10: Сайт продавця

**Files:** Create `server/scripts/build-front.js`, `server/public/index.html` (результат), тест.
**Interfaces:** збірка з `app/ui/Index.html` + `app/ui/WriteOff.html` + логотип з `app/Logo.gs`: скриптлети розкрито, `call()` → `fetch('/api', {method:'POST', body: JSON.stringify({action,payload})})` з тайм-аутом 20 с і текстом «Сервер не відповідає, спробуйте ще раз»; `docs/app-url.js` - нова адреса (Pages-оболонка в продавців лишається).
- [ ] **Step 1:** тест - у файлі немає `<?` і `google.script.run`; `call` у `vm` з підмінним `fetch`. **Step 2-4:** збірка, перегляд у вбудованому браузері на `test-` точці (375 px): точки → товари → відправка → «Замовлення прийнято». **Step 5:** commit.

### Task 11: Паралельний прогін і переключення

**Files:** Create `server/scripts/import-today.js`, `.github/workflows/server-backup.yml` (за `D:\Shifts-api\Shifts-api\.github\workflows\backup-db.yml`), `plans/cutover-checklist.md`
- [ ] **Step 1:** 2-3 робочі дні тіньового режиму: щогодини `import-today.js --shadow` копіює сьогоднішні рядки з сирих листів у базу (лише для порівняння), `rebuild*({target:'test'})` → порівняння з листами Apps Script; розбіжності - виправити.
- [ ] **Step 2:** бекап-воркфлоу запускається вручну, файл з'являється на Drive.
- [ ] **Step 3: Переключення (увечері після 18:00):** спершу `node server/scripts/import-reference.js --force` (свіжі точки й ассортимент з Google; `--force` затирає правки з Table Editor - тому лише тут, до переключення; після переключення ассортимент і точки правляться тільки в базі, Google-таблиці Довідника/Ассортименту більше не читаються сервером); далі `import-today.js` (сьогоднішні замовлення в базу, щоб уникнути дублів) → `docs/app-url.js` на Fly → push → перевірка з телефона → тригери Apps Script, що будують звіти й пишуть сирі листи, вимкнути (лишається лише сам `/exec` як відкат) → захист сирих листів (редагує лише сервісний акаунт і власник).
- [ ] **Step 4:** перший день - «Здоровʼя» пульта щогодини до 13:00; відкат = старий `docs/app-url.js` + увімкнути тригери Apps Script.
- [ ] **Step 5:** через тиждень стабільної роботи - вимкнути Apps Script остаточно (видалити тригери, архівувати проєкт). Commit і push.
