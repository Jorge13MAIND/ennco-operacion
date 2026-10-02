CREATE OR REPLACE FUNCTION public.price_supplier_save(target_organization_id uuid, target_id uuid, target_name text, target_active boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare s public.ennco_price_suppliers;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_id is null then
    insert into public.ennco_price_suppliers(organization_id,name,active) values (target_organization_id, trim(target_name), target_active)
      on conflict (organization_id,name) do update set active=excluded.active returning * into s;
  else
    update public.ennco_price_suppliers set name=trim(target_name), active=target_active where organization_id=target_organization_id and id=target_id returning * into s;
    if not found then raise exception 'PRICE_SUPPLIER_NOT_FOUND'; end if;
  end if;
  return jsonb_build_object('id',s.id,'name',s.name,'active',s.active);
end $function$
