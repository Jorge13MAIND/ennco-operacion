-- 113 · Pestaña Medidores (16-oct-2026). Generado por tools/medidores/gen-113.py; ver su docstring.
-- Clientes y plantas (energy_sites), puntos de medición (energy_meters), lecturas (energy_readings),
-- alertas (energy_alerts) e integraciones con Growatt (energy_integrations). Las pantallas leen solo
-- por read_energy y read_energy_meter; el equipo escribe por energy_command (con Idempotency-Key) y los
-- procesos de servidor (API de lecturas, Growatt, evaluación, Telegram) por energy_service, firmado con
-- la prueba HMAC del despachador. Telegram queda configurado y APAGADO (telegram_enabled=false).

begin;

set local app.operations_rpc_write = 'on';

create table if not exists app.energy_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  telegram_enabled boolean not null default false,
  telegram_chat_ids text[] not null default '{}',
  telegram_min_severity text not null default 'URGENTE' check (telegram_min_severity in ('ATENCION','URGENTE')),
  updated_at timestamptz not null default clock_timestamp()
);
alter table app.energy_settings enable row level security;
revoke all on app.energy_settings from public, anon, authenticated;
insert into app.energy_settings (organization_id, telegram_enabled, telegram_chat_ids)
select 'e0000000-0000-4000-8000-000000000001', false, coalesce((select s.telegram_chat_ids from app.email_sdr_settings s where s.organization_id = 'e0000000-0000-4000-8000-000000000001'), '{}')
where exists (select 1 from public.organizations where id = 'e0000000-0000-4000-8000-000000000001')
on conflict (organization_id) do nothing;

create table if not exists public.energy_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_name text not null check (length(btrim(client_name)) between 2 and 200),
  site_name text not null default 'Planta' check (length(btrim(site_name)) between 1 and 200),
  city text check (city is null or length(city) <= 120),
  state text check (state is null or length(state) <= 120),
  timezone text not null default 'America/Mexico_City' check (length(timezone) between 3 and 64),
  price_mxn_kwh numeric(10,4) not null default 2.80 check (price_mxn_kwh >= 0 and price_mxn_kwh <= 50),
  contracted_demand_kw numeric(10,2) check (contracted_demand_kw is null or contracted_demand_kw > 0),
  paro_cost_mxn_h numeric(14,2) check (paro_cost_mxn_h is null or paro_cost_mxn_h >= 0),
  work_days smallint[] not null default '{1,2,3,4,5,6}',
  work_start time not null default '07:00',
  work_end time not null default '19:00',
  crm_record_id uuid references public.crm_records(id) on delete set null,
  notes text check (notes is null or length(notes) <= 2000),
  revision integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index if not exists energy_sites_name_unique on public.energy_sites (organization_id, lower(client_name), lower(site_name));

create table if not exists public.energy_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.energy_sites(id) on delete cascade,
  provider text not null check (provider in ('GROWATT')),
  api_base text not null check (api_base ~ '^https://[a-z0-9-]+([.][a-z0-9-]+)*[.]growatt[.]com/?$'),
  token_ciphertext text not null check (length(token_ciphertext) between 20 and 4000),
  token_key_id text not null check (length(token_key_id) between 4 and 200),
  token_hint text check (token_hint is null or length(token_hint) <= 12),
  plant_id text not null check (length(plant_id) between 1 and 64),
  plant_name text check (plant_name is null or length(plant_name) <= 200),
  status text not null default 'ACTIVA' check (status in ('ACTIVA','PAUSADA','ERROR')),
  last_sync_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 300),
  last_error_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, provider, plant_id)
);

create table if not exists public.energy_meters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.energy_sites(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  kind text not null default 'ANALIZADOR' check (kind in ('ANALIZADOR','INVERSOR')),
  scope text not null default 'GENERAL' check (scope in ('GENERAL','AREA','MAQUINA')),
  source text not null default 'ARCHIVO' check (source in ('ARCHIVO','API','GROWATT')),
  device_brand text check (device_brand is null or length(device_brand) <= 120),
  device_model text check (device_model is null or length(device_model) <= 120),
  device_serial text check (device_serial is null or length(device_serial) <= 120),
  nominal_v_ln numeric(7,2) not null default 127 check (nominal_v_ln between 50 and 1000),
  interval_minutes numeric(7,2) check (interval_minutes is null or (interval_minutes > 0 and interval_minutes <= 1440)),
  thresholds jsonb not null default '{}'::jsonb check (jsonb_typeof(thresholds) = 'object'),
  ingest_key_sha256 text unique check (ingest_key_sha256 is null or ingest_key_sha256 ~ '^[a-f0-9]{64}$'),
  ingest_key_hint text check (ingest_key_hint is null or length(ingest_key_hint) <= 16),
  ingest_key_created_at timestamptz,
  integration_id uuid references public.energy_integrations(id) on delete set null,
  external_id text check (external_id is null or length(external_id) <= 64),
  active boolean not null default true,
  first_reading_at timestamptz,
  last_reading_at timestamptz,
  readings_count bigint not null default 0,
  evaluated_at timestamptz,
  revision integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index if not exists energy_meters_name_unique on public.energy_meters (site_id, lower(name));
create unique index if not exists energy_meters_external_unique on public.energy_meters (integration_id, external_id) where integration_id is not null;

create table if not exists public.energy_readings (
  meter_id uuid not null references public.energy_meters(id) on delete cascade,
  ts timestamptz not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  v_ln real,
  v_l1 real,
  v_l2 real,
  v_l3 real,
  v_ln_min real,
  v_ln_max real,
  v_ll real,
  v_ll_min real,
  v_ll_max real,
  i_avg real,
  i_l1 real,
  i_l2 real,
  i_l3 real,
  i_max real,
  freq real,
  freq_min real,
  freq_max real,
  p_import_kw real,
  p_import_l1 real,
  p_import_l2 real,
  p_import_l3 real,
  p_import_max_kw real,
  p_export_kw real,
  p_export_l1 real,
  p_export_l2 real,
  p_export_l3 real,
  p_export_max_kw real,
  s_kva real,
  s_kva_max real,
  pf real,
  pf_l1 real,
  pf_l2 real,
  pf_l3 real,
  thd_v_l1 real,
  thd_v_l2 real,
  thd_v_l3 real,
  thd_v_max real,
  thd_i_l1 real,
  thd_i_l2 real,
  thd_i_l3 real,
  thd_i_max real,
  pv_kw real,
  pv_kwh_today real,
  inverter_status text check (inverter_status is null or length(inverter_status) <= 40),
  harmonics jsonb,
  extra jsonb,
  source text not null default 'ARCHIVO' check (source in ('ARCHIVO','API','GROWATT')),
  received_at timestamptz not null default clock_timestamp(),
  primary key (meter_id, ts)
);

create table if not exists public.energy_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.energy_sites(id) on delete cascade,
  meter_id uuid not null references public.energy_meters(id) on delete cascade,
  rule text not null check (rule in ('FP_BAJO', 'TENSION_FUERA', 'HUECO_TENSION', 'CORTE', 'DESBALANCE', 'THD_TENSION', 'THD_CORRIENTE', 'FRECUENCIA', 'DEMANDA', 'EXPORTACION_NOCHE', 'DIA_EXPORTADOR', 'PARO', 'CONSUMO_ATIPICO', 'INVERSOR_FALLA', 'GENERACION_BAJA', 'SIN_DATOS')),
  severity text not null check (severity in ('INFO','ATENCION','URGENTE')),
  started_at timestamptz not null,
  ended_at timestamptz,
  value real,
  threshold real,
  unit text check (unit is null or length(unit) <= 16),
  message text not null check (length(message) between 3 and 1000),
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'ABIERTA' check (status in ('ABIERTA','RECONOCIDA','CERRADA')),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  note text check (note is null or length(note) <= 1000),
  telegram_claimed_at timestamptz,
  telegram_sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (meter_id, rule, started_at)
);
create index if not exists energy_alerts_meter_idx on public.energy_alerts (meter_id, started_at desc);
create index if not exists energy_alerts_open_idx on public.energy_alerts (organization_id, status) where status = 'ABIERTA';

-- Nadie lee las tablas directo: solo por las RPC (las integraciones guardan el token cifrado).
alter table public.energy_sites enable row level security;
alter table public.energy_integrations enable row level security;
alter table public.energy_meters enable row level security;
alter table public.energy_readings enable row level security;
alter table public.energy_alerts enable row level security;
revoke all on public.energy_sites, public.energy_integrations, public.energy_meters, public.energy_readings, public.energy_alerts
  from public, anon, authenticated;

drop trigger if exists energy_sites_audit on public.energy_sites;
create trigger energy_sites_audit after insert or update or delete on public.energy_sites
  for each row execute function app.capture_audit_event();
-- Medidores e integraciones no llevan trigger de auditoría: cada lectura y cada sincronización los
-- actualiza y llenaría la bitácora. Los cambios del equipo quedan en operational_command_ledger (con autor).

create or replace function app.energy_valid_tz(tz text) returns boolean language sql stable as $$
  select exists (select 1 from pg_timezone_names where name = tz);
$$;

create or replace function app.energy_meter_json(m public.energy_meters) returns jsonb language sql stable
set search_path to 'public', 'app', 'pg_temp' as $$
  select jsonb_build_object(
    'id', m.id, 'site_id', m.site_id, 'name', m.name, 'kind', m.kind, 'scope', m.scope, 'source', m.source,
    'device_brand', m.device_brand, 'device_model', m.device_model, 'device_serial', m.device_serial,
    'nominal_v_ln', m.nominal_v_ln, 'interval_minutes', m.interval_minutes, 'thresholds', m.thresholds,
    'has_key', m.ingest_key_sha256 is not null, 'key_hint', m.ingest_key_hint, 'key_created_at', m.ingest_key_created_at,
    'integration_id', m.integration_id, 'external_id', m.external_id, 'active', m.active,
    'first_reading_at', m.first_reading_at, 'last_reading_at', m.last_reading_at, 'readings_count', m.readings_count,
    'evaluated_at', m.evaluated_at, 'revision', m.revision,
    'open_alerts', jsonb_build_object(
      'URGENTE', (select count(*) from public.energy_alerts a where a.meter_id = m.id and a.status = 'ABIERTA' and a.severity = 'URGENTE'),
      'ATENCION', (select count(*) from public.energy_alerts a where a.meter_id = m.id and a.status = 'ABIERTA' and a.severity = 'ATENCION'),
      'INFO', (select count(*) from public.energy_alerts a where a.meter_id = m.id and a.status = 'ABIERTA' and a.severity = 'INFO')));
$$;

create or replace function app.energy_site_core_json(s public.energy_sites) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', s.id, 'client_name', s.client_name, 'site_name', s.site_name, 'city', s.city, 'state', s.state,
    'timezone', s.timezone, 'price_mxn_kwh', s.price_mxn_kwh, 'contracted_demand_kw', s.contracted_demand_kw,
    'paro_cost_mxn_h', s.paro_cost_mxn_h, 'work_days', to_jsonb(s.work_days),
    'work_start', to_char(s.work_start, 'HH24:MI'), 'work_end', to_char(s.work_end, 'HH24:MI'),
    'crm_record_id', s.crm_record_id, 'notes', s.notes, 'revision', s.revision);
$$;

create or replace function app.energy_site_json(s public.energy_sites) returns jsonb language sql stable
set search_path to 'public', 'app', 'pg_temp' as $$
  select app.energy_site_core_json(s) || jsonb_build_object(
    'meters', coalesce((select jsonb_agg(app.energy_meter_json(m) order by m.kind, m.scope, lower(m.name))
      from public.energy_meters m where m.site_id = s.id), '[]'::jsonb),
    'integrations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'provider', i.provider, 'api_base', i.api_base,
        'plant_id', i.plant_id, 'plant_name', i.plant_name, 'status', i.status, 'token_hint', i.token_hint,
        'last_sync_at', i.last_sync_at, 'last_error', i.last_error, 'last_error_at', i.last_error_at) order by i.created_at)
      from public.energy_integrations i where i.site_id = s.id), '[]'::jsonb));
$$;

-- Guarda lecturas (máximo 2,000 por llamada). Con target_local las horas vienen en la zona de la planta
-- (así exporta el analizador); si no, en ISO con zona. Una lectura repetida se fusiona: lo nuevo gana y
-- lo que no trae se conserva (los armónicos llegan cada 30 min y el resto cada 10).
create or replace function app.energy_upsert_readings(target_org uuid, target_meter uuid, target_rows jsonb, target_local boolean, target_source text)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
declare m public.energy_meters%rowtype; tz text; total integer; inserted integer; first_ts timestamptz; last_ts timestamptz;
begin
  select * into m from public.energy_meters where organization_id = target_org and id = target_meter for update;
  if not found then raise exception 'ENERGY_METER_NOT_FOUND'; end if;
  if not m.active then raise exception 'ENERGY_METER_INACTIVE'; end if;
  if jsonb_typeof(target_rows) is distinct from 'array' or jsonb_array_length(target_rows) = 0 then raise exception 'ENERGY_ROWS_EMPTY'; end if;
  if jsonb_array_length(target_rows) > 2000 then raise exception 'ENERGY_ROWS_TOO_MANY'; end if;
  select s.timezone into tz from public.energy_sites s where s.id = m.site_id;
  with src as (
    select distinct on (t) x.*, t
    from jsonb_to_recordset(target_rows) as x(ts text, v_ln real, v_l1 real, v_l2 real, v_l3 real, v_ln_min real, v_ln_max real, v_ll real, v_ll_min real, v_ll_max real, i_avg real, i_l1 real, i_l2 real, i_l3 real, i_max real, freq real, freq_min real, freq_max real, p_import_kw real, p_import_l1 real, p_import_l2 real, p_import_l3 real, p_import_max_kw real, p_export_kw real, p_export_l1 real, p_export_l2 real, p_export_l3 real, p_export_max_kw real, s_kva real, s_kva_max real, pf real, pf_l1 real, pf_l2 real, pf_l3 real, thd_v_l1 real, thd_v_l2 real, thd_v_l3 real, thd_v_max real, thd_i_l1 real, thd_i_l2 real, thd_i_l3 real, thd_i_max real, pv_kw real, pv_kwh_today real, inverter_status text, harmonics jsonb, extra jsonb)
    cross join lateral (select case when target_local then (x.ts::timestamp at time zone tz) else x.ts::timestamptz end as t) tt
    where x.ts ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}'
    order by t
  ), ok as (
    select * from src where t >= timestamptz '2015-01-01' and t <= clock_timestamp() + interval '1 day'
  ), up as (
    insert into public.energy_readings as r (meter_id, ts, organization_id, v_ln, v_l1, v_l2, v_l3, v_ln_min, v_ln_max, v_ll, v_ll_min, v_ll_max, i_avg, i_l1, i_l2, i_l3, i_max, freq, freq_min, freq_max, p_import_kw, p_import_l1, p_import_l2, p_import_l3, p_import_max_kw, p_export_kw, p_export_l1, p_export_l2, p_export_l3, p_export_max_kw, s_kva, s_kva_max, pf, pf_l1, pf_l2, pf_l3, thd_v_l1, thd_v_l2, thd_v_l3, thd_v_max, thd_i_l1, thd_i_l2, thd_i_l3, thd_i_max, pv_kw, pv_kwh_today, inverter_status, harmonics, extra, source)
    select target_meter, t, target_org, v_ln, v_l1, v_l2, v_l3, v_ln_min, v_ln_max, v_ll, v_ll_min, v_ll_max, i_avg, i_l1, i_l2, i_l3, i_max, freq, freq_min, freq_max, p_import_kw, p_import_l1, p_import_l2, p_import_l3, p_import_max_kw, p_export_kw, p_export_l1, p_export_l2, p_export_l3, p_export_max_kw, s_kva, s_kva_max, pf, pf_l1, pf_l2, pf_l3, thd_v_l1, thd_v_l2, thd_v_l3, thd_v_max, thd_i_l1, thd_i_l2, thd_i_l3, thd_i_max, pv_kw, pv_kwh_today, left(inverter_status, 40),
      case when jsonb_typeof(harmonics) = 'object' then harmonics end,
      case when jsonb_typeof(extra) = 'object' then extra end, target_source
    from ok
    on conflict (meter_id, ts) do update set
        v_ln = coalesce(excluded.v_ln, r.v_ln),
        v_l1 = coalesce(excluded.v_l1, r.v_l1),
        v_l2 = coalesce(excluded.v_l2, r.v_l2),
        v_l3 = coalesce(excluded.v_l3, r.v_l3),
        v_ln_min = coalesce(excluded.v_ln_min, r.v_ln_min),
        v_ln_max = coalesce(excluded.v_ln_max, r.v_ln_max),
        v_ll = coalesce(excluded.v_ll, r.v_ll),
        v_ll_min = coalesce(excluded.v_ll_min, r.v_ll_min),
        v_ll_max = coalesce(excluded.v_ll_max, r.v_ll_max),
        i_avg = coalesce(excluded.i_avg, r.i_avg),
        i_l1 = coalesce(excluded.i_l1, r.i_l1),
        i_l2 = coalesce(excluded.i_l2, r.i_l2),
        i_l3 = coalesce(excluded.i_l3, r.i_l3),
        i_max = coalesce(excluded.i_max, r.i_max),
        freq = coalesce(excluded.freq, r.freq),
        freq_min = coalesce(excluded.freq_min, r.freq_min),
        freq_max = coalesce(excluded.freq_max, r.freq_max),
        p_import_kw = coalesce(excluded.p_import_kw, r.p_import_kw),
        p_import_l1 = coalesce(excluded.p_import_l1, r.p_import_l1),
        p_import_l2 = coalesce(excluded.p_import_l2, r.p_import_l2),
        p_import_l3 = coalesce(excluded.p_import_l3, r.p_import_l3),
        p_import_max_kw = coalesce(excluded.p_import_max_kw, r.p_import_max_kw),
        p_export_kw = coalesce(excluded.p_export_kw, r.p_export_kw),
        p_export_l1 = coalesce(excluded.p_export_l1, r.p_export_l1),
        p_export_l2 = coalesce(excluded.p_export_l2, r.p_export_l2),
        p_export_l3 = coalesce(excluded.p_export_l3, r.p_export_l3),
        p_export_max_kw = coalesce(excluded.p_export_max_kw, r.p_export_max_kw),
        s_kva = coalesce(excluded.s_kva, r.s_kva),
        s_kva_max = coalesce(excluded.s_kva_max, r.s_kva_max),
        pf = coalesce(excluded.pf, r.pf),
        pf_l1 = coalesce(excluded.pf_l1, r.pf_l1),
        pf_l2 = coalesce(excluded.pf_l2, r.pf_l2),
        pf_l3 = coalesce(excluded.pf_l3, r.pf_l3),
        thd_v_l1 = coalesce(excluded.thd_v_l1, r.thd_v_l1),
        thd_v_l2 = coalesce(excluded.thd_v_l2, r.thd_v_l2),
        thd_v_l3 = coalesce(excluded.thd_v_l3, r.thd_v_l3),
        thd_v_max = coalesce(excluded.thd_v_max, r.thd_v_max),
        thd_i_l1 = coalesce(excluded.thd_i_l1, r.thd_i_l1),
        thd_i_l2 = coalesce(excluded.thd_i_l2, r.thd_i_l2),
        thd_i_l3 = coalesce(excluded.thd_i_l3, r.thd_i_l3),
        thd_i_max = coalesce(excluded.thd_i_max, r.thd_i_max),
        pv_kw = coalesce(excluded.pv_kw, r.pv_kw),
        pv_kwh_today = coalesce(excluded.pv_kwh_today, r.pv_kwh_today),
        inverter_status = coalesce(excluded.inverter_status, r.inverter_status),
        harmonics = coalesce(excluded.harmonics, r.harmonics),
        extra = case when excluded.extra is null then r.extra else coalesce(r.extra, '{}'::jsonb) || excluded.extra end,
        received_at = clock_timestamp()
    returning r.ts, (r.xmax = 0) as is_new
  )
  select count(*), count(*) filter (where is_new), min(ts), max(ts) into total, inserted, first_ts, last_ts from up;
  if total > 0 then
    update public.energy_meters set
      first_reading_at = least(coalesce(first_reading_at, first_ts), first_ts),
      last_reading_at = greatest(coalesce(last_reading_at, last_ts), last_ts),
      readings_count = readings_count + inserted,
      updated_at = clock_timestamp()
    where id = target_meter;
    -- Si llegaron datos nuevos, el aviso de "sin datos" de ese medidor se cierra solo.
    update public.energy_alerts set ended_at = first_ts, status = case when status = 'ABIERTA' then 'CERRADA' else status end,
      updated_at = clock_timestamp()
    where meter_id = target_meter and rule = 'SIN_DATOS' and ended_at is null and started_at < last_ts;
  end if;
  return jsonb_build_object('accepted', total, 'inserted', inserted, 'ignored', jsonb_array_length(target_rows) - total,
    'first', first_ts, 'last', last_ts);
end $$;
revoke all on function app.energy_upsert_readings(uuid, uuid, jsonb, boolean, text) from public, anon, authenticated;

create or replace function public.read_energy(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'app', 'pg_temp' as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'ENERGY_MEMBER_REQUIRED'; end if;
  return jsonb_build_object(
    'settings', coalesce((select jsonb_build_object('telegram_enabled', s.telegram_enabled,
        'telegram_chats', coalesce(array_length(s.telegram_chat_ids, 1), 0), 'telegram_min_severity', s.telegram_min_severity)
      from app.energy_settings s where s.organization_id = target_organization_id),
      jsonb_build_object('telegram_enabled', false, 'telegram_chats', 0, 'telegram_min_severity', 'URGENTE')),
    'sites', coalesce((select jsonb_agg(app.energy_site_json(s) order by lower(s.client_name), lower(s.site_name))
      from public.energy_sites s where s.organization_id = target_organization_id), '[]'::jsonb),
    'storage', jsonb_build_object(
      'rows', (select coalesce(sum(m.readings_count), 0) from public.energy_meters m where m.organization_id = target_organization_id),
      'bytes', pg_total_relation_size('public.energy_readings'),
      'all_rows', (select coalesce(sum(m.readings_count), 0) from public.energy_meters m)),
    'generated_at', clock_timestamp());
end $$;
revoke all on function public.read_energy(uuid) from public, anon;
grant execute on function public.read_energy(uuid) to authenticated;

-- Tablero de un medidor en un periodo. Todo se calcula aquí para no mandar lecturas crudas al navegador:
-- indicadores, serie con a lo más ~720 puntos, energía por día, mapa de calor por hora local, armónicos
-- (percentil 95) y alertas. "Dudosas" = frecuencia mínima de 50 Hz o THD de tensión arriba de 50 %:
-- en México no ocurren y son artefactos del analizador; no cuentan para mínimos ni distorsión.
create or replace function public.read_energy_meter(target_organization_id uuid, target_meter_id uuid,
  since_at timestamptz default null, until_at timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'app', 'pg_temp' as $$
declare m public.energy_meters%rowtype; s public.energy_sites%rowtype; t0 timestamptz; t1 timestamptz;
  nominal interval; step interval; result jsonb;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'ENERGY_MEMBER_REQUIRED'; end if;
  select * into m from public.energy_meters where organization_id = target_organization_id and id = target_meter_id;
  if not found then raise exception 'ENERGY_METER_NOT_FOUND'; end if;
  select * into s from public.energy_sites where id = m.site_id;
  t1 := coalesce(until_at, m.last_reading_at + interval '1 second', clock_timestamp());
  t0 := coalesce(since_at, m.first_reading_at, t1 - interval '7 days');
  if t1 <= t0 then raise exception 'ENERGY_RANGE_INVALID'; end if;
  if t1 - t0 > interval '400 days' then t0 := t1 - interval '400 days'; end if;
  nominal := make_interval(secs => coalesce(m.interval_minutes, 10) * 60);
  step := greatest(nominal, make_interval(secs => ceil(extract(epoch from (t1 - t0)) / 720.0 / 60.0) * 60));

  with r as (
    select e.*, (e.ts at time zone s.timezone) as lt,
      extract(epoch from least(coalesce(lead(e.ts) over (order by e.ts) - e.ts, nominal), nominal * 2)) / 3600.0 as h
    from public.energy_readings e
    where e.meter_id = m.id and e.ts >= t0 and e.ts < t1
  ), rr as (
    select r.*,
      (select avg(abs(x.pf)) from (values (r.pf_l1, r.p_import_l1), (r.pf_l2, r.p_import_l2), (r.pf_l3, r.p_import_l3)) as x(pf, p)
        where x.p > 0.5 and x.pf is not null and x.pf <> 0) as pf_eff,
      case when r.i_l1 is not null and r.i_l2 is not null and r.i_l3 is not null and (r.i_l1 + r.i_l2 + r.i_l3) / 3 > 5 then
        greatest(abs(r.i_l1 - (r.i_l1 + r.i_l2 + r.i_l3) / 3), abs(r.i_l2 - (r.i_l1 + r.i_l2 + r.i_l3) / 3),
          abs(r.i_l3 - (r.i_l1 + r.i_l2 + r.i_l3) / 3)) / ((r.i_l1 + r.i_l2 + r.i_l3) / 3) * 100 end as unbalance,
      (coalesce(r.freq_min, 60) <= 50.5 or coalesce(r.thd_v_max, 0) > 50) as dubious
    from r
  ), pi as (
    select coalesce(percentile_cont(0.95) within group (order by i_avg), 0) as p95 from rr where i_avg is not null
  ), k as (
    select count(*) as n, min(ts) as first_ts, max(ts) as last_ts,
      sum(coalesce(p_import_kw, 0) * h) as imp_kwh, sum(coalesce(p_export_kw, 0) * h) as exp_kwh,
      sum(coalesce(pv_kw, 0) * h) as pv_kwh_int,
      max(coalesce(p_import_max_kw, p_import_kw)) as peak_kw, max(p_import_kw) as peak_avg_kw,
      max(coalesce(p_export_max_kw, p_export_kw)) as peak_exp_kw, max(pv_kw) as peak_pv_kw,
      sum(pf_eff * coalesce(p_import_kw, 0) * h) / nullif(sum(case when pf_eff is not null then coalesce(p_import_kw, 0) * h end), 0) as pf_avg,
      avg(case when pf_eff is not null and p_import_kw > 1 then (pf_eff < 0.95)::int end) as pf_below,
      min(v_ln_min) filter (where not dubious) as v_min, max(v_ln_max) filter (where not dubious) as v_max, avg(v_ln) as v_avg,
      avg(unbalance) as unb_avg, percentile_cont(0.95) within group (order by unbalance) as unb_p95,
      percentile_cont(0.95) within group (order by thd_v_max) filter (where not dubious) as thdv_p95,
      percentile_cont(0.95) within group (order by thd_i_max) filter (where i_avg >= 0.3 * pi.p95 and pi.p95 > 0) as thdi_p95,
      count(*) filter (where dubious) as dubious_n,
      count(*) filter (where freq is not null and (freq < 59.8 or freq > 60.2)) as freq_out,
      avg(freq) as freq_avg
    from rr cross join pi
    group by pi.p95
  ), ser as (
    select date_bin(step, ts, t0) as b,
      avg(p_import_kw) as imp, max(coalesce(p_import_max_kw, p_import_kw)) as imp_max,
      avg(p_export_kw) as exp, max(coalesce(p_export_max_kw, p_export_kw)) as exp_max, avg(pv_kw) as pv,
      avg(v_l1) as v1, avg(v_l2) as v2, avg(v_l3) as v3,
      min(v_ln_min) filter (where not dubious) as vmin, max(v_ln_max) filter (where not dubious) as vmax,
      avg(i_l1) as i1, avg(i_l2) as i2, avg(i_l3) as i3, avg(pf_eff) as pf,
      avg(thd_v_max) filter (where not dubious) as thdv, avg(thd_i_max) as thdi, avg(unbalance) as unb
    from rr group by 1
  ), dly as (
    select lt::date as d, sum(coalesce(p_import_kw, 0) * h) as imp, sum(coalesce(p_export_kw, 0) * h) as exp,
      coalesce(max(pv_kwh_today), sum(coalesce(pv_kw, 0) * h)) as pv,
      max(coalesce(p_import_max_kw, p_import_kw)) as peak,
      sum(pf_eff * coalesce(p_import_kw, 0) * h) / nullif(sum(case when pf_eff is not null then coalesce(p_import_kw, 0) * h end), 0) as pf,
      count(*) as n
    from rr group by 1
  ), heat as (
    select lt::date as d, extract(hour from lt)::int as hr,
      sum(coalesce(p_import_kw, 0) * h) as imp, sum(coalesce(p_export_kw, 0) * h) as exp, sum(coalesce(pv_kw, 0) * h) as pv
    from rr group by 1, 2
  ), harm as (
    select hk.key as kind, ho.key::int as ord,
      percentile_cont(0.95) within group (order by (ho.value->>0)::float8) as l1,
      percentile_cont(0.95) within group (order by (ho.value->>1)::float8) as l2,
      percentile_cont(0.95) within group (order by (ho.value->>2)::float8) as l3
    from rr
    cross join lateral jsonb_each(case when jsonb_typeof(rr.harmonics) = 'object' then rr.harmonics else '{}'::jsonb end) hk
    cross join lateral jsonb_each(case when jsonb_typeof(hk.value) = 'object' then hk.value else '{}'::jsonb end) ho
    where rr.harmonics is not null and jsonb_typeof(ho.value) = 'array' and ho.key ~ '^[0-9]{1,2}$' and hk.key in ('v', 'i')
    group by 1, 2
  )
  select jsonb_build_object(
    'meter', app.energy_meter_json(m),
    'site', app.energy_site_core_json(s),
    'range', jsonb_build_object('since', t0, 'until', t1, 'step_minutes', extract(epoch from step) / 60),
    'kpis', (select jsonb_build_object(
        'readings', k.n, 'first_ts', k.first_ts, 'last_ts', k.last_ts,
        'expected', case when k.n > 0 then floor(extract(epoch from (k.last_ts - k.first_ts)) / extract(epoch from nominal)) + 1 else 0 end,
        'import_kwh', round(k.imp_kwh::numeric, 1), 'export_kwh', round(k.exp_kwh::numeric, 1),
        'pv_kwh', round(coalesce((select sum(d.pv) from dly d), k.pv_kwh_int)::numeric, 1),
        'cost_mxn', round((k.imp_kwh * s.price_mxn_kwh)::numeric, 0),
        'peak_kw', round(k.peak_kw::numeric, 1), 'peak_avg_kw', round(k.peak_avg_kw::numeric, 1),
        'peak_at', (select x.ts from rr x order by coalesce(x.p_import_max_kw, x.p_import_kw) desc nulls last limit 1),
        'peak_export_kw', round(k.peak_exp_kw::numeric, 1),
        'peak_export_at', (select x.ts from rr x order by coalesce(x.p_export_max_kw, x.p_export_kw) desc nulls last limit 1),
        'peak_pv_kw', round(k.peak_pv_kw::numeric, 1),
        'pf_avg', round(k.pf_avg::numeric, 3), 'pf_below_share', round(k.pf_below::numeric, 3),
        'v_min', round(k.v_min::numeric, 1), 'v_max', round(k.v_max::numeric, 1), 'v_avg', round(k.v_avg::numeric, 1),
        'v_min_at', (select x.ts from rr x where not x.dubious and x.v_ln_min is not null order by x.v_ln_min limit 1),
        'unbalance_avg', round(k.unb_avg::numeric, 1), 'unbalance_p95', round(k.unb_p95::numeric, 1),
        'thd_v_p95', round(k.thdv_p95::numeric, 2), 'thd_i_p95', round(k.thdi_p95::numeric, 1),
        'dubious', k.dubious_n, 'freq_out', k.freq_out, 'freq_avg', round(k.freq_avg::numeric, 2))
      from k),
    'series', coalesce((select jsonb_agg(jsonb_build_object('t', x.b,
        'imp', round(x.imp::numeric, 2), 'imp_max', round(x.imp_max::numeric, 2), 'exp', round(x.exp::numeric, 2),
        'exp_max', round(x.exp_max::numeric, 2), 'pv', round(x.pv::numeric, 2),
        'v1', round(x.v1::numeric, 1), 'v2', round(x.v2::numeric, 1), 'v3', round(x.v3::numeric, 1),
        'vmin', round(x.vmin::numeric, 1), 'vmax', round(x.vmax::numeric, 1),
        'i1', round(x.i1::numeric, 1), 'i2', round(x.i2::numeric, 1), 'i3', round(x.i3::numeric, 1),
        'pf', round(x.pf::numeric, 3), 'thdv', round(x.thdv::numeric, 2), 'thdi', round(x.thdi::numeric, 1),
        'unb', round(x.unb::numeric, 1)) order by x.b) from ser x), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d', x.d, 'imp', round(x.imp::numeric, 1), 'exp', round(x.exp::numeric, 1),
        'pv', round(x.pv::numeric, 1), 'peak', round(x.peak::numeric, 1), 'pf', round(x.pf::numeric, 3), 'n', x.n) order by x.d)
      from dly x), '[]'::jsonb),
    'heatmap', coalesce((select jsonb_agg(jsonb_build_object('d', x.d, 'h', x.hr, 'imp', round(x.imp::numeric, 2),
        'exp', round(x.exp::numeric, 2), 'pv', round(x.pv::numeric, 2)) order by x.d, x.hr) from heat x), '[]'::jsonb),
    'harmonics', jsonb_build_object(
      'v', coalesce((select jsonb_agg(jsonb_build_object('order', x.ord, 'l1', round(x.l1::numeric, 2), 'l2', round(x.l2::numeric, 2),
          'l3', round(x.l3::numeric, 2)) order by x.ord) from harm x where x.kind = 'v'), '[]'::jsonb),
      'i', coalesce((select jsonb_agg(jsonb_build_object('order', x.ord, 'l1', round(x.l1::numeric, 2), 'l2', round(x.l2::numeric, 2),
          'l3', round(x.l3::numeric, 2)) order by x.ord) from harm x where x.kind = 'i'), '[]'::jsonb)),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'rule', a.rule, 'severity', a.severity,
        'started_at', a.started_at, 'ended_at', a.ended_at, 'value', a.value, 'threshold', a.threshold, 'unit', a.unit,
        'message', a.message, 'detail', a.detail, 'status', a.status, 'acknowledged_at', a.acknowledged_at, 'note', a.note,
        'telegram_sent_at', a.telegram_sent_at) order by a.started_at desc)
      from (select * from public.energy_alerts a where a.meter_id = m.id
          and ((a.started_at < t1 and coalesce(a.ended_at, clock_timestamp()) >= t0) or a.status = 'ABIERTA')
          order by a.started_at desc limit 300) a), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.read_energy_meter(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.read_energy_meter(uuid, uuid, timestamptz, timestamptz) to authenticated;

create or replace function app.energy_command(target_organization_id uuid, target_op text, target_payload jsonb, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
declare p jsonb := coalesce(target_payload, '{}'::jsonb); op text := upper(coalesce(target_op, '')); command text;
  replay jsonb; result jsonb; actor uuid := auth.uid(); s public.energy_sites%rowtype; m public.energy_meters%rowtype;
  integ public.energy_integrations%rowtype; a public.energy_alerts%rowtype; up jsonb; dev jsonb; created integer := 0;
  request jsonb;
begin
  perform app.operations_assert_operator(target_organization_id);
  if op not in ('SITIO_GUARDAR','MEDIDOR_GUARDAR','MEDIDOR_LLAVE','MEDIDOR_LLAVE_QUITAR','LECTURAS_IMPORTAR','LECTURAS_BORRAR',
    'ALERTA_ESTADO','GROWATT_GUARDAR','GROWATT_PAUSAR') then raise exception 'ENERGY_OP_INVALID'; end if;
  command := 'energy.' || lower(op);
  -- El registro guarda solo la huella del pedido; las lecturas no se duplican en el registro.
  request := jsonb_build_object('op', op, 'sha', encode(digest(p::text, 'sha256'), 'hex'));
  replay := app.operations_command_begin(target_organization_id, command, target_idempotency_key, request);
  if replay is not null then return replay; end if;

  if op = 'SITIO_GUARDAR' then
    if nullif(btrim(p->>'client_name'), '') is null then raise exception 'ENERGY_CLIENT_REQUIRED'; end if;
    if nullif(p->>'timezone', '') is not null and not app.energy_valid_tz(p->>'timezone') then raise exception 'ENERGY_TIMEZONE_INVALID'; end if;
    if nullif(p->>'site_id', '') is null then
      insert into public.energy_sites (organization_id, client_name, site_name, city, state, timezone, price_mxn_kwh,
        contracted_demand_kw, paro_cost_mxn_h, work_days, work_start, work_end, crm_record_id, notes, created_by)
      values (target_organization_id, btrim(p->>'client_name'), coalesce(nullif(btrim(p->>'site_name'), ''), 'Planta'),
        nullif(btrim(p->>'city'), ''), nullif(btrim(p->>'state'), ''), coalesce(nullif(p->>'timezone', ''), 'America/Mexico_City'),
        coalesce(nullif(p->>'price_mxn_kwh', '')::numeric, 2.80), nullif(p->>'contracted_demand_kw', '')::numeric,
        nullif(p->>'paro_cost_mxn_h', '')::numeric,
        coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(case when jsonb_typeof(p->'work_days') = 'array' then p->'work_days' else '[]'::jsonb end) x), '{1,2,3,4,5,6}'),
        coalesce(nullif(p->>'work_start', '')::time, '07:00'), coalesce(nullif(p->>'work_end', '')::time, '19:00'),
        nullif(p->>'crm_record_id', '')::uuid, nullif(btrim(p->>'notes'), ''), actor)
      returning * into s;
      result := jsonb_build_object('ok', true, 'site_id', s.id, 'message', 'Planta agregada.');
    else
      select * into s from public.energy_sites where organization_id = target_organization_id and id = (p->>'site_id')::uuid for update;
      if not found then raise exception 'ENERGY_SITE_NOT_FOUND'; end if;
      update public.energy_sites set
        client_name = btrim(p->>'client_name'), site_name = coalesce(nullif(btrim(p->>'site_name'), ''), 'Planta'),
        city = nullif(btrim(p->>'city'), ''), state = nullif(btrim(p->>'state'), ''),
        timezone = coalesce(nullif(p->>'timezone', ''), timezone),
        price_mxn_kwh = coalesce(nullif(p->>'price_mxn_kwh', '')::numeric, price_mxn_kwh),
        contracted_demand_kw = nullif(p->>'contracted_demand_kw', '')::numeric,
        paro_cost_mxn_h = nullif(p->>'paro_cost_mxn_h', '')::numeric,
        work_days = coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(case when jsonb_typeof(p->'work_days') = 'array' then p->'work_days' else '[]'::jsonb end) x), work_days),
        work_start = coalesce(nullif(p->>'work_start', '')::time, work_start), work_end = coalesce(nullif(p->>'work_end', '')::time, work_end),
        notes = nullif(btrim(p->>'notes'), ''), revision = revision + 1, updated_at = clock_timestamp()
      where id = s.id returning * into s;
      result := jsonb_build_object('ok', true, 'site_id', s.id, 'message', 'Planta actualizada.');
    end if;

  elsif op = 'MEDIDOR_GUARDAR' then
    if nullif(btrim(p->>'name'), '') is null then raise exception 'ENERGY_METER_NAME_REQUIRED'; end if;
    if jsonb_typeof(coalesce(p->'thresholds', '{}'::jsonb)) <> 'object' then raise exception 'ENERGY_THRESHOLDS_INVALID'; end if;
    if nullif(p->>'meter_id', '') is null then
      select * into s from public.energy_sites where organization_id = target_organization_id and id = (p->>'site_id')::uuid;
      if not found then raise exception 'ENERGY_SITE_NOT_FOUND'; end if;
      insert into public.energy_meters (organization_id, site_id, name, kind, scope, source, device_brand, device_model, device_serial,
        nominal_v_ln, interval_minutes, thresholds, created_by)
      values (target_organization_id, s.id, btrim(p->>'name'), coalesce(nullif(p->>'kind', ''), 'ANALIZADOR'),
        coalesce(nullif(p->>'scope', ''), 'GENERAL'), case when p->>'source' = 'API' then 'API' else 'ARCHIVO' end,
        nullif(btrim(p->>'device_brand'), ''), nullif(btrim(p->>'device_model'), ''), nullif(btrim(p->>'device_serial'), ''),
        coalesce(nullif(p->>'nominal_v_ln', '')::numeric, 127), nullif(p->>'interval_minutes', '')::numeric,
        coalesce(p->'thresholds', '{}'::jsonb), actor)
      returning * into m;
      result := jsonb_build_object('ok', true, 'meter_id', m.id, 'message', 'Medidor agregado.');
    else
      select * into m from public.energy_meters where organization_id = target_organization_id and id = (p->>'meter_id')::uuid for update;
      if not found then raise exception 'ENERGY_METER_NOT_FOUND'; end if;
      update public.energy_meters set
        name = btrim(p->>'name'), scope = coalesce(nullif(p->>'scope', ''), scope),
        source = case when source = 'GROWATT' then source when p->>'source' = 'API' then 'API' when p->>'source' = 'ARCHIVO' then 'ARCHIVO' else source end,
        device_brand = nullif(btrim(p->>'device_brand'), ''), device_model = nullif(btrim(p->>'device_model'), ''),
        device_serial = nullif(btrim(p->>'device_serial'), ''),
        nominal_v_ln = coalesce(nullif(p->>'nominal_v_ln', '')::numeric, nominal_v_ln),
        interval_minutes = coalesce(nullif(p->>'interval_minutes', '')::numeric, interval_minutes),
        thresholds = coalesce(p->'thresholds', thresholds),
        active = coalesce((p->>'active')::boolean, active),
        evaluated_at = case when p ? 'thresholds' and p->'thresholds' is distinct from thresholds then null else evaluated_at end,
        revision = revision + 1, updated_at = clock_timestamp()
      where id = m.id returning * into m;
      result := jsonb_build_object('ok', true, 'meter_id', m.id, 'message', 'Medidor actualizado.');
    end if;

  elsif op in ('MEDIDOR_LLAVE', 'MEDIDOR_LLAVE_QUITAR') then
    select * into m from public.energy_meters where organization_id = target_organization_id and id = (p->>'meter_id')::uuid for update;
    if not found then raise exception 'ENERGY_METER_NOT_FOUND'; end if;
    if op = 'MEDIDOR_LLAVE' then
      -- La llave la genera el servidor de la app y solo se guarda su huella: aquí nunca pasa la llave.
      if coalesce(p->>'key_sha256', '') !~ '^[a-f0-9]{64}$' then raise exception 'ENERGY_KEY_INVALID'; end if;
      update public.energy_meters set ingest_key_sha256 = p->>'key_sha256', ingest_key_hint = left(p->>'key_hint', 16),
        ingest_key_created_at = clock_timestamp(), source = case when source = 'ARCHIVO' then 'API' else source end,
        revision = revision + 1, updated_at = clock_timestamp()
      where id = m.id;
      result := jsonb_build_object('ok', true, 'meter_id', m.id, 'message', 'Llave nueva lista. La anterior dejó de servir.');
    else
      update public.energy_meters set ingest_key_sha256 = null, ingest_key_hint = null, ingest_key_created_at = null,
        revision = revision + 1, updated_at = clock_timestamp() where id = m.id;
      result := jsonb_build_object('ok', true, 'meter_id', m.id, 'message', 'Llave quitada. El medidor ya no puede mandar lecturas por API.');
    end if;

  elsif op = 'LECTURAS_IMPORTAR' then
    select * into m from public.energy_meters where organization_id = target_organization_id and id = (p->>'meter_id')::uuid;
    if not found then raise exception 'ENERGY_METER_NOT_FOUND'; end if;
    if m.kind <> 'ANALIZADOR' then raise exception 'ENERGY_IMPORT_ONLY_ANALYZER'; end if;
    up := app.energy_upsert_readings(target_organization_id, m.id, p->'rows', coalesce((p->>'local')::boolean, true), 'ARCHIVO');
    if nullif(p->>'interval_minutes', '') is not null then
      update public.energy_meters set interval_minutes = coalesce(interval_minutes, (p->>'interval_minutes')::numeric) where id = m.id;
    end if;
    result := jsonb_build_object('ok', true, 'meter_id', m.id, 'message', 'Lecturas guardadas.') || up;

  elsif op = 'LECTURAS_BORRAR' then
    select * into m from public.energy_meters where organization_id = target_organization_id and id = (p->>'meter_id')::uuid for update;
    if not found then raise exception 'ENERGY_METER_NOT_FOUND'; end if;
    delete from public.energy_readings where meter_id = m.id
      and ts >= coalesce(nullif(p->>'since', '')::timestamptz, '-infinity') and ts < coalesce(nullif(p->>'until', '')::timestamptz, 'infinity');
    get diagnostics created = row_count;
    delete from public.energy_alerts where meter_id = m.id and acknowledged_at is null
      and started_at >= coalesce(nullif(p->>'since', '')::timestamptz, '-infinity') and started_at < coalesce(nullif(p->>'until', '')::timestamptz, 'infinity');
    update public.energy_meters set readings_count = (select count(*) from public.energy_readings where meter_id = m.id),
      first_reading_at = (select min(ts) from public.energy_readings where meter_id = m.id),
      last_reading_at = (select max(ts) from public.energy_readings where meter_id = m.id),
      evaluated_at = null, revision = revision + 1, updated_at = clock_timestamp()
    where id = m.id;
    result := jsonb_build_object('ok', true, 'meter_id', m.id, 'deleted', created, 'message', 'Lecturas borradas: ' || created || '.');

  elsif op = 'ALERTA_ESTADO' then
    select * into a from public.energy_alerts where organization_id = target_organization_id and id = (p->>'alert_id')::uuid for update;
    if not found then raise exception 'ENERGY_ALERT_NOT_FOUND'; end if;
    if coalesce(p->>'status', '') not in ('ABIERTA', 'RECONOCIDA', 'CERRADA') then raise exception 'ENERGY_ALERT_STATUS_INVALID'; end if;
    update public.energy_alerts set status = p->>'status',
      acknowledged_by = case when p->>'status' = 'ABIERTA' then null else actor end,
      acknowledged_at = case when p->>'status' = 'ABIERTA' then null else clock_timestamp() end,
      note = coalesce(nullif(btrim(p->>'note'), ''), note), updated_at = clock_timestamp()
    where id = a.id;
    result := jsonb_build_object('ok', true, 'alert_id', a.id, 'message', case p->>'status'
      when 'RECONOCIDA' then 'Alerta reconocida.' when 'CERRADA' then 'Alerta cerrada.' else 'Alerta abierta de nuevo.' end);

  elsif op = 'GROWATT_GUARDAR' then
    select * into s from public.energy_sites where organization_id = target_organization_id and id = (p->>'site_id')::uuid;
    if not found then raise exception 'ENERGY_SITE_NOT_FOUND'; end if;
    if nullif(p->>'plant_id', '') is null or nullif(p->>'token_ciphertext', '') is null then raise exception 'ENERGY_GROWATT_INCOMPLETE'; end if;
    insert into public.energy_integrations (organization_id, site_id, provider, api_base, token_ciphertext, token_key_id, token_hint,
      plant_id, plant_name, status, created_by)
    values (target_organization_id, s.id, 'GROWATT', p->>'api_base', p->>'token_ciphertext', p->>'token_key_id', left(p->>'token_hint', 12),
      p->>'plant_id', left(nullif(btrim(p->>'plant_name'), ''), 200), 'ACTIVA', actor)
    on conflict (organization_id, provider, plant_id) do update set site_id = excluded.site_id, api_base = excluded.api_base,
      token_ciphertext = excluded.token_ciphertext, token_key_id = excluded.token_key_id, token_hint = excluded.token_hint,
      plant_name = excluded.plant_name, status = 'ACTIVA', last_error = null, last_error_at = null, updated_at = clock_timestamp()
    returning * into integ;
    -- Un medidor para la planta completa y uno por inversor.
    insert into public.energy_meters (organization_id, site_id, name, kind, scope, source, device_brand, integration_id, external_id, interval_minutes, created_by)
    values (target_organization_id, s.id, left(coalesce(integ.plant_name, 'Planta solar') || ' (Growatt)', 200), 'INVERSOR', 'GENERAL', 'GROWATT',
      'Growatt', integ.id, 'PLANT', 15, actor)
    on conflict do nothing;
    for dev in select * from jsonb_array_elements(case when jsonb_typeof(p->'devices') = 'array' then p->'devices' else '[]'::jsonb end) loop
      if nullif(btrim(dev->>'sn'), '') is null then continue; end if;
      insert into public.energy_meters (organization_id, site_id, name, kind, scope, source, device_brand, device_model, device_serial,
        integration_id, external_id, interval_minutes, created_by)
      values (target_organization_id, s.id, left('Inversor ' || coalesce(nullif(btrim(dev->>'name'), ''), dev->>'sn'), 200), 'INVERSOR', 'MAQUINA',
        'GROWATT', 'Growatt', left(nullif(btrim(dev->>'model'), ''), 120), left(dev->>'sn', 120), integ.id, left(dev->>'sn', 64), 15, actor)
      on conflict do nothing;
      created := created + 1;
    end loop;
    result := jsonb_build_object('ok', true, 'integration_id', integ.id, 'message', 'Growatt conectado: planta ' || coalesce(integ.plant_name, integ.plant_id)
      || ' y ' || created || ' inversor(es). Los datos se jalan cada 15 minutos.');

  elsif op = 'GROWATT_PAUSAR' then
    update public.energy_integrations set status = case when coalesce((p->>'active')::boolean, false) then 'ACTIVA' else 'PAUSADA' end,
      updated_at = clock_timestamp()
    where organization_id = target_organization_id and id = (p->>'integration_id')::uuid returning * into integ;
    if integ.id is null then raise exception 'ENERGY_INTEGRATION_NOT_FOUND'; end if;
    result := jsonb_build_object('ok', true, 'integration_id', integ.id,
      'message', case when integ.status = 'ACTIVA' then 'Growatt reanudado.' else 'Growatt en pausa. Los datos guardados se conservan.' end);
  end if;

  return app.operations_command_finish(target_organization_id, command, target_idempotency_key, result);
end $$;
revoke all on function app.energy_command(uuid, text, jsonb, text) from public, anon, authenticated;

create or replace function public.energy_command(target_organization_id uuid, target_op text, target_payload jsonb, target_idempotency_key text)
returns jsonb language sql security definer set search_path to 'public', 'app', 'pg_temp' as $$
  select app.energy_command(target_organization_id, target_op, target_payload, target_idempotency_key);
$$;
revoke all on function public.energy_command(uuid, text, jsonb, text) from public, anon;
grant execute on function public.energy_command(uuid, text, jsonb, text) to authenticated;

-- Procesos de servidor, firmados con la prueba HMAC del despachador (ENNCO_DISPATCH_SECRET):
-- INGEST (API de lecturas), EVAL_READ y ALERTS_SYNC (evaluación de alertas), WORK (cron),
-- SYNC_RESULT (Growatt) y TELEGRAM_SETTLE. Firma: sha256 de 'energy_service', la organización y el
-- sha256 del payload, igual que createDispatchProof.
create or replace function public.energy_service(target_organization_id uuid, target_payload text, proof_command_id text,
  proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'extensions', 'pg_temp' as $$
declare p jsonb; op text; payload_sha text; m public.energy_meters%rowtype; s public.energy_sites%rowtype;
  integ public.energy_integrations%rowtype; up jsonb; result jsonb; t0 timestamptz; t1 timestamptz; rules text[];
  batch jsonb; cfg app.energy_settings%rowtype; claimed jsonb; total integer := 0;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n', 'energy_service', target_organization_id::text,
    encode(digest(convert_to(coalesce(target_payload, ''), 'utf8'), 'sha256'), 'hex')), 'utf8'), 'sha256'), 'hex');
  perform app.verify_dispatch_proof(target_organization_id, proof_command_id, proof_nonce, proof_expires_at, payload_sha, proof_signature);
  if length(coalesce(target_payload, '')) > 4000000 then raise exception 'ENERGY_PAYLOAD_TOO_LARGE'; end if;
  p := target_payload::jsonb;
  op := upper(coalesce(p->>'op', ''));

  if op = 'INGEST' then
    select * into m from public.energy_meters
    where organization_id = target_organization_id and ingest_key_sha256 = p->>'key_sha256' and coalesce(p->>'key_sha256', '') ~ '^[a-f0-9]{64}$';
    if not found then raise exception 'ENERGY_KEY_UNKNOWN'; end if;
    if not m.active then raise exception 'ENERGY_METER_INACTIVE'; end if;
    up := app.energy_upsert_readings(target_organization_id, m.id, p->'rows', false, case when m.source = 'GROWATT' then 'GROWATT' else 'API' end);
    return jsonb_build_object('status', 'OK', 'meter_id', m.id, 'meter', m.name) || up;

  elsif op = 'EVAL_READ' then
    select * into m from public.energy_meters where organization_id = target_organization_id and id = (p->>'meter_id')::uuid;
    if not found then raise exception 'ENERGY_METER_NOT_FOUND'; end if;
    select * into s from public.energy_sites where id = m.site_id;
    t0 := coalesce(nullif(p->>'since', '')::timestamptz, m.first_reading_at, clock_timestamp());
    t1 := coalesce(nullif(p->>'until', '')::timestamptz, m.last_reading_at + interval '1 second', clock_timestamp());
    if t1 - t0 > interval '8 days' then raise exception 'ENERGY_EVAL_WINDOW_TOO_LARGE'; end if;
    return jsonb_build_object('status', 'EVAL',
      'meter', app.energy_meter_json(m), 'site', app.energy_site_core_json(s),
      'since', t0, 'until', t1, 'last_reading_at', m.last_reading_at,
      'fields', jsonb_build_array('ts', 'v_l1', 'v_l2', 'v_l3', 'v_ln_min', 'v_ln_max', 'i_avg', 'i_l1', 'i_l2', 'i_l3', 'freq', 'freq_min', 'p_import_kw', 'p_import_l1', 'p_import_l2', 'p_import_l3', 'p_import_max_kw', 'p_export_kw', 'p_export_l1', 'p_export_l2', 'p_export_l3', 'pf', 'pf_l1', 'pf_l2', 'pf_l3', 'thd_v_max', 'thd_i_max', 'pv_kw', 'pv_kwh_today', 'inverter_status'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(to_jsonb(e.ts), e.v_l1, e.v_l2, e.v_l3, e.v_ln_min, e.v_ln_max, e.i_avg, e.i_l1, e.i_l2, e.i_l3, e.freq, e.freq_min, e.p_import_kw, e.p_import_l1, e.p_import_l2, e.p_import_l3, e.p_import_max_kw, e.p_export_kw, e.p_export_l1, e.p_export_l2, e.p_export_l3, e.pf, e.pf_l1, e.pf_l2, e.pf_l3, e.thd_v_max, e.thd_i_max, e.pv_kw, e.pv_kwh_today, e.inverter_status) order by e.ts)
        from public.energy_readings e where e.meter_id = m.id and e.ts >= t0 and e.ts < t1), '[]'::jsonb),
      'open_events', coalesce((select jsonb_agg(jsonb_build_object('rule', a.rule, 'started_at', a.started_at))
        from public.energy_alerts a where a.meter_id = m.id and a.ended_at is null and a.started_at < t0), '[]'::jsonb),
      -- Contexto para reglas que comparan contra días anteriores (consumo atípico, generación baja).
      'history', coalesce((select jsonb_agg(jsonb_build_object('d', x.d, 'h', x.hr, 'imp', round(x.imp::numeric, 2), 'pv', round(x.pv::numeric, 2)))
        from (select (e.ts at time zone s.timezone)::date as d, extract(hour from e.ts at time zone s.timezone)::int as hr,
            sum(coalesce(e.p_import_kw, 0)) * coalesce(m.interval_minutes, 10) / 60.0 as imp,
            coalesce(max(e.pv_kwh_today), sum(coalesce(e.pv_kw, 0)) * coalesce(m.interval_minutes, 15) / 60.0) as pv
          from public.energy_readings e where e.meter_id = m.id and e.ts >= t0 - interval '28 days' and e.ts < t0
          group by 1, 2) x), '[]'::jsonb));

  elsif op = 'ALERTS_SYNC' then
    select * into m from public.energy_meters where organization_id = target_organization_id and id = (p->>'meter_id')::uuid;
    if not found then raise exception 'ENERGY_METER_NOT_FOUND'; end if;
    t0 := (p->>'since')::timestamptz; t1 := (p->>'until')::timestamptz;
    rules := array(select jsonb_array_elements_text(p->'rules'));
    if jsonb_typeof(p->'events') is distinct from 'array' or jsonb_array_length(p->'events') > 2000 then raise exception 'ENERGY_EVENTS_INVALID'; end if;
    -- Lo que la evaluación ya no encuentra en su ventana (por ejemplo, porque cambió un umbral) se borra,
    -- salvo que alguien ya lo haya visto o se haya mandado por Telegram.
    delete from public.energy_alerts a where a.meter_id = m.id and a.rule = any(rules) and a.started_at >= t0 and a.started_at < t1
      and a.status = 'ABIERTA' and a.acknowledged_at is null and a.telegram_sent_at is null
      and not exists (select 1 from jsonb_to_recordset(p->'events') e(rule text, started_at timestamptz)
        where e.rule = a.rule and e.started_at = a.started_at);
    insert into public.energy_alerts as a (organization_id, site_id, meter_id, rule, severity, started_at, ended_at, value, threshold, unit, message, detail)
    select target_organization_id, m.site_id, m.id, e.rule, e.severity, e.started_at, e.ended_at, e.value, e.threshold,
      left(e.unit, 16), left(e.message, 1000), coalesce(e.detail, '{}'::jsonb)
    from jsonb_to_recordset(p->'events') e(rule text, severity text, started_at timestamptz, ended_at timestamptz, value real,
      threshold real, unit text, message text, detail jsonb)
    where e.rule = any(rules)
    on conflict (meter_id, rule, started_at) do update set severity = excluded.severity, ended_at = excluded.ended_at,
      value = excluded.value, threshold = excluded.threshold, unit = excluded.unit, message = excluded.message,
      detail = excluded.detail, updated_at = clock_timestamp();
    get diagnostics total = row_count;
    if coalesce((p->>'mark_evaluated')::boolean, true) then
      update public.energy_meters set evaluated_at = clock_timestamp() where id = m.id;
    end if;
    return jsonb_build_object('status', 'SYNCED', 'meter_id', m.id, 'events', total);

  elsif op = 'WORK' then
    select * into cfg from app.energy_settings where organization_id = target_organization_id;
    claimed := '[]'::jsonb;
    if coalesce(cfg.telegram_enabled, false) and coalesce(array_length(cfg.telegram_chat_ids, 1), 0) > 0 then
      with c as (
        update public.energy_alerts a set telegram_claimed_at = clock_timestamp()
        where a.id in (select x.id from public.energy_alerts x
          where x.organization_id = target_organization_id and x.status = 'ABIERTA' and x.telegram_sent_at is null
            and (x.telegram_claimed_at is null or x.telegram_claimed_at < clock_timestamp() - interval '10 minutes')
            and x.created_at > clock_timestamp() - interval '1 day'
            and (x.severity = 'URGENTE' or (cfg.telegram_min_severity = 'ATENCION' and x.severity = 'ATENCION'))
          order by x.created_at limit 10 for update skip locked)
        returning a.*
      )
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'rule', c.rule, 'severity', c.severity, 'message', c.message,
          'started_at', c.started_at, 'meter', mm.name, 'client', ss.client_name, 'site', ss.site_name, 'timezone', ss.timezone)), '[]'::jsonb)
        into claimed
      from c join public.energy_meters mm on mm.id = c.meter_id join public.energy_sites ss on ss.id = c.site_id;
    end if;
    return jsonb_build_object('status', 'WORK',
      'integrations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'provider', i.provider, 'api_base', i.api_base,
          'token_ciphertext', i.token_ciphertext, 'token_key_id', i.token_key_id, 'plant_id', i.plant_id, 'timezone', ss.timezone,
          'meters', coalesce((select jsonb_agg(jsonb_build_object('id', mm.id, 'external_id', mm.external_id))
            from public.energy_meters mm where mm.integration_id = i.id and mm.active), '[]'::jsonb)))
        from public.energy_integrations i join public.energy_sites ss on ss.id = i.site_id
        where i.organization_id = target_organization_id and i.status in ('ACTIVA', 'ERROR')
          and (i.last_sync_at is null or i.last_sync_at < clock_timestamp() - interval '10 minutes')), '[]'::jsonb),
      'evaluate', coalesce((select jsonb_agg(jsonb_build_object('id', mm.id, 'evaluated_at', mm.evaluated_at,
          'first_reading_at', mm.first_reading_at, 'last_reading_at', mm.last_reading_at))
        from (select * from public.energy_meters mm where mm.organization_id = target_organization_id and mm.active
            and mm.last_reading_at is not null and mm.last_reading_at > coalesce(mm.evaluated_at, '-infinity'::timestamptz)
          order by mm.last_reading_at desc limit 20) mm), '[]'::jsonb),
      'stale', coalesce((select jsonb_agg(jsonb_build_object('id', mm.id, 'name', mm.name, 'last_reading_at', mm.last_reading_at))
        from public.energy_meters mm where mm.organization_id = target_organization_id and mm.active and mm.source in ('API', 'GROWATT')
          and mm.last_reading_at is not null
          and mm.last_reading_at < clock_timestamp() - greatest(interval '30 minutes', make_interval(secs => coalesce(mm.interval_minutes, 10) * 180))
          and not exists (select 1 from public.energy_alerts a where a.meter_id = mm.id and a.rule = 'SIN_DATOS' and a.ended_at is null)), '[]'::jsonb),
      'telegram', jsonb_build_object('enabled', coalesce(cfg.telegram_enabled, false), 'chat_ids', to_jsonb(coalesce(cfg.telegram_chat_ids, '{}')),
        'alerts', claimed));

  elsif op = 'SYNC_RESULT' then
    select * into integ from public.energy_integrations where organization_id = target_organization_id and id = (p->>'integration_id')::uuid for update;
    if not found then raise exception 'ENERGY_INTEGRATION_NOT_FOUND'; end if;
    if coalesce((p->>'ok')::boolean, false) then
      for batch in select * from jsonb_array_elements(case when jsonb_typeof(p->'batches') = 'array' then p->'batches' else '[]'::jsonb end) loop
        select * into m from public.energy_meters where integration_id = integ.id and external_id = batch->>'external_id';
        if not found then
          insert into public.energy_meters (organization_id, site_id, name, kind, scope, source, device_brand, device_model, device_serial,
            integration_id, external_id, interval_minutes)
          values (target_organization_id, integ.site_id, left('Inversor ' || coalesce(nullif(btrim(batch->>'name'), ''), batch->>'external_id'), 200),
            'INVERSOR', 'MAQUINA', 'GROWATT', 'Growatt', left(batch->>'model', 120), left(batch->>'external_id', 120), integ.id,
            left(batch->>'external_id', 64), 15)
          on conflict do nothing returning * into m;
          if m.id is null then continue; end if;
        end if;
        if jsonb_typeof(batch->'rows') = 'array' and jsonb_array_length(batch->'rows') > 0 then
          up := app.energy_upsert_readings(target_organization_id, m.id, batch->'rows', false, 'GROWATT');
          total := total + coalesce((up->>'accepted')::integer, 0);
        end if;
      end loop;
      update public.energy_integrations set status = 'ACTIVA', last_sync_at = clock_timestamp(), last_error = null, updated_at = clock_timestamp()
      where id = integ.id;
    else
      update public.energy_integrations set status = 'ERROR', last_sync_at = clock_timestamp(), last_error = left(p->>'error', 300),
        last_error_at = clock_timestamp(), updated_at = clock_timestamp() where id = integ.id;
    end if;
    return jsonb_build_object('status', 'SYNCED', 'integration_id', integ.id, 'readings', total);

  elsif op = 'TELEGRAM_SETTLE' then
    if coalesce((p->>'delivered')::boolean, false) then
      update public.energy_alerts set telegram_sent_at = clock_timestamp(), updated_at = clock_timestamp()
      where organization_id = target_organization_id and id = (p->>'alert_id')::uuid;
    else
      update public.energy_alerts set telegram_claimed_at = null where organization_id = target_organization_id and id = (p->>'alert_id')::uuid;
    end if;
    return jsonb_build_object('status', 'SETTLED');
  end if;
  raise exception 'ENERGY_SERVICE_OP_INVALID';
end $$;
revoke all on function public.energy_service(uuid, text, text, uuid, timestamptz, text) from public;
grant execute on function public.energy_service(uuid, text, text, uuid, timestamptz, text) to anon, authenticated;

commit;
