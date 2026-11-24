# CLAUDE.md — shop-orders

## Память — только этого проекта
Для репозитория есть свой сервер Serena **`serena-shop-orders`** (инструменты `mcp__serena-shop-orders__*`), запущенный с
`--project D:\shop-orders`: другие сессии его не переключают.
- Память (`read_memory`, `write_memory`, `edit_memory`) и навигацию по коду — **через `serena-shop-orders`**. Общий `mcp__serena__*`
  (из Claude Desktop) один на все сессии, его активный проект переключает любая сессия — для памяти **не использовать**
  (так в эту папку попадали файлы проекта матрицы). Если `serena-shop-orders` недоступен — править `.serena/memories/*.md` напрямую.
- В начале чата прочитать `project_overview`, затем `shop-orders-node-server` и `HANDOVER.md`. Описание Apps Script (`shop-orders-overview`) — история до 23.10.2026.
- Срез «где мы» вести одним файлом `status.md`: перезаписывать, не дописывать. Решения — отдельными файлами с датой и причиной.
- Пуш в `main` = деплой на Fly: только по команде «пуш». В `app/` (боевой Apps Script) правки только с явного разрешения.
- Чат начинать в папке проекта, а не в scratch: Claude-память привязана к рабочей папке.
- Регистрация (локально, `~/.claude.json`): `claude.cmd mcp add serena-shop-orders --scope local -- serena.exe start-mcp-server --context claude-code --project D:\shop-orders`.
  Из PowerShell вызывать именно `claude.cmd`, иначе `--` проглатывается.
