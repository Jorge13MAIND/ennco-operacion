begin;

-- Cotizador solar (port de la Calculadora Solar ENNCO v1.0.1 al dashboard): cada cotización guarda
-- las entradas de la captura, el resumen calculado y las versiones de catálogo que usó; cada guardado
-- deja una versión inmutable. Acceso solo por RPC con guarda de membresía (app.is_member).

create table if not exists public.ennco_solar_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  project_id uuid,
  segment text not null check (segment in ('RESIDENTIAL','COMMERCIAL','INDUSTRIAL')),
  name text not null check (length(trim(name)) between 1 and 200),
  status text not null default 'DRAFT' check (status in ('DRAFT','SENT','ACCEPTED','ARCHIVED')),
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  catalog_versions jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, project_id) references public.ennco_projects(organization_id, id)
);
create index if not exists ennco_solar_quotes_org_updated on public.ennco_solar_quotes(organization_id, updated_at desc);
create index if not exists ennco_solar_quotes_project on public.ennco_solar_quotes(project_id);

create table if not exists public.ennco_solar_quote_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null references public.ennco_solar_quotes(id),
  version integer not null,
  name text not null,
  status text not null,
  input jsonb not null,
  result jsonb not null,
  catalog_versions jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (quote_id, version)
);

alter table public.ennco_solar_quotes enable row level security;
alter table public.ennco_solar_quote_versions enable row level security;
revoke all on public.ennco_solar_quotes, public.ennco_solar_quote_versions from public, anon, authenticated, service_role;

create or replace function app.solar_quote_json(q public.ennco_solar_quotes, with_body boolean) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', q.id, 'projectId', q.project_id, 'segment', q.segment, 'name', q.name, 'status', q.status, 'version', q.version,
    'summary', coalesce(q.result->'summary', '{}'::jsonb), 'catalogVersions', q.catalog_versions,
    'createdAt', q.created_at, 'updatedAt', q.updated_at)
  || case when with_body then jsonb_build_object('input', q.input, 'result', q.result) else '{}'::jsonb end
$$;

create or replace function public.solar_quotes_list(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  return coalesce((select jsonb_agg(app.solar_quote_json(q, false) order by q.updated_at desc)
    from public.ennco_solar_quotes q where q.organization_id=target_organization_id and q.status<>'ARCHIVED'), '[]'::jsonb);
end $$;

create or replace function public.solar_quote_get(target_organization_id uuid, target_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare q public.ennco_solar_quotes;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  select * into q from public.ennco_solar_quotes where organization_id=target_organization_id and id=target_quote_id;
  if not found then raise exception 'SOLAR_QUOTE_NOT_FOUND'; end if;
  return app.solar_quote_json(q, true);
end $$;

create or replace function public.solar_quote_save(
  target_organization_id uuid, target_quote_id uuid, target_project_id uuid, target_segment text, target_name text,
  target_input jsonb, target_result jsonb, target_catalog_versions jsonb, expected_version integer default null, target_status text default null)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare q public.ennco_solar_quotes;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
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
end $$;

revoke all on function public.solar_quotes_list(uuid) from public, anon, service_role;
revoke all on function public.solar_quote_get(uuid, uuid) from public, anon, service_role;
revoke all on function public.solar_quote_save(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, integer, text) from public, anon, service_role;
grant execute on function public.solar_quotes_list(uuid) to authenticated;
grant execute on function public.solar_quote_get(uuid, uuid) to authenticated;
grant execute on function public.solar_quote_save(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, integer, text) to authenticated;

commit;
