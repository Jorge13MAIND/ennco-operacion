CREATE OR REPLACE FUNCTION public.product_set_active(target_organization_id uuid, target_id uuid, target_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare p public.ennco_products;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  update public.ennco_products set active = target_active, updated_at = now() where organization_id = target_organization_id and id = target_id returning * into p;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return app.product_json(p);
end $function$
