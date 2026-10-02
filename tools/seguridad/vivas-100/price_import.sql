CREATE OR REPLACE FUNCTION public.price_import(target_organization_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare r record; n_items int := 0; n_quotes int := 0; n_sup int := 0; sid uuid; iid uuid;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  for r in select * from jsonb_array_elements_text(coalesce(payload->'suppliers','[]'::jsonb)) as s(name) loop
    insert into public.ennco_price_suppliers(organization_id,name) values (target_organization_id, trim(r.name)) on conflict do nothing;
    if found then n_sup := n_sup + 1; end if;
  end loop;
  for r in select * from jsonb_to_recordset(coalesce(payload->'items','[]'::jsonb)) as x(category text, name text, unit text, currency text, equipment jsonb, sort int, quotes jsonb) loop
    insert into public.ennco_price_items(organization_id,category,name,unit,currency,equipment,sort)
      values (target_organization_id, trim(r.category), trim(r.name), coalesce(r.unit,'Pzs'), coalesce(r.currency,'MXN'), r.equipment, coalesce(r.sort,0))
      on conflict (organization_id,category,name) do update set unit=excluded.unit, currency=excluded.currency, equipment=coalesce(excluded.equipment, public.ennco_price_items.equipment), sort=excluded.sort, updated_at=now()
      returning id into iid;
    n_items := n_items + 1;
    if r.quotes is not null then
      insert into public.ennco_price_quotes(organization_id,item_id,supplier_id,period,unit_price,source,created_by)
        select target_organization_id, iid, s.id, date_trunc('month',(q->>'period')::date)::date, (q->>'unitPrice')::numeric, 'excel', auth.uid()
        from jsonb_array_elements(r.quotes) q join public.ennco_price_suppliers s on s.organization_id=target_organization_id and s.name=trim(q->>'supplier')
        where (q->>'unitPrice')::numeric > 0
        on conflict (item_id,supplier_id,period) do update set unit_price=excluded.unit_price, source=excluded.source;
      get diagnostics n_quotes = row_count; 
    end if;
  end loop;
  if payload ? 'fxByPeriod' then
    insert into public.ennco_price_settings(organization_id,fx_by_period) values (target_organization_id, payload->'fxByPeriod')
      on conflict (organization_id) do update set fx_by_period=public.ennco_price_settings.fx_by_period || excluded.fx_by_period, updated_at=now();
  end if;
  return jsonb_build_object('suppliers',n_sup,'items',n_items);
end $function$
