begin;

-- Productos: el catálogo de SunOne hecho tabla en el hub de ENNCO (21-sep-2026).
-- Un producto pertenece a un tipo (módulo, inversor, estructura, mano de obra, adicional…),
-- tiene precio base + utilidad = precio final, se cobra por unidad o por panel, y puede llevar
-- foto y ficha técnica en Storage. Los tipos los administra Paco. Acceso solo por RPC con guarda
-- de membresía, igual que precios y cotizaciones.

create table if not exists public.ennco_product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (length(trim(name)) between 1 and 60),
  -- kind: qué papel juega en una cotización. 'module' e 'inverter' entran al motor eléctrico;
  -- 'structure', 'labor' y 'additional' son los factores por panel o por unidad del presupuesto.
  kind text not null default 'other' check (kind in ('module','inverter','microinverter','accessory','structure','labor','additional','battery','controller','offgrid_inverter','other')),
  icon text not null default 'box',
  default_unit_basis text check (default_unit_basis is null or default_unit_basis in ('por_unidad','por_panel')),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists public.ennco_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  category_id uuid not null references public.ennco_product_categories(id),
  name text not null check (length(trim(name)) between 1 and 160),
  brand text,
  code text,
  description text,
  currency text not null default 'USD' check (currency in ('USD','MXN')),
  -- pricing_mode: 'unit' = precio fijo por pieza; 'range' = precio variable por cantidad (tiers).
  pricing_mode text not null default 'unit' check (pricing_mode in ('unit','range')),
  -- unit_basis: a qué se aplica el precio. Null = sin definir (como "Selecciona" en SunOne).
  unit_basis text check (unit_basis is null or unit_basis in ('por_unidad','por_panel')),
  base_price numeric(14,4) not null default 0 check (base_price >= 0),
  utility_pct numeric(7,3) check (utility_pct is null or utility_pct >= 0),
  final_price numeric(14,4) generated always as (round(base_price * (1 + coalesce(utility_pct, 0) / 100), 4)) stored,
  -- tiers: [{"minQty":1,"maxQty":10,"price":85}] cuando pricing_mode = 'range'.
  tiers jsonb not null default '[]'::jsonb,
  -- rating: 645 (W) en módulos, 10 (kW) en inversores; es el número chico de la lista de SunOne.
  rating numeric(10,3),
  rating_unit text check (rating_unit is null or rating_unit in ('W','kW')),
  photo_path text,
  datasheet_path text,
  favorite boolean not null default false,
  source text not null default 'manual',
  -- specs: ficha eléctrica con la forma de SolarModule / SolarInverter del cotizador; null si no se ha capturado.
  specs jsonb,
  active boolean not null default true,
  sort integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ennco_products_org_category_idx on public.ennco_products (organization_id, category_id) where active;
create index if not exists ennco_products_org_name_idx on public.ennco_products (organization_id, lower(name));

alter table public.ennco_product_categories enable row level security;
alter table public.ennco_products enable row level security;
drop policy if exists ennco_product_categories_member_read on public.ennco_product_categories;
create policy ennco_product_categories_member_read on public.ennco_product_categories for select using (app.is_member(organization_id));
drop policy if exists ennco_products_member_read on public.ennco_products;
create policy ennco_products_member_read on public.ennco_products for select using (app.is_member(organization_id));
revoke insert, update, delete, truncate on public.ennco_product_categories, public.ennco_products from authenticated, anon;
grant select on public.ennco_product_categories, public.ennco_products to authenticated;

/* ---------- Storage: fotos y fichas técnicas ---------- */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ennco-productos', 'ennco-productos', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- La ruta de un objeto es {organización}/{producto}/{foto|ficha}.{ext}; el primer segmento manda.
create or replace function app.product_object_org_id(target_name text)
returns uuid language plpgsql immutable as $$
begin
  return nullif(split_part(coalesce(target_name, ''), '/', 1), '')::uuid;
exception when others then
  return null;
end $$;

drop policy if exists ennco_productos_read on storage.objects;
create policy ennco_productos_read on storage.objects for select
  using (bucket_id = 'ennco-productos' and app.is_member(app.product_object_org_id(name)));
drop policy if exists ennco_productos_insert on storage.objects;
create policy ennco_productos_insert on storage.objects for insert
  with check (bucket_id = 'ennco-productos' and app.is_member(app.product_object_org_id(name)));
drop policy if exists ennco_productos_update on storage.objects;
create policy ennco_productos_update on storage.objects for update
  using (bucket_id = 'ennco-productos' and app.is_member(app.product_object_org_id(name)));
drop policy if exists ennco_productos_delete on storage.objects;
create policy ennco_productos_delete on storage.objects for delete
  using (bucket_id = 'ennco-productos' and app.is_member(app.product_object_org_id(name)));

/* ---------- Lectura ---------- */

create or replace function app.product_category_json(c public.ennco_product_categories) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'kind', c.kind, 'icon', c.icon,
    'defaultUnitBasis', c.default_unit_basis, 'sort', c.sort, 'active', c.active);
$$;

create or replace function app.product_json(p public.ennco_products) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p.id, 'categoryId', p.category_id, 'name', p.name, 'brand', p.brand, 'code', p.code,
    'description', p.description, 'currency', p.currency, 'pricingMode', p.pricing_mode, 'unitBasis', p.unit_basis,
    'basePrice', p.base_price, 'utilityPct', p.utility_pct, 'finalPrice', p.final_price, 'tiers', p.tiers,
    'rating', p.rating, 'ratingUnit', p.rating_unit, 'photoPath', p.photo_path, 'datasheetPath', p.datasheet_path,
    'favorite', p.favorite, 'source', p.source, 'hasSpecs', (p.specs is not null), 'specs', p.specs, 'active', p.active,
    'sort', p.sort, 'createdAt', p.created_at, 'updatedAt', p.updated_at);
$$;

create or replace function public.product_catalog_read(target_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(app.product_category_json(c) order by c.sort, c.name) from public.ennco_product_categories c where c.organization_id = target_organization_id), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(app.product_json(p) order by p.sort, p.created_at) from public.ennco_products p where p.organization_id = target_organization_id), '[]'::jsonb));
end $$;

/* ---------- Tipos ---------- */

create or replace function public.product_category_save(target_organization_id uuid, target_id uuid, target_slug text, target_name text, target_kind text, target_icon text, target_default_unit_basis text, target_sort integer, target_active boolean)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare c public.ennco_product_categories;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
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
end $$;

/* Los diez tipos de SunOne, para arrancar una organización nueva o reponer los que falten. Idempotente. */
create or replace function public.product_categories_seed_defaults(target_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare inserted integer := 0;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
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
end $$;

/* ---------- Productos ---------- */

create or replace function public.product_save(target_organization_id uuid, target_id uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
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
end $$;

create or replace function public.product_set_active(target_organization_id uuid, target_id uuid, target_active boolean)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare p public.ennco_products;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  update public.ennco_products set active = target_active, updated_at = now() where organization_id = target_organization_id and id = target_id returning * into p;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return app.product_json(p);
end $$;

create or replace function public.product_set_favorite(target_organization_id uuid, target_id uuid, target_favorite boolean)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare p public.ennco_products;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  update public.ennco_products set favorite = target_favorite, updated_at = now() where organization_id = target_organization_id and id = target_id returning * into p;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return app.product_json(p);
end $$;

/* Registra la ruta de la foto o de la ficha ya subida a Storage; null la quita. */
create or replace function public.product_set_file(target_organization_id uuid, target_id uuid, target_kind text, target_path text)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare p public.ennco_products;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_kind not in ('photo','datasheet') then raise exception 'PRODUCT_FILE_KIND_INVALID'; end if;
  if target_path is not null and app.product_object_org_id(target_path) is distinct from target_organization_id then raise exception 'PRODUCT_FILE_PATH_INVALID'; end if;
  if target_kind = 'photo' then
    update public.ennco_products set photo_path = target_path, updated_at = now() where organization_id = target_organization_id and id = target_id returning * into p;
  else
    update public.ennco_products set datasheet_path = target_path, updated_at = now() where organization_id = target_organization_id and id = target_id returning * into p;
  end if;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return app.product_json(p);
end $$;

revoke all on function public.product_catalog_read(uuid) from public;
revoke all on function public.product_category_save(uuid, uuid, text, text, text, text, text, integer, boolean) from public;
revoke all on function public.product_categories_seed_defaults(uuid) from public;
revoke all on function public.product_save(uuid, uuid, jsonb) from public;
revoke all on function public.product_set_active(uuid, uuid, boolean) from public;
revoke all on function public.product_set_favorite(uuid, uuid, boolean) from public;
revoke all on function public.product_set_file(uuid, uuid, text, text) from public;
grant execute on function public.product_catalog_read(uuid) to authenticated;
grant execute on function public.product_category_save(uuid, uuid, text, text, text, text, text, integer, boolean) to authenticated;
grant execute on function public.product_categories_seed_defaults(uuid) to authenticated;
grant execute on function public.product_save(uuid, uuid, jsonb) to authenticated;
grant execute on function public.product_set_active(uuid, uuid, boolean) to authenticated;
grant execute on function public.product_set_favorite(uuid, uuid, boolean) to authenticated;
grant execute on function public.product_set_file(uuid, uuid, text, text) to authenticated;

commit;
