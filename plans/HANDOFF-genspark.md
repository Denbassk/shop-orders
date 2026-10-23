# Передача робіт з переносу shop-orders (для Claude у Genspark, до четверга)

Ти продовжуєш перенос застосунку замовлень «Фемелі Маркет» з Google Apps Script на
Node.js + Supabase + Fly.io. Власник — Денис. Відповідай російською, коротко, без
непідтвердженого «все працює».

## Що прочитати спершу

1. `plans/2026-10-18-node-supabase-migration.md` — план з 11 задач і Global Constraints.
2. `app/*.gs`, `app/ui/*.html` — старий застосунок (Apps Script). **Джерело правил і текстів.**
3. `server/` — новий сервер (Node 22, Express, supabase-js, googleapis). Подивись, як зроблені
   вже готові частини, і роби так само.

## Стан на 19.10.2026

- Гілка `migration/node-supabase`. Готово: Task 1–6 (+ можливо 7, див. `git log`).
- Перевірено фактом:
  - відповіді нового `/api` збіглися з бойовим Apps Script у 302 з 302 запитів;
  - звіти ВК збіглися в 2152 з 2152 комірок;
  - захист від дублів — 200 з 200 паралельних повторів;
  - вигрузка в листи збіглася з боєм поле за полем.
- Бой досі працює на Apps Script (v74). Новий сервер `shop-orders.fly.dev` — тестовий, продавців там немає.

## Правила (порушувати не можна)

1. **Тексти для продавця і закупниці — дослівно** з `app/*.gs` / `app/ui/*.html` (українською).
   Відповіді — ті самі поля, що в Apps Script.
2. **Переносити майже дослівно** — це той самий JavaScript. `Sheets.Spreadsheets.*` → `googleapis`,
   `PropertiesService` → таблиці бази. Не «покращувати» логіку.
3. **Тест спершу червоний**, потім код (`node:test`, `npm test` у `server/`).
   Тести, яким потрібна база, без секретів самі пропускаються — так і має бути.
   Google і Supabase у твоїх тестах — лише підмінні (див. наявні тести в `server/test/`).
4. **Звіряння зі старим кодом:** запускай оригінальний `.gs` у `vm` (приклад:
   `server/scripts/gas-oracle.js`) і порівнюй результат/запити з новим кодом один в один.
5. Списання ВК — **+20%** (`WO_MARKUP` в `app/WriteOff.gs`), не 15%.
6. **Жодних секретів** у коді, комітах і чаті. Ключі є лише на машині власника.

## Що можна робити в Genspark (без секретів і без доступу до Google/Fly)

Кожна задача — окрема гілка від `migration/node-supabase`: `genspark/task-8`,
`genspark/task-9`, `genspark/task-10`. Наприкінці — PR **у `migration/node-supabase`**, не в `main`.

- **Task 8 — списання** (`app/WriteOff.gs`, `app/WriteOffCosts.gs`, `app/ui/WriteOff.html`):
  - міграція `supabase/migrations/…000005_writeoff.sql`;
  - `server/src/api/writeoff.js` з діями `woProducts`, `woSubmit`, `woMine`, `woDelete` (ті самі поля і тексти, дедлайн `WO_DEADLINE`);
  - вигрузка в ті самі листи «Списания», як пише Apps Script (з підмінним Google);
  - тести.
- **Task 9 — пульт і сторінка закупниці:**
  - `server/public/admin/` з `app/ui/Admin.html`, `AdminJs.html`, `AdminToolsJs.html`, `WriteOffAdminJs.html` (`google.script.run` → `fetch('/admin/api')`);
  - `server/src/api/admin.js`: вхід за паролем, cookie з підписом;
  - сторінка закупниці `/buyer/<dir>`: замовлення за сьогодні з кнопкою «Видалити», асортимент свого напрямку (ціна, «стоп»);
  - вкладка «Точки» — редагування `stores` як у Довіднику: галочки напрямків, дні текстом, маршрут, зона, примітка;
  - тести на вхід, скасування, правку, зміну ціни.
- **Task 10 — сайт продавця:**
  - `server/scripts/build-front.js` збирає `app/ui/Index.html` + `WriteOff.html` у `server/public/index.html` (розкрити скриптлети `<? ?>`, `call()` → `fetch('/api')` з тайм-аутом 20 с);
  - тест: у файлі немає `<?` і `google.script.run`.

## Чого в Genspark НЕ робити (дочекатися Claude Code в четвер)

- деплой на Fly;
- `import-reference.js`, `shadow.js`, e2e-скрипти, будь-які звернення до бойових Google-таблиць;
- Task 11 (переключення);
- push у `main`;
- зміни в `app/` (бойовий Apps Script).

## Формат звіту після кожної задачі

**Зроблено / перевірено фактом (числа: тести X з Y) / не перевірено / рішення, які прийняв сам / ризики.**
Окремо — список того, що треба перевірити на реальній базі і Google в четвер.
