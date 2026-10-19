-- Схема shop-orders. Доступ лише через сервер (service_role): RLS увімкнено, політик немає.

create table public.stores (
  store_id     text primary key,            -- canonKey_(адреса) з Довідника
  active       boolean not null default true,
  label        text not null,
  address      text not null,
  code         text not null default '',
  route        text not null default '',
  type         text not null default 'Магазин',
  addr_bread   text not null,
  addr_bakery  text not null,
  addr_veg     text not null,
  addr_nbhz    text not null,
  route_nbhz   text not null default '',
  zone         text not null default '',
  edrpou       text not null default '',
  days         jsonb not null default '{"veg":[],"bakery":[]}'::jsonb,  -- 0 нд ... 6 сб
  directions   text[] not null default '{}',
  sort         int not null default 0
);

create table public.directions (
  dir  text primary key,                    -- bread | nbhz | bakery | veg
  cfg  jsonb not null                       -- статичні поля DIRECTIONS (Config.gs), без функцій
);

create table public.products (
  dir           text not null references public.directions(dir),
  id            text not null,              -- штрихкод, інакше nameKey_(назва)
  barcode       text not null default '',
  name          text not null,
  price         numeric(12,2) not null default 0,
  category      text,                       -- лише випічка
  availability  text,                       -- лише випічка
  box           text,                       -- хліб: шт в ящику
  status        text not null default 'active' check (status in ('active','stop')),
  sort          int not null default 0,
  primary key (dir, id)
);

create table public.settings (
  key    text primary key,                  -- dirs_off, late_all, app_version, test_mode, wo_deadline
  value  jsonb not null
);

create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  order_id     text not null unique,        -- ключ ідемпотентності від клієнта
  dir          text not null references public.directions(dir),
  store_id     text not null,               -- без FK: тестові точки з префіксом test-
  order_date   date not null,
  status       text not null default 'active' check (status in ('active','cancelled')),
  is_addon     boolean not null default false,
  total        numeric(12,2) not null default 0,
  result       jsonb,                       -- збережена відповідь для повтору order_id
  created_at   timestamptz not null default now(),
  changed_at   timestamptz not null default now(),
  exported_at  timestamptz
);

-- рівно одне активне основне замовлення точки на напрямок за день
create unique index orders_one_active_per_day
  on public.orders (dir, store_id, order_date)
  where status = 'active' and not is_addon;

create index orders_export_idx on public.orders (dir, changed_at) where exported_at is null or exported_at < changed_at;
create index orders_day_idx on public.orders (order_date, dir);

create table public.order_lines (
  id          bigint generated always as identity primary key,
  order_pk    uuid not null references public.orders(id) on delete cascade,
  line_no     int not null,
  product_id  text not null,
  barcode     text not null default '',
  name        text not null,
  price       numeric(12,2) not null default 0,
  qty         numeric(12,3) not null check (qty > 0)
);
create index order_lines_order_idx on public.order_lines (order_pk);

create table public.late_requests (
  id            uuid primary key default gen_random_uuid(),
  dir           text not null references public.directions(dir),
  store_id      text not null,
  req_date      date not null,
  status        text not null default 'pending' check (status in ('pending','approved')),
  requested_at  timestamptz not null default now(),
  approved_at   timestamptz,
  unique (dir, store_id, req_date)
);

alter table public.stores        enable row level security;
alter table public.directions    enable row level security;
alter table public.products      enable row level security;
alter table public.settings      enable row level security;
alter table public.orders        enable row level security;
alter table public.order_lines   enable row level security;
alter table public.late_requests enable row level security;
