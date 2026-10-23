-- submit_order_tx(p jsonb): запис замовлення в одній транзакції.
--   p = { order_id, dir, store_id, order_date 'yyyy-mm-dd', mode 'new'|'replace', approved bool,
--         total, result jsonb (відповідь продавцю без поля removed), lines [{product_id,barcode,name,price,qty}] }
--   повтор order_id            -> { ok:true, duplicate:true, result: <збережена відповідь> }
--   mode='replace'             -> активні замовлення точки за день -> cancelled, removed = кількість їхніх рядків
--   approved і вже є основне   -> нове замовлення пишеться як добавка (is_addon), решта випадків - як основне
--   конфлікт orders_one_active_per_day -> { ok:false, reason:'already' }
create or replace function public.submit_order_tx(p jsonb) returns jsonb
language plpgsql
as $$
declare
  v_existing jsonb;
  v_id       uuid;
  v_removed  int := 0;
  v_addon    boolean := false;
  v_mode     text := coalesce(p->>'mode', 'new');
  v_dir      text := p->>'dir';
  v_store    text := p->>'store_id';
  v_date     date := (p->>'order_date')::date;
  v_result   jsonb;
  v_cname    text;
begin
  select result into v_existing from public.orders where order_id = p->>'order_id';
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'result', v_existing);
  end if;

  begin
    if v_mode = 'replace' then
      with c as (
        update public.orders set status = 'cancelled', changed_at = now()
         where dir = v_dir and store_id = v_store and order_date = v_date and status = 'active'
        returning id
      )
      select count(l.id) into v_removed from c left join public.order_lines l on l.order_pk = c.id;
    elsif coalesce((p->>'approved')::boolean, false) and exists (
      select 1 from public.orders
       where dir = v_dir and store_id = v_store and order_date = v_date and status = 'active' and not is_addon
    ) then
      v_addon := true;
    end if;

    v_result := coalesce(p->'result', '{}'::jsonb) || jsonb_build_object('removed', v_removed);

    insert into public.orders (order_id, dir, store_id, order_date, is_addon, total, result)
    values (p->>'order_id', v_dir, v_store, v_date, v_addon, coalesce((p->>'total')::numeric, 0), v_result)
    returning id into v_id;

    insert into public.order_lines (order_pk, line_no, product_id, barcode, name, price, qty)
    select v_id, t.n, t.e->>'product_id', coalesce(t.e->>'barcode', ''), t.e->>'name',
           coalesce((t.e->>'price')::numeric, 0), (t.e->>'qty')::numeric
      from jsonb_array_elements(p->'lines') with ordinality as t(e, n);
  exception when unique_violation then
    get stacked diagnostics v_cname = constraint_name;
    if v_cname = 'orders_order_id_key' then      -- той самий order_id одночасно з іншим запитом
      select result into v_existing from public.orders where order_id = p->>'order_id';
      return jsonb_build_object('ok', true, 'duplicate', true, 'result', v_existing);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already');
  end;

  return jsonb_build_object('ok', true, 'duplicate', false, 'order_pk', v_id,
                            'is_addon', v_addon, 'removed', v_removed, 'result', v_result);
end;
$$;

revoke all on function public.submit_order_tx(jsonb) from public, anon, authenticated;
grant execute on function public.submit_order_tx(jsonb) to service_role;
