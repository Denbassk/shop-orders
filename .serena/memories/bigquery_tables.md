# BigQuery: таблицы проекта

Проект `family-market-analytics`, датасет `family_market`, локация EU.
Доступ — сервисный ключ `D:\Family_Market_Analytics\credentials\family-market-analytics-23fbcbcee571c.json`.

## Источники (заливаются из Торгсофта)

| Таблица | Что |
|---|---|
| `turnover_transactions` | продажи по чекам: barcode, product_name, store, quantity, price_retail, price_purchase, transaction_datetime |
| `incoming_transactions` | приходы: + supplier, amount_purchase, incoming_datetime, doc_* |
| `outgoing_to_supplier_transactions` | возвраты поставщику: amount_retail, amount_purchase, outgoing_datetime |
| `turnover_monthly` | помесячные остатки: start_qty, end_qty, sales_qty, return_qty по store |

## Справочники и состояние

| Таблица | Зачем |
|---|---|
| `barcode_recode_map` | пары «старый ШК → актуальный». Источник правды о склейках |
| `supplier_mapping` | incoming_supplier → matrix_supplier (141 из 156 заполнены). Один поставщик прихода может давать несколько строк матрицы: `ДЛ Солюшн` → `Сигарети_BAT / _IT / _JTI / _PM / Сигарети / Нікотинові Паучі` |
| `item_lifecycle_decisions` | решения по позициям вне матрицы: barcode, status, decided_at, decided_by, note, revenue_at_decision (колонка добавлена мной) |
| `matrix_snapshots` | состав матрицы по дням (создаёт matrix_diff) |
| `matrix_changelog` | что добавлено/выведено, с датой |
| `v_actual_prices` | cost_price, retail_price, price_date, price_source |
| `pozycii_poza_matryceyu` | позиции с продажами вне матрицы: stan, rishennia, chekiv_90d, vyruchka_90d |
| `assortment_matrix_clean` / `_full` / `_complete` | снимки матрицы в BQ |
| `v_barcode_audit` | view для barcode_audit.py |
| `new_items_actions`, `new_items_segmented` | сегментация по lifecycle (1136 строк) |

## Важное про assortment_matrix_complete

Пересоздаётся из самой себя (`CREATE OR REPLACE TABLE X AS ... FROM X UNION snapshot`),
поэтому только растёт: ШК, удалённый из матрицы, остаётся навсегда.
Изначально записал это в дефекты — **оказалось, что это единственная
сохранившаяся история удалений**: 3058 ШК всего, из них 1079 когда-то были
в матрице и выведены. Используется в `find_new_items` для пометки
«⚠ Раніше виведено».

С 10.09.2026 историю ведёт `matrix_diff.py` нормально: снапшот →
разница → `matrix_changelog` + автопроставление `Виведений`/`Додано`.

## Факты о данных (10.09.2026)

- Товарных строк в матрице: 2021 → после добавлений 2044
- ШК с продажами: 5199
- Ведущих нулей в ШК продаж: 0
- Торговых точек (для покрытия): 39
