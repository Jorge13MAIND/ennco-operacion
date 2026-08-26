begin;

drop trigger if exists messages_aaa_m025_rollback_fail_closed on public.messages;
drop function if exists app.block_m025_rollback_outbound();

create table if not exists public.suppression_manifests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  annex_id text not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  scope_statement text not null,
  confirmed_at timestamptz not null,
  entry_count integer not null check (entry_count >= 0),
  alias_count integer not null check (alias_count >= 0),
  domain_count integer not null check (domain_count >= 0),
  status text not null check (status in ('ACTIVE','SUPERSEDED')),
  evidence_class public.evidence_class not null default 'live',
  imported_by uuid not null,
  imported_at timestamptz not null default clock_timestamp(),
  unique (organization_id, annex_id, snapshot_sha256),
  unique (organization_id, id)
);

create unique index if not exists suppression_manifests_one_active
  on public.suppression_manifests (organization_id)
  where status='ACTIVE';

create table if not exists public.suppression_manifest_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  manifest_id uuid not null,
  entry_ordinal integer not null check (entry_ordinal between 1 and 3),
  identity_ordinal integer not null check (identity_ordinal between 1 and 32),
  identity_type text not null check (identity_type in ('NAME','DOMAIN')),
  identity_hmac text not null check (identity_hmac ~ '^[a-f0-9]{64}$'),
  source_entry_sha256 text not null check (source_entry_sha256 ~ '^[a-f0-9]{64}$'),
  matched_account_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, manifest_id, entry_ordinal, identity_ordinal),
  foreign key (organization_id, manifest_id)
    references public.suppression_manifests(organization_id, id) on delete restrict,
  foreign key (organization_id, matched_account_id)
    references public.accounts(organization_id, id) on delete restrict
);

create index if not exists suppression_manifest_identity_lookup
  on public.suppression_manifest_identities (organization_id, identity_type, identity_hmac, manifest_id);

create table if not exists public.suppression_manifest_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  command_name text not null check (command_name='APPLY_ANNEX_A_SNAPSHOT'),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  manifest_id uuid,
  response_json jsonb,
  executed_by uuid not null,
  executed_at timestamptz not null default clock_timestamp(),
  unique (organization_id, command_name, idempotency_key),
  foreign key (organization_id, manifest_id)
    references public.suppression_manifests(organization_id, id) on delete restrict
);

create or replace function app.annex_a_normalize_name(target_value text)
returns text
language sql
immutable
set search_path = app, public, pg_catalog
as $$
  select app.research_legal_name_key(target_value)
$$;

create or replace function app.annex_a_normalize_domain(target_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(lower(btrim(coalesce(target_value,''))), '^www\.', '')
$$;

create or replace function app.annex_a_identity_hmac(
  target_organization_id uuid,
  target_identity_type text,
  target_identity_value text
)
returns text
language plpgsql
stable
security definer
set search_path = app, public, pg_temp
as $$
declare
  runtime_secret text;
  normalized_type text:=upper(btrim(target_identity_type));
  normalized_value text;
begin
  if target_organization_id is null or normalized_type not in ('NAME','DOMAIN') then
    raise exception 'ANNEX_A_IDENTITY_INPUT_INVALID';
  end if;
  normalized_value:=case when normalized_type='NAME'
    then app.annex_a_normalize_name(target_identity_value)
    else app.annex_a_normalize_domain(target_identity_value) end;
  if nullif(normalized_value,'') is null then raise exception 'ANNEX_A_IDENTITY_INPUT_INVALID'; end if;

  select suppression_hmac_secret into runtime_secret
  from app.private_runtime_config where organization_id=target_organization_id;
  if not found or runtime_secret is null then raise exception 'SUPPRESSION_HMAC_SECRET_MISSING'; end if;

  return encode(hmac(
    convert_to(target_organization_id::text||':ANNEX_A:'||normalized_type||':'||normalized_value,'UTF8'),
    convert_to(runtime_secret,'UTF8'),'sha256'
  ),'hex');
end;
$$;

create or replace function app.annex_a_manifest_is_ready(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.suppression_manifests m
    where m.organization_id=target_organization_id
      and m.annex_id='ENNCO-ANNEX-A-2026-08-13'
      and m.snapshot_sha256='8e986eff74dee10d3f619f7562ee6b7d18207c3c5e080cd82656cc0e88d46af1'
      and m.scope_statement='ONLY_THESE_THREE_COMPANIES_AS_OF_CONFIRMATION'
      and m.entry_count=3 and m.alias_count=12 and m.domain_count=6
      and m.status='ACTIVE' and m.evidence_class='live'
      and (select count(*) from public.suppression_manifest_identities i
           where i.organization_id=m.organization_id and i.manifest_id=m.id and i.identity_type='NAME')=12
      and (select count(*) from public.suppression_manifest_identities i
           where i.organization_id=m.organization_id and i.manifest_id=m.id and i.identity_type='DOMAIN')=6
  )
$$;

create or replace function app.is_annex_a_account_suppressed(
  target_organization_id uuid,
  target_account_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = app, public, pg_temp
as $$
declare
  account_record public.accounts%rowtype;
begin
  if target_organization_id is null or target_account_id is null then return true; end if;
  if not app.annex_a_manifest_is_ready(target_organization_id) then return true; end if;

  select * into account_record from public.accounts
  where organization_id=target_organization_id and id=target_account_id and not is_deleted;
  if not found then return true; end if;

  return exists (
    select 1
    from public.suppression_manifest_identities i
    join public.suppression_manifests m
      on m.organization_id=i.organization_id and m.id=i.manifest_id and m.status='ACTIVE'
    where i.organization_id=target_organization_id and (
      (i.identity_type='DOMAIN' and account_record.primary_domain is not null
        and i.identity_hmac=app.annex_a_identity_hmac(target_organization_id,'DOMAIN',account_record.primary_domain))
      or
      (i.identity_type='NAME' and (
        i.identity_hmac=app.annex_a_identity_hmac(target_organization_id,'NAME',account_record.legal_name)
        or i.identity_hmac=app.annex_a_identity_hmac(target_organization_id,'NAME',account_record.normalized_name)
        or exists (
          select 1 from public.account_aliases aa
          where aa.organization_id=target_organization_id and aa.account_id=target_account_id
            and i.identity_hmac=app.annex_a_identity_hmac(target_organization_id,'NAME',aa.alias)
        )
      ))
    )
  );
exception when others then
  return true;
end;
$$;

create or replace function app.enforce_annex_a_enrollment_suppression()
returns trigger
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
begin
  if new.status in ('PENDING','ACTIVE','PAUSED')
    and app.is_annex_a_account_suppressed(new.organization_id,new.account_id)
  then
    new.status:='SUPPRESSED';
    new.stopped_reason:='ANNEX_A_MATCH';
    new.next_touch_at:=null;
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_enrollments_aaa_annex_a_suppression on public.campaign_enrollments;
create trigger campaign_enrollments_aaa_annex_a_suppression
before insert or update of organization_id,account_id,status on public.campaign_enrollments
for each row execute function app.enforce_annex_a_enrollment_suppression();

create or replace function app.enforce_annex_a_message_release()
returns trigger
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
begin
  if new.direction='OUTBOUND' and new.status<>'DRY_RUN'
    and not app.annex_a_manifest_is_ready(new.organization_id)
  then raise exception 'ANNEX_A_NOT_READY'; end if;
  return new;
end;
$$;

drop trigger if exists messages_aaa_m025_annex_a_release on public.messages;
create trigger messages_aaa_m025_annex_a_release
before insert or update of direction,status,organization_id on public.messages
for each row execute function app.enforce_annex_a_message_release();

create or replace function app.enforce_annex_a_provider_gate()
returns trigger
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
begin
  if new.gate_code='ANEXO_A_BOUND' and new.status='PASS' and new.evidence_class='live'
    and not app.annex_a_manifest_is_ready(new.organization_id)
  then raise exception 'ANNEX_A_PROVIDER_GATE_NOT_VERIFIED'; end if;
  return new;
end;
$$;

drop trigger if exists provider_activation_gates_annex_a_binding on public.provider_activation_gates;
create trigger provider_activation_gates_annex_a_binding
before insert or update of organization_id,gate_code,status,evidence_class on public.provider_activation_gates
for each row execute function app.enforce_annex_a_provider_gate();

create or replace function public.apply_annex_a_suppression_snapshot(
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
  if auth.uid() is null or coalesce(current_setting('request.jwt.claim.aal',true),'')<>'aal2'
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
$$;

alter table public.suppression_manifests enable row level security;
alter table public.suppression_manifest_identities enable row level security;
alter table public.suppression_manifest_commands enable row level security;

drop policy if exists suppression_manifests_member_read on public.suppression_manifests;
create policy suppression_manifests_member_read on public.suppression_manifests for select
  using (app.is_member(organization_id));
drop policy if exists suppression_manifest_commands_admin_read on public.suppression_manifest_commands;
create policy suppression_manifest_commands_admin_read on public.suppression_manifest_commands for select
  using (app.has_role(organization_id,array['ennco_admin','teckel_admin','auditor_readonly']::public.user_role[]));

revoke all on public.suppression_manifests,public.suppression_manifest_identities,
  public.suppression_manifest_commands from public,anon,authenticated,service_role;
grant select on public.suppression_manifests to authenticated;
grant select on public.suppression_manifest_commands to authenticated;

revoke all on function app.annex_a_normalize_name(text) from public,anon,authenticated,service_role;
revoke all on function app.annex_a_normalize_domain(text) from public,anon,authenticated,service_role;
revoke all on function app.annex_a_identity_hmac(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function app.annex_a_manifest_is_ready(uuid) from public,anon,authenticated,service_role;
revoke all on function app.is_annex_a_account_suppressed(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function app.enforce_annex_a_enrollment_suppression() from public,anon,authenticated,service_role;
revoke all on function app.enforce_annex_a_message_release() from public,anon,authenticated,service_role;
revoke all on function app.enforce_annex_a_provider_gate() from public,anon,authenticated,service_role;
revoke all on function public.apply_annex_a_suppression_snapshot(uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.apply_annex_a_suppression_snapshot(uuid,jsonb,text) to authenticated;

drop trigger if exists suppression_manifests_audit on public.suppression_manifests;
create trigger suppression_manifests_audit after insert or update or delete on public.suppression_manifests
for each row execute function app.capture_audit_event();
drop trigger if exists suppression_manifest_commands_audit on public.suppression_manifest_commands;
create trigger suppression_manifest_commands_audit after insert or update or delete on public.suppression_manifest_commands
for each row execute function app.capture_audit_event();

commit;
