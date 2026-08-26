begin;

-- M032 hybrid dispatch engine.
-- HMAC-proofed dispatcher surface over the M29 hybrid outbound contract:
-- heartbeat, claim, settle, credential broker read, outbox/provider wrappers,
-- dispatch tick ledger, and the FAILED/QUARANTINED transition amendments on the
-- M20/M22 send-health triggers.
-- NOTE: this migration deliberately does NOT redefine any object created by
-- migrations 029/030/031 - their gate runners apply the full migration chain
-- and re-apply themselves after rollback, so any M032 change to their objects
-- would regress their schema diffs. The envelope contract (design point F)
-- therefore lives in a new trigger on hybrid_outbound_release_enrollments and
-- the M29 message trigger stays untouched (see settle fallback below).

-- A. dispatch secret alongside the other per-organization runtime secrets.
alter table app.private_runtime_config
  add column if not exists dispatch_secret text;
alter table app.private_runtime_config
  drop constraint if exists private_runtime_config_dispatch_secret_check;
alter table app.private_runtime_config
  add constraint private_runtime_config_dispatch_secret_check
  check (dispatch_secret is null or length(dispatch_secret) >= 32);

-- B. dispatch tick ledger.
create table if not exists public.hybrid_dispatch_ticks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tick_kind text not null check (tick_kind in ('HEARTBEAT','CLAIM','SETTLE','OUTBOX','OBSERVATION','HEALTH','CREDENTIAL')),
  correlation_id uuid not null default gen_random_uuid(),
  message_id uuid,
  release_id uuid,
  outcome text not null check (outcome ~ '^[A-Z0-9_]{2,80}$'),
  detail_json jsonb not null default '{}'::jsonb,
  idempotency_key_sha256 text check (idempotency_key_sha256 is null or idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id,id),
  constraint hybrid_dispatch_ticks_message_tenant_fkey
    foreign key (organization_id,message_id) references public.messages(organization_id,id),
  constraint hybrid_dispatch_ticks_release_tenant_fkey
    foreign key (organization_id,release_id) references public.hybrid_outbound_releases(organization_id,id)
);

create unique index if not exists hybrid_dispatch_ticks_idempotency_unique
on public.hybrid_dispatch_ticks(organization_id,idempotency_key_sha256)
where idempotency_key_sha256 is not null;

create index if not exists hybrid_dispatch_ticks_recent_idx
on public.hybrid_dispatch_ticks(organization_id,created_at desc);

alter table public.hybrid_dispatch_ticks enable row level security;
alter table public.hybrid_dispatch_ticks force row level security;
drop policy if exists hybrid_dispatch_ticks_member_read on public.hybrid_dispatch_ticks;
create policy hybrid_dispatch_ticks_member_read on public.hybrid_dispatch_ticks
for select to authenticated using (app.is_member(organization_id));
revoke all on table public.hybrid_dispatch_ticks from public,anon,authenticated,service_role;
grant select on table public.hybrid_dispatch_ticks to authenticated;

comment on table public.hybrid_dispatch_ticks is
'M032 append-only ledger of hybrid dispatcher activity. Written exclusively by the dispatch RPCs (SECURITY DEFINER); direct DML is revoked for every role.';

create or replace function app.record_hybrid_dispatch_tick(
  target_organization_id uuid,
  target_tick_kind text,
  target_command_id text,
  target_correlation_id uuid,
  target_message_id uuid,
  target_release_id uuid,
  target_outcome text,
  target_detail jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  tick_id uuid;
begin
  insert into public.hybrid_dispatch_ticks(
    organization_id,tick_kind,correlation_id,message_id,release_id,outcome,detail_json,idempotency_key_sha256
  ) values (
    target_organization_id,target_tick_kind,coalesce(target_correlation_id,gen_random_uuid()),
    target_message_id,target_release_id,target_outcome,coalesce(target_detail,'{}'::jsonb),
    encode(digest(convert_to('hybrid-dispatch-tick:'||target_tick_kind||':'||coalesce(target_command_id,''),'utf8'),'sha256'),'hex')
  )
  on conflict (organization_id,idempotency_key_sha256) where idempotency_key_sha256 is not null
  do nothing
  returning id into tick_id;
  return tick_id;
end $$;

comment on function app.record_hybrid_dispatch_tick(uuid,text,text,uuid,uuid,uuid,text,jsonb) is
'M032 internal tick writer. Idempotent per (tick_kind, proof command_id): a retried command re-uses its command_id and lands on the same ledger row.';

-- C. HMAC dispatch proof (pattern: capture_gmail_push_notification, M06) against dispatch_secret.
create or replace function app.verify_dispatch_proof(
  target_organization_id uuid,
  target_command_id text,
  target_proof_nonce uuid,
  target_proof_expires_at timestamptz,
  target_payload_sha256 text,
  target_proof_hmac text
)
returns void
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  runtime_secret text;
  signed_value text;
  expected_signature text;
begin
  if target_organization_id is null
    or target_proof_nonce is null
    or target_proof_expires_at is null
    or target_command_id is null
    or target_command_id !~ '^[A-Za-z0-9_.:-]{8,200}$'
    or target_payload_sha256 !~ '^[a-f0-9]{64}$'
    or target_proof_hmac !~ '^[a-f0-9]{64}$'
  then
    raise exception 'DISPATCH_PROOF_INVALID';
  end if;
  select dispatch_secret into runtime_secret
  from app.private_runtime_config
  where organization_id=target_organization_id;
  if not found or runtime_secret is null then raise exception 'DISPATCH_SECRET_NOT_CONFIGURED'; end if;
  if target_proof_expires_at <= clock_timestamp() then raise exception 'DISPATCH_PROOF_EXPIRED'; end if;
  if target_proof_expires_at > now() + interval '10 minutes' then raise exception 'DISPATCH_PROOF_EXPIRY_TOO_FAR'; end if;
  signed_value := concat_ws(E'\n',
    target_organization_id::text,
    target_command_id,
    target_proof_nonce::text,
    to_char(target_proof_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    target_payload_sha256
  );
  expected_signature := encode(
    app.hmac(convert_to(signed_value,'UTF8'),convert_to(runtime_secret,'UTF8'),'sha256'),
    'hex'
  );
  if digest(target_proof_hmac,'sha256') <> digest(expected_signature,'sha256') then
    raise exception 'DISPATCH_PROOF_SIGNATURE_INVALID';
  end if;
  begin
    insert into public.public_prequote_nonces(organization_id,request_nonce,request_expires_at)
    values (target_organization_id,target_proof_nonce,target_proof_expires_at);
  exception
    when unique_violation then raise exception 'DISPATCH_PROOF_REPLAY_REJECTED';
  end;
end $$;

comment on function app.verify_dispatch_proof(uuid,text,uuid,timestamptz,text,text) is
'M032 HMAC proof check for dispatch RPCs. signed_value = concat_ws(newline, organization_id, command_id, nonce, expires_at UTC as YYYY-MM-DD"T"HH24:MI:SS"Z", payload_sha256); hmac-sha256 with app.private_runtime_config.dispatch_secret; constant-time compare; single-use nonce via public_prequote_nonces.';

-- Send window helper (deterministic, unit-testable).
create or replace function app.hybrid_dispatch_window_is_open(target_at timestamptz)
returns boolean
language sql
stable
set search_path=pg_catalog
as $$
  select extract(isodow from (target_at at time zone 'America/Mexico_City')) between 1 and 5
    and (target_at at time zone 'America/Mexico_City')::time >= time '09:30'
    and (target_at at time zone 'America/Mexico_City')::time < time '13:30'
$$;

comment on function app.hybrid_dispatch_window_is_open(timestamptz) is
'M032 dispatch send window: Monday-Friday 09:30-13:30 America/Mexico_City. Pure function of its argument so the gate can unit-test the bounds.';

create or replace function app.hybrid_dispatch_noop(
  target_organization_id uuid,
  target_tick_kind text,
  target_command_id text,
  target_reason text,
  target_message_id uuid,
  target_release_id uuid,
  target_detail jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
begin
  perform app.record_hybrid_dispatch_tick(
    target_organization_id,target_tick_kind,target_command_id,gen_random_uuid(),
    target_message_id,target_release_id,'NOOP',
    jsonb_build_object('reason',target_reason)||coalesce(target_detail,'{}'::jsonb)
  );
  return jsonb_strip_nulls(jsonb_build_object(
    'status','NOOP','reason',target_reason,'message_id',target_message_id,'release_id',target_release_id
  ))||coalesce(target_detail,'{}'::jsonb);
end $$;

create or replace function app.hybrid_dispatch_active_release(target_organization_id uuid)
returns public.hybrid_outbound_releases
language sql
stable
security definer
set search_path=public,app,pg_temp
as $$
  select hr.*
  from public.hybrid_outbound_releases hr
  join public.mailboxes m on m.organization_id=hr.organization_id and m.id=hr.mailbox_id
  where hr.organization_id=target_organization_id
    and m.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP'
    and hr.status in ('READY_FOR_CANARY','CANARY_ACTIVE','SCALE_ALLOWED')
    and hr.scheduled_for<=clock_timestamp() and hr.expires_at>clock_timestamp()
  order by hr.approved_at desc
  limit 1
$$;

-- E. Monotonic live observation feed (pattern: record_hybrid_mailbox_observation, M29).
-- The M29 RPC requires an authenticated operator (auth.uid()), so the dispatcher
-- cannot reuse it directly; this internal function replicates its monotonic and
-- idempotent contract and records evidence_class='live' on behalf of the release approver.
create or replace function app.record_hybrid_dispatch_observation(
  target_organization_id uuid,
  target_mailbox_id uuid,
  target_deltas jsonb,
  target_evidence_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  previous_observation public.hybrid_mailbox_observations%rowtype;
  delta_attempted integer := coalesce((target_deltas->>'attempted_deliveries')::integer,0);
  delta_valid integer := coalesce((target_deltas->>'valid_deliveries')::integer,0);
  delta_bounces integer := coalesce((target_deltas->>'hard_bounces')::integer,0);
  delta_complaints integer := coalesce((target_deltas->>'spam_complaints')::integer,0);
  new_attempted integer; new_valid integer; new_bounces integer; new_complaints integer;
  observed_at_value timestamptz := clock_timestamp();
  recorded_by_value uuid;
  delta_signature text;
  idempotency_value text;
  observation_id uuid;
begin
  if target_deltas is null or jsonb_typeof(target_deltas)<>'object'
    or delta_attempted<0 or delta_valid<0 or delta_bounces<0 or delta_complaints<0
    or delta_attempted+delta_valid+delta_bounces+delta_complaints=0
    or target_evidence_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'HYBRID_DISPATCH_OBSERVATION_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':hybrid-observation:'||target_mailbox_id::text,0));
  select * into previous_observation from public.hybrid_mailbox_observations
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id
  order by observed_at desc limit 1 for update;

  new_attempted := coalesce(previous_observation.attempted_deliveries,0)+delta_attempted;
  new_valid := coalesce(previous_observation.valid_deliveries,0)+delta_valid;
  new_bounces := coalesce(previous_observation.hard_bounces,0)+delta_bounces;
  new_complaints := coalesce(previous_observation.spam_complaints,0)+delta_complaints;
  if new_valid>new_attempted or new_bounces>new_attempted or new_complaints>new_attempted then
    return jsonb_build_object('status','SKIPPED','reason','MONOTONIC_GUARD');
  end if;
  select hr.approved_by into recorded_by_value
  from public.hybrid_outbound_releases hr
  where hr.organization_id=target_organization_id and hr.mailbox_id=target_mailbox_id
  order by case when hr.status in ('READY_FOR_CANARY','CANARY_ACTIVE','SCALE_ALLOWED') then 0 else 1 end,
    hr.approved_at desc
  limit 1;
  if recorded_by_value is null then
    return jsonb_build_object('status','SKIPPED','reason','NO_RELEASE_FOR_OBSERVATION');
  end if;
  if previous_observation.id is not null and observed_at_value<=previous_observation.observed_at then
    observed_at_value := previous_observation.observed_at + interval '1 millisecond';
  end if;
  delta_signature := coalesce((
    select string_agg(entry.key||'='||entry.value,',' order by entry.key)
    from jsonb_each_text(target_deltas) entry
  ),'none');
  idempotency_value := encode(digest(convert_to(
    'hybrid-dispatch-observation:'||target_mailbox_id::text
    ||':'||to_char(clock_timestamp() at time zone 'America/Mexico_City','YYYY-MM-DD')
    ||':'||delta_signature
    ||':'||target_evidence_sha256,'utf8'),'sha256'),'hex');
  insert into public.hybrid_mailbox_observations(
    organization_id,mailbox_id,valid_deliveries,attempted_deliveries,hard_bounces,spam_complaints,delivery_rate,
    reply_sync_p95_seconds,positive_reply_sla_breaches,provider_reconciled,suppression_reconciled,
    identity_unambiguous,evidence_sha256,evidence_class,observed_at,idempotency_key_sha256,recorded_by
  ) values (
    target_organization_id,target_mailbox_id,new_valid,new_attempted,new_bounces,new_complaints,
    case when new_attempted=0 then null else round(new_valid::numeric/new_attempted::numeric,6) end,
    previous_observation.reply_sync_p95_seconds,
    coalesce(previous_observation.positive_reply_sla_breaches,0),
    coalesce(previous_observation.provider_reconciled,false),
    coalesce(previous_observation.suppression_reconciled,false),
    coalesce(previous_observation.identity_unambiguous,false),
    target_evidence_sha256,'live',observed_at_value,idempotency_value,recorded_by_value
  )
  on conflict (organization_id,idempotency_key_sha256) do nothing
  returning id into observation_id;
  if observation_id is null then
    return jsonb_build_object('status','DUPLICATE');
  end if;
  return jsonb_build_object(
    'status','RECORDED','observation_id',observation_id,
    'attempted_deliveries',new_attempted,'valid_deliveries',new_valid,
    'hard_bounces',new_bounces,'spam_complaints',new_complaints
  );
end $$;

comment on function app.record_hybrid_dispatch_observation(uuid,uuid,jsonb,text) is
'M032 internal monotonic observation feed: adds non-negative deltas on top of the latest M29 observation (never decrements), evidence_class=live, recorded_by = approver of the mailbox release. Idempotent per (mailbox, CDMX day, delta signature, evidence).';

-- F. Envelope clear-text contract for dispatch-engine releases.
-- Implemented as a trigger on hybrid_outbound_release_enrollments instead of an
-- amendment to create_hybrid_outbound_release: the M29 gate runner re-applies
-- migration 029 (which recreates that RPC verbatim) and diffs the schema, so the
-- RPC body must stay 029-owned. The contract only applies when the campaign
-- manifest opts in with {"hybrid":{"dispatch_engine":true}} - pre-M032 releases
-- (including the M29 gate fixture) keep their original contract, and the claim
-- RPC refuses to dispatch campaigns without the flag.
create or replace function app.enforce_hybrid_dispatch_envelope_contract()
returns trigger
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  release_record public.hybrid_outbound_releases%rowtype;
  campaign_record public.campaigns%rowtype;
  envelope jsonb;
  touch_value integer;
  subject_value text;
  body_value text;
begin
  select * into release_record from public.hybrid_outbound_releases
  where organization_id=new.organization_id and id=new.release_id;
  if not found then return new; end if;
  select * into campaign_record from public.campaigns
  where organization_id=new.organization_id and id=release_record.campaign_id;
  if not found or campaign_record.manifest_json#>'{hybrid,dispatch_engine}' is distinct from to_jsonb(true) then
    return new;
  end if;
  for touch_value in 1..3 loop
    select e.envelope into envelope
    from jsonb_array_elements(coalesce(campaign_record.manifest_json#>'{hybrid,envelopes}','[]'::jsonb)) e(envelope)
    where e.envelope->>'enrollment_id'=new.enrollment_id::text
      and (e.envelope->>'touch_number')::integer=touch_value
    limit 1;
    if envelope is null then raise exception 'HYBRID_ENVELOPE_TEXT_MISSING'; end if;
    subject_value := envelope->>'subject';
    body_value := envelope->>'body_text';
    if subject_value is null or body_value is null
      or nullif(btrim(subject_value),'') is null or nullif(btrim(body_value),'') is null then
      raise exception 'HYBRID_ENVELOPE_TEXT_MISSING';
    end if;
    if encode(digest(subject_value,'sha256'),'hex') is distinct from envelope->>'subject_sha256'
      or encode(digest(body_value,'sha256'),'hex') is distinct from envelope->>'body_sha256' then
      raise exception 'HYBRID_ENVELOPE_HASH_MISMATCH';
    end if;
    if body_value ~ '<[^>]+>' then raise exception 'HYBRID_ENVELOPE_HTML_FORBIDDEN'; end if;
    if cardinality(regexp_split_to_array(btrim(body_value),'\s+'))>100 then
      raise exception 'HYBRID_ENVELOPE_BODY_TOO_LONG';
    end if;
    if touch_value=1 and (subject_value||' '||body_value) ~* '(<a\s|https?://)' then
      raise exception 'HYBRID_ENVELOPE_TOUCH1_LINK_FORBIDDEN';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists hybrid_release_enrollments_aaa_m032_envelope_contract on public.hybrid_outbound_release_enrollments;
create trigger hybrid_release_enrollments_aaa_m032_envelope_contract
before insert on public.hybrid_outbound_release_enrollments
for each row execute function app.enforce_hybrid_dispatch_envelope_contract();

comment on function app.enforce_hybrid_dispatch_envelope_contract() is
'M032 design point F: for dispatch-engine campaigns ({hybrid,dispatch_engine}=true) every release enrollment must carry clear-text subject/body_text for touches 1..3 whose sha256 match subject_sha256/body_sha256, body <=100 words, no HTML tags, and no links or anchors on touch 1.';

-- G. Send-health amendments (M20 + M22 trigger functions, original bodies preserved).
-- A legal transition to FAILED (from QUEUED/SENDING) or QUARANTINED (from
-- QUEUED/SENDING/FAILED) must not be blocked by operations/cadence health: a dead
-- mailbox has to be able to record the failure. Transitions toward SENT/DELIVERED
-- are never exempted. The equivalent early-return on the M29 hybrid trigger is
-- intentionally NOT applied (029 runner re-applies that function verbatim); the
-- settle RPC compensates with a ledgered fallback when M29-level checks block.
create or replace function app.enforce_operations_send_health()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare latest public.operations_watchdog_runs%rowtype;
begin
  if new.direction<>'OUTBOUND' or new.status='DRY_RUN' or (tg_op='UPDATE' and new.status is not distinct from old.status) then return new; end if;
  if tg_op='UPDATE' and (
    (new.status='FAILED' and old.status in ('QUEUED','SENDING'))
    or (new.status='QUARANTINED' and old.status in ('QUEUED','SENDING','FAILED'))
  ) then return new; end if;
  select * into latest from public.operations_watchdog_runs
  where organization_id=new.organization_id order by evaluated_at desc limit 1;
  if latest.id is null or latest.evaluated_at<clock_timestamp()-interval '5 minutes' or latest.status<>'HEALTHY' then
    raise exception 'OPERATIONS_HEALTH_NOT_HEALTHY';
  end if;
  if not app.operations_assignment_is_active(new.organization_id) then
    raise exception 'OPERATIONS_ASSIGNMENT_NOT_ACTIVE';
  end if;
  if exists(select 1 from public.incidents where organization_id=new.organization_id and severity in ('P0','P1') and status not in ('RESOLVED','REVIEWED')) then
    raise exception 'OPERATIONS_INCIDENT_SEND_HOLD';
  end if;
  return new;
end $$;

create or replace function app.enforce_control_cadence_send_health()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare health jsonb;
begin
  if new.direction<>'OUTBOUND' or new.status='DRY_RUN' or (tg_op='UPDATE' and new.status is not distinct from old.status) then return new; end if;
  if tg_op='UPDATE' and (
    (new.status='FAILED' and old.status in ('QUEUED','SENDING'))
    or (new.status='QUARANTINED' and old.status in ('QUEUED','SENDING','FAILED'))
  ) then return new; end if;
  select app.evaluate_control_cadence_health_as_system(new.organization_id,clock_timestamp()) into health;
  if health->>'state'<>'HEALTHY' or health->>'outbound_release'<>'ALLOWED' then raise exception 'CONTROL_CADENCE_HEALTH_NOT_HEALTHY'; end if;
  return new;
end $$;

-- D1. Heartbeat: watchdog + cadence reconciler + cadence heartbeat watchdog in one
-- proof-guarded call, idempotent per deterministic 5-minute CDMX bucket.
create or replace function public.run_dispatch_heartbeat(
  target_organization_id uuid,
  proof_command_id text,
  proof_nonce uuid,
  proof_expires_at timestamptz,
  proof_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  payload_sha text;
  local_now timestamp;
  bucket_key text;
  bucket_start timestamptz;
  watchdog_result jsonb;
  reconciler_result jsonb;
  heartbeat_result jsonb;
  cadence_read_model jsonb;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n',
    'run_dispatch_heartbeat',target_organization_id::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  local_now := clock_timestamp() at time zone 'America/Mexico_City';
  bucket_key := 'dispatch-hb:'||to_char(local_now,'YYYY-MM-DD-HH24-')
    ||lpad((floor(extract(minute from local_now)::numeric/5)*5)::text,2,'0');
  bucket_start := (date_trunc('hour',local_now)
    +make_interval(mins=>(floor(extract(minute from local_now)::numeric/5)*5)::integer)) at time zone 'America/Mexico_City';
  watchdog_result := app.run_operations_watchdog(
    target_organization_id,bucket_start,
    encode(digest(convert_to(bucket_key||':operations-watchdog','utf8'),'sha256'),'hex'));
  reconciler_result := app.run_control_cadence_reconciler(
    target_organization_id,bucket_start,
    encode(digest(convert_to(bucket_key||':cadence-reconciler','utf8'),'sha256'),'hex'));
  heartbeat_result := app.run_control_cadence_heartbeat_watchdog(
    target_organization_id,bucket_start,
    encode(digest(convert_to(bucket_key||':cadence-heartbeat','utf8'),'sha256'),'hex'));
  cadence_read_model := app.evaluate_control_cadence_health_as_system(target_organization_id,clock_timestamp());
  perform app.record_hybrid_dispatch_tick(
    target_organization_id,'HEARTBEAT',proof_command_id,gen_random_uuid(),null,null,
    coalesce(watchdog_result->>'status','UNKNOWN'),
    jsonb_build_object(
      'bucket',bucket_key,
      'operations_status',watchdog_result->>'status',
      'reconciler_state',reconciler_result->>'state',
      'heartbeat_state',heartbeat_result->>'state'
    ));
  return jsonb_build_object(
    'status','HEARTBEAT',
    'operations_health',watchdog_result,
    'cadence_health',jsonb_build_object(
      'reconciler',reconciler_result,
      'heartbeat_watchdog',heartbeat_result,
      'read_model',cadence_read_model
    ),
    'evaluated_at',bucket_start
  );
end $$;

comment on function public.run_dispatch_heartbeat(uuid,text,uuid,timestamptz,text) is
'M032 dispatcher heartbeat. Proof payload = sha256(concat_ws(newline, run_dispatch_heartbeat, organization_id)). Runs app.run_operations_watchdog + app.run_control_cadence_reconciler + app.run_control_cadence_heartbeat_watchdog with deterministic idempotency keys per 5-minute America/Mexico_City bucket (replays within a bucket return the recorded responses).';

-- D2. Claim: single-flight envelope claim for the primary Gmail ramp release.
create or replace function public.claim_hybrid_dispatch(
  target_organization_id uuid,
  dry_run boolean,
  proof_command_id text,
  proof_nonce uuid,
  proof_expires_at timestamptz,
  proof_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  payload_sha text;
  controls_record public.runtime_controls%rowtype;
  release_record public.hybrid_outbound_releases%rowtype;
  campaign_record public.campaigns%rowtype;
  sent_count integer;
  budget integer;
  stuck_message_id uuid;
  last_outbound_at timestamptz;
  pace_seconds integer;
  candidate record;
  attempt_value integer;
  idempotency_value text;
  correlation_value uuid := gen_random_uuid();
  message_id_value uuid;
  message_status public.message_status;
  thread_info jsonb;
begin
  if dry_run is null then raise exception 'DISPATCH_CLAIM_INPUT_INVALID'; end if;
  payload_sha := encode(digest(convert_to(concat_ws(E'\n',
    'claim_hybrid_dispatch',target_organization_id::text,dry_run::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  perform pg_advisory_xact_lock(hashtextextended('hybrid-dispatch:'||target_organization_id::text,0));

  if not dry_run then
    select * into controls_record from public.runtime_controls where organization_id=target_organization_id;
    if not found or controls_record.global_kill_switch or not controls_record.external_send_allowed then
      return app.hybrid_dispatch_noop(target_organization_id,'CLAIM',proof_command_id,'RUNTIME_HOLD',null,null,null);
    end if;
    if not app.hybrid_dispatch_window_is_open(clock_timestamp()) then
      return app.hybrid_dispatch_noop(target_organization_id,'CLAIM',proof_command_id,'OUTSIDE_SEND_WINDOW',null,null,null);
    end if;
  end if;

  release_record := app.hybrid_dispatch_active_release(target_organization_id);
  if release_record.id is null then
    return app.hybrid_dispatch_noop(target_organization_id,'CLAIM',proof_command_id,'NO_ACTIVE_RELEASE',null,null,null);
  end if;
  select * into campaign_record from public.campaigns
  where organization_id=target_organization_id and id=release_record.campaign_id;
  if campaign_record.manifest_json#>'{hybrid,dispatch_engine}' is distinct from to_jsonb(true) then
    return app.hybrid_dispatch_noop(target_organization_id,'CLAIM',proof_command_id,'DISPATCH_ENGINE_NOT_ENABLED',null,release_record.id,null);
  end if;

  select count(*) into sent_count from public.messages
  where organization_id=target_organization_id and mailbox_id=release_record.mailbox_id and direction='OUTBOUND'
    and status in ('QUEUED','SENDING','SENT','DELIVERED')
    and (created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date;
  budget := release_record.daily_cap_snapshot-sent_count;
  if budget<=0 then
    return app.hybrid_dispatch_noop(target_organization_id,'CLAIM',proof_command_id,'BUDGET_EXHAUSTED',null,release_record.id,
      jsonb_build_object('sent_today',sent_count,'daily_cap',release_record.daily_cap_snapshot));
  end if;

  select id into stuck_message_id from public.messages
  where organization_id=target_organization_id and mailbox_id=release_record.mailbox_id
    and direction='OUTBOUND' and status='SENDING'
    and updated_at<clock_timestamp()-interval '10 minutes'
  order by updated_at limit 1;
  if stuck_message_id is not null then
    return app.hybrid_dispatch_noop(target_organization_id,'CLAIM',proof_command_id,'STUCK_SENDING_REQUIRES_RECONCILE',stuck_message_id,release_record.id,null);
  end if;

  if not dry_run then
    select max(created_at) into last_outbound_at from public.messages
    where organization_id=target_organization_id and mailbox_id=release_record.mailbox_id and direction='OUTBOUND'
      and status in ('QUEUED','SENDING','SENT','DELIVERED')
      and (created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date;
    if last_outbound_at is not null then
      pace_seconds := 2100+mod(abs(hashtextextended(
        to_char(clock_timestamp() at time zone 'America/Mexico_City','YYYY-MM-DD')||':'||sent_count::text,0)),900)::integer;
      if last_outbound_at>clock_timestamp()-make_interval(secs=>pace_seconds) then
        return app.hybrid_dispatch_noop(target_organization_id,'CLAIM',proof_command_id,'PACING_HOLD',null,release_record.id,
          jsonb_build_object('next_eligible_at',last_outbound_at+make_interval(secs=>pace_seconds)));
      end if;
    end if;
  end if;

  select * into candidate from (
    select
      (e.envelope->>'touch_number')::integer as touch_value,
      e.ord as manifest_position,
      e.envelope->>'subject' as subject_value,
      e.envelope->>'body_text' as body_value,
      hre.enrollment_id as enrollment_id_value,
      ce.status as enrollment_status,
      ce.next_touch_number as next_touch_value,
      ce.sequence_version_id as sequence_version_id_value,
      c.normalized_email as contact_email,
      a.id as account_id_value,
      a.primary_domain as account_domain
    from jsonb_array_elements(coalesce(campaign_record.manifest_json#>'{hybrid,envelopes}','[]'::jsonb)) with ordinality e(envelope,ord)
    join public.hybrid_outbound_release_enrollments hre
      on hre.organization_id=target_organization_id and hre.release_id=release_record.id
      and hre.enrollment_id::text=e.envelope->>'enrollment_id'
    join public.campaign_enrollments ce on ce.organization_id=target_organization_id and ce.id=hre.enrollment_id
    join public.contacts c on c.organization_id=target_organization_id and c.id=hre.contact_id
    join public.accounts a on a.organization_id=target_organization_id and a.id=hre.account_id
  ) cand
  where cand.touch_value between 1 and 3
    and cand.subject_value is not null and cand.body_value is not null
    and ((cand.touch_value=1 and cand.enrollment_status in ('PENDING','ACTIVE'))
      or (cand.touch_value>1 and cand.enrollment_status='ACTIVE'))
    and (dry_run or cand.next_touch_value=cand.touch_value)
    and exists (
      select 1 from public.sequence_touches st
      where st.organization_id=target_organization_id
        and st.sequence_version_id=cand.sequence_version_id_value and st.touch_number=cand.touch_value
    )
    and not exists (
      select 1 from public.messages m2
      where m2.organization_id=target_organization_id and m2.enrollment_id=cand.enrollment_id_value
        and m2.direction='OUTBOUND' and m2.touch_number=cand.touch_value
        and (case when dry_run then m2.status<>'FAILED' else m2.status not in ('FAILED','DRY_RUN') end)
    )
    and (cand.touch_value=1 or exists (
      select 1
      from public.messages pm
      join public.sequence_touches st_cur
        on st_cur.organization_id=target_organization_id
        and st_cur.sequence_version_id=cand.sequence_version_id_value and st_cur.touch_number=cand.touch_value
      join public.sequence_touches st_prev
        on st_prev.organization_id=target_organization_id
        and st_prev.sequence_version_id=cand.sequence_version_id_value and st_prev.touch_number=cand.touch_value-1
      where pm.organization_id=target_organization_id and pm.enrollment_id=cand.enrollment_id_value
        and pm.direction='OUTBOUND' and pm.touch_number=cand.touch_value-1
        and pm.status in ('SENT','DELIVERED') and pm.sent_at is not null
        and pm.sent_at<=clock_timestamp()-make_interval(days=>greatest(0,st_cur.day_offset-st_prev.day_offset))
    ))
    and not app.is_suppressed(target_organization_id,cand.account_id_value,cand.contact_email,cand.account_domain)
  order by cand.touch_value desc,cand.manifest_position
  limit 1;
  if candidate is null or candidate.enrollment_id_value is null then
    return app.hybrid_dispatch_noop(target_organization_id,'CLAIM',proof_command_id,'NO_ELIGIBLE_ENVELOPE',null,release_record.id,null);
  end if;

  select count(*)+1 into attempt_value from public.messages
  where organization_id=target_organization_id and enrollment_id=candidate.enrollment_id_value
    and direction='OUTBOUND' and touch_number=candidate.touch_value and status='FAILED';
  idempotency_value := 'hybrid-dispatch:'||release_record.id::text||':'||candidate.enrollment_id_value::text
    ||':t'||candidate.touch_value::text||':a'||attempt_value::text
    ||case when dry_run then ':shadow' else '' end;

  if not dry_run and candidate.enrollment_status='PENDING' then
    update public.campaign_enrollments set status='ACTIVE',updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=candidate.enrollment_id_value and status='PENDING';
  end if;

  message_id_value := app.enqueue_outbound_message(
    target_organization_id,candidate.enrollment_id_value,candidate.touch_value,
    candidate.subject_value,candidate.body_value,idempotency_value,correlation_value,dry_run);
  if message_id_value is null then
    return app.hybrid_dispatch_noop(target_organization_id,'CLAIM',proof_command_id,'SUPPRESSED',null,release_record.id,
      jsonb_build_object('enrollment_id',candidate.enrollment_id_value));
  end if;

  if not dry_run then
    update public.messages set status='SENDING'
    where organization_id=target_organization_id and id=message_id_value and status='QUEUED';
    select status into message_status from public.messages
    where organization_id=target_organization_id and id=message_id_value;
    if message_status<>'SENDING' then raise exception 'DISPATCH_CLAIM_TRANSITION_FAILED'; end if;
  end if;

  if candidate.touch_value>1 then
    select jsonb_strip_nulls(jsonb_build_object(
      'previous_message_id',pm.id,
      'previous_provider_message_id',pm.provider_message_id,
      'previous_subject',pm.subject,
      'provider_thread_id',(
        select t.detail_json->>'provider_thread_id' from public.hybrid_dispatch_ticks t
        where t.organization_id=target_organization_id and t.tick_kind='SETTLE'
          and t.message_id=pm.id and t.detail_json ? 'provider_thread_id'
        order by t.created_at desc limit 1
      )
    )) into thread_info
    from public.messages pm
    where pm.organization_id=target_organization_id and pm.enrollment_id=candidate.enrollment_id_value
      and pm.direction='OUTBOUND' and pm.touch_number=candidate.touch_value-1
      and pm.status in ('SENT','DELIVERED')
    order by pm.sent_at desc limit 1;
  end if;

  perform app.record_hybrid_dispatch_tick(
    target_organization_id,'CLAIM',proof_command_id,correlation_value,message_id_value,release_record.id,
    case when dry_run then 'CLAIMED_DRY_RUN' else 'CLAIMED' end,
    jsonb_build_object(
      'enrollment_id',candidate.enrollment_id_value,
      'touch_number',candidate.touch_value,
      'attempt',attempt_value,
      'dry_run',dry_run,
      'subject_sha256',encode(digest(candidate.subject_value,'sha256'),'hex'),
      'body_sha256',encode(digest(candidate.body_value,'sha256'),'hex')
    ));

  return jsonb_build_object(
    'status','CLAIMED','dry_run',dry_run,
    'message_id',message_id_value,'release_id',release_record.id,
    'mailbox_id',release_record.mailbox_id,
    'manifest_sha256',release_record.manifest_sha256,
    'touch_number',candidate.touch_value,'to_email',candidate.contact_email,
    'subject',candidate.subject_value,'body_text',candidate.body_value,
    'thread_info',thread_info,'attempt',attempt_value,'correlation_id',correlation_value
  );
end $$;

comment on function public.claim_hybrid_dispatch(uuid,boolean,text,uuid,timestamptz,text) is
'M032 dispatcher claim. Proof payload = sha256(concat_ws(newline, claim_hybrid_dispatch, organization_id, dry_run)). Serialized per organization by advisory lock; real claims require open runtime controls, the Mon-Fri 09:30-13:30 CDMX window, budget, no stuck SENDING, and 35min+deterministic-jitter pacing. dry_run=true is the shadow lane: no runtime/window/pacing requirements and the message stays DRY_RUN.';

-- D3. Settle: SENT/FAILED terminal outcomes for a claimed message.
create or replace function public.settle_hybrid_dispatch(
  target_organization_id uuid,
  target_message_id uuid,
  target_outcome text,
  target_provider_message_id text,
  target_provider_thread_id text,
  target_error_code text,
  proof_command_id text,
  proof_nonce uuid,
  proof_expires_at timestamptz,
  proof_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  payload_sha text;
  message_record public.messages%rowtype;
  release_record public.hybrid_outbound_releases%rowtype;
  observation_result jsonb;
  attempt_count integer;
  blocked_reason text;
  dispatch_blockers constant text[] := array[
    'HYBRID_MAILBOX_NOT_READY','HYBRID_RUNTIME_HOLD','HYBRID_RELEASE_NOT_BOUND',
    'HYBRID_ENROLLMENT_NOT_ACTIVE','HYBRID_RECIPIENT_NOT_ELIGIBLE',
    'HYBRID_RENDERED_MESSAGE_MANIFEST_DRIFT','HYBRID_RELEASE_REFERENCE_REQUIRED',
    'ANNEX_A_NOT_READY','OPERATIONS_HEALTH_NOT_HEALTHY','OPERATIONS_ASSIGNMENT_NOT_ACTIVE',
    'OPERATIONS_INCIDENT_SEND_HOLD','CONTROL_CADENCE_HEALTH_NOT_HEALTHY'
  ];
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n',
    'settle_hybrid_dispatch',target_organization_id::text,target_message_id::text,coalesce(target_outcome,''),
    coalesce(target_provider_message_id,''),coalesce(target_provider_thread_id,''),coalesce(target_error_code,'')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  if target_outcome not in ('SENT','FAILED') then raise exception 'DISPATCH_SETTLE_OUTCOME_INVALID'; end if;
  if target_provider_message_id is not null and length(target_provider_message_id) not between 1 and 512 then
    raise exception 'DISPATCH_SETTLE_INPUT_INVALID';
  end if;
  if target_provider_thread_id is not null and length(target_provider_thread_id) not between 1 and 512 then
    raise exception 'DISPATCH_SETTLE_INPUT_INVALID';
  end if;
  if target_error_code is not null and target_error_code !~ '^[A-Z0-9_]{2,80}$' then
    raise exception 'DISPATCH_SETTLE_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hybrid-dispatch:'||target_organization_id::text,0));
  select * into message_record from public.messages
  where organization_id=target_organization_id and id=target_message_id and direction='OUTBOUND'
  for update;
  if not found then raise exception 'DISPATCH_SETTLE_MESSAGE_NOT_FOUND'; end if;
  if message_record.enrollment_id is null or message_record.mailbox_id is null then
    raise exception 'DISPATCH_SETTLE_NOT_HYBRID';
  end if;
  select hr.* into release_record
  from public.hybrid_outbound_releases hr
  join public.hybrid_outbound_release_enrollments hre
    on hre.organization_id=hr.organization_id and hre.release_id=hr.id
  where hr.organization_id=target_organization_id
    and hre.enrollment_id=message_record.enrollment_id
    and hr.mailbox_id=message_record.mailbox_id
  order by case when hr.status in ('READY_FOR_CANARY','CANARY_ACTIVE','SCALE_ALLOWED') then 0 else 1 end,
    hr.approved_at desc
  limit 1;

  if target_outcome='SENT' then
    if target_provider_message_id is null then raise exception 'DISPATCH_SETTLE_PROVIDER_ID_REQUIRED'; end if;
    if message_record.status in ('SENT','DELIVERED') then
      if message_record.provider_message_id is not distinct from target_provider_message_id then
        perform app.record_hybrid_dispatch_tick(
          target_organization_id,'SETTLE',proof_command_id,message_record.correlation_id,
          message_record.id,release_record.id,'SENT_DUPLICATE','{}'::jsonb);
        return jsonb_build_object('status','SENT','duplicate',true,'message_id',message_record.id);
      end if;
      raise exception 'DISPATCH_SETTLE_CONFLICT';
    end if;
    if message_record.status<>'SENDING' then raise exception 'DISPATCH_SETTLE_STATE_INVALID'; end if;
    update public.messages
    set status='SENT',sent_at=clock_timestamp(),provider_message_id=target_provider_message_id
    where organization_id=target_organization_id and id=message_record.id;
    update public.campaign_enrollments
    set next_touch_number=least(8,greatest(next_touch_number,message_record.touch_number+1)),
        status=case when message_record.touch_number>=3 then 'COMPLETED'::public.enrollment_status else status end,
        stopped_reason=case when message_record.touch_number>=3 then 'HYBRID_SEQUENCE_COMPLETED' else stopped_reason end,
        next_touch_at=case when message_record.touch_number>=3 then null else next_touch_at end,
        updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=message_record.enrollment_id
      and status in ('PENDING','ACTIVE');
    observation_result := app.record_hybrid_dispatch_observation(
      target_organization_id,message_record.mailbox_id,
      jsonb_build_object('attempted_deliveries',1),
      encode(digest(convert_to('hybrid-dispatch-settle:'||message_record.id::text||':SENT','utf8'),'sha256'),'hex'));
    insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
    values (target_organization_id,'message',message_record.id,'hybrid_outbound.message_sent',
      'hybrid-dispatch-sent:'||message_record.id::text,
      jsonb_build_object('message_id',message_record.id,'release_id',release_record.id,
        'touch_number',message_record.touch_number,'correlation_id',message_record.correlation_id))
    on conflict (organization_id,idempotency_key) do nothing;
    select * into message_record from public.messages
    where organization_id=target_organization_id and id=message_record.id;
    insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,correlation_id,new_data)
    values (target_organization_id,null,'HYBRID_DISPATCH_MESSAGE_SENT','messages',message_record.id,
      message_record.correlation_id,app.redact_audit_snapshot('messages',to_jsonb(message_record)));
    perform app.record_hybrid_dispatch_tick(
      target_organization_id,'SETTLE',proof_command_id,message_record.correlation_id,
      message_record.id,release_record.id,'SENT',
      jsonb_strip_nulls(jsonb_build_object(
        'provider_message_id_sha256',encode(digest(target_provider_message_id,'sha256'),'hex'),
        'provider_thread_id',target_provider_thread_id,
        'observation_status',observation_result->>'status')));
    return jsonb_build_object('status','SENT','message_id',message_record.id,
      'touch_number',message_record.touch_number,'observation',observation_result);
  end if;

  -- FAILED
  if message_record.status='FAILED' then
    perform app.record_hybrid_dispatch_tick(
      target_organization_id,'SETTLE',proof_command_id,message_record.correlation_id,
      message_record.id,release_record.id,'FAILED_DUPLICATE','{}'::jsonb);
    return jsonb_build_object('status','FAILED','duplicate',true,'message_id',message_record.id);
  end if;
  if message_record.status not in ('QUEUED','SENDING') then raise exception 'DISPATCH_SETTLE_STATE_INVALID'; end if;
  begin
    update public.messages set status='FAILED'
    where organization_id=target_organization_id and id=message_record.id;
  exception when others then
    if sqlerrm=any(dispatch_blockers) then
      blocked_reason := sqlerrm;
      insert into public.dead_letters(organization_id,source_table,source_id,reason,payload_json)
      values (target_organization_id,'messages',message_record.id,
        'DISPATCH_SETTLE_BLOCKED:'||blocked_reason,
        jsonb_build_object('message_id',message_record.id,'error_code',target_error_code,
          'correlation_id',message_record.correlation_id))
      on conflict (source_table,source_id) do update
        set reason=excluded.reason,payload_json=excluded.payload_json;
      insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
      values (target_organization_id,'message',message_record.id,'hybrid_outbound.dispatch_settle_blocked',
        'hybrid-dispatch-settle-blocked:'||message_record.id::text,
        jsonb_build_object('message_id',message_record.id,'blocked_by',blocked_reason,
          'error_code',target_error_code,'correlation_id',message_record.correlation_id))
      on conflict (organization_id,idempotency_key) do nothing;
      perform app.record_hybrid_dispatch_tick(
        target_organization_id,'SETTLE',proof_command_id,message_record.correlation_id,
        message_record.id,release_record.id,'FAILED_BLOCKED',
        jsonb_strip_nulls(jsonb_build_object('blocked_by',blocked_reason,'error_code',target_error_code)));
      return jsonb_build_object('status','BLOCKED','reason',blocked_reason,'message_id',message_record.id);
    end if;
    raise;
  end;
  select count(*) into attempt_count from public.messages
  where organization_id=target_organization_id and enrollment_id=message_record.enrollment_id
    and direction='OUTBOUND' and touch_number=message_record.touch_number and status='FAILED';
  if attempt_count>=3 then
    insert into public.dead_letters(organization_id,source_table,source_id,reason,payload_json)
    values (target_organization_id,'messages',message_record.id,
      'HYBRID_DISPATCH_MAX_ATTEMPTS:'||coalesce(target_error_code,'UNKNOWN'),
      jsonb_build_object('message_id',message_record.id,'enrollment_id',message_record.enrollment_id,
        'touch_number',message_record.touch_number,'attempts',attempt_count,
        'correlation_id',message_record.correlation_id))
    on conflict (source_table,source_id) do update
      set reason=excluded.reason,payload_json=excluded.payload_json;
    insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
    values (target_organization_id,'message',message_record.id,'hybrid_outbound.dispatch_dead_letter',
      'hybrid-dispatch-dead-letter:'||message_record.enrollment_id::text||':t'||message_record.touch_number::text,
      jsonb_build_object('message_id',message_record.id,'enrollment_id',message_record.enrollment_id,
        'touch_number',message_record.touch_number,'attempts',attempt_count,
        'error_code',target_error_code,'correlation_id',message_record.correlation_id))
    on conflict (organization_id,idempotency_key) do nothing;
    insert into public.tasks(organization_id,account_id,contact_id,task_type,normalized_objective,due_at)
    select target_organization_id,ce.account_id,ce.contact_id,'DISPATCH_REVIEW',
      'review hybrid dispatch delivery failures before retrying',clock_timestamp()+interval '4 hours'
    from public.campaign_enrollments ce
    where ce.organization_id=target_organization_id and ce.id=message_record.enrollment_id
    on conflict do nothing;
  end if;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,correlation_id,new_data)
  values (target_organization_id,null,'HYBRID_DISPATCH_MESSAGE_FAILED','messages',message_record.id,
    message_record.correlation_id,
    jsonb_strip_nulls(jsonb_build_object('message_id',message_record.id,'error_code',target_error_code,
      'attempts',attempt_count)));
  perform app.record_hybrid_dispatch_tick(
    target_organization_id,'SETTLE',proof_command_id,message_record.correlation_id,
    message_record.id,release_record.id,'FAILED',
    jsonb_strip_nulls(jsonb_build_object('error_code',target_error_code,'attempts',attempt_count)));
  return jsonb_build_object('status','FAILED','message_id',message_record.id,
    'attempts',attempt_count,'dead_lettered',attempt_count>=3);
end $$;

comment on function public.settle_hybrid_dispatch(uuid,uuid,text,text,text,text,text,uuid,timestamptz,text) is
'M032 dispatcher settle. Proof payload = sha256(concat_ws(newline, settle_hybrid_dispatch, organization_id, message_id, outcome, provider_message_id or empty, provider_thread_id or empty, error_code or empty)). SENT: SENDING->SENT + provider id + enrollment advance + live observation (+1 attempted) + outbox hybrid_outbound.message_sent. FAILED: QUEUED/SENDING->FAILED; at >=3 attempts per envelope adds a dead letter, a DISPATCH_REVIEW task and outbox hybrid_outbound.dispatch_dead_letter. Idempotent for repeated terminal settles. When an M29-level invariant blocks the FAILED transition the failure is ledgered (dead letter + outbox + FAILED_BLOCKED tick) and status BLOCKED is returned.';

-- D4. Credential broker read for the dispatcher.
create or replace function public.read_hybrid_dispatch_credential(
  target_organization_id uuid,
  target_mailbox_id uuid,
  proof_command_id text,
  proof_nonce uuid,
  proof_expires_at timestamptz,
  proof_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  payload_sha text;
  mailbox_record public.mailboxes%rowtype;
  credential_record public.gmail_oauth_credentials%rowtype;
  controls_record public.runtime_controls%rowtype;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n',
    'read_hybrid_dispatch_credential',target_organization_id::text,target_mailbox_id::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  select * into mailbox_record from public.mailboxes
  where organization_id=target_organization_id and id=target_mailbox_id;
  if not found then raise exception 'DISPATCH_MAILBOX_NOT_FOUND'; end if;
  select * into credential_record from public.gmail_oauth_credentials
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id;
  if not found or credential_record.status<>'ACTIVE' then raise exception 'DISPATCH_CREDENTIAL_NOT_ACTIVE'; end if;
  if mailbox_record.credential_status<>'OAUTH_CONNECTED' then raise exception 'DISPATCH_MAILBOX_NOT_CONNECTED'; end if;
  if not exists (
    select 1 from public.hybrid_outbound_releases hr
    where hr.organization_id=target_organization_id and hr.mailbox_id=target_mailbox_id
      and hr.status in ('READY_FOR_CANARY','CANARY_ACTIVE','SCALE_ALLOWED')
      and hr.scheduled_for<=clock_timestamp() and hr.expires_at>clock_timestamp()
  ) then
    raise exception 'DISPATCH_CREDENTIAL_REQUIRES_ACTIVE_RELEASE';
  end if;
  select * into controls_record from public.runtime_controls where organization_id=target_organization_id;
  if not found or controls_record.global_kill_switch or not controls_record.external_send_allowed then
    raise exception 'DISPATCH_CREDENTIAL_RUNTIME_HOLD';
  end if;
  if exists (
    select 1 from public.hybrid_dispatch_ticks t
    where t.organization_id=target_organization_id and t.tick_kind='CREDENTIAL'
      and t.detail_json->>'mailbox_id'=target_mailbox_id::text
      and t.created_at>clock_timestamp()-interval '2 minutes'
  ) then
    raise exception 'DISPATCH_CREDENTIAL_RATE_LIMITED';
  end if;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,null,'GMAIL_CREDENTIAL_READ_FOR_DISPATCH','mailboxes',target_mailbox_id,
    jsonb_build_object('credential_sha256',credential_record.credential_sha256,'command_id',proof_command_id));
  perform app.record_hybrid_dispatch_tick(
    target_organization_id,'CREDENTIAL',proof_command_id,gen_random_uuid(),null,null,'CREDENTIAL_READ',
    jsonb_build_object('mailbox_id',target_mailbox_id,'credential_sha256',credential_record.credential_sha256));
  return jsonb_build_object(
    'ciphertext',credential_record.ciphertext,
    'kms_key_name',credential_record.kms_key_name,
    'kms_key_version',credential_record.kms_key_version,
    'credential_sha256',credential_record.credential_sha256,
    'normalized_email',credential_record.normalized_email,
    'granted_scopes',to_jsonb(credential_record.granted_scopes)
  );
end $$;

comment on function public.read_hybrid_dispatch_credential(uuid,uuid,text,uuid,timestamptz,text) is
'M032 credential broker read. Proof payload = sha256(concat_ws(newline, read_hybrid_dispatch_credential, organization_id, mailbox_id)). Requires ACTIVE vault credential, OAUTH_CONNECTED mailbox, an active release in window for the mailbox and open runtime controls; rate limited to one read per mailbox per 2 minutes via the CREDENTIAL tick ledger. Audits only the credential sha, never key material.';

-- D5. Thin HMAC wrappers over existing app functions.
create or replace function public.claim_dispatch_outbox(
  target_organization_id uuid,
  target_batch_size integer,
  proof_command_id text,
  proof_nonce uuid,
  proof_expires_at timestamptz,
  proof_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  payload_sha text;
  events jsonb;
  event_count integer;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n',
    'claim_dispatch_outbox',target_organization_id::text,coalesce(target_batch_size,0)::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  select coalesce(jsonb_agg(to_jsonb(e) order by e.next_attempt_at,e.created_at),'[]'::jsonb),count(*)
  into events,event_count
  from app.claim_outbox_events(target_organization_id,target_batch_size) e;
  perform app.record_hybrid_dispatch_tick(
    target_organization_id,'OUTBOX',proof_command_id,gen_random_uuid(),null,null,'OUTBOX_CLAIMED',
    jsonb_build_object('count',event_count));
  return jsonb_build_object('status','CLAIMED','count',event_count,'events',events);
end $$;

create or replace function public.complete_dispatch_outbox_event(
  target_organization_id uuid,
  target_event_id uuid,
  proof_command_id text,
  proof_nonce uuid,
  proof_expires_at timestamptz,
  proof_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  payload_sha text;
  completed boolean;
  current_status public.notification_status;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n',
    'complete_dispatch_outbox_event',target_organization_id::text,target_event_id::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  completed := app.complete_outbox_event(target_organization_id,target_event_id);
  if not completed then
    select status into current_status from public.event_outbox
    where organization_id=target_organization_id and id=target_event_id;
    if current_status is null then raise exception 'DISPATCH_OUTBOX_EVENT_NOT_FOUND'; end if;
    if current_status='DELIVERED' then
      perform app.record_hybrid_dispatch_tick(
        target_organization_id,'OUTBOX',proof_command_id,gen_random_uuid(),null,null,'OUTBOX_COMPLETED_DUPLICATE',
        jsonb_build_object('event_id',target_event_id));
      return jsonb_build_object('status','DELIVERED','duplicate',true,'event_id',target_event_id);
    end if;
    raise exception 'DISPATCH_OUTBOX_EVENT_NOT_PROCESSING';
  end if;
  perform app.record_hybrid_dispatch_tick(
    target_organization_id,'OUTBOX',proof_command_id,gen_random_uuid(),null,null,'OUTBOX_COMPLETED',
    jsonb_build_object('event_id',target_event_id));
  return jsonb_build_object('status','DELIVERED','event_id',target_event_id);
end $$;

create or replace function public.fail_dispatch_outbox_event(
  target_organization_id uuid,
  target_event_id uuid,
  target_error text,
  proof_command_id text,
  proof_nonce uuid,
  proof_expires_at timestamptz,
  proof_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  payload_sha text;
  next_status public.notification_status;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n',
    'fail_dispatch_outbox_event',target_organization_id::text,target_event_id::text,coalesce(target_error,'')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  next_status := app.fail_outbox_event(target_organization_id,target_event_id,target_error);
  perform app.record_hybrid_dispatch_tick(
    target_organization_id,'OUTBOX',proof_command_id,gen_random_uuid(),null,null,'OUTBOX_'||next_status::text,
    jsonb_build_object('event_id',target_event_id));
  return jsonb_build_object('status',next_status,'event_id',target_event_id);
end $$;

create or replace function public.apply_dispatch_provider_event(
  target_organization_id uuid,
  target_mailbox_id uuid,
  target_external_event_id text,
  target_provider_message_id text,
  target_related_outbound_message_id uuid,
  target_event_kind text,
  target_normalized_from text,
  target_subject text,
  target_body_text text,
  target_observed_at timestamptz,
  proof_command_id text,
  proof_nonce uuid,
  proof_expires_at timestamptz,
  proof_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  payload_sha text;
  correlation_value uuid := gen_random_uuid();
  event_result jsonb;
  observation_result jsonb;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n',
    'apply_dispatch_provider_event',target_organization_id::text,target_mailbox_id::text,
    coalesce(target_external_event_id,''),coalesce(target_provider_message_id,''),
    coalesce(target_related_outbound_message_id::text,''),coalesce(target_event_kind,''),
    coalesce(target_normalized_from,''),
    encode(digest(convert_to(coalesce(target_subject,''),'utf8'),'sha256'),'hex'),
    encode(digest(convert_to(coalesce(target_body_text,''),'utf8'),'sha256'),'hex'),
    coalesce(floor(extract(epoch from target_observed_at))::bigint::text,'')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  if target_event_kind not in ('DELIVERY','REPLY','AUTO_REPLY','HARD_BOUNCE','UNSUBSCRIBE','UNKNOWN') then
    raise exception 'DISPATCH_PROVIDER_EVENT_KIND_INVALID';
  end if;
  event_result := app.apply_mailbox_provider_event(
    target_organization_id,target_mailbox_id,target_external_event_id,target_provider_message_id,
    target_related_outbound_message_id,target_event_kind::public.provider_event_kind,
    case when target_event_kind='REPLY' then 'UNREVIEWED' else 'NOT_APPLICABLE' end::public.reply_classification,
    target_normalized_from,target_subject,target_body_text,target_observed_at,correlation_value);
  if event_result->>'status'='PROCESSED' and target_event_kind in ('DELIVERY','HARD_BOUNCE') then
    observation_result := app.record_hybrid_dispatch_observation(
      target_organization_id,target_mailbox_id,
      case when target_event_kind='DELIVERY'
        then jsonb_build_object('valid_deliveries',1)
        else jsonb_build_object('hard_bounces',1) end,
      encode(digest(convert_to('hybrid-dispatch-provider:'||target_external_event_id,'utf8'),'sha256'),'hex'));
  end if;
  perform app.record_hybrid_dispatch_tick(
    target_organization_id,'OBSERVATION',proof_command_id,correlation_value,
    target_related_outbound_message_id,null,
    coalesce(event_result->>'status','UNKNOWN'),
    jsonb_strip_nulls(jsonb_build_object(
      'event_kind',target_event_kind,
      'external_event_id_sha256',encode(digest(convert_to(coalesce(target_external_event_id,''),'utf8'),'sha256'),'hex'),
      'observation_status',observation_result->>'status')));
  return event_result||jsonb_strip_nulls(jsonb_build_object('observation',observation_result));
end $$;

create or replace function public.update_dispatch_sync_cursor(
  target_organization_id uuid,
  target_mailbox_id uuid,
  target_history_id text,
  target_watch_expires_at timestamptz,
  proof_command_id text,
  proof_nonce uuid,
  proof_expires_at timestamptz,
  proof_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  payload_sha text;
  advanced_mailbox uuid;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n',
    'update_dispatch_sync_cursor',target_organization_id::text,target_mailbox_id::text,
    coalesce(target_history_id,''),
    coalesce(floor(extract(epoch from target_watch_expires_at))::bigint::text,'')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  if target_history_id !~ '^[0-9]{1,32}$' then raise exception 'DISPATCH_SYNC_HISTORY_ID_INVALID'; end if;
  if not exists (select 1 from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id) then
    raise exception 'DISPATCH_MAILBOX_NOT_FOUND';
  end if;
  insert into public.mailbox_sync_cursors as msc (
    organization_id,mailbox_id,last_history_id,watch_expires_at,status,last_synced_at,last_error_code,updated_at
  ) values (
    target_organization_id,target_mailbox_id,target_history_id,target_watch_expires_at,'READY',clock_timestamp(),null,clock_timestamp()
  )
  on conflict (organization_id,mailbox_id) do update set
    last_history_id=excluded.last_history_id,
    watch_expires_at=coalesce(excluded.watch_expires_at,msc.watch_expires_at),
    status='READY',last_synced_at=clock_timestamp(),last_error_code=null,updated_at=clock_timestamp()
  where msc.last_history_id is null
    or excluded.last_history_id::numeric>=msc.last_history_id::numeric
  returning msc.mailbox_id into advanced_mailbox;
  if advanced_mailbox is null then
    perform app.record_hybrid_dispatch_tick(
      target_organization_id,'OBSERVATION',proof_command_id,gen_random_uuid(),null,null,'CURSOR_STALE',
      jsonb_build_object('mailbox_id',target_mailbox_id,'history_id',target_history_id));
    return jsonb_build_object('status','STALE','reason','HISTORY_REGRESSION','mailbox_id',target_mailbox_id);
  end if;
  perform app.record_hybrid_dispatch_tick(
    target_organization_id,'OBSERVATION',proof_command_id,gen_random_uuid(),null,null,'CURSOR_ADVANCED',
    jsonb_build_object('mailbox_id',target_mailbox_id,'history_id',target_history_id));
  return jsonb_build_object('status','ADVANCED','mailbox_id',target_mailbox_id,'history_id',target_history_id);
end $$;

create or replace function public.read_dispatch_health(
  target_organization_id uuid,
  proof_command_id text,
  proof_nonce uuid,
  proof_expires_at timestamptz,
  proof_signature text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  payload_sha text;
  release_record public.hybrid_outbound_releases%rowtype;
  sent_count integer;
  last_tick jsonb;
  messages_today jsonb;
  latest_observation jsonb;
  operations_health jsonb;
  cadence_health jsonb;
  outbox_state jsonb;
  dead_letter_count integer;
  result jsonb;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n',
    'read_dispatch_health',target_organization_id::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  release_record := app.hybrid_dispatch_active_release(target_organization_id);
  select jsonb_build_object('tick_kind',t.tick_kind,'outcome',t.outcome,'created_at',t.created_at)
  into last_tick
  from public.hybrid_dispatch_ticks t
  where t.organization_id=target_organization_id
  order by t.created_at desc limit 1;
  select coalesce(jsonb_object_agg(status_value,status_count),'{}'::jsonb) into messages_today
  from (
    select m.status::text as status_value,count(*) as status_count
    from public.messages m
    where m.organization_id=target_organization_id and m.direction='OUTBOUND'
      and (m.created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date
    group by m.status
  ) s;
  if release_record.id is not null then
    select count(*) into sent_count from public.messages
    where organization_id=target_organization_id and mailbox_id=release_record.mailbox_id and direction='OUTBOUND'
      and status in ('QUEUED','SENDING','SENT','DELIVERED')
      and (created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date;
  end if;
  select jsonb_build_object(
    'observed_at',o.observed_at,
    'age_seconds',floor(extract(epoch from (clock_timestamp()-o.observed_at)))::bigint,
    'attempted_deliveries',o.attempted_deliveries,'valid_deliveries',o.valid_deliveries,
    'hard_bounces',o.hard_bounces,'spam_complaints',o.spam_complaints,'delivery_rate',o.delivery_rate)
  into latest_observation
  from public.hybrid_mailbox_observations o
  join public.mailboxes m on m.organization_id=o.organization_id and m.id=o.mailbox_id
  where o.organization_id=target_organization_id and o.evidence_class='live'
    and m.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP'
  order by o.observed_at desc limit 1;
  select jsonb_build_object(
    'last_watchdog_at',w.evaluated_at,'last_watchdog_status',w.status,
    'open_p0',(select count(*) from public.incidents i where i.organization_id=target_organization_id and i.severity='P0' and i.status not in ('RESOLVED','REVIEWED')),
    'open_p1',(select count(*) from public.incidents i where i.organization_id=target_organization_id and i.severity='P1' and i.status not in ('RESOLVED','REVIEWED')),
    'assignment_active',app.operations_assignment_is_active(target_organization_id))
  into operations_health
  from public.operations_watchdog_runs w
  where w.organization_id=target_organization_id
  order by w.evaluated_at desc limit 1;
  cadence_health := app.evaluate_control_cadence_health_as_system(target_organization_id,clock_timestamp());
  select jsonb_build_object(
    'pending',count(*) filter (where status in ('PENDING','FAILED')),
    'due',count(*) filter (where status in ('PENDING','FAILED') and next_attempt_at<=clock_timestamp()),
    'processing',count(*) filter (where status='PROCESSING'))
  into outbox_state
  from public.event_outbox where organization_id=target_organization_id;
  select count(*) into dead_letter_count from public.dead_letters
  where organization_id=target_organization_id and resolved_at is null;
  result := jsonb_build_object(
    'status','READ_ONLY',
    'evaluated_at',clock_timestamp(),
    'last_tick',last_tick,
    'messages_today',messages_today,
    'active_release',case when release_record.id is null then null else jsonb_build_object(
      'release_id',release_record.id,'status',release_record.status,
      'mailbox_id',release_record.mailbox_id,
      'daily_cap',release_record.daily_cap_snapshot,'sent_today',sent_count,
      'budget_remaining',release_record.daily_cap_snapshot-sent_count,
      'expires_at',release_record.expires_at) end,
    'latest_live_observation',latest_observation,
    'operations_health',coalesce(operations_health,jsonb_build_object('last_watchdog_at',null,'last_watchdog_status','UNKNOWN')),
    'cadence_health',cadence_health,
    'outbox',outbox_state,
    'unresolved_dead_letters',dead_letter_count,
    'send_window_open',app.hybrid_dispatch_window_is_open(clock_timestamp())
  );
  perform app.record_hybrid_dispatch_tick(
    target_organization_id,'HEALTH',proof_command_id,gen_random_uuid(),null,release_record.id,'READ','{}'::jsonb);
  return result;
end $$;

-- H. Privileges: internal helpers are owner-only; public dispatch RPCs are
-- executable exclusively by anon+authenticated (the HMAC proof is the gate).
revoke all on function app.record_hybrid_dispatch_tick(uuid,text,text,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function app.verify_dispatch_proof(uuid,text,uuid,timestamptz,text,text) from public,anon,authenticated,service_role;
revoke all on function app.hybrid_dispatch_window_is_open(timestamptz) from public,anon,authenticated,service_role;
revoke all on function app.hybrid_dispatch_noop(uuid,text,text,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function app.hybrid_dispatch_active_release(uuid) from public,anon,authenticated,service_role;
revoke all on function app.record_hybrid_dispatch_observation(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function app.enforce_hybrid_dispatch_envelope_contract() from public,anon,authenticated,service_role;

revoke all on function public.run_dispatch_heartbeat(uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_hybrid_dispatch(uuid,boolean,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.settle_hybrid_dispatch(uuid,uuid,text,text,text,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.read_hybrid_dispatch_credential(uuid,uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_dispatch_outbox(uuid,integer,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.complete_dispatch_outbox_event(uuid,uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.fail_dispatch_outbox_event(uuid,uuid,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.apply_dispatch_provider_event(uuid,uuid,text,text,uuid,text,text,text,text,timestamptz,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.update_dispatch_sync_cursor(uuid,uuid,text,timestamptz,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.read_dispatch_health(uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;

grant execute on function public.run_dispatch_heartbeat(uuid,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.claim_hybrid_dispatch(uuid,boolean,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.settle_hybrid_dispatch(uuid,uuid,text,text,text,text,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.read_hybrid_dispatch_credential(uuid,uuid,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.claim_dispatch_outbox(uuid,integer,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.complete_dispatch_outbox_event(uuid,uuid,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.fail_dispatch_outbox_event(uuid,uuid,text,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.apply_dispatch_provider_event(uuid,uuid,text,text,uuid,text,text,text,text,timestamptz,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.update_dispatch_sync_cursor(uuid,uuid,text,timestamptz,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.read_dispatch_health(uuid,text,uuid,timestamptz,text) to anon,authenticated;

commit;
