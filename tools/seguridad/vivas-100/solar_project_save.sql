CREATE OR REPLACE FUNCTION public.solar_project_save(target_organization_id uuid, target_id uuid, target_name text, target_customer text, target_quote_id uuid, target_status text, target_notes text, target_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare p public.ennco_solar_projects;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_quote_id is not null and not exists (select 1 from public.ennco_solar_quotes q where q.organization_id=target_organization_id and q.id=target_quote_id) then raise exception 'SOLAR_QUOTE_NOT_FOUND'; end if;
  if target_id is null then
    insert into public.ennco_solar_projects(organization_id,name,customer,quote_id,status,notes,created_by,updated_by)
      values (target_organization_id, trim(target_name), target_customer, target_quote_id, coalesce(target_status,'COTIZADO'), target_notes, auth.uid(), auth.uid()) returning * into p;
  else
    update public.ennco_solar_projects set name=trim(coalesce(target_name,name)), customer=coalesce(target_customer,customer), quote_id=coalesce(target_quote_id,quote_id), status=coalesce(target_status,status), notes=target_notes, updated_by=auth.uid(), updated_at=now()
      where organization_id=target_organization_id and id=target_id returning * into p;
    if not found then raise exception 'SOLAR_PROJECT_NOT_FOUND'; end if;
  end if;
  if target_items is not null then
    delete from public.ennco_solar_project_items where project_id=p.id;
    insert into public.ennco_solar_project_items(organization_id,project_id,item_id,description,unit,quantity,supplier_id,unit_cost,currency,fx,sort,purchased)
      select target_organization_id, p.id, nullif(x->>'itemId','')::uuid, coalesce(x->>'description','—'), coalesce(x->>'unit','Pzs'), coalesce((x->>'quantity')::numeric,0), nullif(x->>'supplierId','')::uuid,
        coalesce((x->>'unitCost')::numeric,0), coalesce(x->>'currency','MXN'), nullif(x->>'fx','')::numeric, coalesce((x->>'sort')::int, ord::int), coalesce((x->>'purchased')::boolean,false)
      from jsonb_array_elements(target_items) with ordinality as t(x, ord);
  end if;
  return app.solar_project_json(p);
end $function$
