# Apps Script, привязанный к таблице матрицы

Script ID: `1Y_7xLVcx6uAQsgioXoa96vwp61YPTiITAyfId_D_Bpn-uNoS4WEJW7K7`
(лежит в `apps_script/_scriptId.txt`)

## Как я его читаю без clasp

clasp и OAuth пользователя НЕ нужны. У привязанного скрипта права
наследуются от документа-контейнера, а сервисный аккаунт уже имеет доступ
к таблице. Работает так:

```python
creds = service_account.Credentials.from_service_account_file(
    KEY, scopes=["https://www.googleapis.com/auth/script.projects.readonly"])
gtr.AuthorizedSession(creds).get(
    f"https://script.googleapis.com/v1/projects/{SID}/content")
```

Запись (`script.projects` + `updateContent`) не проверялась.

## Файлы

| Файл | Размер | Содержание |
|---|---|---|
| `Code.gs` | 63 КБ | основной: onOpen, аналитика, категории, recalcSupplierTotals, sortByProfitWithinSuppliers |
| `Синхронизация_с_копией.gs` | 22 КБ | diagnosticSync, syncMainFromCopy — сверка и перенос с копии |
| `Claude.gs` | 15 КБ | callClaudeAPI, classifyMissing — классификация категорий через Claude API |
| `Tests.gs` | 6 КБ | проверка структуры блоков и строк ИТОГО |

## recalcSupplierTotals — как считаются ИТОГО

**Категория строки определяется ЦВЕТОМ ЗАЛИВКИ КОЛОНКИ A**, не текстом статуса:

```javascript
isRedBackground:   r>180 && g<170 && b<170 && (r-g)>30   -> «вывести»
isGreenBackground: g>150 && (g-r)>20 && (g-b)>20         -> «новинки» (+ в «оставить»)
иначе                                                     -> «оставить»
```

Текст: `ИТОГО: {N} SKU (оставить: {K}[, новинки: {M}][, вывести: {R}])`
ОБЩИЙ ИТОГ: `{N} SKU (оставить: {K}[, ...], {S} поставщиков)`

Цвета красит `status_update.py` (`NEW_ROW_COLOR = #b3ffb7`), а ИТОГО
никто после этого не пересчитывал — отсюда расхождения.

Оригинал начинается с `SpreadsheetApp.getUi()` и заканчивается `ui.alert()`,
поэтому headless его не вызвать. **Портирован один в один** в
`scripts/recalc_totals.py`; порт сошёлся с фактом по SKU и «оставить»
(2021/2021). Менять только вместе с Apps Script.

## Триггеры НЕ срабатывают на правки через Sheets API

Официально: *«Script executions and API requests don't cause triggers to run»*
(developers.google.com/apps-script/guides/triggers/installable).
Это касается и `onEdit`, и `onChange`, и записи значений, и вставки строк.

Следствие в обе стороны: ничего лишнего не запустится и данные не перетрёт,
но и полезная автоматика на `onEdit` не отработает на строках, добавленных
скриптами. После добавления позиций — запускать нужное вручную или через `sync`.

## ⚠️ API-ключ Anthropic открытым текстом

`Claude.gs`, строка 2: `var CLAUDE_API_KEY = 'sk-ant-api03-...'`.
Виден каждому, у кого есть доступ к таблице на редактирование.

Файл **исключён из git** (`.gitignore`). Пользователю предложено отозвать
ключ на console.anthropic.com и перенести в Script Properties:

```javascript
var CLAUDE_API_KEY = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
```

На 11.09.2026 **не сделано**. Пока не сделано — `Claude.gs` не коммитить.
