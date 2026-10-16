"""Genera supabase/migrations/202610160111_crm_directorio.sql (16-oct-2026, Grant).

Grant: cargar al CRM el directorio de empresas del corredor industrial y distinguir los leads que
llegan del correo de los que llegan del directorio. Decisiones:
  · Etapa nueva al inicio del tablero: "Por contactar" (POR_CONTACTAR). No pide nada para avanzar.
  · Origen nuevo DIRECTORIO. Un lead de directorio es de empresa: puede no tener persona todavía
    (full_name opcional cuando hay empresa). Se guardan parque industrial, dirección, sector y fuente.
  · Las que ya están en la campaña de correo entran igual, enlazadas a su cuenta, y la pantalla las
    marca "también en campaña de correo" (in_email_campaign).
  · Importar más directorios desde el CRM con vista previa: public.crm_import_preview (solo lectura)
    y la op IMPORTAR de crm_command, por lotes. Una empresa del directorio no se repite (llave de
    nombre normalizada).
Los datos del archivo se cargan aparte, directo en la base: el repositorio es público.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-111"
OUT = ROOT / "supabase/migrations/202610160111_crm_directorio.sql"

STAGES_OLD = "'RESPONDIO','CALIFICADO','LLAMADA_VISITA','LEVANTAMIENTO','PROPUESTA','NEGOCIACION','GANADO','PERDIDO','DESCARTADO'"
STAGES_NEW = "'POR_CONTACTAR'," + STAGES_OLD


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


command = patch("crm_command", [
    ("""  if op not in ('CREAR','ACTUALIZAR','MOVER','CALIFICAR','NOTA','TAREA_CREAR','TAREA_ESTADO') then raise exception 'CRM_OP_INVALID'; end if;""",
     """  if op not in ('CREAR','ACTUALIZAR','MOVER','CALIFICAR','NOTA','TAREA_CREAR','TAREA_ESTADO','IMPORTAR') then raise exception 'CRM_OP_INVALID'; end if;"""),
    (f"      if new_stage not in ({STAGES_OLD})", f"      if new_stage not in ({STAGES_NEW})"),
    ("""  elsif op = 'TAREA_ESTADO' then""",
     """  elsif op = 'IMPORTAR' then
    -- 16-oct: directorio de empresas (vista previa en crm_import_preview).
    result := app.crm_import_rows(target_organization_id, p->'rows', p->>'file_name', actor);

  elsif op = 'TAREA_ESTADO' then"""),
    ("""      if p ? 'full_name' then
        if nullif(btrim(p->>'full_name'), '') is null then raise exception 'CRM_NOMBRE_REQUERIDO'; end if;
        rec.full_name := btrim(p->>'full_name'); changed := array_append(changed, 'nombre'); end if;""",
     """      if p ? 'full_name' then
        if nullif(btrim(p->>'full_name'), '') is null and (rec.source <> 'DIRECTORIO' or rec.company_name is null) then raise exception 'CRM_NOMBRE_REQUERIDO'; end if;
        rec.full_name := nullif(btrim(p->>'full_name'), ''); changed := array_append(changed, 'nombre'); end if;
      if p ? 'industrial_park' then rec.industrial_park := nullif(btrim(p->>'industrial_park'), ''); changed := array_append(changed, 'parque'); end if;
      if p ? 'address' then rec.address := nullif(btrim(p->>'address'), ''); changed := array_append(changed, 'dirección'); end if;
      if p ? 'sector' then rec.sector := nullif(btrim(p->>'sector'), ''); changed := array_append(changed, 'sector'); end if;"""),
    ("""      update public.crm_records set full_name = rec.full_name, email = rec.email, phone = rec.phone, role_title = rec.role_title,""",
     """      update public.crm_records set full_name = rec.full_name, email = rec.email, phone = rec.phone, role_title = rec.role_title,
        industrial_park = rec.industrial_park, address = rec.address, sector = rec.sector,"""),
])

record_json = patch("crm_record_json", [
    ("""  select to_jsonb(r) - 'organization_id' || jsonb_build_object(""",
     """  select to_jsonb(r) - 'organization_id' || jsonb_build_object(
    'in_email_campaign', r.account_id is not null and exists (select 1 from public.campaign_enrollments ce
      join public.campaigns ca on ca.organization_id = ce.organization_id and ca.id = ce.campaign_id
      where ce.organization_id = r.organization_id and ce.account_id = r.account_id and ca.lane = 'DIRECT' and ca.name !~* '^PRUEBA'),"""),
])

sql = f"""-- 111 · Directorio de empresas en el CRM (16-oct-2026). Generado por tools/correos/gen-111.py desde
-- tools/correos/vivas-111/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

alter table public.crm_records drop constraint if exists crm_records_source_check;
alter table public.crm_records add constraint crm_records_source_check check (source in ('CORREO','MANUAL','REFERIDO','DIRECTORIO'));
alter table public.crm_records drop constraint if exists crm_records_stage_check;
alter table public.crm_records add constraint crm_records_stage_check check (stage in ({STAGES_NEW}));
alter table public.crm_records alter column full_name drop not null;
alter table public.crm_records drop constraint if exists crm_records_full_name_check;
alter table public.crm_records add constraint crm_records_full_name_check
  check ((full_name is null or length(btrim(full_name)) between 1 and 200) and (full_name is not null or company_name is not null));
alter table public.crm_records add column if not exists industrial_park text check (industrial_park is null or length(industrial_park) <= 200);
alter table public.crm_records add column if not exists address text check (address is null or length(address) <= 400);
alter table public.crm_records add column if not exists sector text check (sector is null or length(sector) <= 300);
alter table public.crm_records add column if not exists source_url text check (source_url is null or (length(source_url) <= 600 and source_url ~* '^https?://'));
alter table public.crm_records add column if not exists import_batch text check (import_batch is null or length(import_batch) <= 200);

-- Llave para comparar nombres de empresa: sin acentos, sin razón social ni signos.
create or replace function app.crm_company_key(name text) returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
    lower(translate(coalesce(name, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
    '[^a-z0-9]+', ' ', 'g'),
    '\\m(s a p i|sapi|s a|sa|s de r l|de r l|s r l|rl|c v|cv|de cv|de c v|inc|llc|gmbh|ltd|corp|corporation|company|co|group|grupo|mexico|mexicana|mexicano|de|del|la|el|y)\\M', ' ', 'g'),
    '\\s+', ' ', 'g')), '');
$$;
create unique index if not exists crm_records_directory_company_unique
  on public.crm_records (organization_id, app.crm_company_key(company_name)) where source = 'DIRECTORIO';

-- Cuenta de la campaña de correo que corresponde a una empresa del directorio (si hay una sola clara).
create or replace function app.crm_match_account(target_org uuid, company text) returns uuid language sql stable
set search_path to 'public', 'app', 'pg_temp' as $$
  with k as (select app.crm_company_key(company) key)
  select a.id from public.accounts a, k
  where a.organization_id = target_org and not a.is_deleted and k.key is not null and length(k.key) >= 4
    and (app.crm_company_key(a.legal_name) = k.key
      or (length(app.crm_company_key(a.legal_name)) >= 5 and (app.crm_company_key(a.legal_name) like k.key || ' %' or k.key like app.crm_company_key(a.legal_name) || ' %')))
  order by exists (select 1 from public.campaign_enrollments ce where ce.account_id = a.id) desc, a.created_at
  limit 1;
$$;

create or replace function app.crm_import_rows(target_org uuid, target_rows jsonb, target_file text, target_actor uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
declare r jsonb; company text; key text; owner uuid; rec public.crm_records%rowtype; account uuid;
  inserted integer := 0; duplicates integer := 0; skipped integer := 0; in_campaign integer := 0;
begin
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) > 200 then raise exception 'CRM_IMPORT_ROWS_INVALID'; end if;
  select default_owner_user_id into owner from app.crm_settings where organization_id = target_org;
  for r in select * from jsonb_array_elements(target_rows) loop
    company := left(btrim(regexp_replace(coalesce(r->>'company_name', ''), '\\s+', ' ', 'g')), 200);
    key := app.crm_company_key(company);
    if key is null then skipped := skipped + 1; continue; end if;
    if exists (select 1 from public.crm_records x where x.organization_id = target_org and x.source = 'DIRECTORIO'
        and app.crm_company_key(x.company_name) = key) then duplicates := duplicates + 1; continue; end if;
    account := app.crm_match_account(target_org, company);
    insert into public.crm_records (organization_id, account_id, source, full_name, email, phone, role_title, company_name, city, state,
      industrial_park, address, sector, source_url, import_batch, stage, owner_user_id, created_by)
    values (target_org, account, 'DIRECTORIO',
      nullif(left(btrim(r->>'full_name'), 200), ''),
      case when lower(btrim(r->>'email')) ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then lower(btrim(r->>'email')) end,
      case when length(btrim(r->>'phone')) between 7 and 40 then btrim(r->>'phone') end,
      nullif(left(btrim(r->>'role_title'), 200), ''), company,
      nullif(left(btrim(regexp_replace(r->>'city', '\\s+', ' ', 'g')), 120), ''),
      nullif(left(btrim(regexp_replace(r->>'state', '\\s+', ' ', 'g')), 120), ''),
      nullif(left(btrim(regexp_replace(r->>'industrial_park', '\\s+', ' ', 'g')), 200), ''),
      nullif(left(btrim(regexp_replace(r->>'address', '\\s+', ' ', 'g')), 400), ''),
      nullif(left(btrim(regexp_replace(r->>'sector', '\\s+', ' ', 'g')), 300), ''),
      case when btrim(r->>'source_url') ~* '^https?://' then left(btrim(r->>'source_url'), 600) end,
      nullif(left(btrim(target_file), 200), ''), 'POR_CONTACTAR', owner, target_actor)
    on conflict do nothing
    returning * into rec;
    if rec.id is null then duplicates := duplicates + 1; continue; end if;
    inserted := inserted + 1;
    if account is not null and exists (select 1 from public.campaign_enrollments ce where ce.account_id = account) then in_campaign := in_campaign + 1; end if;
    perform app.crm_log(target_org, rec.id, 'SISTEMA', 'Importado del directorio' || coalesce(' "' || nullif(btrim(target_file), '') || '"', '') || '.',
      jsonb_build_object('import_batch', target_file), target_actor);
    rec := null;
  end loop;
  return jsonb_build_object('ok', true, 'inserted', inserted, 'duplicates', duplicates, 'skipped', skipped, 'in_campaign', in_campaign,
    'message', inserted || ' empresas agregadas al CRM' || case when duplicates > 0 then ', ' || duplicates || ' ya estaban' else '' end || '.');
end $$;
revoke all on function app.crm_import_rows(uuid, jsonb, text, uuid) from public, anon, authenticated;

-- Vista previa de una importación: qué entra, qué ya estaba y qué empresa ya está en la campaña de correo.
create or replace function public.crm_import_preview(target_organization_id uuid, target_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'app', 'pg_temp' as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'CRM_ACCESS_DENIED'; end if;
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) > 1000 then raise exception 'CRM_IMPORT_ROWS_INVALID'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('index', x.i - 1, 'company_name', x.r->>'company_name',
      'status', case when app.crm_company_key(x.r->>'company_name') is null then 'SIN_NOMBRE'
        when exists (select 1 from public.crm_records c where c.organization_id = target_organization_id and c.source = 'DIRECTORIO'
          and app.crm_company_key(c.company_name) = app.crm_company_key(x.r->>'company_name')) then 'YA_EN_CRM'
        when (select count(*) from jsonb_array_elements(target_rows) with ordinality y(r2, j)
          where y.j < x.i and app.crm_company_key(y.r2->>'company_name') = app.crm_company_key(x.r->>'company_name')) > 0 then 'REPETIDA_EN_ARCHIVO'
        else 'NUEVA' end,
      'account_name', (select a.legal_name from public.accounts a where a.id = app.crm_match_account(target_organization_id, x.r->>'company_name')),
      'in_email_campaign', exists (select 1 from public.campaign_enrollments ce
        where ce.account_id = app.crm_match_account(target_organization_id, x.r->>'company_name')))
      order by x.i)
    from jsonb_array_elements(target_rows) with ordinality x(r, i)), '[]'::jsonb);
end $$;
revoke all on function public.crm_import_preview(uuid, jsonb) from public, anon;
grant execute on function public.crm_import_preview(uuid, jsonb) to authenticated;

{record_json}
{command}
commit;
"""
OUT.write_text(sql)
print(OUT, len(sql))
