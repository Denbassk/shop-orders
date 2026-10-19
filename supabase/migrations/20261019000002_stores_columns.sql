-- stores: колонки як у Довіднику ТТ (чекбокси напрямків, дні текстом "Пн, Ср", примітка)
-- замість directions text[] і days jsonb. Розбір днів у масиви - у коді (parseDays).

alter table public.stores
  add column bread       boolean not null default false,
  add column nbhz        boolean not null default false,
  add column bakery      boolean not null default false,
  add column veg         boolean not null default false,
  add column days_veg    text not null default '',
  add column days_bakery text not null default '',
  add column note        text not null default '';

create function pg_temp.days_text(j jsonb) returns text language sql immutable as $$
  select coalesce(string_agg((array['Нд','Пн','Вт','Ср','Чт','Пт','Сб'])[d + 1], ', ' order by (d + 6) % 7), '')
  from (select x::int as d from jsonb_array_elements_text(coalesce(j, '[]'::jsonb)) as t(x)) q
$$;

update public.stores set
  bread       = 'bread'  = any(directions),
  nbhz        = 'nbhz'   = any(directions),
  bakery      = 'bakery' = any(directions),
  veg         = 'veg'    = any(directions),
  days_veg    = pg_temp.days_text(days->'veg'),
  days_bakery = pg_temp.days_text(days->'bakery');

alter table public.stores
  drop column directions,
  drop column days;
