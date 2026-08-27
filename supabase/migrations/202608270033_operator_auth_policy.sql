begin;

-- M033 política de aseguramiento del operador.
--
-- Hasta M032 el nivel de aseguramiento exigido a toda sesión de operador
-- estaba escrito a mano como 'aal2' en tres lugares (app.is_member,
-- app.has_role y la comprobación en línea de app.apply_annex_a_snapshot), de
-- los que cuelgan 37 funciones y 33 políticas RLS. Esta migración NO relaja el
-- control: lo convierte en política explícita, con una sola fuente de verdad y
-- un interruptor auditable.
--
-- Decisión del negocio (DEC-106, 2026-08-27): el acceso al Control Room queda
-- con usuario, contraseña y recuperación, sin segundo factor. La bandera se
-- siembra en false para reflejarlo; volver a exigir MFA es un UPDATE de una
-- fila más el ambiente `ENNCO_REQUIRE_MFA` en la aplicación.
--
-- Invariante que NO cambia: una petición sin sesión (aal nulo, anónima o
-- service-role sin claim) sigue siendo rechazada en los tres puntos. Lo único
-- que cambia es si una sesión autenticada de un solo factor basta.

create table if not exists app.auth_policy (
  singleton boolean primary key default true,
  require_mfa boolean not null,
  reason text not null,
  updated_at timestamptz not null default now(),
  constraint auth_policy_singleton check (singleton)
);

revoke all on table app.auth_policy from anon, authenticated;

insert into app.auth_policy (singleton, require_mfa, reason)
values (true, false, 'DEC-106 2026-08-27: acceso con usuario, contrasena y recuperacion, sin segundo factor')
on conflict (singleton) do nothing;

-- Falla cerrado: si la fila de política no existe, se exige MFA.
create or replace function app.mfa_enforced()
returns boolean
language sql
stable
security definer
set search_path = app, public, pg_temp
as $$
  select coalesce((select require_mfa from app.auth_policy where singleton), true);
$$;

-- Único predicado de aseguramiento del proyecto. Nulo siempre es falso.
create or replace function app.request_assurance_ok()
returns boolean
language sql
stable
security definer
set search_path = app, public, pg_temp
as $$
  select case
    when app.current_request_aal() is null then false
    when app.mfa_enforced() then app.current_request_aal() = 'aal2'
    else app.current_request_aal() in ('aal1', 'aal2')
  end;
$$;

create or replace function app.is_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.request_assurance_ok()
    and exists (
      select 1
      from public.organization_users ou
      where ou.organization_id = target_organization_id
        and ou.user_id = auth.uid()
        and ou.active
    );
$$;

create or replace function app.has_role(target_organization_id uuid, allowed_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.request_assurance_ok()
    and exists (
      select 1
      from public.organization_users ou
      where ou.organization_id = target_organization_id
        and ou.user_id = auth.uid()
        and ou.active
        and ou.role = any(allowed_roles)
    );
$$;

-- public.apply_annex_a_suppression_snapshot repetía la comprobación en línea.
-- Se reemplaza el cuerpo completo tomado de 202608200025 cambiando ÚNICAMENTE
-- la línea del guardia: sigue exigiendo sesión viva, rol de administrador y el
-- nivel de aseguramiento que mande la política.
-- Guardia: los gates de base cargan subconjuntos de migraciones y varios se
-- detienen antes del Anexo A. Sin este condicional la migración explotaría en
-- esos entornos, al declarar %rowtype sobre una tabla que aún no existe.
do $migration$
begin
  if to_regclass('public.suppression_manifest_commands') is not null then
    execute $fn$create or replace function public.apply_annex_a_suppression_snapshot(
  target_organization_id uuid,
  target_snapshot jsonb,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
declare
  request_sha text;
  existing_command public.suppression_manifest_commands%rowtype;
  manifest_record public.suppression_manifests%rowtype;
  entry_item jsonb;
  identity_value jsonb;
  entry_position integer:=0;
  identity_position integer;
  alias_total integer:=0;
  domain_total integer:=0;
  names text[]:='{}';
  aliases text[]:='{}';
  domains text[]:='{}';
  name_value text;
  domain_value text;
  source_entry_hash text;
  matched_account uuid;
  response jsonb;
begin
  if auth.uid() is null or not app.request_assurance_ok()
    or not app.has_role(target_organization_id,array['ennco_admin','teckel_admin']::public.user_role[])
  then raise exception 'ANNEX_A_ADMIN_AAL2_REQUIRED'; end if;
  if target_idempotency_key is null or target_idempotency_key !~ '^[a-f0-9]{64}$'
    or target_snapshot is null or jsonb_typeof(target_snapshot)<>'object'
  then raise exception 'ANNEX_A_SNAPSHOT_INPUT_INVALID'; end if;

  request_sha:=encode(digest(target_snapshot::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':annex-a-import',0));
  select * into existing_command from public.suppression_manifest_commands
  where organization_id=target_organization_id and command_name='APPLY_ANNEX_A_SNAPSHOT'
    and idempotency_key=target_idempotency_key;
  if found then
    if existing_command.request_sha256<>request_sha then raise exception 'ANNEX_A_IDEMPOTENCY_DRIFT'; end if;
    return existing_command.response_json||jsonb_build_object('status','DUPLICATE');
  end if;

  if (select array_agg(k order by k) from jsonb_object_keys(target_snapshot) k)
      <> array['annex_id','confirmed_at','entries','external_send_authorized','scope_statement','snapshot_sha256','status']::text[]
    or target_snapshot->>'annex_id'<>'ENNCO-ANNEX-A-2026-08-13'
    or target_snapshot->>'snapshot_sha256'<>'8e986eff74dee10d3f619f7562ee6b7d18207c3c5e080cd82656cc0e88d46af1'
    or target_snapshot->>'scope_statement'<>'ONLY_THESE_THREE_COMPANIES_AS_OF_CONFIRMATION'
    or target_snapshot->>'status'<>'IDENTITY_AND_DOMAIN_VERIFIED_ACCOUNT_BINDING_PENDING'
    or coalesce((target_snapshot->>'external_send_authorized')::boolean,true)
    or jsonb_typeof(target_snapshot->'entries')<>'array'
    or jsonb_array_length(target_snapshot->'entries')<>3
  then raise exception 'ANNEX_A_SNAPSHOT_CONTRACT_INVALID'; end if;

  perform (target_snapshot->>'confirmed_at')::timestamptz;
  for entry_item in select value from jsonb_array_elements(target_snapshot->'entries') loop
    entry_position:=entry_position+1;
    if (select array_agg(k order by k) from jsonb_object_keys(entry_item) k)
       <> array['aliases','domains','legal_name','normalized_name','source_timestamp']::text[]
      or jsonb_typeof(entry_item->'aliases')<>'array'
      or jsonb_typeof(entry_item->'domains')<>'array'
    then raise exception 'ANNEX_A_ENTRY_CONTRACT_INVALID'; end if;
    name_value:=entry_item->>'normalized_name';
    if name_value not in ('POSCO MPPC','MPE PLASTIC','TEJAS EL AGUILA')
      or (case name_value
        when 'POSCO MPPC' then (entry_item->>'legal_name') <> 'POSCO MPPC, S.A. DE C.V.'
        when 'MPE PLASTIC' then (entry_item->>'legal_name') <> 'MATERIAS PLASTICAS Y ELASTOMEROS DE MEXICO, S.A. DE C.V.'
        when 'TEJAS EL AGUILA' then (entry_item->>'legal_name') <> 'LAPROBA EL AGUILA SA DE CV'
        else true end)
    then raise exception 'ANNEX_A_ENTRY_IDENTITY_INVALID'; end if;
    perform (entry_item->>'source_timestamp')::timestamptz;
    names:=array_append(names,name_value);
    source_entry_hash:=encode(digest(entry_item::text,'sha256'),'hex');
    identity_position:=0;
    for identity_value in select value from jsonb_array_elements(entry_item->'aliases') loop
      if jsonb_typeof(identity_value)<>'string' or length(identity_value#>>'{}') not between 2 and 240
      then raise exception 'ANNEX_A_ALIAS_INVALID'; end if;
      identity_position:=identity_position+1;
      alias_total:=alias_total+1;
      aliases:=array_append(aliases,identity_value#>>'{}');
    end loop;
    for identity_value in select value from jsonb_array_elements(entry_item->'domains') loop
      if jsonb_typeof(identity_value)<>'string' then raise exception 'ANNEX_A_DOMAIN_INVALID'; end if;
      domain_value:=app.annex_a_normalize_domain(identity_value#>>'{}');
      if domain_value!~ '^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
      then raise exception 'ANNEX_A_DOMAIN_INVALID'; end if;
      identity_position:=identity_position+1;
      domain_total:=domain_total+1;
      domains:=array_append(domains,domain_value);
    end loop;
  end loop;

  if (select array_agg(x order by x) from unnest(names) x)
      <> array['MPE PLASTIC','POSCO MPPC','TEJAS EL AGUILA']::text[]
    or alias_total<>12 or domain_total<>6
    or (select array_agg(x order by x) from unnest(aliases) x)
      <> array[
        'LAPROBA EL AGUILA','LAPROBA EL AGUILA S.A. DE C.V.','LAPROBA EL AGUILA SA DE CV',
        'MATERIAS PLASTICAS Y ELASTOMEROS DE MEXICO','MATERIAS PLASTICAS Y ELASTOMEROS DE MEXICO SA DE CV',
        'MPE MEXICO','MPE PLASTIC','MPE PLASTICS','POSCO MPPC','POSCO MPPC S.A. DE C.V.',
        'POSCO MPPC SA DE CV','TEJAS EL AGUILA'
      ]::text[]
    or (select array_agg(x order by x) from unnest(domains) x)
      <> array['mpeplastics.com','poscomppc.com','poscomppc.com.mx','tejaselaguila.com','tejaselaguila.mx','tejaselaguila.net']::text[]
  then raise exception 'ANNEX_A_CARDINALITY_OR_IDENTITY_DRIFT'; end if;

  select * into manifest_record from public.suppression_manifests
  where organization_id=target_organization_id
    and annex_id=target_snapshot->>'annex_id'
    and snapshot_sha256=target_snapshot->>'snapshot_sha256';
  if found then
    response:=jsonb_build_object(
      'status','DUPLICATE','manifest_id',manifest_record.id,'annex_id',manifest_record.annex_id,
      'snapshot_sha256',manifest_record.snapshot_sha256,'entry_count',manifest_record.entry_count,
      'alias_count',manifest_record.alias_count,'domain_count',manifest_record.domain_count,
      'matched_account_count',(select count(distinct matched_account_id)
        from public.suppression_manifest_identities where organization_id=target_organization_id
          and manifest_id=manifest_record.id and matched_account_id is not null),
      'outreach_eligible_records',0,'release_state','HOLD'
    );
    insert into public.suppression_manifest_commands(
      organization_id,command_name,idempotency_key,request_sha256,manifest_id,response_json,executed_by
    ) values (target_organization_id,'APPLY_ANNEX_A_SNAPSHOT',target_idempotency_key,request_sha,
      manifest_record.id,response,auth.uid());
    return response;
  end if;

  update public.suppression_manifests set status='SUPERSEDED'
  where organization_id=target_organization_id and status='ACTIVE';
  insert into public.suppression_manifests(
    organization_id,annex_id,snapshot_sha256,scope_statement,confirmed_at,
    entry_count,alias_count,domain_count,status,evidence_class,imported_by
  ) values (
    target_organization_id,target_snapshot->>'annex_id',target_snapshot->>'snapshot_sha256',
    target_snapshot->>'scope_statement',(target_snapshot->>'confirmed_at')::timestamptz,
    3,12,6,'ACTIVE','live',auth.uid()
  ) returning * into manifest_record;

  -- Identity rows are inserted after the manifest exists. Re-run the validated payload now.
  entry_position:=0;
  for entry_item in select value from jsonb_array_elements(target_snapshot->'entries') loop
    entry_position:=entry_position+1;
    source_entry_hash:=encode(digest(entry_item::text,'sha256'),'hex');
    identity_position:=0;
    for identity_value in select value from jsonb_array_elements(entry_item->'aliases') loop
      identity_position:=identity_position+1;
      select a.id into matched_account from public.accounts a
      where a.organization_id=target_organization_id and not a.is_deleted and (
        app.annex_a_identity_hmac(target_organization_id,'NAME',a.legal_name)=app.annex_a_identity_hmac(target_organization_id,'NAME',identity_value#>>'{}')
        or app.annex_a_identity_hmac(target_organization_id,'NAME',a.normalized_name)=app.annex_a_identity_hmac(target_organization_id,'NAME',identity_value#>>'{}')
        or exists(select 1 from public.account_aliases aa where aa.organization_id=a.organization_id and aa.account_id=a.id
          and app.annex_a_identity_hmac(target_organization_id,'NAME',aa.alias)=app.annex_a_identity_hmac(target_organization_id,'NAME',identity_value#>>'{}'))
      ) order by a.created_at,a.id limit 1;
      insert into public.suppression_manifest_identities values (
        gen_random_uuid(),target_organization_id,manifest_record.id,entry_position,identity_position,'NAME',
        app.annex_a_identity_hmac(target_organization_id,'NAME',identity_value#>>'{}'),source_entry_hash,matched_account,clock_timestamp()
      );
    end loop;
    for identity_value in select value from jsonb_array_elements(entry_item->'domains') loop
      identity_position:=identity_position+1;
      domain_value:=app.annex_a_normalize_domain(identity_value#>>'{}');
      select a.id into matched_account from public.accounts a
      where a.organization_id=target_organization_id and not a.is_deleted
        and app.annex_a_normalize_domain(a.primary_domain)=domain_value order by a.created_at,a.id limit 1;
      insert into public.suppression_manifest_identities values (
        gen_random_uuid(),target_organization_id,manifest_record.id,entry_position,identity_position,'DOMAIN',
        app.annex_a_identity_hmac(target_organization_id,'DOMAIN',domain_value),source_entry_hash,matched_account,clock_timestamp()
      );
    end loop;
  end loop;

  insert into public.suppression_entries(organization_id,kind,account_id,reason,effective_at,expires_at)
  select distinct target_organization_id,'ANNEX_A'::public.suppression_kind,i.matched_account_id,
    'ENNCO_ANNEX_A_2026_08_13',clock_timestamp(),null::timestamptz
  from public.suppression_manifest_identities i
  where i.organization_id=target_organization_id and i.manifest_id=manifest_record.id
    and i.matched_account_id is not null
  on conflict do nothing;

  insert into public.suppression_entries(organization_id,kind,normalized_domain,reason,effective_at,expires_at)
  select distinct target_organization_id,'ANNEX_A'::public.suppression_kind,d,
    'ENNCO_ANNEX_A_2026_08_13',clock_timestamp(),null::timestamptz
  from unnest(domains) as d
  on conflict do nothing;

  response:=jsonb_build_object(
    'status','APPLIED','manifest_id',manifest_record.id,'annex_id',manifest_record.annex_id,
    'snapshot_sha256',manifest_record.snapshot_sha256,'entry_count',3,'alias_count',12,'domain_count',6,
    'matched_account_count',(select count(distinct matched_account_id) from public.suppression_manifest_identities
      where organization_id=target_organization_id and manifest_id=manifest_record.id and matched_account_id is not null),
    'outreach_eligible_records',0,'release_state','HOLD'
  );
  insert into public.suppression_manifest_commands(
    organization_id,command_name,idempotency_key,request_sha256,manifest_id,response_json,executed_by
  ) values (target_organization_id,'APPLY_ANNEX_A_SNAPSHOT',target_idempotency_key,request_sha,
    manifest_record.id,response,auth.uid());
  insert into public.event_outbox(
    organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json
  ) values (
    target_organization_id,'suppression_manifest',manifest_record.id,'suppression.annex_a_applied',
    'annex-a-applied:'||manifest_record.id::text,
    jsonb_build_object('manifest_id',manifest_record.id,'annex_id',manifest_record.annex_id,
      'snapshot_sha256',manifest_record.snapshot_sha256,'entry_count',3,'alias_count',12,'domain_count',6)
  ) on conflict (organization_id,idempotency_key) do nothing;
  return response;
end;
$$;$fn$;
  end if;
end
$migration$;

commit;
