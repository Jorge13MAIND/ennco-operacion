\set ON_ERROR_STOP on

-- ============================================================================
-- M032 hybrid dispatch engine gate (forward).
-- ============================================================================

insert into public.organizations(id,slug,legal_name) values
  ('32000000-0000-4000-8000-000000000001','m032-ennco','ENNCO M032 Synthetic'),
  ('32000000-0000-4000-8000-000000000002','m032-other','M032 Other Tenant');
insert into public.organization_users(organization_id,user_id,role) values
  ('32000000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','teckel_admin'),
  ('32000000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000002','teckel_operator'),
  ('32000000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000003','teckel_admin');
insert into public.runtime_controls(organization_id,global_kill_switch,external_send_allowed) values
  ('32000000-0000-4000-8000-000000000001',true,false),
  ('32000000-0000-4000-8000-000000000002',true,false);
-- org 2 deliberately has NO dispatch_secret.
insert into app.private_runtime_config(organization_id,prequote_ingest_secret,suppression_hmac_secret,dispatch_secret) values
  ('32000000-0000-4000-8000-000000000001',repeat('p',64),repeat('a',64),'m032-dispatch-secret-0123456789abcdef'),
  ('32000000-0000-4000-8000-000000000002',repeat('q',64),repeat('b',64),null);

do $$ begin
  perform set_config('app.research_rpc_write','true',true);
  insert into public.accounts(id,organization_id,legal_name,normalized_name,primary_domain,tier,evidence_class,source_confidence) values
    ('32200000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','M032 Tier1 One','m032-tier1-one','m032-tier1-one.invalid',1,'live','VERIFIED'),
    ('32200000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','M032 Tier1 Two','m032-tier1-two','m032-tier1-two.invalid',1,'live','VERIFIED'),
    ('32200000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000001','M032 Tier1 Three','m032-tier1-three','m032-tier1-three.invalid',1,'live','VERIFIED'),
    ('32200000-0000-4000-8000-000000000004','32000000-0000-4000-8000-000000000001','M032 Tier1 Four','m032-tier1-four','m032-tier1-four.invalid',1,'live','VERIFIED');
  insert into public.contacts(id,organization_id,account_id,full_name,role_title,normalized_email,verified,verified_at,source_confidence) values
    ('32300000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','32200000-0000-4000-8000-000000000001','Buyer One','Compras','buyer1@m032-tier1-one.invalid',true,clock_timestamp(),'VERIFIED'),
    ('32300000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','32200000-0000-4000-8000-000000000002','Buyer Two','Compras','buyer2@m032-tier1-two.invalid',true,clock_timestamp(),'VERIFIED'),
    ('32300000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000001','32200000-0000-4000-8000-000000000003','Buyer Three','Compras','buyer3@m032-tier1-three.invalid',true,clock_timestamp(),'VERIFIED'),
    ('32300000-0000-4000-8000-000000000004','32000000-0000-4000-8000-000000000001','32200000-0000-4000-8000-000000000004','Buyer Four','Compras','buyer4@m032-tier1-four.invalid',true,clock_timestamp(),'VERIFIED');
end $$;

-- Good dispatch-engine campaign: clear-text envelopes for both enrollments x touches 1..3.
insert into public.campaigns(id,organization_id,name,status,manifest_json,manifest_sha256,suppression_snapshot_at,shadow_canary_decision,approved_by,approved_at)
select
  '32400000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','M032 Dispatch Engine','ACTIVE',
  jsonb_build_object('hybrid',jsonb_build_object(
    'copy_sha256',repeat('b',64),
    'sequence_sha256',repeat('a',64),
    'dispatch_engine',true,
    'envelopes',jsonb_build_array(
      jsonb_build_object('enrollment_id','32600000-0000-4000-8000-000000000001','touch_number',1,
        'normalized_to','buyer1@m032-tier1-one.invalid',
        'subject','Rango preliminar de ahorro','body_text','Hola. Preparé un rango preliminar de ahorro para su planta. ¿Vale la pena revisarlo juntos esta semana?',
        'subject_sha256',encode(digest('Rango preliminar de ahorro','sha256'),'hex'),
        'body_sha256',encode(digest('Hola. Preparé un rango preliminar de ahorro para su planta. ¿Vale la pena revisarlo juntos esta semana?','sha256'),'hex')),
      jsonb_build_object('enrollment_id','32600000-0000-4000-8000-000000000001','touch_number',2,
        'normalized_to','buyer1@m032-tier1-one.invalid',
        'subject','Seguimiento breve','body_text','Retomo el rango preliminar que compartí. ¿Le interesa que lo revisemos en una llamada corta?',
        'subject_sha256',encode(digest('Seguimiento breve','sha256'),'hex'),
        'body_sha256',encode(digest('Retomo el rango preliminar que compartí. ¿Le interesa que lo revisemos en una llamada corta?','sha256'),'hex')),
      jsonb_build_object('enrollment_id','32600000-0000-4000-8000-000000000001','touch_number',3,
        'normalized_to','buyer1@m032-tier1-one.invalid',
        'subject','Último seguimiento','body_text','Cierro el tema por ahora. Si el ahorro energético vuelve a ser prioridad, con gusto lo retomamos.',
        'subject_sha256',encode(digest('Último seguimiento','sha256'),'hex'),
        'body_sha256',encode(digest('Cierro el tema por ahora. Si el ahorro energético vuelve a ser prioridad, con gusto lo retomamos.','sha256'),'hex')),
      jsonb_build_object('enrollment_id','32600000-0000-4000-8000-000000000002','touch_number',1,
        'normalized_to','buyer2@m032-tier1-two.invalid',
        'subject','Rango preliminar de ahorro','body_text','Hola. Preparé un rango preliminar de ahorro para su planta. ¿Vale la pena revisarlo juntos esta semana?',
        'subject_sha256',encode(digest('Rango preliminar de ahorro','sha256'),'hex'),
        'body_sha256',encode(digest('Hola. Preparé un rango preliminar de ahorro para su planta. ¿Vale la pena revisarlo juntos esta semana?','sha256'),'hex')),
      jsonb_build_object('enrollment_id','32600000-0000-4000-8000-000000000002','touch_number',2,
        'normalized_to','buyer2@m032-tier1-two.invalid',
        'subject','Seguimiento breve','body_text','Retomo el rango preliminar que compartí. ¿Le interesa que lo revisemos en una llamada corta?',
        'subject_sha256',encode(digest('Seguimiento breve','sha256'),'hex'),
        'body_sha256',encode(digest('Retomo el rango preliminar que compartí. ¿Le interesa que lo revisemos en una llamada corta?','sha256'),'hex')),
      jsonb_build_object('enrollment_id','32600000-0000-4000-8000-000000000002','touch_number',3,
        'normalized_to','buyer2@m032-tier1-two.invalid',
        'subject','Último seguimiento','body_text','Cierro el tema por ahora. Si el ahorro energético vuelve a ser prioridad, con gusto lo retomamos.',
        'subject_sha256',encode(digest('Último seguimiento','sha256'),'hex'),
        'body_sha256',encode(digest('Cierro el tema por ahora. Si el ahorro energético vuelve a ser prioridad, con gusto lo retomamos.','sha256'),'hex'))
    )
  )),
  repeat('c',64),clock_timestamp(),'PASS','32100000-0000-4000-8000-000000000001',clock_timestamp();

insert into public.sequence_versions(id,organization_id,campaign_id,version,sender_name,sender_title,content_sha256,approved_by,approved_at) values
  ('32500000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','32400000-0000-4000-8000-000000000001',1,'Francisco Cuellar','ENNCO',repeat('a',64),'32100000-0000-4000-8000-000000000001',clock_timestamp());
insert into public.sequence_touches(organization_id,sequence_version_id,touch_number,day_offset,subject_template,body_template) values
  ('32000000-0000-4000-8000-000000000001','32500000-0000-4000-8000-000000000001',1,0,'t1','b1'),
  ('32000000-0000-4000-8000-000000000001','32500000-0000-4000-8000-000000000001',2,3,'t2','b2'),
  ('32000000-0000-4000-8000-000000000001','32500000-0000-4000-8000-000000000001',3,7,'t3','b3');

-- Bad campaigns for the envelope contract negatives (flag on, defective envelopes).
insert into public.campaigns(id,organization_id,name,status,manifest_json,manifest_sha256)
select '32400000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','M032 Bad Text Missing','DRAFT',
  jsonb_build_object('hybrid',jsonb_build_object(
    'copy_sha256',repeat('b',64),'sequence_sha256',repeat('a',64),'dispatch_engine',true,
    'envelopes',jsonb_build_array(
      jsonb_build_object('enrollment_id','32600000-0000-4000-8000-000000000003','touch_number',1,
        'normalized_to','buyer3@m032-tier1-three.invalid',
        'subject','Rango preliminar de ahorro',
        'subject_sha256',encode(digest('Rango preliminar de ahorro','sha256'),'hex'),
        'body_sha256',repeat('0',64))
    ))),repeat('d',64);
insert into public.campaigns(id,organization_id,name,status,manifest_json,manifest_sha256)
select '32400000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000001','M032 Bad Hash Mismatch','DRAFT',
  jsonb_build_object('hybrid',jsonb_build_object(
    'copy_sha256',repeat('b',64),'sequence_sha256',repeat('a',64),'dispatch_engine',true,
    'envelopes',jsonb_build_array(
      jsonb_build_object('enrollment_id','32600000-0000-4000-8000-000000000004','touch_number',1,
        'normalized_to','buyer4@m032-tier1-four.invalid',
        'subject','Rango preliminar de ahorro','body_text','Cuerpo que no corresponde al hash declarado en el manifiesto.',
        'subject_sha256',encode(digest('Rango preliminar de ahorro','sha256'),'hex'),
        'body_sha256',repeat('0',64))
    ))),repeat('e',64);
insert into public.sequence_versions(id,organization_id,campaign_id,version,sender_name,sender_title,content_sha256) values
  ('32500000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','32400000-0000-4000-8000-000000000002',1,'Francisco Cuellar','ENNCO',repeat('a',64)),
  ('32500000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000001','32400000-0000-4000-8000-000000000003',1,'Francisco Cuellar','ENNCO',repeat('a',64));

-- Disposable helpers (dropped at the end of this gate).
create or replace function app.m032_test_mailbox_snapshot(
  target_email text,target_domain text,target_route text,target_registered_at timestamptz,target_warmup_at timestamptz
) returns jsonb language sql volatile set search_path=pg_catalog as $$
  select jsonb_build_object(
    'normalized_email',target_email,'domain',target_domain,'eligibility_route',target_route,
    'domain_role',case when target_route='EXISTING_PRIMARY_GMAIL_RAMP' then 'PRIMARY_CORPORATE' else 'OUTREACH_ISOLATED' end,
    'custody_status',case when target_route='EXISTING_PRIMARY_GMAIL_RAMP' then 'TECKEL_MANAGED_FOR_ENNCO' else 'APOLLO_PROVISIONED_TECKEL_CUSTODY' end,
    'provider',case when target_route='EXISTING_PRIMARY_GMAIL_RAMP' then 'gmail' else 'apollo_shared_smtp' end,
    'domain_ready_at',target_registered_at,'domain_registered_at',target_registered_at,
    'warmup_started_at',target_warmup_at,'warmup_status',case when target_route='EXISTING_PRIMARY_GMAIL_RAMP' then 'NOT_STARTED' else 'HEALTHY' end,
    'auth_spf',true,'auth_dkim',true,'auth_dmarc',true,'auth_tls',true,'health_status','HEALTHY','kill_switch',false,
    'credential_status','OAUTH_CONNECTED','sender_identity_verified',true,'gmail_seed_verified',true,
    'outlook_seed_verified',true,'yahoo_seed_verified',true,'reply_sync_verified',true,
    'human_history_verified',target_route='EXISTING_PRIMARY_GMAIL_RAMP','blocklist_status','CLEAR',
    'route_evidence_sha256',repeat('a',64),'route_evidence_at',clock_timestamp(),
    'provider_daily_limit',case when target_route='EXISTING_PRIMARY_GMAIL_RAMP' then 20 else 5 end,
    'last_provider_health_at',clock_timestamp()
  )
$$;

create or replace function app.m032_test_observation(
  target_valid integer,target_attempted integer,target_bounces integer,target_complaints integer,target_observed_at timestamptz
) returns jsonb language sql immutable set search_path=pg_catalog as $$
  select jsonb_build_object(
    'valid_deliveries',target_valid,'attempted_deliveries',target_attempted,
    'hard_bounces',target_bounces,'spam_complaints',target_complaints,
    'delivery_rate',case when target_attempted=0 then null else round(target_valid::numeric/target_attempted::numeric,6) end,
    'reply_sync_p95_seconds',60,'positive_reply_sla_breaches',0,
    'provider_reconciled',true,'suppression_reconciled',true,'identity_unambiguous',true,
    'evidence_sha256',repeat('b',64),'evidence_class','live','observed_at',target_observed_at
  )
$$;

create or replace function app.m032_sign(target_org uuid,target_cmd text,target_payload_sha text,target_nonce uuid,target_expires timestamptz)
returns text language sql volatile as $$
  select encode(app.hmac(convert_to(concat_ws(E'\n',
    target_org::text,target_cmd,target_nonce::text,
    to_char(target_expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),target_payload_sha),'UTF8'),
    convert_to('m032-dispatch-secret-0123456789abcdef','UTF8'),'sha256'),'hex')
$$;

create or replace function app.m032_payload(variadic target_parts text[])
returns text language sql volatile as $$
  select encode(digest(convert_to((
    select string_agg(coalesce(part,''),E'\n') from unnest(target_parts) part
  ),'utf8'),'sha256'),'hex')
$$;

create or replace function app.m032_claim(target_org uuid,target_dry boolean,target_cmd text)
returns jsonb language plpgsql volatile as $$
declare n uuid:=gen_random_uuid(); exp timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  return public.claim_hybrid_dispatch(target_org,target_dry,target_cmd,n,exp,
    app.m032_sign(target_org,target_cmd,app.m032_payload('claim_hybrid_dispatch',target_org::text,target_dry::text),n,exp));
end $$;

create or replace function app.m032_settle(target_org uuid,target_msg uuid,target_outcome text,target_pmid text,target_ptid text,target_err text,target_cmd text)
returns jsonb language plpgsql volatile as $$
declare n uuid:=gen_random_uuid(); exp timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  return public.settle_hybrid_dispatch(target_org,target_msg,target_outcome,target_pmid,target_ptid,target_err,target_cmd,n,exp,
    app.m032_sign(target_org,target_cmd,app.m032_payload('settle_hybrid_dispatch',target_org::text,target_msg::text,
      coalesce(target_outcome,''),coalesce(target_pmid,''),coalesce(target_ptid,''),coalesce(target_err,'')),n,exp));
end $$;

create or replace function app.m032_heartbeat(target_org uuid,target_cmd text)
returns jsonb language plpgsql volatile as $$
declare n uuid:=gen_random_uuid(); exp timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  return public.run_dispatch_heartbeat(target_org,target_cmd,n,exp,
    app.m032_sign(target_org,target_cmd,app.m032_payload('run_dispatch_heartbeat',target_org::text),n,exp));
end $$;

create or replace function app.m032_credential(target_org uuid,target_mailbox uuid,target_cmd text)
returns jsonb language plpgsql volatile as $$
declare n uuid:=gen_random_uuid(); exp timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  return public.read_hybrid_dispatch_credential(target_org,target_mailbox,target_cmd,n,exp,
    app.m032_sign(target_org,target_cmd,app.m032_payload('read_hybrid_dispatch_credential',target_org::text,target_mailbox::text),n,exp));
end $$;

create or replace function app.m032_outbox_claim(target_org uuid,target_batch integer,target_cmd text)
returns jsonb language plpgsql volatile as $$
declare n uuid:=gen_random_uuid(); exp timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  return public.claim_dispatch_outbox(target_org,target_batch,target_cmd,n,exp,
    app.m032_sign(target_org,target_cmd,app.m032_payload('claim_dispatch_outbox',target_org::text,target_batch::text),n,exp));
end $$;

create or replace function app.m032_outbox_complete(target_org uuid,target_event uuid,target_cmd text)
returns jsonb language plpgsql volatile as $$
declare n uuid:=gen_random_uuid(); exp timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  return public.complete_dispatch_outbox_event(target_org,target_event,target_cmd,n,exp,
    app.m032_sign(target_org,target_cmd,app.m032_payload('complete_dispatch_outbox_event',target_org::text,target_event::text),n,exp));
end $$;

create or replace function app.m032_outbox_fail(target_org uuid,target_event uuid,target_err text,target_cmd text)
returns jsonb language plpgsql volatile as $$
declare n uuid:=gen_random_uuid(); exp timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  return public.fail_dispatch_outbox_event(target_org,target_event,target_err,target_cmd,n,exp,
    app.m032_sign(target_org,target_cmd,app.m032_payload('fail_dispatch_outbox_event',target_org::text,target_event::text,coalesce(target_err,'')),n,exp));
end $$;

create or replace function app.m032_provider_event(
  target_org uuid,target_mailbox uuid,target_ext text,target_pmid text,target_related uuid,
  target_kind text,target_from text,target_subject text,target_body text,target_observed timestamptz,target_cmd text)
returns jsonb language plpgsql volatile as $$
declare n uuid:=gen_random_uuid(); exp timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  return public.apply_dispatch_provider_event(target_org,target_mailbox,target_ext,target_pmid,target_related,
    target_kind,target_from,target_subject,target_body,target_observed,target_cmd,n,exp,
    app.m032_sign(target_org,target_cmd,app.m032_payload('apply_dispatch_provider_event',target_org::text,target_mailbox::text,
      coalesce(target_ext,''),coalesce(target_pmid,''),coalesce(target_related::text,''),coalesce(target_kind,''),
      coalesce(target_from,''),
      encode(digest(convert_to(coalesce(target_subject,''),'utf8'),'sha256'),'hex'),
      encode(digest(convert_to(coalesce(target_body,''),'utf8'),'sha256'),'hex'),
      coalesce(floor(extract(epoch from target_observed))::bigint::text,'')),n,exp));
end $$;

create or replace function app.m032_cursor(target_org uuid,target_mailbox uuid,target_history text,target_watch timestamptz,target_cmd text)
returns jsonb language plpgsql volatile as $$
declare n uuid:=gen_random_uuid(); exp timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  return public.update_dispatch_sync_cursor(target_org,target_mailbox,target_history,target_watch,target_cmd,n,exp,
    app.m032_sign(target_org,target_cmd,app.m032_payload('update_dispatch_sync_cursor',target_org::text,target_mailbox::text,
      coalesce(target_history,''),coalesce(floor(extract(epoch from target_watch))::bigint::text,'')),n,exp));
end $$;

create or replace function app.m032_health(target_org uuid,target_cmd text)
returns jsonb language plpgsql volatile as $$
declare n uuid:=gen_random_uuid(); exp timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  return public.read_dispatch_health(target_org,target_cmd,n,exp,
    app.m032_sign(target_org,target_cmd,app.m032_payload('read_dispatch_health',target_org::text),n,exp));
end $$;

-- ---------------------------------------------------------------------------
-- Send window helper unit tests (Mon-Fri 09:30-13:30 America/Mexico_City).
-- ---------------------------------------------------------------------------
do $$ begin
  if not app.hybrid_dispatch_window_is_open('2026-08-24 10:00:00-06'::timestamptz) then raise exception 'M032_WINDOW_MONDAY_10_CLOSED'; end if;
  if not app.hybrid_dispatch_window_is_open('2026-08-24 09:30:00-06'::timestamptz) then raise exception 'M032_WINDOW_OPEN_EDGE_CLOSED'; end if;
  if app.hybrid_dispatch_window_is_open('2026-08-24 09:29:59-06'::timestamptz) then raise exception 'M032_WINDOW_EARLY_OPEN'; end if;
  if app.hybrid_dispatch_window_is_open('2026-08-24 13:30:00-06'::timestamptz) then raise exception 'M032_WINDOW_CLOSE_EDGE_OPEN'; end if;
  if app.hybrid_dispatch_window_is_open('2026-08-29 10:00:00-06'::timestamptz) then raise exception 'M032_WINDOW_SATURDAY_OPEN'; end if;
  if app.hybrid_dispatch_window_is_open('2026-08-30 10:00:00-06'::timestamptz) then raise exception 'M032_WINDOW_SUNDAY_OPEN'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- (1) invalid proof, missing secret, expiry bounds. (2) nonce replay.
-- (3) claim without release -> NOOP NO_ACTIVE_RELEASE.
-- ---------------------------------------------------------------------------
do $$
declare
  fixed_nonce uuid:='32900000-0000-4000-8000-000000000001';
  fixed_exp timestamptz:=clock_timestamp()+interval '5 minutes';
  payload text; result jsonb;
begin
  payload := app.m032_payload('claim_hybrid_dispatch','32000000-0000-4000-8000-000000000001','true');
  begin
    perform public.claim_hybrid_dispatch('32000000-0000-4000-8000-000000000001',true,'m032-bad-signature',gen_random_uuid(),clock_timestamp()+interval '5 minutes',repeat('0',64));
    raise exception 'EXPECTED_M032_BAD_SIGNATURE_REJECTION';
  exception when others then if sqlerrm<>'DISPATCH_PROOF_SIGNATURE_INVALID' then raise; end if; end;
  begin
    perform public.claim_hybrid_dispatch('32000000-0000-4000-8000-000000000002',true,'m032-no-secret-1',gen_random_uuid(),clock_timestamp()+interval '5 minutes',repeat('0',64));
    raise exception 'EXPECTED_M032_SECRET_NOT_CONFIGURED';
  exception when others then if sqlerrm<>'DISPATCH_SECRET_NOT_CONFIGURED' then raise; end if; end;
  begin
    perform public.claim_hybrid_dispatch('32000000-0000-4000-8000-000000000001',true,'m032-expired-1',gen_random_uuid(),clock_timestamp()-interval '1 second',repeat('0',64));
    raise exception 'EXPECTED_M032_PROOF_EXPIRED';
  exception when others then if sqlerrm<>'DISPATCH_PROOF_EXPIRED' then raise; end if; end;
  begin
    perform public.claim_hybrid_dispatch('32000000-0000-4000-8000-000000000001',true,'m032-too-far-1',gen_random_uuid(),clock_timestamp()+interval '11 minutes',repeat('0',64));
    raise exception 'EXPECTED_M032_PROOF_EXPIRY_TOO_FAR';
  exception when others then if sqlerrm<>'DISPATCH_PROOF_EXPIRY_TOO_FAR' then raise; end if; end;
  -- (3) valid proof, no release yet -> NOOP; this also consumes fixed_nonce.
  result := public.claim_hybrid_dispatch('32000000-0000-4000-8000-000000000001',true,'m032-noop-1',fixed_nonce,fixed_exp,
    app.m032_sign('32000000-0000-4000-8000-000000000001','m032-noop-1',payload,fixed_nonce,fixed_exp));
  if result->>'status'<>'NOOP' or result->>'reason'<>'NO_ACTIVE_RELEASE' then
    raise exception 'M032_CLAIM_WITHOUT_RELEASE_INVALID:%',result;
  end if;
  -- (2) same nonce replayed with a fresh valid signature -> rejected.
  begin
    perform public.claim_hybrid_dispatch('32000000-0000-4000-8000-000000000001',true,'m032-noop-1',fixed_nonce,fixed_exp,
      app.m032_sign('32000000-0000-4000-8000-000000000001','m032-noop-1',payload,fixed_nonce,fixed_exp));
    raise exception 'EXPECTED_M032_NONCE_REPLAY_REJECTION';
  exception when others then if sqlerrm<>'DISPATCH_PROOF_REPLAY_REJECTED' then raise; end if; end;
end $$;

-- ---------------------------------------------------------------------------
-- Primary ramp mailbox + live observation via the M29 RPCs.
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub='32100000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.apply_hybrid_mailbox_snapshot(
  '32000000-0000-4000-8000-000000000001',
  app.m032_test_mailbox_snapshot('contacto@ennco.com.mx','ennco.com.mx','EXISTING_PRIMARY_GMAIL_RAMP',clock_timestamp()-interval '200 days',null),
  repeat('1',64)
);
select public.record_hybrid_mailbox_observation(
  '32000000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  app.m032_test_observation(0,0,0,0,clock_timestamp()),repeat('2',64)
);
reset role;

do $$ declare result jsonb; begin
  select app.evaluate_hybrid_mailbox_as_system('32000000-0000-4000-8000-000000000001',id,clock_timestamp()) into result
  from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
  if result->>'state'<>'READY' or (result->>'daily_cap')::integer<>5 then
    raise exception 'M032_PRIMARY_MAILBOX_NOT_READY:%',result;
  end if;
end $$;

-- Vault credential fixture (superuser insert; the vault is revoked for all roles).
insert into public.gmail_oauth_authorizations(
  id,organization_id,mailbox_id,state_sha256,pkce_challenge,redirect_uri_sha256,granted_scopes,status,requested_by,
  expires_at,start_idempotency_key,start_request_sha256
) values (
  '32a00000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  repeat('3',64),repeat('A',43),repeat('4',64),
  array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'],
  'PENDING','32100000-0000-4000-8000-000000000001',clock_timestamp()+interval '9 minutes',repeat('5',64),repeat('6',64)
);
insert into public.gmail_oauth_credentials(
  id,organization_id,mailbox_id,authorization_id,ciphertext,kms_key_name,kms_key_version,
  google_subject_sha256,normalized_email,granted_scopes,token_issued_at,credential_sha256,status
) values (
  '32b00000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  '32a00000-0000-4000-8000-000000000001',
  encode(convert_to('m032-ciphertext-sentinel-never-audit','utf8'),'base64'),
  'projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail','3',repeat('5',64),'contacto@ennco.com.mx',
  array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'],
  clock_timestamp(),repeat('6',64),'ACTIVE'
);

-- (10) credential read without an active release -> rejected.
do $$ declare mailbox_id_value uuid; begin
  select id into mailbox_id_value from public.mailboxes
  where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
  begin
    perform app.m032_credential('32000000-0000-4000-8000-000000000001',mailbox_id_value,'m032-cred-norelease');
    raise exception 'EXPECTED_M032_CREDENTIAL_NO_RELEASE_REJECTION';
  exception when others then if sqlerrm<>'DISPATCH_CREDENTIAL_REQUIRES_ACTIVE_RELEASE' then raise; end if; end;
end $$;

-- Enrollments (annex triggers isolated exactly like the M29 gate does).
alter table public.campaign_enrollments disable trigger campaign_enrollments_aaa_annex_a_suppression;
alter table public.messages disable trigger messages_aaa_m025_annex_a_release;
insert into public.campaign_enrollments(id,organization_id,campaign_id,sequence_version_id,account_id,contact_id,mailbox_id,status) values
  ('32600000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','32400000-0000-4000-8000-000000000001',
   '32500000-0000-4000-8000-000000000001','32200000-0000-4000-8000-000000000001','32300000-0000-4000-8000-000000000001',
   (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),'PENDING'),
  ('32600000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','32400000-0000-4000-8000-000000000001',
   '32500000-0000-4000-8000-000000000001','32200000-0000-4000-8000-000000000002','32300000-0000-4000-8000-000000000002',
   (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),'PENDING'),
  ('32600000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000001','32400000-0000-4000-8000-000000000002',
   '32500000-0000-4000-8000-000000000002','32200000-0000-4000-8000-000000000003','32300000-0000-4000-8000-000000000003',
   (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),'PENDING'),
  ('32600000-0000-4000-8000-000000000004','32000000-0000-4000-8000-000000000001','32400000-0000-4000-8000-000000000003',
   '32500000-0000-4000-8000-000000000003','32200000-0000-4000-8000-000000000004','32300000-0000-4000-8000-000000000004',
   (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),'PENDING');

-- Good release through the canonical M29 RPC (also proves the M032 envelope
-- contract accepts a compliant clear-text manifest).
set role authenticated;
select public.create_hybrid_outbound_release(
  '32000000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  '32400000-0000-4000-8000-000000000001','ACCELERATED_TIER1_CANARY',
  repeat('c',64),repeat('f',64),repeat('b',64),repeat('a',64),
  clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',
  array['32600000-0000-4000-8000-000000000001'::uuid,'32600000-0000-4000-8000-000000000002'::uuid],
  repeat('7',64)
);
reset role;

-- (8) envelope contract negatives on dispatch-engine campaigns.
insert into public.hybrid_outbound_releases(
  id,organization_id,mailbox_id,campaign_id,lane,status,manifest_sha256,suppression_sha256,copy_sha256,sequence_sha256,
  route_evidence_sha256,recipient_count,account_count,daily_cap_snapshot,scheduled_for,expires_at,approved_by,paused_at,pause_reason_code
) values
  ('32700000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001',
   (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
   '32400000-0000-4000-8000-000000000002','ACCELERATED_TIER1_CANARY','PAUSED',repeat('d',64),repeat('f',64),repeat('b',64),repeat('a',64),
   repeat('a',64),1,1,5,clock_timestamp(),clock_timestamp()+interval '1 hour','32100000-0000-4000-8000-000000000001',clock_timestamp(),'M032_FIXTURE_HOLD'),
  ('32700000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000001',
   (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
   '32400000-0000-4000-8000-000000000003','ACCELERATED_TIER1_CANARY','PAUSED',repeat('e',64),repeat('f',64),repeat('b',64),repeat('a',64),
   repeat('a',64),1,1,5,clock_timestamp(),clock_timestamp()+interval '1 hour','32100000-0000-4000-8000-000000000001',clock_timestamp(),'M032_FIXTURE_HOLD');
do $$ begin
  begin
    insert into public.hybrid_outbound_release_enrollments(organization_id,release_id,enrollment_id,account_id,contact_id)
    values ('32000000-0000-4000-8000-000000000001','32700000-0000-4000-8000-000000000002',
      '32600000-0000-4000-8000-000000000003','32200000-0000-4000-8000-000000000003','32300000-0000-4000-8000-000000000003');
    raise exception 'EXPECTED_M032_ENVELOPE_TEXT_REJECTION';
  exception when others then if sqlerrm<>'HYBRID_ENVELOPE_TEXT_MISSING' then raise; end if; end;
  begin
    insert into public.hybrid_outbound_release_enrollments(organization_id,release_id,enrollment_id,account_id,contact_id)
    values ('32000000-0000-4000-8000-000000000001','32700000-0000-4000-8000-000000000003',
      '32600000-0000-4000-8000-000000000004','32200000-0000-4000-8000-000000000004','32300000-0000-4000-8000-000000000004');
    raise exception 'EXPECTED_M032_ENVELOPE_HASH_REJECTION';
  exception when others then if sqlerrm<>'HYBRID_ENVELOPE_HASH_MISMATCH' then raise; end if; end;
end $$;

-- ---------------------------------------------------------------------------
-- (4) shadow claim: creates a DRY_RUN message with the kill switch still ON.
-- ---------------------------------------------------------------------------
do $$ declare result jsonb; controls public.runtime_controls%rowtype; begin
  select * into controls from public.runtime_controls where organization_id='32000000-0000-4000-8000-000000000001';
  if not controls.global_kill_switch or controls.external_send_allowed then
    raise exception 'M032_FIXTURE_RUNTIME_MUST_BE_CLOSED';
  end if;
  result := app.m032_claim('32000000-0000-4000-8000-000000000001',true,'m032-dry-claim-1');
  if result->>'status'<>'CLAIMED' or (result->>'dry_run')::boolean is not true
    or result->>'touch_number'<>'1'
    or result->>'to_email'<>'buyer1@m032-tier1-one.invalid'
    or result->>'subject' is null or result->>'body_text' is null
  then raise exception 'M032_DRY_CLAIM_INVALID:%',result; end if;
  if (select status from public.messages where organization_id='32000000-0000-4000-8000-000000000001'
      and id=(result->>'message_id')::uuid)<>'DRY_RUN'
  then raise exception 'M032_DRY_CLAIM_MESSAGE_NOT_DRY_RUN'; end if;
  if (select idempotency_key from public.messages where organization_id='32000000-0000-4000-8000-000000000001'
      and id=(result->>'message_id')::uuid) not like '%:shadow'
  then raise exception 'M032_DRY_CLAIM_KEY_NOT_SHADOW'; end if;
  if not exists (select 1 from public.hybrid_dispatch_ticks
      where organization_id='32000000-0000-4000-8000-000000000001' and tick_kind='CLAIM' and outcome='CLAIMED_DRY_RUN')
  then raise exception 'M032_DRY_CLAIM_TICK_MISSING'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- (5) concurrent claims via dblink: the advisory lock serializes them; exactly
-- one takes the last shadow-eligible envelope, no pair is duplicated.
-- ---------------------------------------------------------------------------
create extension if not exists dblink;
do $$
declare
  connstr text;
  status_a text; status_b text; drained integer;
begin
  connstr := 'host='||btrim(split_part(current_setting('unix_socket_directories'),',',1))
    ||' port='||current_setting('port')||' dbname='||current_database();
  perform dblink_connect('m032_conn_a',connstr);
  perform dblink_connect('m032_conn_b',connstr);
  perform dblink_send_query('m032_conn_a',
    $q$select app.m032_claim('32000000-0000-4000-8000-000000000001'::uuid,true,'m032-conc-a')->>'status'$q$);
  perform dblink_send_query('m032_conn_b',
    $q$select app.m032_claim('32000000-0000-4000-8000-000000000001'::uuid,true,'m032-conc-b')->>'status'$q$);
  select t.status into status_a from dblink_get_result('m032_conn_a') as t(status text);
  select t.status into status_b from dblink_get_result('m032_conn_b') as t(status text);
  select count(*) into drained from dblink_get_result('m032_conn_a') as t(status text);
  select count(*) into drained from dblink_get_result('m032_conn_b') as t(status text);
  perform dblink_disconnect('m032_conn_a');
  perform dblink_disconnect('m032_conn_b');
  if not ((status_a='CLAIMED' and status_b='NOOP') or (status_a='NOOP' and status_b='CLAIMED')) then
    raise exception 'M032_CONCURRENT_CLAIM_INVALID:%/%',status_a,status_b;
  end if;
  if (select count(*) from public.messages where organization_id='32000000-0000-4000-8000-000000000001' and status='DRY_RUN')<>2 then
    raise exception 'M032_CONCURRENT_DRY_RUN_COUNT_INVALID';
  end if;
  if exists (
    select 1 from public.messages
    where organization_id='32000000-0000-4000-8000-000000000001' and status='DRY_RUN'
    group by enrollment_id,touch_number having count(*)>1
  ) then raise exception 'M032_CONCURRENT_CLAIM_DUPLICATED_PAIR'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Real-lane setup: open runtime, isolate the independent send-health gates
-- (repo pattern, see 029 gate), materialize real messages directly.
-- ---------------------------------------------------------------------------
update public.runtime_controls set global_kill_switch=false,external_send_allowed=true
where organization_id='32000000-0000-4000-8000-000000000001';
alter table public.messages disable trigger messages_operations_send_health;
alter table public.messages disable trigger messages_control_cadence_send_health;
update public.campaign_enrollments set status='ACTIVE' where id='32600000-0000-4000-8000-000000000001';

insert into public.messages(id,organization_id,enrollment_id,mailbox_id,contact_id,direction,status,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
select '32800000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','32600000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  '32300000-0000-4000-8000-000000000001','OUTBOUND','QUEUED',1,'buyer1@m032-tier1-one.invalid','contacto@ennco.com.mx',
  e.envelope->>'subject',e.envelope->>'body_text','m032-direct-e1t1','32800000-0000-4000-8000-000000000099'
from public.campaigns c,jsonb_array_elements(c.manifest_json#>'{hybrid,envelopes}') e(envelope)
where c.id='32400000-0000-4000-8000-000000000001'
  and e.envelope->>'enrollment_id'='32600000-0000-4000-8000-000000000001' and (e.envelope->>'touch_number')::integer=1;
update public.messages set status='SENDING' where id='32800000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- (6) settle SENT: message SENT, enrollment advanced, observation monotonic.
-- ---------------------------------------------------------------------------
do $$ declare result jsonb; attempted_before integer; begin
  select coalesce(max(attempted_deliveries),0) into attempted_before from public.hybrid_mailbox_observations
  where organization_id='32000000-0000-4000-8000-000000000001';
  result := app.m032_settle('32000000-0000-4000-8000-000000000001','32800000-0000-4000-8000-000000000001','SENT','m032-prov-0001','m032-thread-0001',null,'m032-settle-1');
  if result->>'status'<>'SENT' then raise exception 'M032_SETTLE_SENT_INVALID:%',result; end if;
  if (select status from public.messages where id='32800000-0000-4000-8000-000000000001')<>'SENT'
    or (select provider_message_id from public.messages where id='32800000-0000-4000-8000-000000000001')<>'m032-prov-0001'
    or (select sent_at from public.messages where id='32800000-0000-4000-8000-000000000001') is null
  then raise exception 'M032_SETTLE_SENT_MESSAGE_STATE_INVALID'; end if;
  if (select next_touch_number from public.campaign_enrollments where id='32600000-0000-4000-8000-000000000001')<>2
    or (select status from public.campaign_enrollments where id='32600000-0000-4000-8000-000000000001')<>'ACTIVE'
  then raise exception 'M032_SETTLE_SENT_ENROLLMENT_NOT_ADVANCED'; end if;
  if (select attempted_deliveries from public.hybrid_mailbox_observations
      where organization_id='32000000-0000-4000-8000-000000000001'
      order by observed_at desc limit 1)<>attempted_before+1
  then raise exception 'M032_SETTLE_SENT_OBSERVATION_NOT_MONOTONIC'; end if;
  if (select evidence_class::text from public.hybrid_mailbox_observations
      where organization_id='32000000-0000-4000-8000-000000000001'
      order by observed_at desc limit 1)<>'live'
  then raise exception 'M032_SETTLE_SENT_OBSERVATION_NOT_LIVE'; end if;
  if not exists (select 1 from public.event_outbox where organization_id='32000000-0000-4000-8000-000000000001'
      and event_type='hybrid_outbound.message_sent')
  then raise exception 'M032_SETTLE_SENT_OUTBOX_MISSING'; end if;
  -- idempotent duplicate settle: no double count, explicit duplicate response.
  result := app.m032_settle('32000000-0000-4000-8000-000000000001','32800000-0000-4000-8000-000000000001','SENT','m032-prov-0001','m032-thread-0001',null,'m032-settle-1-dup');
  if result->>'status'<>'SENT' or (result->>'duplicate')::boolean is not true then
    raise exception 'M032_SETTLE_SENT_DUPLICATE_INVALID:%',result;
  end if;
  if (select attempted_deliveries from public.hybrid_mailbox_observations
      where organization_id='32000000-0000-4000-8000-000000000001'
      order by observed_at desc limit 1)<>attempted_before+1
  then raise exception 'M032_SETTLE_SENT_DUPLICATE_DOUBLE_COUNTED'; end if;
  begin
    perform app.m032_settle('32000000-0000-4000-8000-000000000001','32800000-0000-4000-8000-000000000001','SENT','m032-prov-OTHER',null,null,'m032-settle-1-conflict');
    raise exception 'EXPECTED_M032_SETTLE_CONFLICT';
  exception when others then if sqlerrm<>'DISPATCH_SETTLE_CONFLICT' then raise; end if; end;
end $$;

-- Provider DELIVERY event through the proof wrapper: message DELIVERED and the
-- live observation gains a valid delivery (still monotonic).
do $$ declare result jsonb; mailbox_id_value uuid; begin
  select id into mailbox_id_value from public.mailboxes
  where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
  result := app.m032_provider_event('32000000-0000-4000-8000-000000000001',mailbox_id_value,
    'm032-ext-evt-0001','m032-prov-0001','32800000-0000-4000-8000-000000000001','DELIVERY',null,null,null,clock_timestamp(),'m032-provider-1');
  if result->>'status'<>'PROCESSED' then raise exception 'M032_PROVIDER_DELIVERY_INVALID:%',result; end if;
  if (select status from public.messages where id='32800000-0000-4000-8000-000000000001')<>'DELIVERED'
  then raise exception 'M032_PROVIDER_DELIVERY_MESSAGE_NOT_DELIVERED'; end if;
  if (select valid_deliveries from public.hybrid_mailbox_observations
      where organization_id='32000000-0000-4000-8000-000000000001'
      order by observed_at desc limit 1)<>1
  then raise exception 'M032_PROVIDER_DELIVERY_OBSERVATION_INVALID'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- (7) settle FAILED works with the send-health gates ARMED and unhealthy
-- (no cadence policy and no fresh watchdog run): only the M032 amendments on
-- the M20/M22 triggers allow the FAILED transition. SENT stays gated.
-- ---------------------------------------------------------------------------
insert into public.messages(id,organization_id,enrollment_id,mailbox_id,contact_id,direction,status,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
select '32800000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','32600000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  '32300000-0000-4000-8000-000000000001','OUTBOUND','QUEUED',2,'buyer1@m032-tier1-one.invalid','contacto@ennco.com.mx',
  e.envelope->>'subject',e.envelope->>'body_text','m032-direct-e1t2-a1',gen_random_uuid()
from public.campaigns c,jsonb_array_elements(c.manifest_json#>'{hybrid,envelopes}') e(envelope)
where c.id='32400000-0000-4000-8000-000000000001'
  and e.envelope->>'enrollment_id'='32600000-0000-4000-8000-000000000001' and (e.envelope->>'touch_number')::integer=2;
update public.messages set status='SENDING' where id='32800000-0000-4000-8000-000000000002';

alter table public.messages enable trigger messages_operations_send_health;
alter table public.messages enable trigger messages_control_cadence_send_health;

do $$ declare result jsonb; begin
  -- prove the health gates are armed: a SENT settle is still blocked.
  begin
    perform app.m032_settle('32000000-0000-4000-8000-000000000001','32800000-0000-4000-8000-000000000002','SENT','m032-prov-0002',null,null,'m032-settle-2-sent');
    raise exception 'EXPECTED_M032_SENT_HEALTH_BLOCK';
  exception when others then
    if sqlerrm not in ('CONTROL_CADENCE_HEALTH_NOT_HEALTHY','OPERATIONS_HEALTH_NOT_HEALTHY') then raise; end if;
  end;
  -- the FAILED settle passes through the amended triggers.
  result := app.m032_settle('32000000-0000-4000-8000-000000000001','32800000-0000-4000-8000-000000000002','FAILED',null,null,'SMTP_5XX','m032-settle-2-failed');
  if result->>'status'<>'FAILED' or (result->>'attempts')::integer<>1 or (result->>'dead_lettered')::boolean is true then
    raise exception 'M032_SETTLE_FAILED_INVALID:%',result;
  end if;
  if (select status from public.messages where id='32800000-0000-4000-8000-000000000002')<>'FAILED'
  then raise exception 'M032_SETTLE_FAILED_MESSAGE_STATE_INVALID'; end if;
end $$;

alter table public.messages disable trigger messages_operations_send_health;
alter table public.messages disable trigger messages_control_cadence_send_health;

-- Second and third attempts on the same envelope are sequential (the partial
-- unique index messages_one_external_touch_per_enrollment allows only one
-- non-FAILED real message per pair); the third failure dead-letters and opens
-- a review task.
insert into public.messages(id,organization_id,enrollment_id,mailbox_id,contact_id,direction,status,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
select '32800000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000001','32600000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  '32300000-0000-4000-8000-000000000001','OUTBOUND','QUEUED',2,'buyer1@m032-tier1-one.invalid','contacto@ennco.com.mx',
  e.envelope->>'subject',e.envelope->>'body_text','m032-direct-e1t2-a3',gen_random_uuid()
from public.campaigns c,jsonb_array_elements(c.manifest_json#>'{hybrid,envelopes}') e(envelope)
where c.id='32400000-0000-4000-8000-000000000001'
  and e.envelope->>'enrollment_id'='32600000-0000-4000-8000-000000000001' and (e.envelope->>'touch_number')::integer=2;
update public.messages set status='SENDING' where id='32800000-0000-4000-8000-000000000003';

do $$ declare result jsonb; begin
  result := app.m032_settle('32000000-0000-4000-8000-000000000001','32800000-0000-4000-8000-000000000003','FAILED',null,null,'SMTP_5XX','m032-settle-3-failed');
  if (result->>'attempts')::integer<>2 then raise exception 'M032_SETTLE_ATTEMPT_TWO_INVALID:%',result; end if;
end $$;

insert into public.messages(id,organization_id,enrollment_id,mailbox_id,contact_id,direction,status,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
select '32800000-0000-4000-8000-000000000004','32000000-0000-4000-8000-000000000001','32600000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  '32300000-0000-4000-8000-000000000001','OUTBOUND','QUEUED',2,'buyer1@m032-tier1-one.invalid','contacto@ennco.com.mx',
  e.envelope->>'subject',e.envelope->>'body_text','m032-direct-e1t2-a4',gen_random_uuid()
from public.campaigns c,jsonb_array_elements(c.manifest_json#>'{hybrid,envelopes}') e(envelope)
where c.id='32400000-0000-4000-8000-000000000001'
  and e.envelope->>'enrollment_id'='32600000-0000-4000-8000-000000000001' and (e.envelope->>'touch_number')::integer=2;
update public.messages set status='SENDING' where id='32800000-0000-4000-8000-000000000004';

do $$ declare result jsonb; begin
  result := app.m032_settle('32000000-0000-4000-8000-000000000001','32800000-0000-4000-8000-000000000004','FAILED',null,null,'SMTP_5XX','m032-settle-4-failed');
  if (result->>'attempts')::integer<>3 or (result->>'dead_lettered')::boolean is not true then
    raise exception 'M032_SETTLE_DEAD_LETTER_INVALID:%',result;
  end if;
  if not exists (select 1 from public.dead_letters where organization_id='32000000-0000-4000-8000-000000000001'
      and source_table='messages' and source_id='32800000-0000-4000-8000-000000000004'
      and reason like 'HYBRID_DISPATCH_MAX_ATTEMPTS:%')
  then raise exception 'M032_DEAD_LETTER_ROW_MISSING'; end if;
  if not exists (select 1 from public.event_outbox where organization_id='32000000-0000-4000-8000-000000000001'
      and event_type='hybrid_outbound.dispatch_dead_letter')
  then raise exception 'M032_DEAD_LETTER_OUTBOX_MISSING'; end if;
  if not exists (select 1 from public.tasks where organization_id='32000000-0000-4000-8000-000000000001'
      and task_type='DISPATCH_REVIEW' and status='OPEN')
  then raise exception 'M032_DEAD_LETTER_TASK_MISSING'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Heartbeat: runs watchdog + reconciler + heartbeat watchdog; with unresolved
-- dead letters the operations lane must report DEGRADED. Idempotent per bucket.
-- ---------------------------------------------------------------------------
do $$
declare
  bucket_before text; bucket_after text; hb1 jsonb; hb2 jsonb; local_now timestamp;
begin
  local_now := clock_timestamp() at time zone 'America/Mexico_City';
  bucket_before := to_char(local_now,'YYYY-MM-DD-HH24-')||lpad((floor(extract(minute from local_now)::numeric/5)*5)::text,2,'0');
  hb1 := app.m032_heartbeat('32000000-0000-4000-8000-000000000001','m032-hb-1');
  hb2 := app.m032_heartbeat('32000000-0000-4000-8000-000000000001','m032-hb-2');
  local_now := clock_timestamp() at time zone 'America/Mexico_City';
  bucket_after := to_char(local_now,'YYYY-MM-DD-HH24-')||lpad((floor(extract(minute from local_now)::numeric/5)*5)::text,2,'0');
  if hb1->>'status'<>'HEARTBEAT' or hb1->'operations_health'->>'status'<>'DEGRADED' then
    raise exception 'M032_HEARTBEAT_INVALID:%',hb1;
  end if;
  if hb1->'cadence_health'->'reconciler'->>'state'<>'UNKNOWN' then
    raise exception 'M032_HEARTBEAT_RECONCILER_STATE_INVALID:%',hb1;
  end if;
  if (select count(*) from public.operations_watchdog_runs where organization_id='32000000-0000-4000-8000-000000000001')<1 then
    raise exception 'M032_HEARTBEAT_WATCHDOG_RUN_MISSING';
  end if;
  if (select count(*) from public.control_cadence_reconciliation_runs where organization_id='32000000-0000-4000-8000-000000000001')<1 then
    raise exception 'M032_HEARTBEAT_RECONCILIATION_RUN_MISSING';
  end if;
  if bucket_before=bucket_after and (hb2->'operations_health'->>'replayed')::boolean is not true then
    raise exception 'M032_HEARTBEAT_BUCKET_NOT_IDEMPOTENT:%',hb2;
  end if;
  if not exists (select 1 from public.hybrid_dispatch_ticks
      where organization_id='32000000-0000-4000-8000-000000000001' and tick_kind='HEARTBEAT')
  then raise exception 'M032_HEARTBEAT_TICK_MISSING'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Credential broker read: happy path + rate limit + no key material in audit.
-- ---------------------------------------------------------------------------
do $$ declare result jsonb; mailbox_id_value uuid; sentinel text; begin
  select id into mailbox_id_value from public.mailboxes
  where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
  sentinel := encode(convert_to('m032-ciphertext-sentinel-never-audit','utf8'),'base64');
  result := app.m032_credential('32000000-0000-4000-8000-000000000001',mailbox_id_value,'m032-cred-1');
  if result->>'ciphertext'<>sentinel
    or result->>'kms_key_name'<>'projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail'
    or result->>'kms_key_version'<>'3'
    or result->>'credential_sha256'<>repeat('6',64)
    or result->>'normalized_email'<>'contacto@ennco.com.mx'
    or jsonb_array_length(result->'granted_scopes')<>4
  then raise exception 'M032_CREDENTIAL_READ_INVALID'; end if;
  if not exists (select 1 from public.audit_log where organization_id='32000000-0000-4000-8000-000000000001'
      and action='GMAIL_CREDENTIAL_READ_FOR_DISPATCH')
  then raise exception 'M032_CREDENTIAL_AUDIT_MISSING'; end if;
  if exists (select 1 from public.audit_log where organization_id='32000000-0000-4000-8000-000000000001'
      and action='GMAIL_CREDENTIAL_READ_FOR_DISPATCH'
      and (coalesce(old_data::text,'')||coalesce(new_data::text,'')) like '%'||sentinel||'%')
  then raise exception 'M032_CREDENTIAL_AUDIT_LEAKED_CIPHERTEXT'; end if;
  if exists (select 1 from public.hybrid_dispatch_ticks
      where organization_id='32000000-0000-4000-8000-000000000001' and tick_kind='CREDENTIAL'
      and detail_json::text like '%'||sentinel||'%')
  then raise exception 'M032_CREDENTIAL_TICK_LEAKED_CIPHERTEXT'; end if;
  begin
    perform app.m032_credential('32000000-0000-4000-8000-000000000001',mailbox_id_value,'m032-cred-2');
    raise exception 'EXPECTED_M032_CREDENTIAL_RATE_LIMIT';
  exception when others then if sqlerrm<>'DISPATCH_CREDENTIAL_RATE_LIMITED' then raise; end if; end;
end $$;

-- ---------------------------------------------------------------------------
-- Outbox wrappers: claim / complete / fail through proofs.
-- ---------------------------------------------------------------------------
do $$ declare claim_result jsonb; event_a uuid; event_b uuid; result jsonb; begin
  claim_result := app.m032_outbox_claim('32000000-0000-4000-8000-000000000001',10,'m032-outbox-claim-1');
  if (claim_result->>'count')::integer<2 then raise exception 'M032_OUTBOX_CLAIM_EMPTY:%',claim_result->>'count'; end if;
  event_a := (claim_result->'events'->0->>'id')::uuid;
  event_b := (claim_result->'events'->1->>'id')::uuid;
  result := app.m032_outbox_complete('32000000-0000-4000-8000-000000000001',event_a,'m032-outbox-complete-1');
  if result->>'status'<>'DELIVERED' then raise exception 'M032_OUTBOX_COMPLETE_INVALID:%',result; end if;
  if (select status from public.event_outbox where id=event_a)<>'DELIVERED' then
    raise exception 'M032_OUTBOX_COMPLETE_STATE_INVALID';
  end if;
  result := app.m032_outbox_fail('32000000-0000-4000-8000-000000000001',event_b,'M032 synthetic delivery error','m032-outbox-fail-1');
  if result->>'status'<>'FAILED' then raise exception 'M032_OUTBOX_FAIL_INVALID:%',result; end if;
  if (select status from public.event_outbox where id=event_b)<>'FAILED' then
    raise exception 'M032_OUTBOX_FAIL_STATE_INVALID';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Sync cursor wrapper: advance + stale regression guard.
-- ---------------------------------------------------------------------------
do $$ declare result jsonb; mailbox_id_value uuid; begin
  select id into mailbox_id_value from public.mailboxes
  where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
  result := app.m032_cursor('32000000-0000-4000-8000-000000000001',mailbox_id_value,'12345',clock_timestamp()+interval '7 days','m032-cursor-1');
  if result->>'status'<>'ADVANCED' then raise exception 'M032_CURSOR_ADVANCE_INVALID:%',result; end if;
  if (select last_history_id from public.mailbox_sync_cursors
      where organization_id='32000000-0000-4000-8000-000000000001' and mailbox_id=mailbox_id_value)<>'12345'
    or (select status::text from public.mailbox_sync_cursors
      where organization_id='32000000-0000-4000-8000-000000000001' and mailbox_id=mailbox_id_value)<>'READY'
  then raise exception 'M032_CURSOR_STATE_INVALID'; end if;
  result := app.m032_cursor('32000000-0000-4000-8000-000000000001',mailbox_id_value,'12344',null,'m032-cursor-2');
  if result->>'status'<>'STALE' then raise exception 'M032_CURSOR_REGRESSION_ACCEPTED:%',result; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Stuck SENDING guard: a SENDING message older than 10 minutes NOOPs the claim.
-- ---------------------------------------------------------------------------
update public.campaign_enrollments set status='ACTIVE' where id='32600000-0000-4000-8000-000000000002';
insert into public.messages(id,organization_id,enrollment_id,mailbox_id,contact_id,direction,status,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
select '32800000-0000-4000-8000-000000000005','32000000-0000-4000-8000-000000000001','32600000-0000-4000-8000-000000000002',
  (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  '32300000-0000-4000-8000-000000000002','OUTBOUND','QUEUED',1,'buyer2@m032-tier1-two.invalid','contacto@ennco.com.mx',
  e.envelope->>'subject',e.envelope->>'body_text','m032-direct-e2t1-a1',gen_random_uuid()
from public.campaigns c,jsonb_array_elements(c.manifest_json#>'{hybrid,envelopes}') e(envelope)
where c.id='32400000-0000-4000-8000-000000000001'
  and e.envelope->>'enrollment_id'='32600000-0000-4000-8000-000000000002' and (e.envelope->>'touch_number')::integer=1;
update public.messages set status='SENDING' where id='32800000-0000-4000-8000-000000000005';
alter table public.messages disable trigger messages_updated_at;
update public.messages set updated_at=clock_timestamp()-interval '11 minutes' where id='32800000-0000-4000-8000-000000000005';
alter table public.messages enable trigger messages_updated_at;

do $$ declare result jsonb; begin
  result := app.m032_claim('32000000-0000-4000-8000-000000000001',true,'m032-stuck-claim-1');
  if result->>'status'<>'NOOP' or result->>'reason'<>'STUCK_SENDING_REQUIRES_RECONCILE'
    or result->>'message_id'<>'32800000-0000-4000-8000-000000000005'
  then raise exception 'M032_STUCK_SENDING_NOOP_INVALID:%',result; end if;
  -- reconcile the stuck message so later checks stay deterministic.
  result := app.m032_settle('32000000-0000-4000-8000-000000000001','32800000-0000-4000-8000-000000000005','FAILED',null,null,'DISPATCH_TIMEOUT','m032-settle-5-failed');
  if result->>'status'<>'FAILED' then raise exception 'M032_STUCK_RECONCILE_INVALID:%',result; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Real-lane claim gates, fully deterministic: RUNTIME_HOLD when closed, then
-- OUTSIDE_SEND_WINDOW or PACING_HOLD depending on the wall clock (the pacing
-- branch is guaranteed by the message sent seconds ago).
-- ---------------------------------------------------------------------------
do $$ declare result jsonb; begin
  update public.runtime_controls set global_kill_switch=true,external_send_allowed=false
  where organization_id='32000000-0000-4000-8000-000000000001';
  result := app.m032_claim('32000000-0000-4000-8000-000000000001',false,'m032-real-runtime-1');
  if result->>'status'<>'NOOP' or result->>'reason'<>'RUNTIME_HOLD' then
    raise exception 'M032_REAL_CLAIM_RUNTIME_HOLD_INVALID:%',result;
  end if;
  update public.runtime_controls set global_kill_switch=false,external_send_allowed=true
  where organization_id='32000000-0000-4000-8000-000000000001';
  result := app.m032_claim('32000000-0000-4000-8000-000000000001',false,'m032-real-window-1');
  if app.hybrid_dispatch_window_is_open(clock_timestamp()) then
    if result->>'status'<>'NOOP' or result->>'reason'<>'PACING_HOLD' then
      raise exception 'M032_REAL_CLAIM_PACING_INVALID:%',result;
    end if;
  else
    if result->>'status'<>'NOOP' or result->>'reason'<>'OUTSIDE_SEND_WINDOW' then
      raise exception 'M032_REAL_CLAIM_WINDOW_INVALID:%',result;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- (9) daily cap respected: fill the mailbox to its cap, then claim NOOPs with
-- BUDGET_EXHAUSTED. One message intentionally stays SENDING for the rollback gate.
-- ---------------------------------------------------------------------------
insert into public.messages(id,organization_id,enrollment_id,mailbox_id,contact_id,direction,status,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
select ('32800000-0000-4000-8000-00000000001'||row_number() over (order by fill.enrollment_key,fill.touch_value))::uuid,
  '32000000-0000-4000-8000-000000000001',fill.enrollment_key::uuid,
  (select id from public.mailboxes where organization_id='32000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  fill.contact_key::uuid,'OUTBOUND','QUEUED',fill.touch_value,fill.to_email,'contacto@ennco.com.mx',
  e.envelope->>'subject',e.envelope->>'body_text','m032-capfill-'||fill.enrollment_key||'-t'||fill.touch_value,gen_random_uuid()
from (values
  ('32600000-0000-4000-8000-000000000001','32300000-0000-4000-8000-000000000001','buyer1@m032-tier1-one.invalid',3),
  ('32600000-0000-4000-8000-000000000002','32300000-0000-4000-8000-000000000002','buyer2@m032-tier1-two.invalid',1),
  ('32600000-0000-4000-8000-000000000002','32300000-0000-4000-8000-000000000002','buyer2@m032-tier1-two.invalid',2),
  ('32600000-0000-4000-8000-000000000002','32300000-0000-4000-8000-000000000002','buyer2@m032-tier1-two.invalid',3)
) fill(enrollment_key,contact_key,to_email,touch_value)
join public.campaigns c on c.id='32400000-0000-4000-8000-000000000001'
join lateral jsonb_array_elements(c.manifest_json#>'{hybrid,envelopes}') e(envelope)
  on e.envelope->>'enrollment_id'=fill.enrollment_key and (e.envelope->>'touch_number')::integer=fill.touch_value;
update public.messages set status='SENDING' where idempotency_key='m032-capfill-32600000-0000-4000-8000-000000000002-t2';

do $$ declare result jsonb; counted integer; begin
  select count(*) into counted from public.messages
  where organization_id='32000000-0000-4000-8000-000000000001' and direction='OUTBOUND'
    and status in ('QUEUED','SENDING','SENT','DELIVERED')
    and (created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date;
  if counted<>5 then raise exception 'M032_CAP_FIXTURE_COUNT_INVALID:%',counted; end if;
  result := app.m032_claim('32000000-0000-4000-8000-000000000001',true,'m032-budget-claim-1');
  if result->>'status'<>'NOOP' or result->>'reason'<>'BUDGET_EXHAUSTED' then
    raise exception 'M032_BUDGET_EXHAUSTED_INVALID:%',result;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Consolidated health read.
-- ---------------------------------------------------------------------------
do $$ declare result jsonb; begin
  result := app.m032_health('32000000-0000-4000-8000-000000000001','m032-health-1');
  if result->>'status'<>'READ_ONLY'
    or (result->'active_release'->>'budget_remaining')::integer<>0
    or (result->>'unresolved_dead_letters')::integer<1
    or result->'messages_today' is null
    or result->'outbox' is null
    or result->'cadence_health' is null
    or (result->'operations_health'->>'last_watchdog_status') is null
    or (result->'latest_live_observation'->>'attempted_deliveries')::integer<>1
    or result->>'send_window_open' is null
  then raise exception 'M032_HEALTH_READ_INVALID:%',result; end if;
  if not exists (select 1 from public.hybrid_dispatch_ticks
      where organization_id='32000000-0000-4000-8000-000000000001' and tick_kind='HEALTH')
  then raise exception 'M032_HEALTH_TICK_MISSING'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: RPCs for anon+authenticated only; tick ledger is read-only.
-- ---------------------------------------------------------------------------
do $$ begin
  if not has_function_privilege('anon','public.claim_hybrid_dispatch(uuid,boolean,text,uuid,timestamptz,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.settle_hybrid_dispatch(uuid,uuid,text,text,text,text,text,uuid,timestamptz,text)','EXECUTE')
    or not has_function_privilege('anon','public.run_dispatch_heartbeat(uuid,text,uuid,timestamptz,text)','EXECUTE')
    or has_function_privilege('service_role','public.claim_hybrid_dispatch(uuid,boolean,text,uuid,timestamptz,text)','EXECUTE')
    or has_function_privilege('service_role','public.read_hybrid_dispatch_credential(uuid,uuid,text,uuid,timestamptz,text)','EXECUTE')
  then raise exception 'M032_RPC_PRIVILEGES_INVALID'; end if;
  if has_table_privilege('authenticated','public.hybrid_dispatch_ticks','INSERT')
    or has_table_privilege('authenticated','public.hybrid_dispatch_ticks','UPDATE')
    or has_table_privilege('authenticated','public.hybrid_dispatch_ticks','DELETE')
    or has_table_privilege('anon','public.hybrid_dispatch_ticks','SELECT')
    or has_table_privilege('service_role','public.hybrid_dispatch_ticks','SELECT')
    or not has_table_privilege('authenticated','public.hybrid_dispatch_ticks','SELECT')
  then raise exception 'M032_TICK_LEDGER_PRIVILEGES_INVALID'; end if;
end $$;

-- Re-arm the send-health gates for the rollback phase and drop the disposable
-- helpers (annex triggers stay isolated, exactly as at the end of the M29 gate).
alter table public.messages enable trigger messages_operations_send_health;
alter table public.messages enable trigger messages_control_cadence_send_health;

drop function app.m032_health(uuid,text);
drop function app.m032_cursor(uuid,uuid,text,timestamptz,text);
drop function app.m032_provider_event(uuid,uuid,text,text,uuid,text,text,text,text,timestamptz,text);
drop function app.m032_outbox_fail(uuid,uuid,text,text);
drop function app.m032_outbox_complete(uuid,uuid,text);
drop function app.m032_outbox_claim(uuid,integer,text);
drop function app.m032_credential(uuid,uuid,text);
drop function app.m032_heartbeat(uuid,text);
drop function app.m032_settle(uuid,uuid,text,text,text,text,text);
drop function app.m032_claim(uuid,boolean,text);
drop function app.m032_payload(text[]);
drop function app.m032_sign(uuid,text,text,uuid,timestamptz);
drop function app.m032_test_observation(integer,integer,integer,integer,timestamptz);
drop function app.m032_test_mailbox_snapshot(text,text,text,timestamptz,timestamptz);

select 'HYBRID_DISPATCH_GATE_PASS' as result;
