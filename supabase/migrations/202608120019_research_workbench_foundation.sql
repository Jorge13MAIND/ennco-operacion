begin;

create extension if not exists unaccent;

-- Reapplying after the fail-closed rollback removes only its explicit circuit breaker.
drop trigger if exists accounts_m019_rollback_fail_closed on public.accounts;

alter table public.accounts
  add column if not exists research_status text not null default 'SEED',
  add column if not exists priority_market text not null default 'EXPANSION_HOLD',
  add column if not exists research_verified_at timestamptz,
  add column if not exists research_verified_by uuid,
  add column if not exists research_created_by uuid,
  add column if not exists research_legal_name_key text,
  add column if not exists research_state text not null default 'UNKNOWN',
  add column if not exists research_coverage_exception_approved boolean not null default false;

alter table public.accounts drop constraint if exists accounts_research_status_check;
alter table public.accounts add constraint accounts_research_status_check check (
  research_status in ('SEED', 'IN_REVIEW', 'VERIFIED', 'QUARANTINED', 'MERGED', 'REJECTED')
  and ((research_status = 'VERIFIED' and research_verified_at is not null and research_verified_by is not null)
    or research_status <> 'VERIFIED')
);
alter table public.accounts drop constraint if exists accounts_priority_market_check;
alter table public.accounts add constraint accounts_priority_market_check check (
  priority_market in ('GTO_QRO_FIRST', 'EXPANSION_HOLD')
);
alter table public.accounts drop constraint if exists accounts_research_state_check;
alter table public.accounts add constraint accounts_research_state_check check (
  research_state in ('GUANAJUATO', 'QUERETARO', 'OTHER', 'UNKNOWN')
);

create unique index if not exists import_batches_organization_id_id_unique
  on public.import_batches (organization_id, id);
create unique index if not exists accounts_research_legal_name_key_unique
  on public.accounts (organization_id, research_legal_name_key)
  where research_legal_name_key is not null and not is_deleted;

alter table public.import_batches
  add column if not exists manifest_sha256 text,
  add column if not exists research_idempotency_key text;
alter table public.import_batches drop constraint if exists import_batches_manifest_sha256_check;
alter table public.import_batches add constraint import_batches_manifest_sha256_check
  check (manifest_sha256 is null or manifest_sha256 ~ '^[a-f0-9]{64}$');
create unique index if not exists import_batches_research_idempotency_unique
  on public.import_batches (organization_id, research_idempotency_key)
  where research_idempotency_key is not null;

alter table public.account_aliases
  drop constraint if exists account_aliases_account_id_fkey,
  drop constraint if exists account_aliases_account_tenant_fkey;
alter table public.account_aliases add constraint account_aliases_account_tenant_fkey
  foreign key (organization_id, account_id)
  references public.accounts (organization_id, id) on delete cascade;

alter table public.contacts
  drop constraint if exists contacts_account_id_fkey,
  drop constraint if exists contacts_account_tenant_fkey;
alter table public.contacts add constraint contacts_account_tenant_fkey
  foreign key (organization_id, account_id)
  references public.accounts (organization_id, id) on delete cascade;

create table if not exists public.research_import_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid not null,
  external_record_id text not null,
  source_row integer not null check (source_row > 0),
  raw_fingerprint text not null check (raw_fingerprint ~ '^[a-f0-9]{64}$'),
  legal_name text not null,
  legal_name_key text not null,
  primary_domain text,
  city text,
  state text not null,
  industrial_park text,
  sector text,
  source_url text,
  record_status text not null default 'PENDING' check (
    record_status in ('PENDING', 'ACCOUNT_CREATED', 'MATCHED', 'DUPLICATE_CANDIDATE', 'QUARANTINED')
  ),
  account_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, import_batch_id, external_record_id),
  unique (organization_id, import_batch_id, source_row),
  foreign key (organization_id, import_batch_id)
    references public.import_batches (organization_id, id) on delete cascade,
  foreign key (organization_id, account_id)
    references public.accounts (organization_id, id)
);

create table if not exists public.research_contact_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  full_name text not null,
  role_title text not null,
  role_category text not null check (
    role_category in ('CEO', 'PLANT_DIRECTOR', 'MAINTENANCE', 'PROCUREMENT', 'OTHER')
  ),
  normalized_email text,
  research_status text not null default 'DISCOVERED' check (
    research_status in ('DISCOVERED', 'IN_REVIEW', 'VERIFIED', 'QUARANTINED', 'PROMOTED', 'REJECTED')
  ),
  evidence_ids uuid[] not null default '{}',
  promoted_contact_id uuid,
  idempotency_key text not null,
  created_by uuid not null,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, account_id)
    references public.accounts (organization_id, id),
  foreign key (organization_id, promoted_contact_id)
    references public.contacts (organization_id, id),
  check (normalized_email is null or normalized_email = lower(normalized_email)),
  check ((research_status = 'PROMOTED' and promoted_contact_id is not null and verified_by is not null and verified_at is not null)
    or research_status <> 'PROMOTED')
);
create unique index if not exists research_contact_candidates_email_unique
  on public.research_contact_candidates (organization_id, normalized_email)
  where normalized_email is not null and research_status <> 'REJECTED';

create table if not exists public.research_evidence_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null check (subject_type in ('ACCOUNT', 'CONTACT_CANDIDATE')),
  subject_id uuid not null,
  field_name text not null,
  source_url text not null,
  source_name text not null,
  observed_at timestamptz not null,
  confidence public.source_confidence not null,
  value_json jsonb not null,
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  unique (organization_id, subject_type, subject_id, field_name, checksum)
);
create index if not exists research_evidence_subject_idx
  on public.research_evidence_records (organization_id, subject_type, subject_id);

create table if not exists public.research_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null check (subject_type in ('ACCOUNT', 'CONTACT_CANDIDATE')),
  subject_id uuid not null,
  decision text not null check (decision in ('VERIFIED', 'QUARANTINED', 'REJECTED')),
  evidence_ids uuid[] not null default '{}',
  review_notes text not null,
  idempotency_key text not null,
  reviewer_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key)
);
create index if not exists research_reviews_subject_idx
  on public.research_reviews (organization_id, subject_type, subject_id, created_at desc);

create table if not exists public.research_dedupe_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null check (subject_type in ('ACCOUNT', 'CONTACT_CANDIDATE')),
  source_record_id uuid,
  candidate_account_id uuid,
  candidate_contact_id uuid,
  matched_account_id uuid,
  matched_candidate_id uuid,
  match_reason text not null check (match_reason in (
    'LEGAL_NAME_KEY', 'PRIMARY_DOMAIN', 'NORMALIZED_EMAIL', 'NAME_ROLE_ACCOUNT', 'MULTIPLE_SIGNALS'
  )),
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'HOLD')),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, source_record_id)
    references public.research_import_records (organization_id, id),
  foreign key (organization_id, candidate_account_id)
    references public.accounts (organization_id, id),
  foreign key (organization_id, matched_account_id)
    references public.accounts (organization_id, id),
  foreign key (organization_id, candidate_contact_id)
    references public.research_contact_candidates (organization_id, id),
  foreign key (organization_id, matched_candidate_id)
    references public.research_contact_candidates (organization_id, id),
  check ((status = 'RESOLVED' and resolved_at is not null) or status <> 'RESOLVED')
);
create unique index if not exists research_dedupe_account_open_unique
  on public.research_dedupe_cases (organization_id, source_record_id, matched_account_id)
  where subject_type = 'ACCOUNT' and status = 'OPEN';
create unique index if not exists research_dedupe_contact_open_unique
  on public.research_dedupe_cases (organization_id, candidate_contact_id, matched_candidate_id)
  where subject_type = 'CONTACT_CANDIDATE' and status = 'OPEN';

create table if not exists public.research_dedupe_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dedupe_case_id uuid not null,
  decision text not null check (decision in ('SAME_ENTITY', 'DISTINCT', 'ALIAS')),
  canonical_account_id uuid,
  rationale text not null,
  aliases_created integer not null default 0 check (aliases_created >= 0),
  destructive_merge_state text not null default 'HOLD' check (destructive_merge_state = 'HOLD'),
  idempotency_key text not null,
  decided_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, dedupe_case_id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, dedupe_case_id)
    references public.research_dedupe_cases (organization_id, id),
  foreign key (organization_id, canonical_account_id)
    references public.accounts (organization_id, id)
);

create table if not exists public.research_inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_checksum text not null check (assessment_checksum ~ '^[a-f0-9]{64}$'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  decision text not null check (decision in ('PASS', 'EXTEND', 'KILL')),
  verified_accounts integer not null check (verified_accounts >= 0),
  verified_contacts integer not null check (verified_contacts >= 0),
  target_accounts integer not null default 75 check (target_accounts = 75),
  target_contacts integer not null default 150 check (target_contacts = 150),
  blockers text[] not null default '{}',
  outreach_state text not null default 'RESEARCH_ONLY_HOLD' check (outreach_state = 'RESEARCH_ONLY_HOLD'),
  outreach_eligible_records integer not null default 0 check (outreach_eligible_records = 0),
  idempotency_key text not null,
  frozen_by uuid not null,
  frozen_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  unique (organization_id, snapshot_sha256)
);

create table if not exists public.research_rpc_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rpc_name text not null,
  idempotency_key text not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, rpc_name, idempotency_key)
);

create or replace function app.research_assert_operator(target_organization_id uuid)
returns void language plpgsql stable security definer
set search_path = app, public, pg_temp as $$
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'RESEARCH_OPERATOR_AAL2_REQUIRED'; end if;
end;
$$;

create or replace function app.upsert_contact_candidate(
  target_organization_id uuid,
  target_account_id uuid,
  target_full_name text,
  target_role_title text,
  target_role_category text,
  target_normalized_email text,
  target_evidence_ids uuid[],
  target_idempotency_key text
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $$
declare
  request_sha text; replay jsonb; candidate_id uuid; duplicate_id uuid; case_id uuid; response jsonb;
  normalized_full_name text:=app.research_normalize_text(target_full_name,180);
  normalized_role_title text:=app.research_normalize_text(target_role_title,180);
  email text:=nullif(lower(btrim(target_normalized_email)),'');
begin
  perform app.research_assert_operator(target_organization_id);
  perform app.research_assert_sha256(target_idempotency_key,'RESEARCH_IDEMPOTENCY_KEY_INVALID');
  if length(normalized_full_name)<2 or length(normalized_role_title)<2 or target_role_category not in (
    'CEO','PLANT_DIRECTOR','MAINTENANCE','PROCUREMENT','OTHER')
    or target_role_category<>app.research_role_category(normalized_role_title)
    or target_full_name ~ '[[:cntrl:]]' or target_role_title ~ '[[:cntrl:]]'
    or (email is not null and (email<>target_normalized_email or length(email)>320
      or email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
      or split_part(email,'@',1) like '.%' or split_part(email,'@',1) like '%.' or split_part(email,'@',1) like '%..%'))
    or coalesce(array_length(target_evidence_ids,1),0)>50
  then raise exception 'RESEARCH_CONTACT_CANDIDATE_INVALID'; end if;
  if not exists (select 1 from public.accounts where organization_id=target_organization_id
    and id=target_account_id and research_status not in ('REJECTED','MERGED') and not is_deleted)
  then raise exception 'RESEARCH_ACCOUNT_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  request_sha:=app.research_request_sha(jsonb_build_object(
    'account_id',target_account_id,'full_name',normalized_full_name,'role_title',normalized_role_title,
    'role_category',target_role_category,'normalized_email',email,
    'evidence_ids',to_jsonb(coalesce(target_evidence_ids,'{}'::uuid[]))
  ));
  perform app.research_lock_command(target_organization_id,'upsert_contact_candidate',target_idempotency_key);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':research-candidate:'||
    target_account_id::text||':'||coalesce(email,lower(normalized_full_name)||':'||lower(normalized_role_title)),0));
  replay:=app.research_replay(target_organization_id,'upsert_contact_candidate',target_idempotency_key,request_sha);
  if replay is not null then return replay || jsonb_build_object('status','DUPLICATE'); end if;
  if exists (select 1 from unnest(coalesce(target_evidence_ids,'{}'::uuid[])) x group by x having count(*)>1)
    or (select count(*) from public.research_evidence_records e where e.organization_id=target_organization_id
      and e.subject_type='CONTACT_CANDIDATE' and e.id=any(coalesce(target_evidence_ids,'{}'::uuid[])))
      <> coalesce(array_length(target_evidence_ids,1),0)
  then raise exception 'RESEARCH_CANDIDATE_EVIDENCE_INVALID'; end if;

  select c.id into candidate_id from public.research_contact_candidates c
  where c.organization_id=target_organization_id and c.account_id=target_account_id
    and lower(c.full_name)=lower(normalized_full_name) and lower(c.role_title)=lower(normalized_role_title)
    and c.normalized_email is not distinct from email and c.research_status<>'REJECTED'
  limit 1;
  perform set_config('app.research_rpc_write','true',true);
  if candidate_id is not null then
    if exists (select 1 from unnest(coalesce(target_evidence_ids,'{}'::uuid[])) e where not exists (
      select 1 from public.research_evidence_records r where r.organization_id=target_organization_id
        and r.subject_type='CONTACT_CANDIDATE' and r.subject_id=candidate_id and r.id=e
    )) then raise exception 'RESEARCH_CANDIDATE_EVIDENCE_SUBJECT_MISMATCH'; end if;
    update public.research_contact_candidates set role_category=target_role_category,
      evidence_ids=coalesce(target_evidence_ids,evidence_ids),
      research_status=case when coalesce(array_length(target_evidence_ids,1),0)>0 and research_status='DISCOVERED'
        then 'IN_REVIEW' else research_status end, updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=candidate_id;
    response:=jsonb_build_object('status','UPDATED','candidate_id',candidate_id,
      'duplicate_candidate_id',null,'role_category',target_role_category);
  else
    select id into duplicate_id from public.research_contact_candidates
    where organization_id=target_organization_id and research_status<>'REJECTED' and (
      (email is not null and normalized_email=email)
      or (account_id=target_account_id and lower(full_name)=lower(normalized_full_name))
    ) limit 1;
    if duplicate_id is null and email is not null then
      select id into duplicate_id from public.research_contact_candidates where false;
      if exists (select 1 from public.contacts where organization_id=target_organization_id
        and normalized_email=email and not is_deleted) then
        response:=jsonb_build_object('status','DUPLICATE_CANDIDATE','candidate_id',null,
          'duplicate_candidate_id',null,'role_category',target_role_category);
      end if;
    end if;
    if duplicate_id is not null then
      insert into public.research_dedupe_cases (
        organization_id,subject_type,matched_candidate_id,match_reason,created_by
      ) values (target_organization_id,'CONTACT_CANDIDATE',duplicate_id,
        case when email is not null then 'NORMALIZED_EMAIL' else 'NAME_ROLE_ACCOUNT' end,auth.uid())
      returning id into case_id;
      response:=jsonb_build_object('status','DUPLICATE_CANDIDATE','candidate_id',null,
        'duplicate_candidate_id',duplicate_id,'role_category',target_role_category);
    elsif response is null then
      if coalesce(array_length(target_evidence_ids,1),0)>0 then
        raise exception 'RESEARCH_CANDIDATE_CREATE_EVIDENCE_MUST_FOLLOW_SUBJECT_CREATION';
      end if;
      insert into public.research_contact_candidates (
        organization_id,account_id,full_name,role_title,role_category,normalized_email,
        evidence_ids,idempotency_key,created_by
      ) values (
        target_organization_id,target_account_id,normalized_full_name,normalized_role_title,target_role_category,email,
        '{}',target_idempotency_key,auth.uid()
      ) returning id into candidate_id;
      response:=jsonb_build_object('status','CREATED','candidate_id',candidate_id,
        'duplicate_candidate_id',null,'role_category',target_role_category);
    end if;
  end if;
  perform app.research_store_response(target_organization_id,'upsert_contact_candidate',target_idempotency_key,request_sha,response);
  return response;
end;
$$;

create or replace function app.verify_contact_candidate(
  target_organization_id uuid,
  target_candidate_id uuid,
  target_role_evidence_id uuid,
  target_email_evidence_id uuid,
  target_idempotency_key text
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $$
declare
  candidate public.research_contact_candidates%rowtype; account_record public.accounts%rowtype;
  existing_contact public.contacts%rowtype;
  request_sha text; replay jsonb; blockers text[]:='{}'; contact_id uuid; response jsonb;
  role_evidence public.research_evidence_records%rowtype;
  email_evidence public.research_evidence_records%rowtype;
begin
  perform app.research_assert_operator(target_organization_id);
  perform app.research_assert_sha256(target_idempotency_key,'RESEARCH_IDEMPOTENCY_KEY_INVALID');
  if target_role_evidence_id=target_email_evidence_id then raise exception 'RESEARCH_DISTINCT_ROLE_EMAIL_EVIDENCE_REQUIRED'; end if;
  request_sha:=app.research_request_sha(jsonb_build_object('candidate_id',target_candidate_id,
    'role_evidence_id',target_role_evidence_id,'email_evidence_id',target_email_evidence_id));
  perform app.research_lock_command(target_organization_id,'verify_contact_candidate',target_idempotency_key);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':promote-candidate:'||target_candidate_id::text,0));
  replay:=app.research_replay(target_organization_id,'verify_contact_candidate',target_idempotency_key,request_sha);
  if replay is not null then return replay || jsonb_build_object('status','DUPLICATE'); end if;
  select * into candidate from public.research_contact_candidates where organization_id=target_organization_id
    and id=target_candidate_id for update;
  if not found then raise exception 'RESEARCH_CANDIDATE_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  if candidate.normalized_email is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      target_organization_id::text||':research-contact-email:'||candidate.normalized_email,0
    ));
  end if;
  if candidate.created_by=auth.uid() then blockers:=array_append(blockers,'FOUR_EYES_VERIFIER_REQUIRED'); end if;
  select * into account_record from public.accounts where organization_id=target_organization_id
    and id=candidate.account_id and not is_deleted;
  if not found or account_record.research_status<>'VERIFIED' or account_record.priority_market<>'GTO_QRO_FIRST'
    or account_record.research_state not in ('GUANAJUATO','QUERETARO') then blockers:=array_append(blockers,'ACCOUNT_NOT_VERIFIED_PRIORITY_MARKET'); end if;
  if candidate.role_category not in ('CEO','PLANT_DIRECTOR','MAINTENANCE','PROCUREMENT')
    then blockers:=array_append(blockers,'TARGET_ROLE_REQUIRED'); end if;
  if candidate.normalized_email is null then blockers:=array_append(blockers,'NORMALIZED_EMAIL_REQUIRED'); end if;
  select * into role_evidence from public.research_evidence_records where organization_id=target_organization_id
    and id=target_role_evidence_id and subject_type='CONTACT_CANDIDATE' and subject_id=target_candidate_id;
  if not found or role_evidence.field_name<>'role_category' or role_evidence.confidence not in ('HIGH','VERIFIED')
    or trim(both '"' from role_evidence.value_json::text)<>candidate.role_category
  then blockers:=array_append(blockers,'ROLE_EVIDENCE_INVALID'); end if;
  select * into email_evidence from public.research_evidence_records where organization_id=target_organization_id
    and id=target_email_evidence_id and subject_type='CONTACT_CANDIDATE' and subject_id=target_candidate_id;
  if not found or email_evidence.field_name<>'email_verification' or email_evidence.confidence not in ('HIGH','VERIFIED')
    or email_evidence.value_json <> 'true'::jsonb
  then blockers:=array_append(blockers,'EMAIL_VERIFICATION_EVIDENCE_INVALID'); end if;
  if not exists (select 1 from public.research_evidence_records e where e.organization_id=target_organization_id
    and e.subject_type='CONTACT_CANDIDATE' and e.subject_id=target_candidate_id
    and e.field_name='normalized_email' and e.confidence in ('HIGH','VERIFIED')
    and trim(both '"' from e.value_json::text)=candidate.normalized_email)
  then blockers:=array_append(blockers,'EMAIL_VALUE_EVIDENCE_MISSING'); end if;
  if exists (select 1 from public.research_dedupe_cases where organization_id=target_organization_id
    and status in ('OPEN','HOLD') and (
      (subject_type='ACCOUNT' and (candidate_account_id=candidate.account_id or matched_account_id=candidate.account_id))
      or (subject_type='CONTACT_CANDIDATE' and (candidate_contact_id=target_candidate_id or matched_candidate_id=target_candidate_id))))
  then blockers:=array_append(blockers,'DEDUPE_UNRESOLVED'); end if;
  if candidate.normalized_email is not null then
    perform app.lock_suppression_subjects(target_organization_id,candidate.account_id,candidate.normalized_email,account_record.primary_domain);
    if app.is_suppressed(target_organization_id,candidate.account_id,candidate.normalized_email,account_record.primary_domain)
      then blockers:=array_append(blockers,'SUPPRESSION_ACTIVE_OR_UNKNOWN'); end if;
  else blockers:=array_append(blockers,'SUPPRESSION_ACTIVE_OR_UNKNOWN'); end if;
  if coalesce(array_length(blockers,1),0)>0 then
    response:=jsonb_build_object('status','HOLD','contact_id',null,'blockers',to_jsonb(blockers));
    perform app.research_store_response(target_organization_id,'verify_contact_candidate',target_idempotency_key,request_sha,response);
    return response;
  end if;
  select * into existing_contact from public.contacts where organization_id=target_organization_id
    and normalized_email=candidate.normalized_email and not is_deleted for update;
  perform set_config('app.research_rpc_write','true',true);
  if existing_contact.id is not null then
    if existing_contact.account_id<>candidate.account_id then
      response:=jsonb_build_object('status','HOLD','contact_id',null,
        'blockers',jsonb_build_array('EXISTING_CONTACT_ACCOUNT_MISMATCH'));
      perform app.research_store_response(target_organization_id,'verify_contact_candidate',target_idempotency_key,request_sha,response);
      return response;
    elsif not existing_contact.verified then
      response:=jsonb_build_object('status','HOLD','contact_id',null,
        'blockers',jsonb_build_array('EXISTING_CONTACT_NOT_VERIFIED'));
      perform app.research_store_response(target_organization_id,'verify_contact_candidate',target_idempotency_key,request_sha,response);
      return response;
    end if;
    contact_id:=existing_contact.id;
    update public.research_contact_candidates set research_status='PROMOTED',promoted_contact_id=contact_id,
      verified_by=auth.uid(),verified_at=clock_timestamp(),updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=target_candidate_id;
    insert into public.research_reviews (
      organization_id,subject_type,subject_id,decision,evidence_ids,review_notes,idempotency_key,reviewer_id
    ) values (
      target_organization_id,'CONTACT_CANDIDATE',target_candidate_id,'VERIFIED',
      array[target_role_evidence_id,target_email_evidence_id],
      'FOUR_EYES_EXISTING_CONTACT_LINK_VERIFIED',target_idempotency_key,auth.uid()
    );
    response:=jsonb_build_object('status','DUPLICATE','contact_id',contact_id,'blockers','[]'::jsonb);
  else
    insert into public.contacts (
      organization_id,account_id,full_name,role_title,normalized_email,verified,verified_at,source_confidence
    ) values (
      target_organization_id,candidate.account_id,candidate.full_name,candidate.role_title,candidate.normalized_email,
      true,clock_timestamp(),'VERIFIED'
    ) returning id into contact_id;
    update public.research_contact_candidates set research_status='PROMOTED',promoted_contact_id=contact_id,
      verified_by=auth.uid(),verified_at=clock_timestamp(),updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=target_candidate_id;
    insert into public.research_reviews (
      organization_id,subject_type,subject_id,decision,evidence_ids,review_notes,idempotency_key,reviewer_id
    ) values (
      target_organization_id,'CONTACT_CANDIDATE',target_candidate_id,'VERIFIED',
      array[target_role_evidence_id,target_email_evidence_id],
      'FOUR_EYES_PROMOTION_EVIDENCE_VERIFIED',target_idempotency_key,auth.uid()
    );
    response:=jsonb_build_object('status','PROMOTED','contact_id',contact_id,'blockers','[]'::jsonb);
  end if;
  perform app.research_store_response(target_organization_id,'verify_contact_candidate',target_idempotency_key,request_sha,response);
  return response;
end;
$$;

create or replace function app.resolve_research_dedupe(
  target_organization_id uuid,
  target_case_id uuid,
  target_decision text,
  target_canonical_account_id uuid,
  target_rationale text,
  target_idempotency_key text
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $$
declare dedupe_case public.research_dedupe_cases%rowtype; request_sha text; replay jsonb;
declare aliases_count integer:=0; alias_value text; alias_key text; response jsonb;
begin
  perform app.research_assert_operator(target_organization_id);
  perform app.research_assert_sha256(target_idempotency_key,'RESEARCH_IDEMPOTENCY_KEY_INVALID');
  if target_decision not in ('SAME_ENTITY','DISTINCT','ALIAS')
    or length(app.research_normalize_text(target_rationale,1000))<3
    or ((target_decision in ('SAME_ENTITY','ALIAS'))<>(target_canonical_account_id is not null))
  then raise exception 'RESEARCH_DEDUPE_DECISION_INVALID'; end if;
  request_sha:=app.research_request_sha(jsonb_build_object('case_id',target_case_id,'decision',target_decision,
    'canonical_account_id',target_canonical_account_id,'rationale',app.research_normalize_text(target_rationale,1000)));
  perform app.research_lock_command(target_organization_id,'resolve_research_dedupe',target_idempotency_key);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':dedupe:'||target_case_id::text,0));
  replay:=app.research_replay(target_organization_id,'resolve_research_dedupe',target_idempotency_key,request_sha);
  if replay is not null then return replay || jsonb_build_object('status','DUPLICATE'); end if;
  select * into dedupe_case from public.research_dedupe_cases where organization_id=target_organization_id
    and id=target_case_id for update;
  if not found then raise exception 'RESEARCH_DEDUPE_CASE_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  if dedupe_case.status<>'OPEN' then raise exception 'RESEARCH_DEDUPE_CASE_NOT_OPEN'; end if;
  if dedupe_case.created_by=auth.uid() then raise exception 'RESEARCH_FOUR_EYES_DEDUPE_REQUIRED'; end if;
  if target_canonical_account_id is not null and not exists (select 1 from public.accounts
    where organization_id=target_organization_id and id=target_canonical_account_id and not is_deleted)
  then raise exception 'RESEARCH_CANONICAL_ACCOUNT_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  perform set_config('app.research_rpc_write','true',true);
  if dedupe_case.subject_type='ACCOUNT' and target_decision in ('SAME_ENTITY','ALIAS') then
    select r.legal_name,r.legal_name_key into alias_value,alias_key from public.research_import_records r
      where r.organization_id=target_organization_id and r.id=dedupe_case.source_record_id;
    insert into public.account_aliases (organization_id,account_id,alias,normalized_alias)
      values (target_organization_id,target_canonical_account_id,alias_value,alias_key)
      on conflict (organization_id,normalized_alias) do nothing;
    get diagnostics aliases_count=row_count;
    update public.research_import_records set account_id=target_canonical_account_id,record_status='MATCHED',updated_at=clock_timestamp()
      where organization_id=target_organization_id and id=dedupe_case.source_record_id;
  end if;
  insert into public.research_dedupe_decisions (
    organization_id,dedupe_case_id,decision,canonical_account_id,rationale,aliases_created,idempotency_key,decided_by
  ) values (
    target_organization_id,target_case_id,target_decision,target_canonical_account_id,
    app.research_normalize_text(target_rationale,1000),aliases_count,target_idempotency_key,auth.uid()
  );
  update public.research_dedupe_cases set status='RESOLVED',resolved_at=clock_timestamp()
    where organization_id=target_organization_id and id=target_case_id;
  response:=jsonb_build_object('status','RESOLVED','canonical_account_id',target_canonical_account_id,
    'aliases_created',aliases_count);
  perform app.research_store_response(target_organization_id,'resolve_research_dedupe',target_idempotency_key,request_sha,response);
  return response;
end;
$$;

create or replace function app.ingest_research_batch(
  target_organization_id uuid,
  target_source_name text,
  target_source_sha256 text,
  target_manifest_sha256 text,
  target_rows_jsonb jsonb,
  target_idempotency_key text
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $$
declare
  request_sha text;
  replay jsonb;
  batch_id uuid;
  row_item jsonb;
  row_count integer;
  response jsonb;
  normalized_name text;
  computed_key text;
  normalized_domain text;
  normalized_state text;
  existing_manifest_sha256 text;
  existing_source_row_count integer;
begin
  perform app.research_assert_operator(target_organization_id);
  perform app.research_assert_sha256(target_source_sha256, 'RESEARCH_SOURCE_SHA256_INVALID');
  perform app.research_assert_sha256(target_manifest_sha256, 'RESEARCH_MANIFEST_SHA256_INVALID');
  perform app.research_assert_sha256(target_idempotency_key, 'RESEARCH_IDEMPOTENCY_KEY_INVALID');
  if target_source_name is null or length(app.research_normalize_text(target_source_name, 200)) < 2
    or target_source_name ~ '[[:cntrl:]]' then raise exception 'RESEARCH_SOURCE_NAME_INVALID'; end if;
  if jsonb_typeof(target_rows_jsonb) <> 'array' then raise exception 'RESEARCH_ROWS_ARRAY_REQUIRED'; end if;
  row_count := jsonb_array_length(target_rows_jsonb);
  if row_count < 1 or row_count > 500 then raise exception 'RESEARCH_ROWS_COUNT_INVALID'; end if;

  request_sha := app.research_request_sha(jsonb_build_object(
    'source_name', app.research_normalize_text(target_source_name, 200),
    'source_sha256', target_source_sha256, 'manifest_sha256', target_manifest_sha256,
    'rows', target_rows_jsonb
  ));
  perform app.research_lock_command(target_organization_id, 'ingest_research_batch', target_idempotency_key);
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':research-source:' || target_source_sha256, 0
  ));
  replay := app.research_replay(target_organization_id, 'ingest_research_batch', target_idempotency_key, request_sha);
  if replay is not null then return replay || jsonb_build_object('status', 'DUPLICATE'); end if;

  for row_item in select value from jsonb_array_elements(target_rows_jsonb)
  loop
    if jsonb_typeof(row_item) <> 'object'
      or coalesce(row_item->>'externalRecordId', '') !~ '^[A-Za-z0-9._:-]{1,120}$'
      or coalesce(row_item->>'sourceRow', '') !~ '^[1-9][0-9]*$'
      or coalesce(row_item->>'rawFingerprint', '') !~ '^[a-f0-9]{64}$'
      or coalesce(row_item->>'legalName', '') = ''
      or coalesce(row_item->>'state', '') = ''
    then raise exception 'RESEARCH_IMPORT_RECORD_INVALID'; end if;
    normalized_name := app.research_normalize_text(row_item->>'legalName', 240);
    computed_key := app.research_legal_name_key(normalized_name);
    normalized_state := upper(app.research_normalize_text(row_item->>'state', 80));
    normalized_domain := nullif(lower(btrim(row_item->>'primaryDomain')), '');
    if length(normalized_name) < 2 or computed_key = ''
      or coalesce(row_item->>'legalNameKey', computed_key) <> computed_key
      or normalized_state not in ('GUANAJUATO', 'QUERETARO', 'OTHER', 'UNKNOWN')
      or (normalized_domain is not null and (
        normalized_domain <> row_item->>'primaryDomain'
        or normalized_domain like 'www.%'
        or normalized_domain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
      ))
    then raise exception 'RESEARCH_IMPORT_NORMALIZATION_MISMATCH'; end if;
  end loop;

  if (select count(*) from (
    select value->>'externalRecordId' key from jsonb_array_elements(target_rows_jsonb)
    group by 1 having count(*) > 1
  ) duplicates) > 0 or (select count(*) from (
    select value->>'sourceRow' key from jsonb_array_elements(target_rows_jsonb)
    group by 1 having count(*) > 1
  ) duplicates) > 0 then raise exception 'RESEARCH_IMPORT_DUPLICATE_ROW_IDENTITY'; end if;

  select id, manifest_sha256, source_row_count
  into batch_id, existing_manifest_sha256, existing_source_row_count
  from public.import_batches
  where organization_id = target_organization_id and source_sha256 = target_source_sha256;
  if found then
    if existing_manifest_sha256 is distinct from target_manifest_sha256
      or existing_source_row_count <> row_count then
      raise exception 'RESEARCH_SOURCE_HASH_DRIFT';
    end if;
    response := jsonb_build_object('status','DUPLICATE','batch_id',batch_id,'created',0,'matched',0,
      'quarantined',0,'duplicate_cases',0);
    perform app.research_store_response(target_organization_id, 'ingest_research_batch', target_idempotency_key, request_sha, response);
    return response;
  end if;

  perform set_config('app.research_rpc_write', 'true', true);
  insert into public.import_batches (
    organization_id, source_name, source_sha256, manifest_sha256, research_idempotency_key,
    source_row_count, accepted_row_count, quarantined_row_count, imported_by
  ) values (
    target_organization_id, app.research_normalize_text(target_source_name, 200),
    target_source_sha256, target_manifest_sha256, target_idempotency_key,
    row_count, row_count, 0, auth.uid()
  ) returning id into batch_id;

  insert into public.research_import_records (
    organization_id, import_batch_id, external_record_id, source_row, raw_fingerprint,
    legal_name, legal_name_key, primary_domain, city, state, industrial_park, sector, source_url, created_by
  )
  select target_organization_id, batch_id, value->>'externalRecordId', (value->>'sourceRow')::integer,
    value->>'rawFingerprint', app.research_normalize_text(value->>'legalName',240),
    app.research_legal_name_key(value->>'legalName'), nullif(lower(btrim(value->>'primaryDomain')),''),
    nullif(app.research_normalize_text(value->>'city',120),''), upper(app.research_normalize_text(value->>'state',80)),
    nullif(app.research_normalize_text(value->>'industrialPark',180),''),
    nullif(app.research_normalize_text(value->>'sector',180),''), nullif(value->>'sourceUrl',''), auth.uid()
  from jsonb_array_elements(target_rows_jsonb);

  response := jsonb_build_object('status','CREATED','batch_id',batch_id,'created',row_count,
    'matched',0,'quarantined',0,'duplicate_cases',0);
  perform app.research_store_response(target_organization_id, 'ingest_research_batch', target_idempotency_key, request_sha, response);
  return response;
end;
$$;

create or replace function app.upsert_research_account(
  target_organization_id uuid,
  target_source_record_id uuid,
  target_legal_name text,
  target_primary_domain text,
  target_city text,
  target_state text,
  target_industrial_park text,
  target_sector text,
  target_idempotency_key text
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $$
declare
  source_record public.research_import_records%rowtype;
  request_sha text;
  replay jsonb;
  legal_name text := app.research_normalize_text(target_legal_name, 240);
  legal_key text := app.research_legal_name_key(target_legal_name);
  domain_name text := nullif(lower(btrim(target_primary_domain)), '');
  state_code text := upper(app.research_normalize_text(target_state, 80));
  matched_id uuid;
  matched_name boolean := false;
  matched_domain boolean := false;
  case_id uuid;
  new_account_id uuid;
  response jsonb;
begin
  perform app.research_assert_operator(target_organization_id);
  perform app.research_assert_sha256(target_idempotency_key, 'RESEARCH_IDEMPOTENCY_KEY_INVALID');
  if length(legal_name) < 2 or legal_key = '' or state_code not in ('GUANAJUATO','QUERETARO','OTHER','UNKNOWN')
    or target_legal_name ~ '[[:cntrl:]]'
    or (domain_name is not null and (domain_name <> target_primary_domain or domain_name like 'www.%'
      or domain_name !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'))
  then raise exception 'RESEARCH_ACCOUNT_NORMALIZATION_INVALID'; end if;
  request_sha := app.research_request_sha(jsonb_build_object(
    'source_record_id',target_source_record_id,'legal_name',legal_name,'legal_key',legal_key,
    'primary_domain',domain_name,'city',nullif(app.research_normalize_text(target_city,120),''),
    'state',state_code,'industrial_park',nullif(app.research_normalize_text(target_industrial_park,180),''),
    'sector',nullif(app.research_normalize_text(target_sector,180),'')
  ));
  perform app.research_lock_command(target_organization_id, 'upsert_research_account', target_idempotency_key);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':research-account:' || legal_key || ':' || coalesce(domain_name,''),0));
  replay := app.research_replay(target_organization_id,'upsert_research_account',target_idempotency_key,request_sha);
  if replay is not null then return replay || jsonb_build_object('status','DUPLICATE'); end if;

  select * into source_record from public.research_import_records
  where organization_id = target_organization_id and id = target_source_record_id for update;
  if not found then raise exception 'RESEARCH_SOURCE_RECORD_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  if source_record.legal_name_key <> legal_key or source_record.primary_domain is distinct from domain_name
    or source_record.state <> state_code then raise exception 'RESEARCH_SOURCE_RECORD_PAYLOAD_DRIFT'; end if;
  if source_record.account_id is not null then
    response := jsonb_build_object('status','DUPLICATE','account_id',source_record.account_id,'dedupe_case_id',null);
    perform app.research_store_response(target_organization_id,'upsert_research_account',target_idempotency_key,request_sha,response);
    return response;
  end if;

  select a.id, a.research_legal_name_key = legal_key,
    domain_name is not null and lower(a.primary_domain) = domain_name
  into matched_id, matched_name, matched_domain
  from public.accounts a where a.organization_id = target_organization_id and not a.is_deleted
    and (a.research_legal_name_key = legal_key or (domain_name is not null and lower(a.primary_domain) = domain_name))
  order by (a.research_legal_name_key = legal_key and domain_name is not null and lower(a.primary_domain)=domain_name) desc, a.created_at
  limit 1;

  perform set_config('app.research_rpc_write','true',true);
  if matched_id is not null and matched_name and (domain_name is null or matched_domain) then
    update public.research_import_records set account_id=matched_id,record_status='MATCHED',updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=target_source_record_id;
    response := jsonb_build_object('status','UPDATED','account_id',matched_id,'dedupe_case_id',null);
  elsif matched_id is not null and not exists (
    select 1 from public.research_dedupe_decisions d join public.research_dedupe_cases c
      on c.organization_id=d.organization_id and c.id=d.dedupe_case_id
    where c.organization_id=target_organization_id and c.source_record_id=target_source_record_id and d.decision='DISTINCT'
  ) then
    insert into public.research_dedupe_cases (
      organization_id,subject_type,source_record_id,matched_account_id,match_reason,created_by
    ) values (
      target_organization_id,'ACCOUNT',target_source_record_id,matched_id,
      case when matched_name and matched_domain then 'MULTIPLE_SIGNALS' when matched_domain then 'PRIMARY_DOMAIN' else 'LEGAL_NAME_KEY' end,
      auth.uid()
    ) on conflict (organization_id,source_record_id,matched_account_id) where subject_type='ACCOUNT' and status='OPEN'
      do update set match_reason=excluded.match_reason returning id into case_id;
    update public.research_import_records set record_status='DUPLICATE_CANDIDATE',updated_at=clock_timestamp()
      where organization_id=target_organization_id and id=target_source_record_id;
    response := jsonb_build_object('status','DUPLICATE_CANDIDATE','account_id',null,'dedupe_case_id',case_id);
  else
    insert into public.accounts (
      organization_id,legal_name,normalized_name,primary_domain,city,state,industrial_park,sector,
      evidence_class,source_confidence,research_status,priority_market,research_created_by,
      research_legal_name_key,research_state
    ) values (
      target_organization_id,legal_name,legal_key,domain_name,
      nullif(app.research_normalize_text(target_city,120),''),state_code,
      nullif(app.research_normalize_text(target_industrial_park,180),''),
      nullif(app.research_normalize_text(target_sector,180),''),'live','UNVERIFIED','SEED',
      case when state_code in ('GUANAJUATO','QUERETARO') then 'GTO_QRO_FIRST' else 'EXPANSION_HOLD' end,
      auth.uid(),legal_key,state_code
    ) returning id into new_account_id;
    update public.research_import_records r set account_id=new_account_id,
      record_status='ACCOUNT_CREATED',updated_at=clock_timestamp()
      where organization_id=target_organization_id and id=target_source_record_id;
    response := jsonb_build_object('status','CREATED','account_id',new_account_id,'dedupe_case_id',null);
  end if;
  perform app.research_store_response(target_organization_id,'upsert_research_account',target_idempotency_key,request_sha,response);
  return response;
end;
$$;

create or replace function app.record_research_evidence(
  target_organization_id uuid,
  target_subject_type text,
  target_subject_id uuid,
  target_field_name text,
  target_source_url text,
  target_source_name text,
  target_observed_at timestamptz,
  target_confidence public.source_confidence,
  target_value_json jsonb,
  target_checksum text,
  target_idempotency_key text
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $$
declare request_sha text; replay jsonb; evidence_id uuid; response jsonb; existing_id uuid;
declare expected_value jsonb;
begin
  perform app.research_assert_operator(target_organization_id);
  perform app.research_assert_sha256(target_checksum,'RESEARCH_EVIDENCE_CHECKSUM_INVALID');
  perform app.research_assert_sha256(target_idempotency_key,'RESEARCH_IDEMPOTENCY_KEY_INVALID');
  if not ((target_subject_type='ACCOUNT' and target_field_name in (
      'legal_name','primary_domain','industrial_plant','city','state','industrial_park','sector'))
    or (target_subject_type='CONTACT_CANDIDATE' and target_field_name in (
      'full_name','role_title','role_category','normalized_email','email_verification')))
  then raise exception 'RESEARCH_EVIDENCE_FIELD_NOT_ALLOWED'; end if;
  if target_source_url !~ '^https?://[^[:space:]@]+$' or target_source_url ~ '[[:cntrl:]]'
    or length(target_source_url)>2048 or length(app.research_normalize_text(target_source_name,200))<2
    or target_observed_at is null or target_observed_at > clock_timestamp() + interval '5 minutes'
    or target_value_json is null or target_value_json = 'null'::jsonb
  then raise exception 'RESEARCH_EVIDENCE_INVALID'; end if;
  perform app.research_subject_creator(target_organization_id,target_subject_type,target_subject_id);
  if target_subject_type='ACCOUNT' then
    select case target_field_name
      when 'legal_name' then to_jsonb(legal_name)
      when 'primary_domain' then to_jsonb(primary_domain)
      when 'industrial_plant' then 'true'::jsonb
      when 'city' then to_jsonb(city)
      when 'state' then to_jsonb(research_state)
      when 'industrial_park' then to_jsonb(industrial_park)
      when 'sector' then to_jsonb(sector)
    end into expected_value from public.accounts
    where organization_id=target_organization_id and id=target_subject_id and not is_deleted;
  else
    select case target_field_name
      when 'full_name' then to_jsonb(full_name)
      when 'role_title' then to_jsonb(role_title)
      when 'role_category' then to_jsonb(role_category)
      when 'normalized_email' then to_jsonb(normalized_email)
      when 'email_verification' then 'true'::jsonb
    end into expected_value from public.research_contact_candidates
    where organization_id=target_organization_id and id=target_subject_id;
  end if;
  if expected_value is null or target_value_json<>expected_value then
    raise exception 'RESEARCH_EVIDENCE_VALUE_SUBJECT_MISMATCH';
  end if;
  request_sha := app.research_request_sha(jsonb_build_object(
    'subject_type',target_subject_type,'subject_id',target_subject_id,'field_name',target_field_name,
    'source_url',target_source_url,'source_name',app.research_normalize_text(target_source_name,200),
    'observed_at',target_observed_at,'confidence',target_confidence,'value',target_value_json,'checksum',target_checksum
  ));
  perform app.research_lock_command(target_organization_id,'record_research_evidence',target_idempotency_key);
  replay := app.research_replay(target_organization_id,'record_research_evidence',target_idempotency_key,request_sha);
  if replay is not null then return replay || jsonb_build_object('status','DUPLICATE'); end if;
  select id into existing_id from public.research_evidence_records
    where organization_id=target_organization_id and subject_type=target_subject_type and subject_id=target_subject_id
      and field_name=target_field_name and checksum=target_checksum;
  if existing_id is not null then
    response:=jsonb_build_object('status','DUPLICATE','evidence_id',existing_id);
  else
    perform set_config('app.research_rpc_write','true',true);
    insert into public.research_evidence_records (
      organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,
      confidence,value_json,checksum,idempotency_key,created_by
    ) values (
      target_organization_id,target_subject_type,target_subject_id,target_field_name,target_source_url,
      app.research_normalize_text(target_source_name,200),target_observed_at,target_confidence,
      target_value_json,target_checksum,target_idempotency_key,auth.uid()
    ) returning id into evidence_id;
    response:=jsonb_build_object('status','CREATED','evidence_id',evidence_id);
  end if;
  perform app.research_store_response(target_organization_id,'record_research_evidence',target_idempotency_key,request_sha,response);
  return response;
end;
$$;

create or replace function app.submit_research_review(
  target_organization_id uuid,
  target_subject_type text,
  target_subject_id uuid,
  target_decision text,
  target_evidence_ids uuid[],
  target_review_notes text,
  target_idempotency_key text
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $$
declare request_sha text; replay jsonb; creator uuid; review_id uuid; resulting_status text; response jsonb;
declare required_fields text[];
begin
  perform app.research_assert_operator(target_organization_id);
  perform app.research_assert_sha256(target_idempotency_key,'RESEARCH_IDEMPOTENCY_KEY_INVALID');
  if target_subject_type not in ('ACCOUNT','CONTACT_CANDIDATE')
    or target_decision not in ('VERIFIED','QUARANTINED','REJECTED')
    or length(app.research_normalize_text(target_review_notes,1000)) < 3
    or coalesce(array_length(target_evidence_ids,1),0) > 50
  then raise exception 'RESEARCH_REVIEW_INVALID'; end if;
  creator:=app.research_subject_creator(target_organization_id,target_subject_type,target_subject_id);
  if creator is null or creator=auth.uid() then raise exception 'RESEARCH_FOUR_EYES_REVIEW_REQUIRED'; end if;
  request_sha:=app.research_request_sha(jsonb_build_object(
    'subject_type',target_subject_type,'subject_id',target_subject_id,'decision',target_decision,
    'evidence_ids',to_jsonb(coalesce(target_evidence_ids,'{}'::uuid[])),'review_notes',app.research_normalize_text(target_review_notes,1000)
  ));
  perform app.research_lock_command(target_organization_id,'submit_research_review',target_idempotency_key);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':review:'||target_subject_type||':'||target_subject_id::text,0));
  replay:=app.research_replay(target_organization_id,'submit_research_review',target_idempotency_key,request_sha);
  if replay is not null then return replay || jsonb_build_object('status','DUPLICATE'); end if;
  if exists (select 1 from unnest(coalesce(target_evidence_ids,'{}'::uuid[])) e group by e having count(*)>1)
    or (select count(*) from public.research_evidence_records e where e.organization_id=target_organization_id
      and e.subject_type=target_subject_type and e.subject_id=target_subject_id and e.id=any(coalesce(target_evidence_ids,'{}'::uuid[])))
      <> coalesce(array_length(target_evidence_ids,1),0)
  then raise exception 'RESEARCH_REVIEW_EVIDENCE_TENANT_OR_SUBJECT_MISMATCH'; end if;
  if target_decision='VERIFIED' then
    required_fields:=case when target_subject_type='ACCOUNT'
      then array['legal_name','industrial_plant','state']
      else array['full_name','role_category','normalized_email','email_verification'] end;
    if exists (select 1 from unnest(required_fields) f where not exists (
      select 1 from public.research_evidence_records e where e.organization_id=target_organization_id
        and e.subject_type=target_subject_type and e.subject_id=target_subject_id
        and e.id=any(target_evidence_ids) and e.field_name=f and e.confidence in ('HIGH','VERIFIED')
    )) then raise exception 'RESEARCH_REVIEW_REQUIRED_EVIDENCE_MISSING'; end if;
    if target_subject_type='ACCOUNT' and (
      not exists (select 1 from public.accounts where organization_id=target_organization_id and id=target_subject_id
        and priority_market='GTO_QRO_FIRST' and research_state in ('GUANAJUATO','QUERETARO') and not is_deleted)
      or exists (select 1 from public.research_dedupe_cases where organization_id=target_organization_id
        and subject_type='ACCOUNT' and status in ('OPEN','HOLD')
        and (candidate_account_id=target_subject_id or matched_account_id=target_subject_id))
    ) then raise exception 'RESEARCH_ACCOUNT_NOT_VERIFIABLE'; end if;
  end if;
  resulting_status:=target_decision;
  perform set_config('app.research_rpc_write','true',true);
  insert into public.research_reviews (
    organization_id,subject_type,subject_id,decision,evidence_ids,review_notes,idempotency_key,reviewer_id
  ) values (
    target_organization_id,target_subject_type,target_subject_id,target_decision,
    coalesce(target_evidence_ids,'{}'::uuid[]),app.research_normalize_text(target_review_notes,1000),
    target_idempotency_key,auth.uid()
  ) returning id into review_id;
  if target_subject_type='ACCOUNT' then
    update public.accounts set research_status=resulting_status,
      research_verified_at=case when resulting_status='VERIFIED' then clock_timestamp() else null end,
      research_verified_by=case when resulting_status='VERIFIED' then auth.uid() else null end,
      source_confidence=case when resulting_status='VERIFIED' then 'VERIFIED' else source_confidence end,
      updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=target_subject_id;
  else
    update public.research_contact_candidates set research_status=resulting_status,
      verified_at=case when resulting_status='VERIFIED' then clock_timestamp() else null end,
      verified_by=case when resulting_status='VERIFIED' then auth.uid() else null end,
      updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=target_subject_id;
  end if;
  response:=jsonb_build_object('status',target_decision,'review_id',review_id,'subject_id',target_subject_id,
    'research_status',resulting_status);
  perform app.research_store_response(target_organization_id,'submit_research_review',target_idempotency_key,request_sha,response);
  return response;
end;
$$;

create or replace function app.research_normalize_text(target_value text, target_max integer)
returns text language sql immutable set search_path = pg_catalog as $$
  select left(regexp_replace(btrim(coalesce(target_value, '')), '[[:space:]]+', ' ', 'g'), target_max)
$$;

create or replace function app.research_legal_name_key(target_value text)
returns text language sql immutable set search_path = public, pg_catalog as $$
  select trim(both '-' from regexp_replace(
    regexp_replace(
      regexp_replace(lower(public.unaccent(app.research_normalize_text(target_value, 240))),
        '(^|[^a-z0-9])(s\.?a\.?\s+de\s+c\.?v\.?|s\.?a\.?p\.?i\.?\s+de\s+c\.?v\.?|s\.?\s+de\s+r\.?l\.?\s+de\s+c\.?v\.?)($|[^a-z0-9])', ' ', 'gi'),
      '(&|\band\b)', ' y ', 'gi'),
    '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function app.research_assert_sha256(target_value text, target_code text)
returns void language plpgsql immutable set search_path = pg_catalog as $$
begin
  if target_value is null or target_value !~ '^[a-f0-9]{64}$' then raise exception '%', target_code; end if;
end;
$$;

create or replace function app.research_request_sha(target_payload jsonb)
returns text language sql immutable set search_path = public, pg_catalog as $$
  select encode(public.digest(target_payload::text, 'sha256'), 'hex')
$$;

create or replace function app.research_lock_command(
  target_organization_id uuid, target_rpc_name text, target_idempotency_key text
) returns void language sql security definer set search_path = pg_catalog as $$
  select pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':research:' || target_rpc_name || ':' || target_idempotency_key, 0
  ))
$$;

create or replace function app.research_replay(
  target_organization_id uuid, target_rpc_name text, target_idempotency_key text, target_request_sha text
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare existing public.research_rpc_commands%rowtype;
begin
  select * into existing from public.research_rpc_commands
  where organization_id = target_organization_id and rpc_name = target_rpc_name
    and idempotency_key = target_idempotency_key;
  if not found then return null; end if;
  if existing.request_sha256 <> target_request_sha then raise exception 'RESEARCH_IDEMPOTENCY_DRIFT'; end if;
  return existing.response_json;
end;
$$;

create or replace function app.research_store_response(
  target_organization_id uuid, target_rpc_name text, target_idempotency_key text,
  target_request_sha text, target_response jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('app.research_rpc_write', 'true', true);
  insert into public.research_rpc_commands (
    organization_id, rpc_name, idempotency_key, request_sha256, response_json, created_by
  ) values (
    target_organization_id, target_rpc_name, target_idempotency_key,
    target_request_sha, target_response, auth.uid()
  );
end;
$$;

create or replace function app.research_subject_creator(
  target_organization_id uuid, target_subject_type text, target_subject_id uuid
) returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare creator uuid;
begin
  if target_subject_type = 'ACCOUNT' then
    select research_created_by into creator from public.accounts
    where organization_id = target_organization_id and id = target_subject_id and not is_deleted;
  elsif target_subject_type = 'CONTACT_CANDIDATE' then
    select created_by into creator from public.research_contact_candidates
    where organization_id = target_organization_id and id = target_subject_id;
  else raise exception 'RESEARCH_SUBJECT_TYPE_INVALID'; end if;
  if not found then raise exception 'RESEARCH_SUBJECT_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  return creator;
end;
$$;

create or replace function app.enforce_research_rpc_write()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_setting('app.research_rpc_write', true) is distinct from 'true' then
    raise exception 'RESEARCH_RPC_WRITE_REQUIRED';
  end if;
  if tg_argv[0] = 'APPEND_ONLY' and tg_op <> 'INSERT' then
    raise exception 'RESEARCH_APPEND_ONLY_RECORD';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app.capture_research_audit_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare raw_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
declare raw_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
declare safe_new jsonb;
declare safe_old jsonb;
declare allowed text[];
begin
  allowed := case tg_table_name
    when 'accounts' then array['id','research_status','priority_market','research_verified_at','research_verified_by','research_state','research_coverage_exception_approved']
    when 'account_aliases' then array['id','account_id']
    when 'contacts' then array['id','account_id','verified','verified_at','source_confidence','is_deleted']
    when 'import_batches' then array['id','source_sha256','manifest_sha256','source_row_count','accepted_row_count','quarantined_row_count']
    when 'research_import_records' then array['id','import_batch_id','source_row','raw_fingerprint','record_status','account_id']
    when 'research_contact_candidates' then array['id','account_id','role_category','research_status','promoted_contact_id','verified_by','verified_at']
    when 'research_evidence_records' then array['id','subject_type','subject_id','field_name','confidence','checksum']
    when 'research_reviews' then array['id','subject_type','subject_id','decision','evidence_ids','reviewer_id']
    when 'research_dedupe_cases' then array['id','subject_type','source_record_id','candidate_account_id','candidate_contact_id','matched_account_id','matched_candidate_id','match_reason','status','resolved_at']
    when 'research_dedupe_decisions' then array['id','dedupe_case_id','decision','canonical_account_id','aliases_created','destructive_merge_state','decided_by']
    when 'research_inventory_snapshots' then array['id','assessment_checksum','snapshot_sha256','decision','verified_accounts','verified_contacts','target_accounts','target_contacts','blockers','outreach_state','outreach_eligible_records','frozen_by']
    when 'research_rpc_commands' then array['id','rpc_name','idempotency_key','request_sha256','created_by']
    else array['id'] end;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into safe_new
  from jsonb_each(raw_new) e where e.key = any(allowed);
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into safe_old
  from jsonb_each(raw_old) e where e.key = any(allowed);
  insert into public.audit_log (
    organization_id, actor_user_id, action, record_type, record_id, old_data, new_data, correlation_id
  ) values (
    coalesce((raw_new->>'organization_id')::uuid, (raw_old->>'organization_id')::uuid),
    auth.uid(), 'RESEARCH_' || tg_op, tg_table_name,
    coalesce((raw_new->>'id')::uuid, (raw_old->>'id')::uuid), safe_old, safe_new, null
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app.research_role_category(target_role_title text)
returns text language plpgsql immutable set search_path = public, pg_catalog as $$
declare normalized text:=regexp_replace(lower(public.unaccent(coalesce(target_role_title,''))),'[^a-z0-9]+',' ','g');
begin
  if normalized ~ '(^| )(ceo|chief executive officer|director general|gerente general|managing director|founder|fundador|fundadora|owner|propietario|propietaria|dueno|duena)( |$)'
    then return 'CEO';
  elsif normalized ~ '(^| )(plant (director|manager|head)|site (director|manager|head)|director de planta|directora de planta|gerente de planta|jefe de planta|jefa de planta|director de operaciones de planta|directora de operaciones de planta|gerente de operaciones de planta)( |$)'
    then return 'PLANT_DIRECTOR';
  elsif normalized ~ '(^| )(maintenance|mantenimiento|facilities (director|manager|head)|facility (director|manager|head)|gerente de instalaciones|jefe de instalaciones|jefa de instalaciones)( |$)'
    then return 'MAINTENANCE';
  elsif normalized ~ '(^| )(procurement|purchasing|compras|adquisiciones|strategic sourcing|sourcing manager|buyer|comprador|compradora|supply chain (director|manager|head))( |$)'
    then return 'PROCUREMENT';
  else return 'OTHER'; end if;
end;
$$;

create or replace function app.assess_research_inventory(target_organization_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = app, public, pg_temp as $$
declare
  verified_accounts integer;
  verified_contacts integer;
  coverage_gaps integer;
  unresolved_accounts boolean;
  unresolved_contacts boolean;
  quarantined_accounts boolean;
  quarantined_contacts boolean;
  role_ceo integer;
  role_plant integer;
  role_maintenance integer;
  role_procurement integer;
  suppression_ready boolean;
  reasons text[]:='{}';
  commercial_blockers text[]:='{}';
  all_blockers text[];
  decision text;
  checksum text;
  canonical jsonb;
begin
  if not app.is_member(target_organization_id) then raise exception 'RESEARCH_MEMBER_AAL2_REQUIRED'; end if;
  with eligible_accounts as (
    select a.id from public.accounts a
    where a.organization_id=target_organization_id and not a.is_deleted
      and a.research_status='VERIFIED' and a.priority_market='GTO_QRO_FIRST'
      and a.research_state in ('GUANAJUATO','QUERETARO')
      and not exists (select 1 from public.research_dedupe_cases d
        where d.organization_id=a.organization_id and d.subject_type='ACCOUNT' and d.status in ('OPEN','HOLD')
          and (d.candidate_account_id=a.id or d.matched_account_id=a.id))
  ), eligible_contacts as (
    select c.id,c.account_id,c.role_category from public.research_contact_candidates c
    join eligible_accounts a on a.id=c.account_id
    where c.organization_id=target_organization_id and c.research_status='PROMOTED'
      and c.role_category in ('CEO','PLANT_DIRECTOR','MAINTENANCE','PROCUREMENT')
      and c.promoted_contact_id is not null
      and exists (select 1 from public.contacts p where p.organization_id=c.organization_id
        and p.id=c.promoted_contact_id and p.verified and not p.is_deleted)
      and exists (select 1 from public.research_evidence_records e where e.organization_id=c.organization_id
        and e.subject_type='CONTACT_CANDIDATE' and e.subject_id=c.id and e.field_name='role_category'
        and e.confidence in ('HIGH','VERIFIED'))
      and exists (select 1 from public.research_evidence_records e where e.organization_id=c.organization_id
        and e.subject_type='CONTACT_CANDIDATE' and e.subject_id=c.id and e.field_name='email_verification'
        and e.confidence in ('HIGH','VERIFIED') and e.value_json='true'::jsonb)
      and not exists (select 1 from public.research_dedupe_cases d where d.organization_id=c.organization_id
        and d.subject_type='CONTACT_CANDIDATE' and d.status in ('OPEN','HOLD')
        and (d.candidate_contact_id=c.id or d.matched_candidate_id=c.id))
  ), coverage as (
    select a.id,count(c.id) contact_count,count(distinct c.role_category) category_count,
      aa.research_coverage_exception_approved
    from eligible_accounts a join public.accounts aa on aa.organization_id=target_organization_id and aa.id=a.id
    left join eligible_contacts c on c.account_id=a.id group by a.id,aa.research_coverage_exception_approved
  )
  select (select count(*) from eligible_accounts), (select count(*) from eligible_contacts),
    (select count(*) from coverage where not research_coverage_exception_approved
      and (contact_count<2 or category_count<2)),
    (select count(*) from eligible_contacts where role_category='CEO'),
    (select count(*) from eligible_contacts where role_category='PLANT_DIRECTOR'),
    (select count(*) from eligible_contacts where role_category='MAINTENANCE'),
    (select count(*) from eligible_contacts where role_category='PROCUREMENT')
  into verified_accounts,verified_contacts,coverage_gaps,role_ceo,role_plant,role_maintenance,role_procurement;

  select exists (select 1 from public.research_dedupe_cases where organization_id=target_organization_id
    and subject_type='ACCOUNT' and status in ('OPEN','HOLD')) into unresolved_accounts;
  select exists (select 1 from public.research_dedupe_cases where organization_id=target_organization_id
    and subject_type='CONTACT_CANDIDATE' and status in ('OPEN','HOLD')) into unresolved_contacts;
  select exists (select 1 from public.accounts where organization_id=target_organization_id
    and research_status='QUARANTINED' and not is_deleted) into quarantined_accounts;
  select exists (select 1 from public.research_contact_candidates where organization_id=target_organization_id
    and research_status='QUARANTINED') into quarantined_contacts;
  select exists (select 1 from app.private_runtime_config where organization_id=target_organization_id
    and suppression_hmac_secret is not null) into suppression_ready;

  if verified_accounts<75 then reasons:=array_append(reasons,'RESEARCH_ACCOUNT_TARGET_NOT_MET'); end if;
  if verified_contacts<150 then reasons:=array_append(reasons,'RESEARCH_CONTACT_TARGET_NOT_MET'); end if;
  if coverage_gaps>0 then reasons:=array_append(reasons,'ACCOUNT_CONTACT_COVERAGE_INCOMPLETE'); end if;
  if role_ceo=0 then reasons:=array_append(reasons,'TARGET_ROLE_CATEGORY_MISSING:CEO'); end if;
  if role_plant=0 then reasons:=array_append(reasons,'TARGET_ROLE_CATEGORY_MISSING:PLANT_DIRECTOR'); end if;
  if role_maintenance=0 then reasons:=array_append(reasons,'TARGET_ROLE_CATEGORY_MISSING:MAINTENANCE'); end if;
  if role_procurement=0 then reasons:=array_append(reasons,'TARGET_ROLE_CATEGORY_MISSING:PROCUREMENT'); end if;
  if unresolved_accounts then reasons:=array_append(reasons,'UNRESOLVED_ACCOUNT_DEDUPE'); end if;
  if unresolved_contacts then reasons:=array_append(reasons,'UNRESOLVED_CONTACT_DEDUPE'); end if;
  if quarantined_accounts then reasons:=array_append(reasons,'QUARANTINED_ACCOUNT_PRESENT'); end if;
  if quarantined_contacts then reasons:=array_append(reasons,'QUARANTINED_CONTACT_PRESENT'); end if;
  decision:=case when coalesce(array_length(reasons,1),0)>0 then 'EXTEND' else 'PASS' end;
  commercial_blockers:=array['RESEARCH_MODULE_CANNOT_AUTHORIZE_COMMERCIAL_ACTION','ANNEX_A_UNKNOWN'];
  if not suppression_ready then commercial_blockers:=array_append(commercial_blockers,'SUPPRESSION_MISSING'); end if;
  commercial_blockers:=array_append(commercial_blockers,'EXPLICIT_RELEASE_APPROVAL_REQUIRED');
  select coalesce(array_agg(x order by x),'{}'::text[]) into all_blockers
    from unnest(reasons||commercial_blockers) x;
  canonical:=jsonb_build_object('decision',decision,'verified_accounts',verified_accounts,
    'verified_contacts',verified_contacts,'target_accounts',75,'target_contacts',150,
    'outreach_state','RESEARCH_ONLY_HOLD','outreach_eligible_records',0,'blockers',to_jsonb(all_blockers));
  checksum:=encode(public.digest(canonical::text,'sha256'),'hex');
  return jsonb_build_object('status','ASSESSED','decision',decision,'verified_accounts',verified_accounts,
    'verified_contacts',verified_contacts,'target_accounts',75,'target_contacts',150,
    'outreach_state','RESEARCH_ONLY_HOLD','outreach_eligible_records',0,
    'blockers',to_jsonb(all_blockers),'assessment_checksum',checksum);
end;
$$;

create or replace function app.freeze_research_inventory_snapshot(
  target_organization_id uuid,
  target_assessment_checksum text,
  target_idempotency_key text
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $$
declare request_sha text; replay jsonb; assessment jsonb; snapshot_id uuid; snapshot_sha text; response jsonb;
begin
  perform app.research_assert_operator(target_organization_id);
  perform app.research_assert_sha256(target_assessment_checksum,'RESEARCH_ASSESSMENT_CHECKSUM_INVALID');
  perform app.research_assert_sha256(target_idempotency_key,'RESEARCH_IDEMPOTENCY_KEY_INVALID');
  request_sha:=app.research_request_sha(jsonb_build_object('assessment_checksum',target_assessment_checksum));
  perform app.research_lock_command(target_organization_id,'freeze_research_inventory_snapshot',target_idempotency_key);
  replay:=app.research_replay(target_organization_id,'freeze_research_inventory_snapshot',target_idempotency_key,request_sha);
  if replay is not null then return replay||jsonb_build_object('status','DUPLICATE'); end if;
  assessment:=app.assess_research_inventory(target_organization_id);
  if assessment->>'assessment_checksum'<>target_assessment_checksum then
    raise exception 'RESEARCH_ASSESSMENT_STALE_OR_TENANT_MISMATCH';
  end if;
  snapshot_sha:=encode(public.digest(jsonb_build_object(
    'organization_id',target_organization_id,'assessment',assessment,
    'idempotency_key',target_idempotency_key
  )::text,'sha256'),'hex');
  perform set_config('app.research_rpc_write','true',true);
  insert into public.research_inventory_snapshots (
    organization_id,assessment_checksum,snapshot_sha256,decision,verified_accounts,verified_contacts,
    target_accounts,target_contacts,blockers,outreach_state,outreach_eligible_records,idempotency_key,frozen_by
  ) values (
    target_organization_id,target_assessment_checksum,snapshot_sha,assessment->>'decision',
    (assessment->>'verified_accounts')::integer,(assessment->>'verified_contacts')::integer,75,150,
    array(select jsonb_array_elements_text(assessment->'blockers')),'RESEARCH_ONLY_HOLD',0,
    target_idempotency_key,auth.uid()
  ) returning id into snapshot_id;
  response:=jsonb_build_object('status','CREATED','snapshot_id',snapshot_id,'decision',assessment->>'decision',
    'snapshot_sha256',snapshot_sha,'outreach_state','RESEARCH_ONLY_HOLD','outreach_eligible_records',0);
  perform app.research_store_response(target_organization_id,'freeze_research_inventory_snapshot',target_idempotency_key,request_sha,response);
  return response;
end;
$$;

-- PostgREST resolves client.rpc() in the exposed public schema. These wrappers preserve
-- the exact HTTP parameter names while all mutation logic remains isolated in app.
create or replace function public.ingest_research_batch(
  target_organization_id uuid,target_source_name text,target_source_sha256 text,
  target_manifest_sha256 text,target_rows_jsonb jsonb,target_idempotency_key text
) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$
  select app.ingest_research_batch(target_organization_id,target_source_name,target_source_sha256,
    target_manifest_sha256,target_rows_jsonb,target_idempotency_key)
$$;
create or replace function public.upsert_research_account(
  target_organization_id uuid,target_source_record_id uuid,target_legal_name text,
  target_primary_domain text,target_city text,target_state text,target_industrial_park text,
  target_sector text,target_idempotency_key text
) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$
  select app.upsert_research_account(target_organization_id,target_source_record_id,target_legal_name,
    target_primary_domain,target_city,target_state,target_industrial_park,target_sector,target_idempotency_key)
$$;
create or replace function public.record_research_evidence(
  target_organization_id uuid,target_subject_type text,target_subject_id uuid,target_field_name text,
  target_source_url text,target_source_name text,target_observed_at timestamptz,
  target_confidence public.source_confidence,target_value_json jsonb,target_checksum text,target_idempotency_key text
) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$
  select app.record_research_evidence(target_organization_id,target_subject_type,target_subject_id,target_field_name,
    target_source_url,target_source_name,target_observed_at,target_confidence,target_value_json,target_checksum,target_idempotency_key)
$$;
create or replace function public.submit_research_review(
  target_organization_id uuid,target_subject_type text,target_subject_id uuid,target_decision text,
  target_evidence_ids uuid[],target_review_notes text,target_idempotency_key text
) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$
  select app.submit_research_review(target_organization_id,target_subject_type,target_subject_id,target_decision,
    target_evidence_ids,target_review_notes,target_idempotency_key)
$$;
create or replace function public.upsert_contact_candidate(
  target_organization_id uuid,target_account_id uuid,target_full_name text,target_role_title text,
  target_role_category text,target_normalized_email text,target_evidence_ids uuid[],target_idempotency_key text
) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$
  select app.upsert_contact_candidate(target_organization_id,target_account_id,target_full_name,target_role_title,
    target_role_category,target_normalized_email,target_evidence_ids,target_idempotency_key)
$$;
create or replace function public.verify_contact_candidate(
  target_organization_id uuid,target_candidate_id uuid,target_role_evidence_id uuid,
  target_email_evidence_id uuid,target_idempotency_key text
) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$
  select app.verify_contact_candidate(target_organization_id,target_candidate_id,target_role_evidence_id,
    target_email_evidence_id,target_idempotency_key)
$$;
create or replace function public.resolve_research_dedupe(
  target_organization_id uuid,target_case_id uuid,target_decision text,target_canonical_account_id uuid,
  target_rationale text,target_idempotency_key text
) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$
  select app.resolve_research_dedupe(target_organization_id,target_case_id,target_decision,
    target_canonical_account_id,target_rationale,target_idempotency_key)
$$;
create or replace function public.assess_research_inventory(target_organization_id uuid)
returns jsonb language sql security definer set search_path=app,public,pg_temp as $$
  select app.assess_research_inventory(target_organization_id)
$$;
create or replace function public.freeze_research_inventory_snapshot(
  target_organization_id uuid,target_assessment_checksum text,target_idempotency_key text
) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$
  select app.freeze_research_inventory_snapshot(target_organization_id,target_assessment_checksum,target_idempotency_key)
$$;

-- New research tables are read-only to AAL2 organization members and mutable only through RPCs.
alter table public.research_import_records enable row level security;
alter table public.research_contact_candidates enable row level security;
alter table public.research_evidence_records enable row level security;
alter table public.research_reviews enable row level security;
alter table public.research_dedupe_cases enable row level security;
alter table public.research_dedupe_decisions enable row level security;
alter table public.research_inventory_snapshots enable row level security;
alter table public.research_rpc_commands enable row level security;

do $$ declare table_name text; begin
  foreach table_name in array array['research_import_records','research_contact_candidates','research_evidence_records',
    'research_reviews','research_dedupe_cases','research_dedupe_decisions','research_inventory_snapshots']
  loop
    execute format('drop policy if exists %I_member_read on public.%I',table_name,table_name);
    execute format('create policy %I_member_read on public.%I for select using (app.is_member(organization_id))',table_name,table_name);
  end loop;
end $$;

drop policy if exists import_batches_operator_write on public.import_batches;
drop policy if exists accounts_operator_write on public.accounts;
drop policy if exists account_aliases_operator_write on public.account_aliases;
drop policy if exists contacts_operator_write on public.contacts;
revoke insert,update,delete,truncate on public.import_batches,public.accounts,public.account_aliases,public.contacts from authenticated;
revoke insert,update,delete,truncate on public.research_import_records,public.research_contact_candidates,
  public.research_evidence_records,public.research_reviews,public.research_dedupe_cases,
  public.research_dedupe_decisions,public.research_inventory_snapshots,public.research_rpc_commands from authenticated;
grant select on public.research_import_records,public.research_contact_candidates,public.research_evidence_records,
  public.research_reviews,public.research_dedupe_cases,public.research_dedupe_decisions,
  public.research_inventory_snapshots to authenticated;

do $$ declare table_name text; mode text; begin
  foreach table_name in array array['research_import_records','research_contact_candidates','research_evidence_records',
    'research_reviews','research_dedupe_cases','research_dedupe_decisions','research_inventory_snapshots','research_rpc_commands']
  loop
    mode:=case when table_name in ('research_evidence_records','research_reviews','research_dedupe_decisions','research_inventory_snapshots','research_rpc_commands')
      then 'APPEND_ONLY' else 'MUTABLE_RPC' end;
    execute format('drop trigger if exists %I_rpc_write_guard on public.%I',table_name,table_name);
    execute format('create trigger %I_rpc_write_guard before insert or update or delete on public.%I for each row execute function app.enforce_research_rpc_write(%L)',table_name,table_name,mode);
  end loop;
end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['import_batches','accounts','account_aliases','contacts','research_import_records',
    'research_contact_candidates','research_evidence_records','research_reviews','research_dedupe_cases',
    'research_dedupe_decisions','research_inventory_snapshots','research_rpc_commands']
  loop
    execute format('drop trigger if exists %I_research_audit on public.%I',table_name,table_name);
    execute format('create trigger %I_research_audit after insert or update or delete on public.%I for each row execute function app.capture_research_audit_event()',table_name,table_name);
  end loop;
end $$;

revoke all on function app.research_assert_operator(uuid) from public,authenticated;
revoke all on function app.research_normalize_text(text,integer) from public,authenticated;
revoke all on function app.research_legal_name_key(text) from public,authenticated;
revoke all on function app.research_assert_sha256(text,text) from public,authenticated;
revoke all on function app.research_request_sha(jsonb) from public,authenticated;
revoke all on function app.research_lock_command(uuid,text,text) from public,authenticated;
revoke all on function app.research_replay(uuid,text,text,text) from public,authenticated;
revoke all on function app.research_store_response(uuid,text,text,text,jsonb) from public,authenticated;
revoke all on function app.research_subject_creator(uuid,text,uuid) from public,authenticated;
revoke all on function app.enforce_research_rpc_write() from public,authenticated;
revoke all on function app.capture_research_audit_event() from public,authenticated;
revoke all on function app.research_role_category(text) from public,authenticated;

revoke all on function app.ingest_research_batch(uuid,text,text,text,jsonb,text) from public,authenticated;
revoke all on function app.upsert_research_account(uuid,uuid,text,text,text,text,text,text,text) from public,authenticated;
revoke all on function app.record_research_evidence(uuid,text,uuid,text,text,text,timestamptz,public.source_confidence,jsonb,text,text) from public,authenticated;
revoke all on function app.submit_research_review(uuid,text,uuid,text,uuid[],text,text) from public,authenticated;
revoke all on function app.upsert_contact_candidate(uuid,uuid,text,text,text,text,uuid[],text) from public,authenticated;
revoke all on function app.verify_contact_candidate(uuid,uuid,uuid,uuid,text) from public,authenticated;
revoke all on function app.resolve_research_dedupe(uuid,uuid,text,uuid,text,text) from public,authenticated;
revoke all on function app.assess_research_inventory(uuid) from public,authenticated;
revoke all on function app.freeze_research_inventory_snapshot(uuid,text,text) from public,authenticated;
revoke all on function public.ingest_research_batch(uuid,text,text,text,jsonb,text) from public;
revoke all on function public.upsert_research_account(uuid,uuid,text,text,text,text,text,text,text) from public;
revoke all on function public.record_research_evidence(uuid,text,uuid,text,text,text,timestamptz,public.source_confidence,jsonb,text,text) from public;
revoke all on function public.submit_research_review(uuid,text,uuid,text,uuid[],text,text) from public;
revoke all on function public.upsert_contact_candidate(uuid,uuid,text,text,text,text,uuid[],text) from public;
revoke all on function public.verify_contact_candidate(uuid,uuid,uuid,uuid,text) from public;
revoke all on function public.resolve_research_dedupe(uuid,uuid,text,uuid,text,text) from public;
revoke all on function public.assess_research_inventory(uuid) from public;
revoke all on function public.freeze_research_inventory_snapshot(uuid,text,text) from public;
grant execute on function public.ingest_research_batch(uuid,text,text,text,jsonb,text) to authenticated;
grant execute on function public.upsert_research_account(uuid,uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.record_research_evidence(uuid,text,uuid,text,text,text,timestamptz,public.source_confidence,jsonb,text,text) to authenticated;
grant execute on function public.submit_research_review(uuid,text,uuid,text,uuid[],text,text) to authenticated;
grant execute on function public.upsert_contact_candidate(uuid,uuid,text,text,text,text,uuid[],text) to authenticated;
grant execute on function public.verify_contact_candidate(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.resolve_research_dedupe(uuid,uuid,text,uuid,text,text) to authenticated;
grant execute on function public.assess_research_inventory(uuid) to authenticated;
grant execute on function public.freeze_research_inventory_snapshot(uuid,text,text) to authenticated;

commit;
