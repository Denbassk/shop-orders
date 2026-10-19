-- Списання випічки і кулінарії (Task 8). Перенос app/WriteOff.gs.
-- Джерело правди - writeoffs/writeoff_lines; лист «Списания» у таблиці юрособи - лише вигрузка.
-- Видалення продавцем = deleted_at (рядок лишається для історії і вигрузки), журнал - admin_log.

-- собівартість з «Ассортимента» випічки (колонка «Себестоимость», WriteOffCosts.gs); заповнює import-reference
alter table public.products add column if not exists cost numeric(12,2);

create table public.writeoffs (
  id            uuid primary key default gen_random_uuid(),
  doc_id        text not null check (doc_id ~* '^[a-z0-9]{8,40}$'),   -- ID з телефону (як WriteOff.gs)
  store_id      text not null,
  store_label   text not null,
  store_code    text not null default '',
  edrpou        text not null,                -- юрособа: stores.edrpou, порожньо = BREAD_EDRPOU
  wo_date       date not null,                -- дата списання
  seller        text not null,
  total         numeric(12,2) not null default 0,
  result        jsonb not null,               -- відповідь продавцю для повтору doc_id
  submitted_at  timestamptz not null default now(),
  deleted_at    timestamptz,
  changed_at    timestamptz not null default now(),
  exported_at   timestamptz
);

-- як ключ oid_wo_<docId>: після видалення той самий ID можна подати знову
create unique index writeoffs_doc_live on public.writeoffs (doc_id) where deleted_at is null;
create index writeoffs_store_day on public.writeoffs (store_id, wo_date) where deleted_at is null;
create index writeoffs_export_idx on public.writeoffs (changed_at) where exported_at is null or exported_at < changed_at;

create table public.writeoff_lines (
  id            bigint generated always as identity primary key,
  writeoff_pk   uuid not null references public.writeoffs(id) on delete cascade,
  line_no       int not null,
  product_id    text not null,
  barcode       text not null default '',
  category      text not null default '',
  name          text not null,
  qty           numeric(12,3) not null check (qty > 0 and qty <= 500),
  price         numeric(12,2) not null default 0,
  amount        numeric(12,2) not null default 0,    -- «Сумма»
  amount_plus   numeric(12,2) not null default 0     -- «Сумма +20%» (WO_MARKUP 0.20)
);
create index writeoff_lines_wo_idx on public.writeoff_lines (writeoff_pk);

-- «Журнал дій» (adminLog_)
create table public.admin_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  action   text not null,
  details  text not null default ''
);
create index admin_log_at_idx on public.admin_log (at desc);

-- submit_writeoff_tx(p jsonb): подача списання однією транзакцією.
--   p = { doc_id, store_id, store_label, store_code, edrpou, wo_date 'yyyy-mm-dd', seller, total,
--         submitted_at, result, lines: [{line_no, product_id, barcode, category, name, qty, price, amount, amount_plus}] }
--   Живе списання з тим самим doc_id -> { ok:true, duplicate:true, result } (повтор / гонка), інакше запис.
create or replace function public.submit_writeoff_tx(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_prev jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('wo:' || (p->>'doc_id')));
  select w.result into v_prev from public.writeoffs w where w.doc_id = p->>'doc_id' and w.deleted_at is null limit 1;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'result', v_prev);
  end if;

  begin
    insert into public.writeoffs (doc_id, store_id, store_label, store_code, edrpou, wo_date, seller, total, result, submitted_at, changed_at)
    values (p->>'doc_id', p->>'store_id', p->>'store_label', coalesce(p->>'store_code', ''), p->>'edrpou',
            (p->>'wo_date')::date, p->>'seller', (p->>'total')::numeric, p->'result',
            (p->>'submitted_at')::timestamptz, (p->>'submitted_at')::timestamptz)
    returning id into v_id;
  exception when unique_violation then
    select w.result into v_prev from public.writeoffs w where w.doc_id = p->>'doc_id' and w.deleted_at is null limit 1;
    return jsonb_build_object('ok', true, 'duplicate', true, 'result', v_prev);
  end;

  insert into public.writeoff_lines (writeoff_pk, line_no, product_id, barcode, category, name, qty, price, amount, amount_plus)
  select v_id, (l->>'line_no')::int, l->>'product_id', coalesce(l->>'barcode', ''), coalesce(l->>'category', ''), l->>'name',
         (l->>'qty')::numeric, (l->>'price')::numeric, (l->>'amount')::numeric, (l->>'amount_plus')::numeric
  from jsonb_array_elements(p->'lines') as l;

  return jsonb_build_object('ok', true, 'duplicate', false, 'result', p->'result');
end $$;

revoke all on function public.submit_writeoff_tx(jsonb) from public, anon, authenticated;
grant execute on function public.submit_writeoff_tx(jsonb) to service_role;

alter table public.writeoffs      enable row level security;
alter table public.writeoff_lines enable row level security;
alter table public.admin_log      enable row level security;