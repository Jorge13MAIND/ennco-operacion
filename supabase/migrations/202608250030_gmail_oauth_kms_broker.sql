begin;

drop trigger if exists mailboxes_aaa_m030_rollback_fail_closed on public.mailboxes;
drop function if exists app.m030_block_oauth_connected_after_rollback();

alter table app.private_runtime_config
  add column if not exists gmail_oauth_completion_secret text;
alter table app.private_runtime_config
  drop constraint if exists private_runtime_config_gmail_oauth_completion_secret_check;
alter table app.private_runtime_config
  add constraint private_runtime_config_gmail_oauth_completion_secret_check
  check (gmail_oauth_completion_secret is null or length(gmail_oauth_completion_secret)>=32);

create or replace function app.gmail_oauth_scopes_are_exact(target_scopes text[])
returns boolean
language sql
immutable
set search_path=pg_catalog
as $$
  select coalesce(cardinality(target_scopes)=4,false)
    and target_scopes @> array[
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'openid'
    ]::text[]
    and target_scopes <@ array[
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'openid'
    ]::text[];
$$;

create table if not exists public.gmail_oauth_authorizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null,
  state_sha256 text not null check (state_sha256 ~ '^[a-f0-9]{64}$'),
  pkce_challenge text not null check (pkce_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  redirect_uri_sha256 text not null check (redirect_uri_sha256 ~ '^[a-f0-9]{64}$'),
  granted_scopes text[] not null check (app.gmail_oauth_scopes_are_exact(granted_scopes)),
  status text not null default 'PENDING' check (status in ('PENDING','CONSUMED','EXPIRED','REVOKED')),
  requested_by uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  start_idempotency_key text not null check (start_idempotency_key ~ '^[a-f0-9]{64}$'),
  start_request_sha256 text not null check (start_request_sha256 ~ '^[a-f0-9]{64}$'),
  completion_idempotency_key text check (completion_idempotency_key is null or completion_idempotency_key ~ '^[a-f0-9]{64}$'),
  completed_request_sha256 text check (completed_request_sha256 is null or completed_request_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,state_sha256),
  unique (organization_id,start_idempotency_key),
  constraint gmail_oauth_authorizations_mailbox_tenant_fkey
    foreign key (organization_id,mailbox_id) references public.mailboxes(organization_id,id),
  constraint gmail_oauth_authorizations_requester_tenant_fkey
    foreign key (organization_id,requested_by) references public.organization_users(organization_id,user_id),
  check ((status='CONSUMED')=(consumed_at is not null)),
  check (expires_at>created_at)
);

create index if not exists gmail_oauth_authorizations_pending_idx
on public.gmail_oauth_authorizations(organization_id,mailbox_id,expires_at)
where status='PENDING';

create table if not exists public.gmail_oauth_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null,
  authorization_id uuid not null,
  ciphertext text not null check (length(ciphertext) between 24 and 65536 and ciphertext ~ '^[A-Za-z0-9+/]+={0,2}$'),
  kms_key_name text not null check (kms_key_name ~ '^projects/[^/]+/locations/[^/]+/keyRings/[^/]+/cryptoKeys/[^/]+$'),
  kms_key_version text not null check (kms_key_version ~ '^[0-9]+$'),
  google_subject_sha256 text not null check (google_subject_sha256 ~ '^[a-f0-9]{64}$'),
  normalized_email text not null check (normalized_email=lower(normalized_email)),
  granted_scopes text[] not null check (app.gmail_oauth_scopes_are_exact(granted_scopes)),
  token_issued_at timestamptz not null,
  credential_sha256 text not null check (credential_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ERROR','REVOKED')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,mailbox_id),
  unique (organization_id,authorization_id),
  constraint gmail_oauth_credentials_mailbox_tenant_fkey
    foreign key (organization_id,mailbox_id) references public.mailboxes(organization_id,id),
  constraint gmail_oauth_credentials_authorization_tenant_fkey
    foreign key (organization_id,authorization_id) references public.gmail_oauth_authorizations(organization_id,id)
);

create index if not exists gmail_oauth_credentials_status_idx
on public.gmail_oauth_credentials(organization_id,status,mailbox_id);

create table if not exists public.gmail_oauth_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null,
  command_type text not null check (command_type in ('START','COMPLETE')),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb not null,
  actor_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,command_type,idempotency_key),
  constraint gmail_oauth_commands_mailbox_tenant_fkey
    foreign key (organization_id,mailbox_id) references public.mailboxes(organization_id,id),
  constraint gmail_oauth_commands_actor_tenant_fkey
    foreign key (organization_id,actor_user_id) references public.organization_users(organization_id,user_id)
);

alter table public.gmail_oauth_authorizations enable row level security;
alter table public.gmail_oauth_authorizations force row level security;
alter table public.gmail_oauth_credentials enable row level security;
alter table public.gmail_oauth_credentials force row level security;
alter table public.gmail_oauth_commands enable row level security;
alter table public.gmail_oauth_commands force row level security;

revoke all on public.gmail_oauth_authorizations,public.gmail_oauth_credentials,public.gmail_oauth_commands
from public,anon,authenticated,service_role;

update public.mailboxes set encrypted_refresh_token=null where encrypted_refresh_token is not null;

create or replace function app.prevent_legacy_mailbox_refresh_token()
returns trigger
language plpgsql
set search_path=pg_catalog
as $$
begin
  if new.encrypted_refresh_token is not null then
    raise exception 'LEGACY_MAILBOX_REFRESH_TOKEN_STORAGE_FORBIDDEN';
  end if;
  return new;
end;
$$;

drop trigger if exists mailboxes_aaa_prevent_legacy_refresh_token on public.mailboxes;
create trigger mailboxes_aaa_prevent_legacy_refresh_token
before insert or update of encrypted_refresh_token on public.mailboxes
for each row execute function app.prevent_legacy_mailbox_refresh_token();

create or replace function public.begin_gmail_oauth_authorization(
  target_organization_id uuid,
  target_mailbox_id uuid,
  target_state_sha256 text,
  target_pkce_challenge text,
  target_redirect_uri_sha256 text,
  target_scopes text[],
  target_expires_at timestamptz,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  actor_id uuid:=auth.uid();
  now_value timestamptz:=clock_timestamp();
  mailbox_record public.mailboxes%rowtype;
  existing_command public.gmail_oauth_commands%rowtype;
  authorization_id uuid:=gen_random_uuid();
  request_sha text;
  response_value jsonb;
begin
  if actor_id is null or not app.has_role(target_organization_id,array[
    'ennco_admin'::public.user_role,'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role,'teckel_operator'::public.user_role
  ]) then raise exception 'GMAIL_OAUTH_AAL2_OPERATOR_REQUIRED'; end if;
  if target_state_sha256 !~ '^[a-f0-9]{64}$'
    or target_pkce_challenge !~ '^[A-Za-z0-9_-]{43,128}$'
    or target_redirect_uri_sha256 !~ '^[a-f0-9]{64}$'
    or target_idempotency_key !~ '^[a-f0-9]{64}$'
    or not app.gmail_oauth_scopes_are_exact(target_scopes)
  then raise exception 'GMAIL_OAUTH_START_INPUT_INVALID'; end if;
  if target_expires_at<now_value+interval '2 minutes' or target_expires_at>now_value+interval '10 minutes'
  then raise exception 'GMAIL_OAUTH_EXPIRY_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended('gmail-oauth:'||target_organization_id::text||':'||target_mailbox_id::text,0));
  select * into mailbox_record from public.mailboxes
  where organization_id=target_organization_id and id=target_mailbox_id for update;
  if not found then raise exception 'GMAIL_OAUTH_MAILBOX_NOT_FOUND'; end if;
  if mailbox_record.provider<>'gmail'
    or mailbox_record.normalized_email<>'contacto@ennco.com.mx'
    or coalesce(mailbox_record.eligibility_route,'')<>'EXISTING_PRIMARY_GMAIL_RAMP'
  then raise exception 'GMAIL_OAUTH_MAILBOX_NOT_ELIGIBLE'; end if;

  request_sha:=encode(digest(convert_to(jsonb_build_object(
    'organization_id',target_organization_id,'mailbox_id',target_mailbox_id,
    'state_sha256',target_state_sha256,'pkce_challenge',target_pkce_challenge,
    'redirect_uri_sha256',target_redirect_uri_sha256,
    'scopes',(select jsonb_agg(scope order by scope) from unnest(target_scopes) scope),
    'expires_at',target_expires_at
  )::text,'utf8'),'sha256'),'hex');
  select * into existing_command from public.gmail_oauth_commands
  where organization_id=target_organization_id and command_type='START' and idempotency_key=target_idempotency_key;
  if found then
    if existing_command.request_sha256<>request_sha then raise exception 'GMAIL_OAUTH_IDEMPOTENCY_DRIFT'; end if;
    return existing_command.response_json||jsonb_build_object('status','DUPLICATE');
  end if;

  update public.gmail_oauth_authorizations set status='EXPIRED'
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id
    and status='PENDING' and expires_at<=now_value;
  insert into public.gmail_oauth_authorizations(
    id,organization_id,mailbox_id,state_sha256,pkce_challenge,redirect_uri_sha256,
    granted_scopes,requested_by,expires_at,start_idempotency_key,start_request_sha256
  ) values (
    authorization_id,target_organization_id,target_mailbox_id,target_state_sha256,target_pkce_challenge,target_redirect_uri_sha256,
    (select array_agg(scope order by scope) from unnest(target_scopes) scope),actor_id,target_expires_at,target_idempotency_key,request_sha
  );
  response_value:=jsonb_build_object(
    'status','STARTED','authorization_id',authorization_id,'mailbox_id',target_mailbox_id,
    'expires_at',target_expires_at,'request_sha256',request_sha
  );
  insert into public.gmail_oauth_commands(organization_id,mailbox_id,command_type,idempotency_key,request_sha256,response_json,actor_user_id)
  values(target_organization_id,target_mailbox_id,'START',target_idempotency_key,request_sha,response_value,actor_id);
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values(target_organization_id,actor_id,'GMAIL_OAUTH_STARTED','mailboxes',target_mailbox_id,
    jsonb_build_object('authorization_id',authorization_id,'expires_at',target_expires_at,'scope_count',cardinality(target_scopes)));
  return response_value;
end;
$$;

create or replace function public.complete_gmail_oauth_authorization(
  target_organization_id uuid,
  target_state_sha256 text,
  target_ciphertext text,
  target_kms_key_name text,
  target_kms_key_version text,
  target_google_subject_sha256 text,
  target_normalized_email text,
  target_scopes text[],
  target_token_issued_at timestamptz,
  target_credential_sha256 text,
  target_idempotency_key text,
  target_completion_proof text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app,extensions,pg_temp
as $$
declare
  actor_id uuid:=auth.uid();
  now_value timestamptz:=clock_timestamp();
  authorization_record public.gmail_oauth_authorizations%rowtype;
  credential_record public.gmail_oauth_credentials%rowtype;
  existing_command public.gmail_oauth_commands%rowtype;
  canonical_scopes text[];
  completion_secret text;
  expected_credential_sha text;
  expected_completion_proof text;
  request_sha text;
  response_value jsonb;
begin
  if actor_id is null or not app.has_role(target_organization_id,array[
    'ennco_admin'::public.user_role,'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role,'teckel_operator'::public.user_role
  ]) then raise exception 'GMAIL_OAUTH_AAL2_OPERATOR_REQUIRED'; end if;
  canonical_scopes:=(select array_agg(scope order by scope) from unnest(target_scopes) scope);
  if target_state_sha256 !~ '^[a-f0-9]{64}$'
    or length(target_ciphertext) not between 24 and 65536 or target_ciphertext !~ '^[A-Za-z0-9+/]+={0,2}$'
    or target_kms_key_name !~ '^projects/[^/]+/locations/[^/]+/keyRings/[^/]+/cryptoKeys/[^/]+$'
    or target_kms_key_version !~ '^[0-9]+$'
    or target_google_subject_sha256 !~ '^[a-f0-9]{64}$'
    or target_normalized_email<>lower(target_normalized_email)
    or not app.gmail_oauth_scopes_are_exact(target_scopes)
    or target_credential_sha256 !~ '^[a-f0-9]{64}$'
    or target_idempotency_key !~ '^[a-f0-9]{64}$'
    or target_completion_proof !~ '^[a-f0-9]{64}$'
  then raise exception 'GMAIL_OAUTH_COMPLETION_INPUT_INVALID'; end if;
  if target_token_issued_at>now_value+interval '5 minutes' or target_token_issued_at<now_value-interval '1 day'
  then raise exception 'GMAIL_OAUTH_TOKEN_TIME_INVALID'; end if;
  expected_credential_sha:=encode(digest(convert_to(concat_ws(E'\n',
    target_ciphertext,target_kms_key_name,target_kms_key_version,target_google_subject_sha256,
    target_normalized_email,array_to_string(canonical_scopes,' ')
  ),'utf8'),'sha256'),'hex');
  if expected_credential_sha<>target_credential_sha256 then raise exception 'GMAIL_OAUTH_CREDENTIAL_SHA_MISMATCH'; end if;
  select gmail_oauth_completion_secret into completion_secret from app.private_runtime_config
  where organization_id=target_organization_id;
  if completion_secret is null then raise exception 'GMAIL_OAUTH_COMPLETION_ATTESTATION_UNAVAILABLE'; end if;
  expected_completion_proof:=encode(app.hmac(
    convert_to(concat_ws(E'\n',target_organization_id::text,target_state_sha256,target_credential_sha256),'utf8'),
    convert_to(completion_secret,'utf8'),'sha256'
  ),'hex');
  if expected_completion_proof<>target_completion_proof then raise exception 'GMAIL_OAUTH_COMPLETION_ATTESTATION_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended('gmail-oauth-state:'||target_organization_id::text||':'||target_state_sha256,0));
  select * into authorization_record from public.gmail_oauth_authorizations
  where organization_id=target_organization_id and state_sha256=target_state_sha256 for update;
  if not found then raise exception 'GMAIL_OAUTH_STATE_UNKNOWN'; end if;
  if authorization_record.requested_by<>actor_id then raise exception 'GMAIL_OAUTH_ACTOR_MISMATCH'; end if;
  if authorization_record.expires_at<=now_value and authorization_record.status='PENDING' then
    update public.gmail_oauth_authorizations set status='EXPIRED' where id=authorization_record.id;
    raise exception 'GMAIL_OAUTH_STATE_EXPIRED';
  end if;
  if target_normalized_email<>(select normalized_email from public.mailboxes
    where organization_id=target_organization_id and id=authorization_record.mailbox_id)
  then raise exception 'GMAIL_OAUTH_IDENTITY_MISMATCH'; end if;
  if canonical_scopes<>authorization_record.granted_scopes then raise exception 'GMAIL_OAUTH_SCOPE_DRIFT'; end if;

  request_sha:=encode(digest(convert_to(jsonb_build_object(
    'authorization_id',authorization_record.id,'credential_sha256',target_credential_sha256,
    'token_issued_at',target_token_issued_at
  )::text,'utf8'),'sha256'),'hex');
  select * into existing_command from public.gmail_oauth_commands
  where organization_id=target_organization_id and command_type='COMPLETE' and idempotency_key=target_idempotency_key;
  if found then
    if existing_command.request_sha256<>request_sha then raise exception 'GMAIL_OAUTH_IDEMPOTENCY_DRIFT'; end if;
    return existing_command.response_json||jsonb_build_object('status','DUPLICATE');
  end if;
  if authorization_record.status='CONSUMED' then
    if authorization_record.completion_idempotency_key=target_idempotency_key
      and authorization_record.completed_request_sha256=request_sha
    then
      select * into credential_record from public.gmail_oauth_credentials
      where organization_id=target_organization_id and authorization_id=authorization_record.id;
      return jsonb_build_object('status','DUPLICATE','authorization_id',authorization_record.id,
        'credential_id',credential_record.id,'mailbox_id',authorization_record.mailbox_id,
        'credential_sha256',credential_record.credential_sha256);
    end if;
    raise exception 'GMAIL_OAUTH_STATE_ALREADY_CONSUMED';
  end if;
  if authorization_record.status<>'PENDING' then raise exception 'GMAIL_OAUTH_STATE_NOT_PENDING'; end if;

  insert into public.gmail_oauth_credentials(
    organization_id,mailbox_id,authorization_id,ciphertext,kms_key_name,kms_key_version,
    google_subject_sha256,normalized_email,granted_scopes,token_issued_at,credential_sha256,status
  ) values (
    target_organization_id,authorization_record.mailbox_id,authorization_record.id,target_ciphertext,target_kms_key_name,
    target_kms_key_version,target_google_subject_sha256,target_normalized_email,canonical_scopes,
    target_token_issued_at,target_credential_sha256,'ACTIVE'
  ) on conflict(organization_id,mailbox_id) do update set
    authorization_id=excluded.authorization_id,ciphertext=excluded.ciphertext,kms_key_name=excluded.kms_key_name,
    kms_key_version=excluded.kms_key_version,google_subject_sha256=excluded.google_subject_sha256,
    normalized_email=excluded.normalized_email,granted_scopes=excluded.granted_scopes,
    token_issued_at=excluded.token_issued_at,credential_sha256=excluded.credential_sha256,status='ACTIVE',
    updated_at=clock_timestamp()
  returning * into credential_record;

  update public.gmail_oauth_authorizations set status='CONSUMED',consumed_at=now_value,
    completion_idempotency_key=target_idempotency_key,completed_request_sha256=request_sha
  where id=authorization_record.id;
  update public.mailboxes set encrypted_refresh_token=null,credential_status='OAUTH_CONNECTED'
  where organization_id=target_organization_id and id=authorization_record.mailbox_id;
  response_value:=jsonb_build_object('status','CONNECTED','authorization_id',authorization_record.id,
    'credential_id',credential_record.id,'mailbox_id',authorization_record.mailbox_id,
    'credential_sha256',target_credential_sha256);
  insert into public.gmail_oauth_commands(organization_id,mailbox_id,command_type,idempotency_key,request_sha256,response_json,actor_user_id)
  values(target_organization_id,authorization_record.mailbox_id,'COMPLETE',target_idempotency_key,request_sha,response_value,actor_id);
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values(target_organization_id,actor_id,'GMAIL_OAUTH_CONNECTED','mailboxes',authorization_record.mailbox_id,
    jsonb_build_object('authorization_id',authorization_record.id,'credential_sha256',target_credential_sha256,
      'kms_key_version',target_kms_key_version,'scope_count',cardinality(target_scopes),'token_issued_at',target_token_issued_at));
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values(target_organization_id,'mailbox',authorization_record.mailbox_id,'gmail.oauth.connected',
    'gmail-oauth-connected:'||authorization_record.id::text,
    jsonb_build_object('organization_id',target_organization_id,'mailbox_id',authorization_record.mailbox_id,
      'status','OAUTH_CONNECTED','credential_sha256',target_credential_sha256))
  on conflict(organization_id,idempotency_key) do nothing;
  return response_value;
end;
$$;

create or replace function public.evaluate_gmail_oauth_readiness(target_organization_id uuid,target_mailbox_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app,pg_temp
as $$
declare mailbox_record public.mailboxes%rowtype; credential_record public.gmail_oauth_credentials%rowtype;
begin
  if not app.is_member(target_organization_id) then raise exception 'GMAIL_OAUTH_READ_AAL2_REQUIRED'; end if;
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id;
  if not found then raise exception 'GMAIL_OAUTH_MAILBOX_NOT_FOUND'; end if;
  select * into credential_record from public.gmail_oauth_credentials
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id;
  return jsonb_build_object('status','READ_ONLY','organization_id',target_organization_id,'mailbox_id',target_mailbox_id,
    'state',case when credential_record.id is null then 'UNKNOWN'
      when credential_record.status='ACTIVE' and mailbox_record.credential_status='OAUTH_CONNECTED' then 'READY'
      else 'BLOCKED' end,
    'reason_code',case when credential_record.id is null then 'GMAIL_OAUTH_CREDENTIAL_MISSING'
      when credential_record.status<>'ACTIVE' then 'GMAIL_OAUTH_CREDENTIAL_NOT_ACTIVE'
      when mailbox_record.credential_status<>'OAUTH_CONNECTED' then 'MAILBOX_CREDENTIAL_STATUS_DRIFT' else null end,
    'credential_sha256',credential_record.credential_sha256,'kms_key_version',credential_record.kms_key_version,
    'token_issued_at',credential_record.token_issued_at);
end;
$$;

revoke all on function app.gmail_oauth_scopes_are_exact(text[]) from public,anon,authenticated,service_role;
revoke all on function app.prevent_legacy_mailbox_refresh_token() from public,anon,authenticated,service_role;
revoke all on function public.begin_gmail_oauth_authorization(uuid,uuid,text,text,text,text[],timestamptz,text) from public,anon,service_role;
revoke all on function public.complete_gmail_oauth_authorization(uuid,text,text,text,text,text,text,text[],timestamptz,text,text,text) from public,anon,service_role;
revoke all on function public.evaluate_gmail_oauth_readiness(uuid,uuid) from public,anon,service_role;
grant execute on function public.begin_gmail_oauth_authorization(uuid,uuid,text,text,text,text[],timestamptz,text) to authenticated;
grant execute on function public.complete_gmail_oauth_authorization(uuid,text,text,text,text,text,text,text[],timestamptz,text,text,text) to authenticated;
grant execute on function public.evaluate_gmail_oauth_readiness(uuid,uuid) to authenticated;

commit;
