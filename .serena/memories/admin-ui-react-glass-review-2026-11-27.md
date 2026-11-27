---
name: admin-ui-react-glass-review
description: "27.11.2026 ревью React-пульта (server/admin-ui, ветка feat/seller-react-glass): почему фон пёстрый и цвета не сходятся, что ломает кнопки"
metadata:
  node_type: memory
  type: project
  originSessionId: e04fe269-ff35-4963-8980-bef4dc1acdbe
  modified: 2026-11-27T08:19:34.236Z
---

27.11.2026 ревью React-пульта (`server/admin-ui`, коммиты 8a2941e..0179a7f). Тесты 741/741, сборка OK, правок не вносилось.
- Фон неоднородный: в `index.css` body::before — фото-хотлинк с cdn.21st.dev + 2 градиента-оверлея. Владелец хочет однотонный фон, стекло (blur/rim/gloss) НЕ трогать.
- «Сочетание цветов»: перекраска коснулась только index.css/App-шапки/Sidebar; 11 компонентов на старых slate/cyan/teal/navy (#081322 ×17), заплатки `!important` ловят часть.
- Кнопки: `.btn-*`/`.input-field` вне `@layer components` → перебивают утилиты Tailwind (py-3, px-3 молча игнорируются). Модалки `fixed` внутри `main.gd-stage-frame` с backdrop-filter → позиционируются от main (нужен createPortal).
- 27.11 владелец утвердил K4: «кофе с молоком» (#d6c3ae / тёмная #2b221d) + чернильный синий (#34466e / #a9bbe3). Стекло не трогать.
- 27.11 сделано (НЕ закоммичено): токены --gd-* в index.css + Tailwind-цвета `gd-*` (tailwind.config, /alpha через *-rgb); фон без фото; @layer components; Modal/панель через createPortal, Esc-стек; 11 компонентов без slate/cyan/teal/navy; logo-light.png сделан прозрачным; баги (двойное нажатие, confirm, логин, гонка dir). Тесты 741/741, проверено в браузере обе темы.
- Новые цвета писать только `gd-*` (text-gd-ink/muted, bg-gd-inner, gd-accent/ok/warn/danger), не slate/teal.
**Why:** чтобы новый чат не начинал перекраску с токенов — без замены классов в компонентах однородности не будет.
**How to apply:** в новых компонентах пульта только токены gd-*; хардкод цветов = регресс.
