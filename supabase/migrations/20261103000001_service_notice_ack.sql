-- Підтвердження сервісних повідомлень продавцям (пульт «Сообщение продавцам», settings.service_notice).
-- Один рядок на (повідомлення, магазин): seen_at - коли магазин уперше побачив банер, ack_at - коли хтось натиснув «Зрозуміло» у вікні.
-- Лише нова таблиця: існуючі дані не чіпаються. Пишуть і читають лише service_role (сервер); для anon/authenticated закрита.
create table public.service_notice_ack (
  notice_id  text not null,                          -- settings.service_notice[].id
  store_id   text not null,                          -- stores.store_id
  seen_at    timestamptz not null default now(),
  ack_at     timestamptz,
  primary key (notice_id, store_id)
);

alter table public.service_notice_ack enable row level security;
revoke all on public.service_notice_ack from anon, authenticated;
