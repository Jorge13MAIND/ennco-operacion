CREATE OR REPLACE FUNCTION public.price_quote_save(target_organization_id uuid, target_item_id uuid, target_supplier_id uuid, target_period date, target_unit_price numeric, target_source text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if not exists (select 1 from public.ennco_price_items where id=target_item_id and organization_id=target_organization_id) then raise exception 'PRICE_ITEM_NOT_FOUND'; end if;
  if target_unit_price is null or target_unit_price <= 0 then
    delete from public.ennco_price_quotes where item_id=target_item_id and supplier_id=target_supplier_id and period=date_trunc('month',target_period)::date;
    return jsonb_build_object('deleted', true);
  end if;
  insert into public.ennco_price_quotes(organization_id,item_id,supplier_id,period,unit_price,source,created_by)
    values (target_organization_id,target_item_id,target_supplier_id,date_trunc('month',target_period)::date,target_unit_price,target_source,auth.uid())
    on conflict (item_id,supplier_id,period) do update set unit_price=excluded.unit_price, source=excluded.source, created_by=auth.uid(), created_at=now();
  return jsonb_build_object('itemId',target_item_id,'supplierId',target_supplier_id,'period',date_trunc('month',target_period)::date,'unitPrice',target_unit_price);
end $function$
