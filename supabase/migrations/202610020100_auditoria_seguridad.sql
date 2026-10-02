-- 100 · Auditoría de seguridad del hub (2-oct-2026). Generado por tools/seguridad/gen-100.py desde
-- tools/seguridad/vivas-100/. Ver el docstring del generador. Ninguna cuenta pierde acceso.

begin;

set local app.operations_rpc_write = 'on';

-- 1 · Escribir exige rol con permiso de escritura (no solo membresía).
CREATE OR REPLACE FUNCTION public.product_save(target_organization_id uuid, target_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare p public.ennco_products; cat public.ennco_product_categories;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.product_set_file(target_organization_id uuid, target_id uuid, target_kind text, target_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare p public.ennco_products;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_kind not in ('photo','datasheet') then raise exception 'PRODUCT_FILE_KIND_INVALID'; end if;
  if target_path is not null and app.product_object_org_id(target_path) is distinct from target_organization_id then raise exception 'PRODUCT_FILE_PATH_INVALID'; end if;
  if target_kind = 'photo' then
    update public.ennco_products set photo_path = target_path, updated_at = now() where organization_id = target_organization_id and id = target_id returning * into p;
  else
    update public.ennco_products set datasheet_path = target_path, updated_at = now() where organization_id = target_organization_id and id = target_id returning * into p;
  end if;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return app.product_json(p);
end $function$;

CREATE OR REPLACE FUNCTION public.product_set_active(target_organization_id uuid, target_id uuid, target_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare p public.ennco_products;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  update public.ennco_products set active = target_active, updated_at = now() where organization_id = target_organization_id and id = target_id returning * into p;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return app.product_json(p);
end $function$;

CREATE OR REPLACE FUNCTION public.product_set_favorite(target_organization_id uuid, target_id uuid, target_favorite boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare p public.ennco_products;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  update public.ennco_products set favorite = target_favorite, updated_at = now() where organization_id = target_organization_id and id = target_id returning * into p;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return app.product_json(p);
end $function$;

CREATE OR REPLACE FUNCTION public.product_category_save(target_organization_id uuid, target_id uuid, target_slug text, target_name text, target_kind text, target_icon text, target_default_unit_basis text, target_sort integer, target_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare c public.ennco_product_categories;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_id is null then
    insert into public.ennco_product_categories(organization_id, slug, name, kind, icon, default_unit_basis, sort, active)
      values (target_organization_id, target_slug, trim(target_name), coalesce(target_kind, 'other'), coalesce(target_icon, 'box'), target_default_unit_basis,
        coalesce(target_sort, (select coalesce(max(sort), 0) + 10 from public.ennco_product_categories where organization_id = target_organization_id)), coalesce(target_active, true))
      on conflict (organization_id, slug) do update set name = excluded.name, kind = excluded.kind, icon = excluded.icon, default_unit_basis = excluded.default_unit_basis, active = excluded.active, updated_at = now()
      returning * into c;
  else
    update public.ennco_product_categories set slug = coalesce(target_slug, slug), name = coalesce(trim(target_name), name), kind = coalesce(target_kind, kind), icon = coalesce(target_icon, icon),
      default_unit_basis = target_default_unit_basis, sort = coalesce(target_sort, sort), active = coalesce(target_active, active), updated_at = now()
      where organization_id = target_organization_id and id = target_id returning * into c;
    if not found then raise exception 'PRODUCT_CATEGORY_NOT_FOUND'; end if;
  end if;
  return app.product_category_json(c);
end $function$;

CREATE OR REPLACE FUNCTION public.product_categories_seed_defaults(target_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare inserted integer := 0;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  insert into public.ennco_product_categories(organization_id, slug, name, kind, icon, default_unit_basis, sort)
  values
    (target_organization_id, 'modulo-fotovoltaico', 'Módulo fotovoltaico', 'module', 'panel', 'por_unidad', 10),
    (target_organization_id, 'inversor', 'Inversor', 'inverter', 'inverter', 'por_unidad', 20),
    (target_organization_id, 'microinversor', 'Microinversor', 'microinverter', 'inverter', 'por_unidad', 30),
    (target_organization_id, 'accesorio', 'Accesorio', 'accessory', 'box', 'por_unidad', 40),
    (target_organization_id, 'estructura', 'Estructura', 'structure', 'structure', 'por_panel', 50),
    (target_organization_id, 'mano-de-obra', 'Mano de obra', 'labor', 'wrench', 'por_panel', 60),
    (target_organization_id, 'adicional', 'Adicional', 'additional', 'list-plus', null, 70),
    (target_organization_id, 'baterias', 'Baterías', 'battery', 'battery', 'por_unidad', 80),
    (target_organization_id, 'controladores', 'Controladores', 'controller', 'controller', 'por_unidad', 90),
    (target_organization_id, 'inversores-off-grid', 'Inversores Off-grid', 'offgrid_inverter', 'inverter', 'por_unidad', 100)
  on conflict (organization_id, slug) do nothing;
  get diagnostics inserted = row_count;
  return jsonb_build_object('inserted', inserted);
end $function$;

CREATE OR REPLACE FUNCTION public.price_import(target_organization_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare r record; n_items int := 0; n_quotes int := 0; n_sup int := 0; sid uuid; iid uuid;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.price_item_save(target_organization_id uuid, target_id uuid, target_category text, target_name text, target_unit text, target_currency text, target_equipment jsonb, target_active boolean, target_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare i public.ennco_price_items;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.price_quote_save(target_organization_id uuid, target_item_id uuid, target_supplier_id uuid, target_period date, target_unit_price numeric, target_source text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if not exists (select 1 from public.ennco_price_items where id=target_item_id and organization_id=target_organization_id) then raise exception 'PRICE_ITEM_NOT_FOUND'; end if;
  if target_unit_price is null or target_unit_price <= 0 then
    delete from public.ennco_price_quotes where item_id=target_item_id and supplier_id=target_supplier_id and period=date_trunc('month',target_period)::date;
    return jsonb_build_object('deleted', true);
  end if;
  insert into public.ennco_price_quotes(organization_id,item_id,supplier_id,period,unit_price,source,created_by)
    values (target_organization_id,target_item_id,target_supplier_id,date_trunc('month',target_period)::date,target_unit_price,target_source,auth.uid())
    on conflict (item_id,supplier_id,period) do update set unit_price=excluded.unit_price, source=excluded.source, created_by=auth.uid(), created_at=now();
  return jsonb_build_object('itemId',target_item_id,'supplierId',target_supplier_id,'period',date_trunc('month',target_period)::date,'unitPrice',target_unit_price);
end $function$;

CREATE OR REPLACE FUNCTION public.price_settings_save(target_organization_id uuid, target_iva numeric, target_margin numeric, target_margin_by_category jsonb, target_fx_by_period jsonb, target_price_rule text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare t public.ennco_price_settings;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  insert into public.ennco_price_settings(organization_id,iva,margin,margin_by_category,fx_by_period,price_rule)
    values (target_organization_id, coalesce(target_iva,0.16), coalesce(target_margin,0.30), coalesce(target_margin_by_category,'{}'::jsonb), coalesce(target_fx_by_period,'{}'::jsonb), coalesce(target_price_rule,'MAX'))
    on conflict (organization_id) do update set iva=excluded.iva, margin=excluded.margin, margin_by_category=excluded.margin_by_category, fx_by_period=excluded.fx_by_period, price_rule=excluded.price_rule, updated_at=now()
    returning * into t;
  return jsonb_build_object('iva',t.iva,'margin',t.margin,'marginByCategory',t.margin_by_category,'fxByPeriod',t.fx_by_period,'priceRule',t.price_rule);
end $function$;

CREATE OR REPLACE FUNCTION public.price_supplier_save(target_organization_id uuid, target_id uuid, target_name text, target_active boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare s public.ennco_price_suppliers;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_id is null then
    insert into public.ennco_price_suppliers(organization_id,name,active) values (target_organization_id, trim(target_name), target_active)
      on conflict (organization_id,name) do update set active=excluded.active returning * into s;
  else
    update public.ennco_price_suppliers set name=trim(target_name), active=target_active where organization_id=target_organization_id and id=target_id returning * into s;
    if not found then raise exception 'PRICE_SUPPLIER_NOT_FOUND'; end if;
  end if;
  return jsonb_build_object('id',s.id,'name',s.name,'active',s.active);
end $function$;

CREATE OR REPLACE FUNCTION public.solar_project_save(target_organization_id uuid, target_id uuid, target_name text, target_customer text, target_quote_id uuid, target_status text, target_notes text, target_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare p public.ennco_solar_projects;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.solar_project_delete(target_organization_id uuid, target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  delete from public.ennco_solar_projects where organization_id=target_organization_id and id=target_id;
  if not found then raise exception 'SOLAR_PROJECT_NOT_FOUND'; end if;
  return jsonb_build_object('deleted', true);
end $function$;

CREATE OR REPLACE FUNCTION public.solar_quote_save(target_organization_id uuid, target_quote_id uuid, target_project_id uuid, target_segment text, target_name text, target_input jsonb, target_result jsonb, target_catalog_versions jsonb, expected_version integer DEFAULT NULL::integer, target_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare q public.ennco_solar_quotes;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_project_id is not null and not exists (select 1 from public.ennco_projects p where p.organization_id=target_organization_id and p.id=target_project_id) then
    raise exception 'SOLAR_QUOTE_PROJECT_NOT_FOUND';
  end if;
  if target_quote_id is null then
    insert into public.ennco_solar_quotes(organization_id, project_id, segment, name, status, input, result, catalog_versions, created_by, updated_by)
    values (target_organization_id, target_project_id, target_segment, left(trim(target_name), 200), coalesce(target_status, 'DRAFT'), target_input,
      coalesce(target_result, '{}'::jsonb), coalesce(target_catalog_versions, '{}'::jsonb), auth.uid(), auth.uid())
    returning * into q;
  else
    select * into q from public.ennco_solar_quotes where organization_id=target_organization_id and id=target_quote_id for update;
    if not found then raise exception 'SOLAR_QUOTE_NOT_FOUND'; end if;
    if expected_version is not null and q.version<>expected_version then raise exception 'SOLAR_QUOTE_VERSION_CONFLICT'; end if;
    update public.ennco_solar_quotes set
      project_id=coalesce(target_project_id, project_id), segment=coalesce(target_segment, segment), name=left(trim(coalesce(target_name, name)), 200),
      status=coalesce(target_status, status), input=target_input, result=coalesce(target_result, '{}'::jsonb),
      catalog_versions=coalesce(target_catalog_versions, '{}'::jsonb), version=version+1, updated_by=auth.uid(), updated_at=now()
    where id=q.id returning * into q;
  end if;
  insert into public.ennco_solar_quote_versions(organization_id, quote_id, version, name, status, input, result, catalog_versions, created_by)
  values (q.organization_id, q.id, q.version, q.name, q.status, q.input, q.result, q.catalog_versions, auth.uid());
  return app.solar_quote_json(q, true);
end $function$;

CREATE OR REPLACE FUNCTION public.solar_quote_set_status(target_organization_id uuid, target_quote_id uuid, target_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare q public.ennco_solar_quotes;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_status not in ('DRAFT','SENT','ACCEPTED','ARCHIVED') then raise exception 'SOLAR_QUOTE_STATUS_INVALID'; end if;
  update public.ennco_solar_quotes set status=target_status, updated_by=auth.uid(), updated_at=now()
  where organization_id=target_organization_id and id=target_quote_id returning * into q;
  if not found then raise exception 'SOLAR_QUOTE_NOT_FOUND'; end if;
  return app.solar_quote_json(q, false);
end $function$;

CREATE OR REPLACE FUNCTION public.account_hook_save(target_organization_id uuid, target_account_id uuid, target_hook_text text, target_source_url text, target_source_name text, target_observed_at date, target_confidence text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare h public.ennco_account_hooks;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_source_url is null and coalesce(target_confidence,'MEDIA') <> 'BAJA' then raise exception 'HOOK_SOURCE_REQUIRED'; end if;
  insert into public.ennco_account_hooks(organization_id,account_id,hook_text,source_url,source_name,observed_at,confidence,status,created_by)
  values (target_organization_id,target_account_id,btrim(target_hook_text),target_source_url,target_source_name,target_observed_at,coalesce(target_confidence,'MEDIA'),'DRAFT',auth.uid())
  returning * into h;
  return jsonb_build_object('id',h.id,'accountId',h.account_id,'hookText',h.hook_text,'status',h.status,'confidence',h.confidence);
end $function$;

CREATE OR REPLACE FUNCTION public.account_hook_review(target_organization_id uuid, target_id uuid, target_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare h public.ennco_account_hooks;
begin
  if auth.uid() is null or not app.has_role(target_organization_id,array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_status not in ('APPROVED','REJECTED','DRAFT') then raise exception 'HOOK_STATUS_INVALID'; end if;
  -- Un gancho sin fuente no se aprueba: la regla del plan es que nada se inventa.
  if target_status='APPROVED' and not exists (select 1 from public.ennco_account_hooks x where x.organization_id=target_organization_id and x.id=target_id and x.source_url is not null) then
    raise exception 'HOOK_SOURCE_REQUIRED';
  end if;
  if target_status='APPROVED' then
    update public.ennco_account_hooks set status='REJECTED', updated_at=now()
    where organization_id=target_organization_id and status='APPROVED'
      and account_id=(select account_id from public.ennco_account_hooks where organization_id=target_organization_id and id=target_id);
  end if;
  update public.ennco_account_hooks set status=target_status, reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now()
  where organization_id=target_organization_id and id=target_id returning * into h;
  if not found then raise exception 'HOOK_NOT_FOUND'; end if;
  return jsonb_build_object('id',h.id,'accountId',h.account_id,'status',h.status);
end $function$;

alter policy ennco_productos_insert on storage.objects
  with check (bucket_id = 'ennco-productos' and app.has_role(app.product_object_org_id(name), array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]));
alter policy ennco_productos_update on storage.objects
  using (bucket_id = 'ennco-productos' and app.has_role(app.product_object_org_id(name), array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]));
alter policy ennco_productos_delete on storage.objects
  using (bucket_id = 'ennco-productos' and app.has_role(app.product_object_org_id(name), array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]));

-- 2 · El rol anónimo no tiene nada que hacer con las tablas: todo lo público pasa por funciones firmadas.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, trigger, references on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- 3 · Funciones que exigen usuario con sesión: fuera el rol anónimo (y PUBLIC), se mantiene authenticated.
revoke execute on function public.account_hook_review(uuid,uuid,text) from public, anon;
grant execute on function public.account_hook_review(uuid,uuid,text) to authenticated, service_role;
revoke execute on function public.account_hook_save(uuid,uuid,text,text,text,date,text) from public, anon;
grant execute on function public.account_hook_save(uuid,uuid,text,text,text,date,text) to authenticated, service_role;
revoke execute on function public.hooks_read(uuid) from public, anon;
grant execute on function public.hooks_read(uuid) to authenticated, service_role;
revoke execute on function public.product_catalog_read(uuid) from public, anon;
grant execute on function public.product_catalog_read(uuid) to authenticated, service_role;
revoke execute on function public.product_categories_seed_defaults(uuid) from public, anon;
grant execute on function public.product_categories_seed_defaults(uuid) to authenticated, service_role;
revoke execute on function public.product_category_save(uuid,uuid,text,text,text,text,text,integer,boolean) from public, anon;
grant execute on function public.product_category_save(uuid,uuid,text,text,text,text,text,integer,boolean) to authenticated, service_role;
revoke execute on function public.product_save(uuid,uuid,jsonb) from public, anon;
grant execute on function public.product_save(uuid,uuid,jsonb) to authenticated, service_role;
revoke execute on function public.product_set_active(uuid,uuid,boolean) from public, anon;
grant execute on function public.product_set_active(uuid,uuid,boolean) to authenticated, service_role;
revoke execute on function public.product_set_favorite(uuid,uuid,boolean) from public, anon;
grant execute on function public.product_set_favorite(uuid,uuid,boolean) to authenticated, service_role;
revoke execute on function public.product_set_file(uuid,uuid,text,text) from public, anon;
grant execute on function public.product_set_file(uuid,uuid,text,text) to authenticated, service_role;
revoke execute on function public.activate_control_cadence_policy(uuid,uuid,text,text) from public, anon;
grant execute on function public.activate_control_cadence_policy(uuid,uuid,text,text) to authenticated, service_role;
revoke execute on function public.activate_retention_policy(uuid,uuid,text,text) from public, anon;
grant execute on function public.activate_retention_policy(uuid,uuid,text,text) to authenticated, service_role;
revoke execute on function public.approve_retention_batch(uuid,uuid,text,text) from public, anon;
grant execute on function public.approve_retention_batch(uuid,uuid,text,text) to authenticated, service_role;
revoke execute on function public.assess_research_inventory(uuid) from public, anon;
grant execute on function public.assess_research_inventory(uuid) to authenticated, service_role;
revoke execute on function public.assign_operational_task(uuid,uuid,uuid,uuid,text) from public, anon;
grant execute on function public.assign_operational_task(uuid,uuid,uuid,uuid,text) to authenticated, service_role;
revoke execute on function public.complete_operational_task_v2(uuid,uuid,text,text) from public, anon;
grant execute on function public.complete_operational_task_v2(uuid,uuid,text,text) to authenticated, service_role;
revoke execute on function public.configure_single_teckel_operator(uuid,uuid,text,text) from public, anon;
grant execute on function public.configure_single_teckel_operator(uuid,uuid,text,text) to authenticated, service_role;
revoke execute on function public.create_control_cadence_policy(uuid,integer,evidence_class,integer,jsonb,text) from public, anon;
grant execute on function public.create_control_cadence_policy(uuid,integer,evidence_class,integer,jsonb,text) to authenticated, service_role;
revoke execute on function public.create_retention_legal_hold(uuid,uuid,legal_hold_reason_code,text,timestamp with time zone,text) from public, anon;
grant execute on function public.create_retention_legal_hold(uuid,uuid,legal_hold_reason_code,text,timestamp with time zone,text) to authenticated, service_role;
revoke execute on function public.create_retention_policy(uuid,integer,text,timestamp with time zone,text,jsonb,text) from public, anon;
grant execute on function public.create_retention_policy(uuid,integer,text,timestamp with time zone,text,jsonb,text) to authenticated, service_role;
revoke execute on function public.decide_operational_approval(uuid,uuid,text,text,text,text) from public, anon;
grant execute on function public.decide_operational_approval(uuid,uuid,text,text,text,text) to authenticated, service_role;
revoke execute on function public.evaluate_control_cadence_health(uuid,timestamp with time zone) from public, anon;
grant execute on function public.evaluate_control_cadence_health(uuid,timestamp with time zone) to authenticated, service_role;
revoke execute on function public.evaluate_operations_health(uuid,timestamp with time zone) from public, anon;
grant execute on function public.evaluate_operations_health(uuid,timestamp with time zone) to authenticated, service_role;
revoke execute on function public.evaluate_retention_health(uuid) from public, anon;
grant execute on function public.evaluate_retention_health(uuid) to authenticated, service_role;
revoke execute on function public.freeze_research_inventory_snapshot(uuid,text,text) from public, anon;
grant execute on function public.freeze_research_inventory_snapshot(uuid,text,text) to authenticated, service_role;
revoke execute on function public.ingest_research_batch(uuid,text,text,text,jsonb,text) from public, anon;
grant execute on function public.ingest_research_batch(uuid,text,text,text,jsonb,text) to authenticated, service_role;
revoke execute on function public.mitigate_control_cadence_breach(uuid,uuid,text,text) from public, anon;
grant execute on function public.mitigate_control_cadence_breach(uuid,uuid,text,text) to authenticated, service_role;
revoke execute on function public.record_control_cadence_attendance(uuid,uuid,uuid,text,text,text) from public, anon;
grant execute on function public.record_control_cadence_attendance(uuid,uuid,uuid,text,text,text) to authenticated, service_role;
revoke execute on function public.record_control_cadence_delivery(uuid,uuid,text,text,evidence_class,text,timestamp with time zone,text,boolean,text) from public, anon;
grant execute on function public.record_control_cadence_delivery(uuid,uuid,text,text,evidence_class,text,timestamp with time zone,text,boolean,text) to authenticated, service_role;
revoke execute on function public.record_control_cadence_evidence(uuid,uuid,text,text,text,evidence_class,text,text) from public, anon;
grant execute on function public.record_control_cadence_evidence(uuid,uuid,text,text,text,evidence_class,text,text) to authenticated, service_role;
revoke execute on function public.record_control_cadence_session(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,evidence_class,text,text) from public, anon;
grant execute on function public.record_control_cadence_session(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,evidence_class,text,text) to authenticated, service_role;
revoke execute on function public.record_meeting_outcome_v2(uuid,uuid,text,timestamp with time zone,text,text,text) from public, anon;
grant execute on function public.record_meeting_outcome_v2(uuid,uuid,text,timestamp with time zone,text,text,text) to authenticated, service_role;
revoke execute on function public.record_research_evidence(uuid,text,uuid,text,text,text,timestamp with time zone,source_confidence,jsonb,text,text) from public, anon;
grant execute on function public.record_research_evidence(uuid,text,uuid,text,text,text,timestamp with time zone,source_confidence,jsonb,text,text) to authenticated, service_role;
revoke execute on function public.release_retention_legal_hold(uuid,uuid,text,text) from public, anon;
grant execute on function public.release_retention_legal_hold(uuid,uuid,text,text) to authenticated, service_role;
revoke execute on function public.request_operational_approval(uuid,text,uuid,text,text,text) from public, anon;
grant execute on function public.request_operational_approval(uuid,text,uuid,text,text,text) to authenticated, service_role;
revoke execute on function public.resolve_research_dedupe(uuid,uuid,text,uuid,text,text) from public, anon;
grant execute on function public.resolve_research_dedupe(uuid,uuid,text,uuid,text,text) to authenticated, service_role;
revoke execute on function public.review_reply_and_route(uuid,uuid,reply_classification,text) from public, anon;
grant execute on function public.review_reply_and_route(uuid,uuid,reply_classification,text) to authenticated, service_role;
revoke execute on function public.submit_research_review(uuid,text,uuid,text,uuid[],text,text) from public, anon;
grant execute on function public.submit_research_review(uuid,text,uuid,text,uuid[],text,text) to authenticated, service_role;
revoke execute on function public.transition_operational_incident(uuid,uuid,text,text,text,boolean,text) from public, anon;
grant execute on function public.transition_operational_incident(uuid,uuid,text,text,text,boolean,text) to authenticated, service_role;
revoke execute on function public.upsert_contact_candidate(uuid,uuid,text,text,text,text,uuid[],text) from public, anon;
grant execute on function public.upsert_contact_candidate(uuid,uuid,text,text,text,text,uuid[],text) to authenticated, service_role;
revoke execute on function public.upsert_research_account(uuid,uuid,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.upsert_research_account(uuid,uuid,text,text,text,text,text,text,text) to authenticated, service_role;
revoke execute on function public.verify_contact_candidate(uuid,uuid,uuid,uuid,text) from public, anon;
grant execute on function public.verify_contact_candidate(uuid,uuid,uuid,uuid,text) to authenticated, service_role;

-- 4 · Versión vieja sin prueba HMAC (fuera del repo; el motor usa la de 7 argumentos).
drop function if exists public.claim_direct_lane_dispatch(uuid, uuid, boolean);

-- 5 · Firma del SDR comparada en tiempo constante.
CREATE OR REPLACE FUNCTION public.email_sdr_command(target_organization_id uuid, target_payload text, proof_command_id text, proof_nonce uuid, proof_expires_at timestamp with time zone, proof_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare cfg app.email_sdr_settings%rowtype; sha text; signature text; p jsonb; op text; c public.email_sdr_cases%rowtype;
  e public.provider_events%rowtype; inbound public.messages%rowtype; enrollment public.campaign_enrollments%rowtype;
  mailbox public.mailboxes%rowtype; contact public.contacts%rowtype; campaign public.campaigns%rowtype; account public.accounts%rowtype;
  result jsonb; work jsonb:='[]'; message_id_value uuid; body_value text; intent text; next_due timestamptz;
  reviewed_count integer; model_calls integer; work_count integer:=0; followup boolean; row_value record;
begin
  select * into cfg from app.email_sdr_settings where organization_id=target_organization_id;
  if cfg.service_secret is null or proof_nonce is null or proof_signature is null or proof_expires_at is null
    or proof_command_id is distinct from 'email_sdr_command:'||proof_nonce::text
    or proof_expires_at<=clock_timestamp() or proof_expires_at>clock_timestamp()+interval '5 minutes'
    or target_payload is null or octet_length(target_payload)>50000 then raise exception 'SDR_UNAUTHORIZED'; end if;
  sha:=encode(digest(convert_to(concat_ws(E'\n','email_sdr_command',target_organization_id::text,
    encode(digest(convert_to(target_payload,'utf8'),'sha256'),'hex')),'utf8'),'sha256'),'hex');
  signature:=encode(app.hmac(convert_to(concat_ws(E'\n',target_organization_id::text,proof_command_id,proof_nonce::text,
    to_char(proof_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),sha),'utf8'),convert_to(cfg.service_secret,'utf8'),'sha256'),'hex');
  if digest(proof_signature,'sha256')<>digest(signature,'sha256') then raise exception 'SDR_UNAUTHORIZED'; end if;
  insert into app.email_sdr_nonces values(target_organization_id,proof_nonce,proof_expires_at);
  delete from app.email_sdr_nonces where organization_id=target_organization_id and expires_at<clock_timestamp()-interval '1 day';
  p:=target_payload::jsonb; op:=p->>'op';
  if op='ALERT_WORK' then
    return app.email_sdr_alert_work(target_organization_id);
  elsif op='ALERT_SETTLE' then
    return app.email_sdr_alert_settle(target_organization_id,(p->>'case_id')::uuid,
      p->>'stage',(p->>'accepted')::boolean);
  end if;
  if op='WORK' then
    -- Only configured commercial campaigns. Internal tests never enter the queue.
    insert into public.email_sdr_cases(organization_id,provider_event_id,owner_user_id,policy_version)
    select pe.organization_id,pe.id,a.primary_user_id,cfg.policy_version from public.provider_events pe
      join public.messages m on m.organization_id=pe.organization_id and m.id=pe.message_id
      join public.campaign_enrollments ce on ce.organization_id=m.organization_id and ce.id=m.enrollment_id
      join public.campaigns ca on ca.organization_id=ce.organization_id and ca.id=ce.campaign_id
      left join public.operational_assignments a on a.organization_id=pe.organization_id and a.status='ACTIVE'
      where pe.organization_id=target_organization_id and pe.event_kind in ('REPLY','AUTO_REPLY') and m.direction='INBOUND'
        and ca.id=any(cfg.campaign_ids) and ca.name !~* '^PRUEBA'
      on conflict(organization_id,provider_event_id) do nothing;
    -- Reconcile the existing sender's receipts; never treat QUEUED as SENT.
    for row_value in select sc.id,m.status,m.sent_at,m.provider_message_id,sc.decision->>'subtype' as subtype from public.email_sdr_cases sc
      join public.messages m on m.organization_id=sc.organization_id and m.id=sc.message_id
      where sc.organization_id=target_organization_id and sc.state='QUEUED' and m.status in ('SENT','DELIVERED','FAILED','QUARANTINED')
    loop
      if row_value.status in ('SENT','DELIVERED') and row_value.provider_message_id is not null then
        update public.email_sdr_cases set state='SENT',initial_sent_at=coalesce(initial_sent_at,row_value.sent_at),
          next_due_at=case when row_value.subtype in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then null when followups_sent<2 then app.email_sdr_followup_due(target_organization_id,coalesce(initial_sent_at,row_value.sent_at),case when followups_sent=0 then 3 else 7 end) else null end,
          next_action=case when row_value.subtype in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then 'Respondida automáticamente con copia a Paco. Paco coordina desde su correo'
            when followups_sent<2 then 'Seguimiento por email sujeto a revisión de conversación y calendario' else 'Seguimiento concluido' end,updated_at=clock_timestamp()
          where id=row_value.id;
        if row_value.subtype in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then perform app.email_sdr_mark_positive(target_organization_id,row_value.id); end if;
      else
        update public.email_sdr_cases set state='BLOCKED',next_action='Reconciliar resultado de envío. No reintentar',updated_at=clock_timestamp() where id=row_value.id;
      end if;
    end loop;
    for c in select * from public.email_sdr_cases sc where sc.organization_id=target_organization_id
      and ((sc.state='READY' and coalesce(sc.send_after,'-infinity'::timestamptz)<=clock_timestamp()) or (sc.state='SENT' and sc.next_due_at<=clock_timestamp() and sc.followups_sent<2))
      and coalesce(sc.lease_until,'epoch')<clock_timestamp() order by sc.created_at limit 10 for update skip locked
    loop
      update public.email_sdr_cases set lease_until=clock_timestamp()+interval '4 minutes' where id=c.id;
      select * into e from public.provider_events where id=c.provider_event_id and organization_id=target_organization_id;
      select * into inbound from public.messages where id=e.message_id and organization_id=target_organization_id;
      select * into enrollment from public.campaign_enrollments where id=inbound.enrollment_id and organization_id=target_organization_id;
      select * into contact from public.contacts where id=inbound.contact_id and organization_id=target_organization_id;
      select * into account from public.accounts where id=contact.account_id and organization_id=target_organization_id;
      select * into campaign from public.campaigns where id=enrollment.campaign_id and organization_id=target_organization_id;
      select * into mailbox from public.mailboxes where id=inbound.mailbox_id and organization_id=target_organization_id;
      work:=work||jsonb_build_array(jsonb_build_object('case_id',c.id,'event_id',e.id,'event_kind',e.event_kind,'body',inbound.body_text,
        'mailbox_id',inbound.mailbox_id,'mailbox_email',mailbox.normalized_email,'contact_email',contact.normalized_email,'owner_id',c.owner_user_id,
        'campaign_id',campaign.id,'campaign_name',campaign.name,'offer_id',campaign.manifest_json->>'offer_id',
        'account_name',account.legal_name,'contact_role',contact.role_title,
        'plant_state',(select cl.plant_state from public.email_contact_clearances cl where cl.organization_id=target_organization_id and cl.contact_id=contact.id and cl.decision='READY' and cl.expires_at>clock_timestamp()),
        'provider_message_id',inbound.provider_message_id,'provider_thread_id',inbound.provider_thread_id,'related_outbound_id',e.payload_json->>'related_outbound_message_id',
        'suppressed',app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2)),
        'followup',c.state='SENT','followups_sent',c.followups_sent,'approved',c.approved,'decision',c.decision,
        'own_sdr_message_ids',coalesce((select jsonb_agg(m.provider_message_id) from public.messages m where m.organization_id=target_organization_id and m.reply_to_provider_event_id=e.id and m.idempotency_key like 'email-sdr:%' and m.provider_message_id is not null),'[]'::jsonb)));
      work_count:=work_count+1;
    end loop;
    return jsonb_build_object('status','WORK','mode',cfg.mode,'policy_version',cfg.policy_version,'cases',work,'count',work_count);
  elsif op='MODEL_SLOT' then
    if cfg.mode='PAUSED' or cfg.max_model_calls_daily=0 then return jsonb_build_object('allowed',false); end if;
    insert into app.email_sdr_model_usage values(target_organization_id,(clock_timestamp() at time zone 'America/Mexico_City')::date,0) on conflict do nothing;
    update app.email_sdr_model_usage set calls=calls+1 where organization_id=target_organization_id and day=(clock_timestamp() at time zone 'America/Mexico_City')::date and calls<cfg.max_model_calls_daily returning calls into model_calls;
    return jsonb_build_object('allowed',model_calls is not null);
  end if;
  select * into c from public.email_sdr_cases where organization_id=target_organization_id and id=(p->>'case_id')::uuid for update;
  if c.id is null then raise exception 'SDR_CASE_NOT_FOUND'; end if;
  select * into e from public.provider_events where organization_id=target_organization_id and id=c.provider_event_id;
  select * into inbound from public.messages where organization_id=target_organization_id and id=e.message_id and direction='INBOUND';
  select * into enrollment from public.campaign_enrollments where organization_id=target_organization_id and id=inbound.enrollment_id;
  select * into campaign from public.campaigns where organization_id=target_organization_id and id=enrollment.campaign_id;
  select * into contact from public.contacts where organization_id=target_organization_id and id=inbound.contact_id;
  if campaign.id is null or not campaign.id=any(cfg.campaign_ids) then raise exception 'SDR_CAMPAIGN_NOT_ALLOWED'; end if;
  if op='SEND_CONTEXT' then
    if c.state<>'QUEUED' or c.message_id is distinct from (p->>'message_id')::uuid or cfg.mode='PAUSED'
      or c.policy_version<>cfg.policy_version or app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2))
      or not exists(select 1 from public.runtime_controls rc where rc.organization_id=target_organization_id and not rc.global_kill_switch and rc.external_send_allowed)
      then return jsonb_build_object('status','HOLD'); end if;
    select * into mailbox from public.mailboxes where organization_id=target_organization_id and id=inbound.mailbox_id;
    return jsonb_build_object('status','SEND_CONTEXT','case_id',c.id,'event_id',e.id,'event_kind',e.event_kind,'body',inbound.body_text,
      'mailbox_id',inbound.mailbox_id,'mailbox_email',mailbox.normalized_email,'contact_email',contact.normalized_email,'owner_id',c.owner_user_id,
      'provider_message_id',inbound.provider_message_id,'provider_thread_id',inbound.provider_thread_id,'related_outbound_id',e.payload_json->>'related_outbound_message_id',
      'suppressed',false,'followup',c.followups_sent>0,'followups_sent',c.followups_sent,'approved',c.approved,'decision',c.decision,
      'own_sdr_message_ids',coalesce((select jsonb_agg(m.provider_message_id) from public.messages m where m.organization_id=target_organization_id and m.reply_to_provider_event_id=e.id and m.idempotency_key like 'email-sdr:%' and m.provider_message_id is not null),'[]'::jsonb));
  elsif op='DECIDE' then
    if p->>'policy_version' is distinct from cfg.policy_version or p->'decision'->>'intent' not in
      ('CONTEXT','EXPLICIT_INTEREST','PRICE','UNSUBSCRIBE','OUT_OF_OFFICE','REFERRAL','WRONG_PERSON','NOT_NOW','REJECTION','COMPLAINT','TECHNICAL_COMMITMENT','AMBIGUOUS') then raise exception 'SDR_DECISION_INVALID'; end if;
    if c.state in ('QUEUED','SUPPRESSED','NO_ACTION','MANUAL_HANDLED') then return jsonb_build_object('status','DUPLICATE'); end if;
    update public.email_sdr_cases set decision=case when p->'decision'->>'subtype' in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then p->'decision'||jsonb_build_object('draft',coalesce(app.email_sdr_positive_body(target_organization_id,c.id,p->'decision'->>'subtype'),'')) else p->'decision' end,thread_hash=p->>'thread_hash',thread_checked_at=clock_timestamp(),
      state=case when p->>'state' in ('REVIEW','BLOCKED','NO_ACTION','MANUAL_HANDLED') then p->>'state' else 'REVIEW' end,
      approved=case when reviewed_thread_hash=p->>'thread_hash' and reviewed_policy_version=cfg.policy_version then approved else false end,
      next_action=left(coalesce(p->>'next_action','Revisión humana requerida'),1000),lease_until=null,updated_at=clock_timestamp() where id=c.id;
    return jsonb_build_object('status','RECORDED');
  elsif op='SUPPRESSED' then
    if not app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2)) then raise exception 'SDR_SUPPRESSION_NOT_CONFIRMED'; end if;
    update public.email_sdr_cases set state='SUPPRESSED',next_due_at=null,next_action='Baja aplicada. No enviar',lease_until=null,updated_at=clock_timestamp() where id=c.id;
    return jsonb_build_object('status','SUPPRESSED');
  elsif op='QUEUE' then
    if c.state='QUEUED' then return jsonb_build_object('status','DUPLICATE','message_id',c.message_id); end if;
    if cfg.mode='PAUSED' then return jsonb_build_object('status','HOLD','reason','SDR_PAUSED'); end if;
    if inbound.body_text is null or inbound.normalized_from is distinct from contact.normalized_email or c.owner_user_id is null
      or c.thread_checked_at<clock_timestamp()-interval '60 seconds' or c.thread_hash is distinct from p->>'thread_hash'
      or c.thread_checked_at is null or c.thread_hash is null or c.decision->'gates' is distinct from '[]'::jsonb then return jsonb_build_object('status','HOLD','reason','CONVERSATION_NOT_ELIGIBLE'); end if;
    if app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2)) then return jsonb_build_object('status','HOLD','reason','SUPPRESSED'); end if;
    if exists(select 1 from public.messages m where m.organization_id=target_organization_id and m.enrollment_id=inbound.enrollment_id
      and m.id<>inbound.id and m.direction='INBOUND' and m.created_at>inbound.created_at) then return jsonb_build_object('status','HOLD','reason','NEWER_REPLY'); end if;
    intent:=c.decision->>'intent';
    if intent not in ('CONTEXT','EXPLICIT_INTEREST') or c.decision->>'eligible' is distinct from 'true' then return jsonb_build_object('status','HOLD','reason','CLASS_REQUIRES_HUMAN'); end if;
    select count(*) into reviewed_count from public.email_sdr_cases sc join public.messages m on m.id=sc.message_id and m.organization_id=sc.organization_id
      where sc.organization_id=target_organization_id and sc.approved and sc.reviewed_by is not null and sc.reviewed_policy_version=cfg.policy_version
        and sc.decision->>'eligible'='true' and m.status in ('SENT','DELIVERED') and m.provider_message_id is not null and m.rfc_message_id is not null
        and m.provider_thread_id=(select im.provider_thread_id from public.provider_events pe join public.messages im on im.id=pe.message_id and im.organization_id=pe.organization_id where pe.id=sc.provider_event_id and pe.organization_id=sc.organization_id);
    if not(c.approved and c.reviewed_thread_hash=c.thread_hash and c.reviewed_policy_version=cfg.policy_version) then
      if cfg.mode<>'AUTO' or not intent=any(cfg.auto_intents) or coalesce(c.decision->>'subtype','') not in ('POSITIVE_ACCEPT','POSITIVE_VISIT')
        or cfg.acceptance_evidence->>'tests_passed' is distinct from 'true'
        or cfg.acceptance_evidence->>'pause_resume_verified' is distinct from 'true'
        then return jsonb_build_object('status','HOLD','reason','AUTO_NOT_ENABLED'); end if;
    end if;
    followup:=coalesce((p->>'followup')::boolean,false);
    if not followup and not(c.approved and c.reviewed_thread_hash=c.thread_hash and c.reviewed_policy_version=cfg.policy_version) then
      if c.send_after is null or c.send_after>clock_timestamp() or not app.direct_lane_campaign_window_open(clock_timestamp()) then
        update public.email_sdr_cases set send_after=case when c.send_after is not null and c.send_after>clock_timestamp() then c.send_after
            else app.email_sdr_next_send_at(greatest(coalesce(e.observed_at,inbound.created_at),coalesce(c.send_after,'-infinity'::timestamptz)),c.id::text) end,
          state='READY',next_action='Respuesta automática programada con copia a Paco',lease_until=null,updated_at=clock_timestamp()
          where id=c.id returning send_after into next_due;
        if next_due>clock_timestamp()+interval '30 seconds' then return jsonb_build_object('status','HOLD','reason','SCHEDULED','send_after',next_due); end if;
      end if;
    end if;
    if followup and (c.initial_sent_at is null or c.followups_sent>=2 or c.next_due_at is null or c.next_due_at>clock_timestamp()) then return jsonb_build_object('status','HOLD','reason','FOLLOWUP_NOT_DUE'); end if;
    if not followup and c.initial_sent_at is not null then return jsonb_build_object('status','HOLD','reason','INITIAL_ALREADY_SENT'); end if;
    body_value:=case when followup then case when c.followups_sent=0 then
      E'Retomo tu respuesta por aquí. ¿Sigue vigente la necesidad que comentaste?\n\nFrancisco'
      else E'Cierro el seguimiento por ahora para no insistir. Si retoman la revisión, puedes responder en este mismo correo.\n\nFrancisco' end
      when c.decision->>'subtype' in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then app.email_sdr_positive_body(target_organization_id,c.id,c.decision->>'subtype')
      when intent='CONTEXT' then E'Claro. En ENNCO hacemos instalaciones fotovoltaicas y mantenimiento eléctrico industrial: tableros, transformadores e instalaciones solares. Entregamos un reporte de lo que encontramos y de lo que conviene atender primero.\n\n¿Qué necesitas revisar hoy en tu planta?\n\nFrancisco'
      else E'Gracias por contármelo. Para entender la necesidad antes de proponerte un alcance, ¿qué equipo o instalación necesitas revisar?\n\nFrancisco' end;
    if nullif(btrim(body_value),'') is null then return jsonb_build_object('status','HOLD','reason','TEMPLATE_NOT_APPROVED'); end if;
    select * into mailbox from public.mailboxes where organization_id=target_organization_id and id=inbound.mailbox_id;
    insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,lane,touch_number,
      normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id,provider_thread_id,cc_emails,reply_to_provider_event_id)
    values(target_organization_id,enrollment.id,inbound.mailbox_id,contact.id,'OUTBOUND','QUEUED','DIRECT',null,contact.normalized_email,mailbox.normalized_email,
      left(case when inbound.subject ~* '^re:' then inbound.subject else 'Re: '||coalesce(inbound.subject,'Seguimiento') end,180),body_value,
      'email-sdr:'||c.id::text||':'||case when followup then (c.followups_sent+1)::text else '0' end,gen_random_uuid(),inbound.provider_thread_id,
      case when campaign.manifest_json->>'cc_on_reply_email' is null then '{}'::text[] else array[lower(campaign.manifest_json->>'cc_on_reply_email')] end,e.id)
    on conflict(organization_id,idempotency_key) do nothing returning id into message_id_value;
    if message_id_value is null then return jsonb_build_object('status','DUPLICATE'); end if;
    update public.email_sdr_cases set state='QUEUED',message_id=message_id_value,followups_sent=followups_sent+case when followup then 1 else 0 end,
      next_action='Esperar recibo del transporte original',lease_until=null,updated_at=clock_timestamp() where id=c.id;
    return jsonb_build_object('status','QUEUED','message_id',message_id_value);
  end if;
  raise exception 'SDR_COMMAND_INVALID';
end $function$;

-- 6 · RLS en las tablas internas de app (postgres es dueño y lo omite; nadie más tiene permisos).
alter table app.private_runtime_config enable row level security;
alter table app.auth_policy enable row level security;
alter table app.dispatch_holidays enable row level security;
alter table app.email_sdr_body_overrides enable row level security;
alter table app.email_unmatched_review_commands enable row level security;
alter table app.email_sdr_settings enable row level security;
alter table app.email_sdr_nonces enable row level security;
alter table app.email_sdr_model_usage enable row level security;
alter table app.email_contact_clearance_commands enable row level security;
alter table app.email_sdr_alert_dispatch enable row level security;
alter table app.email_sdr_templates enable row level security;

-- 7 · Límite de intentos de inicio de sesión y recuperación.
create table if not exists public.auth_attempt_windows (
  organization_id uuid not null references public.organizations(id),
  kind text not null check (kind in ('login','recovery')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  attempts integer not null default 0,
  primary key (organization_id, kind, key_hash, window_start)
);
alter table public.auth_attempt_windows enable row level security;
revoke all on public.auth_attempt_windows from public, anon, authenticated;

create or replace function public.check_auth_attempt(target_organization_id uuid, target_kind text, target_email_hash text,
  target_ip_hash text, proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path = public, app, extensions, pg_temp as $$
declare win timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / 900) * 900);
  email_count integer; ip_count integer; email_limit integer; ip_limit integer;
begin
  if target_kind not in ('login','recovery') or target_email_hash !~ '^[a-f0-9]{64}$' or target_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'AUTH_ATTEMPT_INVALID';
  end if;
  perform app.verify_dispatch_proof(target_organization_id, proof_command_id, proof_nonce, proof_expires_at,
    encode(digest(convert_to(concat_ws(E'\n','check_auth_attempt',target_organization_id::text,target_kind,target_email_hash,target_ip_hash),'utf8'),'sha256'),'hex'),
    proof_signature);
  email_limit := case when target_kind = 'login' then 10 else 3 end;
  ip_limit := case when target_kind = 'login' then 30 else 10 end;
  insert into public.auth_attempt_windows values (target_organization_id, target_kind, target_email_hash, win, 1)
    on conflict (organization_id, kind, key_hash, window_start) do update set attempts = auth_attempt_windows.attempts + 1
    returning attempts into email_count;
  insert into public.auth_attempt_windows values (target_organization_id, target_kind, target_ip_hash, win, 1)
    on conflict (organization_id, kind, key_hash, window_start) do update set attempts = auth_attempt_windows.attempts + 1
    returning attempts into ip_count;
  delete from public.auth_attempt_windows where window_start < clock_timestamp() - interval '2 days';
  return jsonb_build_object('allowed', email_count <= email_limit and ip_count <= ip_limit);
end $$;
revoke all on function public.check_auth_attempt(uuid, text, text, text, text, uuid, timestamptz, text) from public;
grant execute on function public.check_auth_attempt(uuid, text, text, text, text, uuid, timestamptz, text) to anon, authenticated, service_role;

-- 8 · Limpieza única de nonces vencidos (no hay pg_cron).
delete from public.public_prequote_nonces where request_expires_at < now() - interval '1 day';

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('e0000000-0000-4000-8000-000000000001', '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', 'SECURITY_AUDIT_HARDENING', 'organizations', 'e0000000-0000-4000-8000-000000000001',
  jsonb_build_object('source','migración 100','write_rpcs',17,'anon_functions_revoked',42,'app_tables_rls',11));

commit;
