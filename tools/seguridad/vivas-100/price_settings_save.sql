CREATE OR REPLACE FUNCTION public.price_settings_save(target_organization_id uuid, target_iva numeric, target_margin numeric, target_margin_by_category jsonb, target_fx_by_period jsonb, target_price_rule text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare t public.ennco_price_settings;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  insert into public.ennco_price_settings(organization_id,iva,margin,margin_by_category,fx_by_period,price_rule)
    values (target_organization_id, coalesce(target_iva,0.16), coalesce(target_margin,0.30), coalesce(target_margin_by_category,'{}'::jsonb), coalesce(target_fx_by_period,'{}'::jsonb), coalesce(target_price_rule,'MAX'))
    on conflict (organization_id) do update set iva=excluded.iva, margin=excluded.margin, margin_by_category=excluded.margin_by_category, fx_by_period=excluded.fx_by_period, price_rule=excluded.price_rule, updated_at=now()
    returning * into t;
  return jsonb_build_object('iva',t.iva,'margin',t.margin,'marginByCategory',t.margin_by_category,'fxByPeriod',t.fx_by_period,'priceRule',t.price_rule);
end $function$
