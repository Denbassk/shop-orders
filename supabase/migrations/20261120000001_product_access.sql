-- Асортимент по точках (20.11.2026): позицію можна дати лише частині точок.
--   access_mode = 'all'    - бачать усі точки напрямку (як було)
--               = 'only'   - лише точки з access_stores
--               = 'except' - усі, крім точок з access_stores
-- access_stores - store_id точок. Фільтр - у коді (rules.productAllowed): список для продавця, «Змінити замовлення», відправка.
alter table public.products
  add column access_mode   text   not null default 'all' check (access_mode in ('all', 'only', 'except')),
  add column access_stores text[] not null default '{}';
