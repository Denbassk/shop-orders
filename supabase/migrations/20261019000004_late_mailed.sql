-- Task 5: лист закупниці йде у фоні; mailed_at ставиться лише після успішної відправки.
-- /jobs/tick довідправляє pending-запити, у яких mailed_at is null.
alter table public.late_requests add column mailed_at timestamptz;
