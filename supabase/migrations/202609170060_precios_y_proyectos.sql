begin;

-- Precios y proveedores (el Excel "Tabla comparativa de precios" de ENNCO hecho tabla) y
-- Proyectos (cliente + cotización + lista de materiales con cantidades y proveedor elegido).
-- Acceso solo por RPC con guarda de membresía, como el cotizador.

create table if not exists public.ennco_price_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (length(trim(name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.ennco_price_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  category text not null check (length(trim(category)) between 1 and 80),
  name text not null check (length(trim(name)) between 1 and 200),
  unit text not null default 'Pzs',
  currency text not null default 'MXN' check (currency in ('MXN','USD')),
  -- equipment: equipo ligado al catalogo del cotizador {kind: module o inverter, model} o null
  equipment jsonb,
  sort integer not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, category, name)
);

/* Un precio por material, proveedor y mes (periodo = primer día del mes). */
create table if not exists public.ennco_price_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  item_id uuid not null references public.ennco_price_items(id) on delete cascade,
  supplier_id uuid not null references public.ennco_price_suppliers(id),
  period date not null,
  unit_price numeric(14,4) not null check (unit_price >= 0),
  source text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (item_id, supplier_id, period)
);
create index if not exists ennco_price_quotes_item_period on public.ennco_price_quotes (item_id, period desc);

/* Ajustes: IVA, margen global, margen por categoría y tipo de cambio por mes. */
create table if not exists public.ennco_price_settings (
  organization_id uuid primary key references public.organizations(id),
  iva numeric(6,4) not null default 0.16,
  margin numeric(6,4) not null default 0.30,
  margin_by_category jsonb not null default '{}'::jsonb,
  fx_by_period jsonb not null default '{}'::jsonb,
  price_rule text not null default 'MAX' check (price_rule in ('MAX','MIN','AVG')),
  updated_at timestamptz not null default now()
);

create table if not exists public.ennco_solar_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (length(trim(name)) between 1 and 200),
  customer text,
  quote_id uuid references public.ennco_solar_quotes(id),
  status text not null default 'COTIZADO' check (status in ('COTIZADO','APROBADO','EN_COMPRA','INSTALADO','CERRADO','CANCELADO')),
  notes text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ennco_solar_project_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  project_id uuid not null references public.ennco_solar_projects(id) on delete cascade,
  item_id uuid references public.ennco_price_items(id),
  description text not null,
  unit text not null default 'Pzs',
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  supplier_id uuid references public.ennco_price_suppliers(id),
  unit_cost numeric(14,4) not null default 0,
  currency text not null default 'MXN' check (currency in ('MXN','USD')),
  fx numeric(10,4),
  sort integer not null default 0,
  purchased boolean not null default false
);

alter table public.ennco_price_suppliers enable row level security;
alter table public.ennco_price_items enable row level security;
alter table public.ennco_price_quotes enable row level security;
alter table public.ennco_price_settings enable row level security;
alter table public.ennco_solar_projects enable row level security;
alter table public.ennco_solar_project_items enable row level security;
revoke all on public.ennco_price_suppliers, public.ennco_price_items, public.ennco_price_quotes, public.ennco_price_settings,
  public.ennco_solar_projects, public.ennco_solar_project_items from public, anon, authenticated, service_role;

/* ---------- lectura completa del catálogo de precios ---------- */
create or replace function public.price_catalog_read(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  return jsonb_build_object(
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'active',s.active) order by s.name) from public.ennco_price_suppliers s where s.organization_id=target_organization_id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'category',i.category,'name',i.name,'unit',i.unit,'currency',i.currency,'equipment',i.equipment,'sort',i.sort,'active',i.active,'notes',i.notes) order by i.sort, i.name) from public.ennco_price_items i where i.organization_id=target_organization_id), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('itemId',q.item_id,'supplierId',q.supplier_id,'period',q.period,'unitPrice',q.unit_price) order by q.period) from public.ennco_price_quotes q where q.organization_id=target_organization_id), '[]'::jsonb),
    'settings', coalesce((select jsonb_build_object('iva',t.iva,'margin',t.margin,'marginByCategory',t.margin_by_category,'fxByPeriod',t.fx_by_period,'priceRule',t.price_rule) from public.ennco_price_settings t where t.organization_id=target_organization_id),
      jsonb_build_object('iva',0.16,'margin',0.30,'marginByCategory','{}'::jsonb,'fxByPeriod','{}'::jsonb,'priceRule','MAX'))
  );
end $$;

create or replace function public.price_supplier_save(target_organization_id uuid, target_id uuid, target_name text, target_active boolean default true)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
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
end $$;

create or replace function public.price_item_save(target_organization_id uuid, target_id uuid, target_category text, target_name text, target_unit text, target_currency text, target_equipment jsonb, target_active boolean, target_notes text)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
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
end $$;

/* Un precio del mes: si llega 0 o null se borra la celda. */
create or replace function public.price_quote_save(target_organization_id uuid, target_item_id uuid, target_supplier_id uuid, target_period date, target_unit_price numeric, target_source text default null)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
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
end $$;

create or replace function public.price_settings_save(target_organization_id uuid, target_iva numeric, target_margin numeric, target_margin_by_category jsonb, target_fx_by_period jsonb, target_price_rule text)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare t public.ennco_price_settings;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  insert into public.ennco_price_settings(organization_id,iva,margin,margin_by_category,fx_by_period,price_rule)
    values (target_organization_id, coalesce(target_iva,0.16), coalesce(target_margin,0.30), coalesce(target_margin_by_category,'{}'::jsonb), coalesce(target_fx_by_period,'{}'::jsonb), coalesce(target_price_rule,'MAX'))
    on conflict (organization_id) do update set iva=excluded.iva, margin=excluded.margin, margin_by_category=excluded.margin_by_category, fx_by_period=excluded.fx_by_period, price_rule=excluded.price_rule, updated_at=now()
    returning * into t;
  return jsonb_build_object('iva',t.iva,'margin',t.margin,'marginByCategory',t.margin_by_category,'fxByPeriod',t.fx_by_period,'priceRule',t.price_rule);
end $$;

/* Importación masiva (Excel de Paco): proveedores, materiales y precios en una sola llamada. */
create or replace function public.price_import(target_organization_id uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
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
end $$;

/* ---------- proyectos ---------- */
create or replace function app.solar_project_json(p public.ennco_solar_projects) returns jsonb language sql stable as $$
  select jsonb_build_object('id',p.id,'name',p.name,'customer',p.customer,'quoteId',p.quote_id,'status',p.status,'notes',p.notes,'createdAt',p.created_at,'updatedAt',p.updated_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'itemId',i.item_id,'description',i.description,'unit',i.unit,'quantity',i.quantity,'supplierId',i.supplier_id,'unitCost',i.unit_cost,'currency',i.currency,'fx',i.fx,'sort',i.sort,'purchased',i.purchased) order by i.sort) from public.ennco_solar_project_items i where i.project_id=p.id), '[]'::jsonb))
$$;

create or replace function public.solar_projects_list(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  return coalesce((select jsonb_agg(app.solar_project_json(p) order by p.updated_at desc) from public.ennco_solar_projects p where p.organization_id=target_organization_id), '[]'::jsonb);
end $$;

create or replace function public.solar_project_get(target_organization_id uuid, target_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare p public.ennco_solar_projects;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  select * into p from public.ennco_solar_projects where organization_id=target_organization_id and id=target_id;
  if not found then raise exception 'SOLAR_PROJECT_NOT_FOUND'; end if;
  return app.solar_project_json(p);
end $$;

create or replace function public.solar_project_save(target_organization_id uuid, target_id uuid, target_name text, target_customer text, target_quote_id uuid, target_status text, target_notes text, target_items jsonb)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
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
end $$;

create or replace function public.solar_project_delete(target_organization_id uuid, target_id uuid)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  delete from public.ennco_solar_projects where organization_id=target_organization_id and id=target_id;
  if not found then raise exception 'SOLAR_PROJECT_NOT_FOUND'; end if;
  return jsonb_build_object('deleted', true);
end $$;

revoke all on function public.price_catalog_read(uuid), public.price_supplier_save(uuid,uuid,text,boolean), public.price_item_save(uuid,uuid,text,text,text,text,jsonb,boolean,text),
  public.price_quote_save(uuid,uuid,uuid,date,numeric,text), public.price_settings_save(uuid,numeric,numeric,jsonb,jsonb,text), public.price_import(uuid,jsonb),
  public.solar_projects_list(uuid), public.solar_project_get(uuid,uuid), public.solar_project_save(uuid,uuid,text,text,uuid,text,text,jsonb), public.solar_project_delete(uuid,uuid) from public, anon, service_role;
grant execute on function public.price_catalog_read(uuid), public.price_supplier_save(uuid,uuid,text,boolean), public.price_item_save(uuid,uuid,text,text,text,text,jsonb,boolean,text),
  public.price_quote_save(uuid,uuid,uuid,date,numeric,text), public.price_settings_save(uuid,numeric,numeric,jsonb,jsonb,text), public.price_import(uuid,jsonb),
  public.solar_projects_list(uuid), public.solar_project_get(uuid,uuid), public.solar_project_save(uuid,uuid,text,text,uuid,text,text,jsonb), public.solar_project_delete(uuid,uuid) to authenticated;

commit;
