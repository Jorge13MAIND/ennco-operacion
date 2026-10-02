CREATE OR REPLACE FUNCTION public.product_save(target_organization_id uuid, target_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare p public.ennco_products; cat public.ennco_product_categories;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  select * into cat from public.ennco_product_categories where organization_id = target_organization_id and id = (payload->>'categoryId')::uuid;
  if not found then raise exception 'PRODUCT_CATEGORY_NOT_FOUND'; end if;
  if target_id is null then
    insert into public.ennco_products(organization_id, category_id, name, brand, code, description, currency, pricing_mode, unit_basis, base_price, utility_pct, tiers, rating, rating_unit, favorite, source, specs, sort, created_by)
      values (target_organization_id, cat.id, trim(payload->>'name'), nullif(trim(coalesce(payload->>'brand','')),''), nullif(trim(coalesce(payload->>'code','')),''), nullif(trim(coalesce(payload->>'description','')),''),
        coalesce(payload->>'currency','USD'), coalesce(payload->>'pricingMode','unit'), nullif(payload->>'unitBasis',''),
        coalesce((payload->>'basePrice')::numeric, 0), (payload->>'utilityPct')::numeric, coalesce(payload->'tiers','[]'::jsonb),
        (payload->>'rating')::numeric, nullif(payload->>'ratingUnit',''), coalesce((payload->>'favorite')::boolean, false), coalesce(payload->>'source','manual'),
        case when payload ? 'specs' then payload->'specs' else null end,
        coalesce((select max(sort) + 10 from public.ennco_products where organization_id = target_organization_id and category_id = cat.id), 0), auth.uid())
      returning * into p;
  else
    update public.ennco_products set category_id = cat.id, name = trim(payload->>'name'), brand = nullif(trim(coalesce(payload->>'brand','')),''), code = nullif(trim(coalesce(payload->>'code','')),''),
      description = nullif(trim(coalesce(payload->>'description','')),''), currency = coalesce(payload->>'currency', currency), pricing_mode = coalesce(payload->>'pricingMode', pricing_mode),
      unit_basis = nullif(payload->>'unitBasis',''), base_price = coalesce((payload->>'basePrice')::numeric, base_price), utility_pct = (payload->>'utilityPct')::numeric,
      tiers = coalesce(payload->'tiers', tiers), rating = (payload->>'rating')::numeric, rating_unit = nullif(payload->>'ratingUnit',''),
      specs = case when payload ? 'specs' then payload->'specs' else specs end, updated_at = now()
      where organization_id = target_organization_id and id = target_id returning * into p;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  end if;
  return app.product_json(p);
end $function$
