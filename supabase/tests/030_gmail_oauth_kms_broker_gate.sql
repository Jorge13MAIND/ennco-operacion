-- M033: estas aserciones prueban el rechazo de la sesión de un solo factor.
-- Se fija la política en modo estricto para que sigan probando exactamente lo
-- mismo que antes de DEC-106. Los dos modos se prueban en el gate 034.
do $m033$ begin
  if to_regclass('app.auth_policy') is not null then
    update app.auth_policy set require_mfa = true;
  end if;
end $m033$;

\set ON_ERROR_STOP on

insert into public.organizations(id,slug,legal_name) values
  ('30000000-0000-4000-8000-000000000001','m030-ennco','ENNCO M030 Synthetic'),
  ('30000000-0000-4000-8000-000000000002','m030-other','M030 Other Tenant');
insert into public.organization_users(organization_id,user_id,role) values
  ('30000000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000001','teckel_admin'),
  ('30000000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000002','teckel_operator'),
  ('30000000-0000-4000-8000-000000000002','30100000-0000-4000-8000-000000000003','teckel_admin');
insert into app.private_runtime_config(organization_id,prequote_ingest_secret,gmail_oauth_completion_secret) values
  ('30000000-0000-4000-8000-000000000001',repeat('p',64),'synthetic-m030-completion-secret-at-least-32'),
  ('30000000-0000-4000-8000-000000000002',repeat('q',64),'synthetic-m030-other-completion-secret-32');
insert into public.mailboxes(
  id,organization_id,normalized_email,domain,sender_name,provider,
  eligibility_route,domain_role,custody_status,warmup_minimum_days
) values
  ('30200000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
   'contacto@ennco.com.mx','ennco.com.mx','Francisco Cuellar','gmail',
   'EXISTING_PRIMARY_GMAIL_RAMP','PRIMARY_CORPORATE','TECKEL_MANAGED_FOR_ENNCO',0),
  ('30200000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',
   'contacto@other.invalid','other.invalid','Other Sender','gmail',
   'EXISTING_PRIMARY_GMAIL_RAMP','PRIMARY_CORPORATE','ENNCO_DIRECT',0);

set request.jwt.claim.sub='30100000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal1';
set role authenticated;
do $$ begin
  begin
    perform public.begin_gmail_oauth_authorization(
      '30000000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001',
      repeat('1',64),repeat('A',43),repeat('2',64),
      array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'],
      clock_timestamp()+interval '5 minutes',repeat('3',64));
    raise exception 'EXPECTED_M030_AAL1_REJECTION';
  exception when others then if sqlerrm<>'GMAIL_OAUTH_AAL2_OPERATOR_REQUIRED' then raise; end if; end;
end $$;
reset role;

set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ begin
  begin
    perform public.begin_gmail_oauth_authorization(
      '30000000-0000-4000-8000-000000000002','30200000-0000-4000-8000-000000000002',
      repeat('1',64),repeat('A',43),repeat('2',64),
      array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'],
      clock_timestamp()+interval '5 minutes',repeat('3',64));
    raise exception 'EXPECTED_M030_CROSS_TENANT_REJECTION';
  exception when others then if sqlerrm<>'GMAIL_OAUTH_AAL2_OPERATOR_REQUIRED' then raise; end if; end;
  begin
    update public.mailboxes set encrypted_refresh_token='raw-token-forbidden'
    where id='30200000-0000-4000-8000-000000000001';
    raise exception 'EXPECTED_M030_LEGACY_TOKEN_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.gmail_oauth_credentials;
    raise exception 'EXPECTED_M030_VAULT_SELECT_REJECTION';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin
  begin
    update public.mailboxes set encrypted_refresh_token='owner-token-forbidden'
    where id='30200000-0000-4000-8000-000000000001';
    raise exception 'EXPECTED_M030_LEGACY_TOKEN_REJECTION';
  exception when others then if sqlerrm<>'LEGACY_MAILBOX_REFRESH_TOKEN_STORAGE_FORBIDDEN' then raise; end if; end;
end $$;

set role service_role;
do $$ begin
  begin
    insert into public.gmail_oauth_credentials(
      organization_id,mailbox_id,authorization_id,ciphertext,kms_key_name,kms_key_version,
      google_subject_sha256,normalized_email,granted_scopes,token_issued_at,credential_sha256
    ) values(
      '30000000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001',gen_random_uuid(),
      repeat('A',24),'projects/x/locations/us/keyRings/x/cryptoKeys/x','1',repeat('1',64),'contacto@ennco.com.mx',
      array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'],
      clock_timestamp(),repeat('2',64));
    raise exception 'EXPECTED_M030_SERVICE_ROLE_DML_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.gmail_oauth_credentials;
    raise exception 'EXPECTED_M030_SERVICE_ROLE_SELECT_REJECTION';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set request.jwt.claim.aal='aal2';
set role authenticated;
select public.begin_gmail_oauth_authorization(
  '30000000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001',
  repeat('1',64),repeat('A',43),repeat('2',64),
  array['openid','email','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly'],
  clock_timestamp()+interval '5 minutes',repeat('3',64)
) as start_result \gset
select case when :'start_result'::jsonb->>'status'='STARTED'
  and :'start_result'::jsonb->>'mailbox_id'='30200000-0000-4000-8000-000000000001'
  then 1 else 1/0 end as m030_start_response_must_be_valid;
reset role;

do $$ begin
  if exists(select 1 from public.gmail_oauth_authorizations where state_sha256<>repeat('1',64))
  then raise exception 'M030_RAW_STATE_PERSISTED'; end if;
  if exists(select 1 from public.gmail_oauth_authorizations where granted_scopes<>
    array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'])
  then raise exception 'M030_SCOPES_NOT_CANONICAL'; end if;
end $$;

set role authenticated;
select public.begin_gmail_oauth_authorization(
  '30000000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001',
  repeat('1',64),repeat('A',43),repeat('2',64),
  array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'],
  (:'start_result'::jsonb->>'expires_at')::timestamptz,repeat('3',64)
) as duplicate_start \gset
select case when :'duplicate_start'::jsonb->>'status'='DUPLICATE'
  then 1 else 1/0 end as m030_start_replay_must_be_duplicate;
do $$ begin
  begin
    perform public.begin_gmail_oauth_authorization(
      '30000000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001',
      repeat('4',64),repeat('B',43),repeat('2',64),
      array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'],
      clock_timestamp()+interval '5 minutes',repeat('3',64));
    raise exception 'EXPECTED_M030_START_DRIFT_REJECTION';
  exception when others then if sqlerrm<>'GMAIL_OAUTH_IDEMPOTENCY_DRIFT' then raise; end if; end;
end $$;
reset role;

set request.jwt.claim.sub='30100000-0000-4000-8000-000000000002';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare
  ciphertext_value text:=encode(convert_to('m030-ciphertext-sentinel-never-audit','utf8'),'base64');
  credential_sha text;
begin
  credential_sha:=encode(digest(convert_to(concat_ws(E'\n',ciphertext_value,
    'projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail','7',repeat('5',64),
    'contacto@ennco.com.mx','email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send openid'),'utf8'),'sha256'),'hex');
  begin
    perform public.complete_gmail_oauth_authorization(
      '30000000-0000-4000-8000-000000000001',repeat('1',64),ciphertext_value,
      'projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail','7',repeat('5',64),'contacto@ennco.com.mx',
      array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'],
      clock_timestamp(),credential_sha,repeat('6',64),
      'f8cefee0a7ca3fa30482c7c258c088fdfa34b0ae46ac24a7af0b63a6be605620');
    raise exception 'EXPECTED_M030_ACTOR_MISMATCH_REJECTION';
  exception when others then if sqlerrm<>'GMAIL_OAUTH_ACTOR_MISMATCH' then raise; end if; end;
end $$;
reset role;

set request.jwt.claim.sub='30100000-0000-4000-8000-000000000001';
set role authenticated;
do $$ declare
  ciphertext_value text:=encode(convert_to('m030-ciphertext-sentinel-never-audit','utf8'),'base64');
begin
  begin
    perform public.complete_gmail_oauth_authorization(
      '30000000-0000-4000-8000-000000000001',repeat('1',64),ciphertext_value,
      'projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail','7',repeat('5',64),'contacto@ennco.com.mx',
      array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'],
      clock_timestamp(),repeat('0',64),repeat('6',64),repeat('0',64));
    raise exception 'EXPECTED_M030_CREDENTIAL_SHA_REJECTION';
  exception when others then if sqlerrm<>'GMAIL_OAUTH_CREDENTIAL_SHA_MISMATCH' then raise; end if; end;
end $$;

do $$ declare
  ciphertext_value text:=encode(convert_to('m030-ciphertext-sentinel-never-audit','utf8'),'base64');
  credential_sha text;
begin
  credential_sha:=encode(digest(convert_to(concat_ws(E'\n',ciphertext_value,
    'projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail','7',repeat('5',64),
    'contacto@ennco.com.mx','email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send openid'),'utf8'),'sha256'),'hex');
  begin
    perform public.complete_gmail_oauth_authorization(
      '30000000-0000-4000-8000-000000000001',repeat('1',64),ciphertext_value,
      'projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail','7',repeat('5',64),'contacto@ennco.com.mx',
      array['email','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','openid'],
      clock_timestamp(),credential_sha,repeat('6',64),repeat('0',64));
    raise exception 'EXPECTED_M030_ATTESTATION_REJECTION';
  exception when others then if sqlerrm<>'GMAIL_OAUTH_COMPLETION_ATTESTATION_INVALID' then raise; end if; end;
end $$;

select public.complete_gmail_oauth_authorization(
  '30000000-0000-4000-8000-000000000001',repeat('1',64),
  encode(convert_to('m030-ciphertext-sentinel-never-audit','utf8'),'base64'),
  'projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail','7',repeat('5',64),'contacto@ennco.com.mx',
  array['openid','https://www.googleapis.com/auth/gmail.send','email','https://www.googleapis.com/auth/gmail.readonly'],
  clock_timestamp(),
  encode(digest(convert_to(concat_ws(E'\n',encode(convert_to('m030-ciphertext-sentinel-never-audit','utf8'),'base64'),
    'projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail','7',repeat('5',64),'contacto@ennco.com.mx',
    'email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send openid'),'utf8'),'sha256'),'hex'),
  repeat('6',64),
  'f8cefee0a7ca3fa30482c7c258c088fdfa34b0ae46ac24a7af0b63a6be605620'
) as complete_result \gset
select case when :'complete_result'::jsonb->>'status'='CONNECTED'
  and :'complete_result'::jsonb->>'mailbox_id'='30200000-0000-4000-8000-000000000001'
  then 1 else 1/0 end as m030_complete_response_must_be_valid;

select public.evaluate_gmail_oauth_readiness(
  '30000000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001'
) as readiness_result \gset
select case when :'readiness_result'::jsonb->>'state'='READY'
  and :'readiness_result'::jsonb->>'reason_code' is null
  and not (:'readiness_result'::jsonb ? 'ciphertext')
  and not (:'readiness_result'::jsonb ? 'kms_key_name')
  and not (:'readiness_result'::jsonb ? 'google_subject_sha256')
  then 1 else 1/0 end as m030_readiness_must_be_safe;
reset role;

do $$ declare sentinel text:=encode(convert_to('m030-ciphertext-sentinel-never-audit','utf8'),'base64'); begin
  if (select count(*) from public.gmail_oauth_credentials where organization_id='30000000-0000-4000-8000-000000000001')<>1
    or (select credential_status from public.mailboxes where id='30200000-0000-4000-8000-000000000001')<>'OAUTH_CONNECTED'
    or (select encrypted_refresh_token from public.mailboxes where id='30200000-0000-4000-8000-000000000001') is not null
  then raise exception 'M030_CREDENTIAL_STATE_INVALID'; end if;
  if exists(select 1 from public.audit_log where organization_id='30000000-0000-4000-8000-000000000001'
    and (coalesce(old_data::text,'')||coalesce(new_data::text,'')) like '%'||sentinel||'%')
    or exists(select 1 from public.event_outbox where organization_id='30000000-0000-4000-8000-000000000001'
      and payload_json::text like '%'||sentinel||'%')
  then raise exception 'M030_CIPHERTEXT_LEAKED_TO_AUDIT_OR_OUTBOX'; end if;
  if (select count(*) from public.event_outbox where organization_id='30000000-0000-4000-8000-000000000001'
      and event_type='gmail.oauth.connected')<>1
  then raise exception 'M030_CONNECTED_OUTBOX_MISSING'; end if;
  if has_table_privilege('authenticated','public.gmail_oauth_credentials','SELECT')
    or has_table_privilege('authenticated','public.gmail_oauth_credentials','INSERT')
    or has_table_privilege('service_role','public.gmail_oauth_credentials','SELECT')
    or has_table_privilege('service_role','public.gmail_oauth_credentials','UPDATE')
  then raise exception 'M030_VAULT_PRIVILEGE_LEAK'; end if;
end $$;

select 'GMAIL_OAUTH_KMS_BROKER_FORWARD_PASS' as result;
