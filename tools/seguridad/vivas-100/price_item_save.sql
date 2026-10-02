CREATE OR REPLACE FUNCTION public.price_item_save(target_organization_id uuid, target_id uuid, target_category text, target_name text, target_unit text, target_currency text, target_equipment jsonb, target_active boolean, target_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare i public.ennco_price_items;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_id is null then
    insert into public.ennco_price_items(organization_id,category,name,unit,currency,equipment,active,notes,sort)
      values (target_organization_id, trim(target_category), trim(target_name), coalesce(target_unit,'Pzs'), coalesce(target_currency,'MXN'), target_equipment, coalesce(target_active,true), target_notes,
        coalesce((select max(sort)+1 from public.ennco_price_items where organization_id=target_organization_id and category=trim(target_category)),0))
      on conflict (organization_id,category,name) do update set unit=excluded.unit, currency=excluded.currency, equipment=excluded.equipment, active=excluded.active, notes=excluded.notes, updated_at=now()
      returning * into i;
  else
    update public.ennco_price_items set category=trim(target_category), name=trim(target_name), unit=coalesce(target_unit,unit), currency=coalesce(target_currency,currency), equipment=target_equipment, active=coalesce(target_active,active), notes=target_notes, updated_at=now()
      where organization_id=target_organization_id and id=target_id returning * into i;
    if not found then raise exception 'PRICE_ITEM_NOT_FOUND'; end if;
  end if;
  return jsonb_build_object('id',i.id,'category',i.category,'name',i.name,'unit',i.unit,'currency',i.currency,'equipment',i.equipment,'sort',i.sort,'active',i.active,'notes',i.notes);
end $function$
