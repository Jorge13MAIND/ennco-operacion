begin;

create unique index if not exists source_evidence_organization_id_id_unique
on public.source_evidence (organization_id, id);
create unique index if not exists source_evidence_stable_fact_unique
on public.source_evidence (organization_id, lower(subject_type), subject_id, lower(field_name), checksum)
where checksum is not null;

create unique index if not exists qualification_checks_organization_id_id_unique
on public.qualification_checks (organization_id, id);
create unique index if not exists qualification_checks_organization_id_lead_id_unique
on public.qualification_checks (organization_id, lead_id);
create unique index if not exists opportunities_organization_id_id_unique
on public.opportunities (organization_id, id);
create unique index if not exists payments_organization_id_id_unique
on public.payments (organization_id, id);
create unique index if not exists attribution_events_organization_id_id_unique
on public.attribution_events (organization_id, id);

alter table public.source_evidence
  drop constraint if exists source_evidence_verifiable_shape_check;
alter table public.source_evidence
  add constraint source_evidence_verifiable_shape_check check (
    btrim(subject_type) <> ''
    and btrim(field_name) <> ''
    and btrim(source_name) <> ''
    and (source_url is null or source_url ~ '^https?://[^[:space:]]+$')
    and (checksum is null or checksum ~ '^[a-f0-9]{64}$')
  );

alter table public.qualification_checks
  drop constraint if exists qualification_checks_lead_id_fkey,
  drop constraint if exists qualification_checks_lead_tenant_fkey;
alter table public.qualification_checks
  add constraint qualification_checks_lead_tenant_fkey
    foreign key (organization_id, lead_id)
    references public.leads (organization_id, id)
    on delete cascade;

alter table public.opportunities
  drop constraint if exists opportunities_account_id_fkey,
  drop constraint if exists opportunities_lead_id_fkey,
  drop constraint if exists opportunities_account_tenant_fkey,
  drop constraint if exists opportunities_lead_tenant_fkey;
alter table public.opportunities
  add constraint opportunities_account_tenant_fkey
    foreign key (organization_id, account_id)
    references public.accounts (organization_id, id),
  add constraint opportunities_lead_tenant_fkey
    foreign key (organization_id, lead_id)
    references public.leads (organization_id, id);

alter table public.payments add column if not exists idempotency_key text;
update public.payments
set idempotency_key = encode(digest('legacy-payment:' || id::text, 'sha256'), 'hex')
where idempotency_key is null;
alter table public.payments alter column idempotency_key set not null;
alter table public.payments
  drop constraint if exists payments_idempotency_key_check,
  add constraint payments_idempotency_key_check check (idempotency_key ~ '^[a-f0-9]{64}$');
create unique index if not exists payments_organization_id_idempotency_unique
on public.payments (organization_id, idempotency_key);
create unique index if not exists payments_one_first_per_opportunity
on public.payments (organization_id, opportunity_id)
where is_first_payment;
create unique index if not exists payments_one_evidence_record
on public.payments (organization_id, evidence_record_id);

alter table public.payments
  drop constraint if exists payments_opportunity_id_fkey,
  drop constraint if exists payments_opportunity_tenant_fkey,
  drop constraint if exists payments_evidence_tenant_fkey;
alter table public.payments
  add constraint payments_opportunity_tenant_fkey
    foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id),
  add constraint payments_evidence_tenant_fkey
    foreign key (organization_id, evidence_record_id)
    references public.source_evidence (organization_id, id);

alter table public.attribution_events add column if not exists idempotency_key text;
update public.attribution_events
set idempotency_key = encode(digest('legacy-attribution:' || id::text, 'sha256'), 'hex')
where idempotency_key is null;
alter table public.attribution_events alter column idempotency_key set not null;
alter table public.attribution_events
  drop constraint if exists attribution_events_idempotency_key_check,
  add constraint attribution_events_idempotency_key_check check (idempotency_key ~ '^[a-f0-9]{64}$');
create unique index if not exists attribution_events_organization_id_idempotency_unique
on public.attribution_events (organization_id, idempotency_key);

alter table public.attribution_events
  drop constraint if exists attribution_events_account_id_fkey,
  drop constraint if exists attribution_events_contact_id_fkey,
  drop constraint if exists attribution_events_first_contact_message_id_fkey,
  drop constraint if exists attribution_events_account_tenant_fkey,
  drop constraint if exists attribution_events_contact_tenant_fkey,
  drop constraint if exists attribution_events_message_tenant_fkey;
alter table public.attribution_events
  add constraint attribution_events_account_tenant_fkey
    foreign key (organization_id, account_id)
    references public.accounts (organization_id, id),
  add constraint attribution_events_contact_tenant_fkey
    foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id),
  add constraint attribution_events_message_tenant_fkey
    foreign key (organization_id, first_contact_message_id)
    references public.messages (organization_id, id);

alter table public.commissions add column if not exists idempotency_key text;
update public.commissions
set idempotency_key = encode(digest('legacy-commission:' || id::text, 'sha256'), 'hex')
where idempotency_key is null;
alter table public.commissions alter column idempotency_key set not null;
alter table public.commissions
  drop constraint if exists commissions_idempotency_key_check,
  add constraint commissions_idempotency_key_check check (idempotency_key ~ '^[a-f0-9]{64}$');
create unique index if not exists commissions_organization_id_idempotency_unique
on public.commissions (organization_id, idempotency_key);

alter table public.commissions
  drop constraint if exists commissions_opportunity_id_fkey,
  drop constraint if exists commissions_payment_id_fkey,
  drop constraint if exists commissions_attribution_event_id_fkey,
  drop constraint if exists commissions_opportunity_tenant_fkey,
  drop constraint if exists commissions_payment_tenant_fkey,
  drop constraint if exists commissions_attribution_tenant_fkey;
alter table public.commissions
  add constraint commissions_opportunity_tenant_fkey
    foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id),
  add constraint commissions_payment_tenant_fkey
    foreign key (organization_id, payment_id)
    references public.payments (organization_id, id),
  add constraint commissions_attribution_tenant_fkey
    foreign key (organization_id, attribution_event_id)
    references public.attribution_events (organization_id, id);

create table if not exists public.qualification_evidence_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  qualification_check_id uuid not null,
  lead_id uuid not null,
  criterion text not null check (criterion in (
    'industrial_over_100_kwp', 'outside_annex_a', 'verified_target_role',
    'explicit_interest', 'monthly_spend_mxn'
  )),
  source_evidence_id uuid not null,
  evidence_checksum text not null check (evidence_checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint qualification_evidence_check_tenant_fkey
    foreign key (organization_id, qualification_check_id)
    references public.qualification_checks (organization_id, id)
    on delete cascade,
  constraint qualification_evidence_lead_tenant_fkey
    foreign key (organization_id, lead_id)
    references public.leads (organization_id, id)
    on delete cascade,
  constraint qualification_evidence_source_tenant_fkey
    foreign key (organization_id, source_evidence_id)
    references public.source_evidence (organization_id, id),
  unique (qualification_check_id, criterion),
  unique (qualification_check_id, source_evidence_id)
);

alter table public.qualification_evidence_links enable row level security;
drop policy if exists qualification_evidence_links_member_read on public.qualification_evidence_links;
create policy qualification_evidence_links_member_read
on public.qualification_evidence_links for select
using (app.is_member(organization_id));

create or replace function app.evidence_subject_matches_lead(
  target_organization_id uuid,
  target_lead_id uuid,
  target_subject_type text,
  target_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from public.leads l
    where l.organization_id = target_organization_id
      and l.id = target_lead_id
      and case lower(target_subject_type)
        when 'lead' then target_subject_id = l.id
        when 'account' then target_subject_id = l.account_id
        when 'contact' then target_subject_id = l.contact_id
        when 'prequote' then target_subject_id = l.prequote_id
        when 'message' then target_subject_id = l.origin_message_id
        else false
      end
  );
$$;

create or replace function app.qualification_evidence_is_strict(
  target_organization_id uuid,
  target_lead_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from public.qualification_checks qc
    where qc.organization_id = target_organization_id
      and qc.lead_id = target_lead_id
      and qc.industrial_over_100_kwp is true
      and qc.outside_annex_a is true
      and qc.verified_target_role is true
      and (qc.explicit_interest is true or coalesce(qc.monthly_spend_mxn, 0) > 20000)
      and exists (
        select 1 from public.qualification_evidence_links qel
        where qel.organization_id = qc.organization_id and qel.qualification_check_id = qc.id
          and qel.criterion = 'industrial_over_100_kwp'
      )
      and exists (
        select 1 from public.qualification_evidence_links qel
        where qel.organization_id = qc.organization_id and qel.qualification_check_id = qc.id
          and qel.criterion = 'outside_annex_a'
      )
      and exists (
        select 1 from public.qualification_evidence_links qel
        where qel.organization_id = qc.organization_id and qel.qualification_check_id = qc.id
          and qel.criterion = 'verified_target_role'
      )
      and (
        (qc.explicit_interest is true and exists (
          select 1 from public.qualification_evidence_links qel
          where qel.organization_id = qc.organization_id and qel.qualification_check_id = qc.id
            and qel.criterion = 'explicit_interest'
        ))
        or (coalesce(qc.monthly_spend_mxn, 0) > 20000 and exists (
          select 1 from public.qualification_evidence_links qel
          where qel.organization_id = qc.organization_id and qel.qualification_check_id = qc.id
            and qel.criterion = 'monthly_spend_mxn'
        ))
      )
  );
$$;

create or replace function app.enforce_source_evidence_append_only()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then raise exception 'SOURCE_EVIDENCE_APPEND_ONLY'; end if;
  if tg_op = 'DELETE' and not (
    lower(old.subject_type) = 'contact'
    and exists (
      select 1
      from public.deletion_items di
      join public.deletion_batches db
        on db.organization_id = di.organization_id and db.id = di.batch_id
      where di.organization_id = old.organization_id
        and di.subject_id = old.subject_id
        and di.subject_type = 'CONTACT'
        and di.status = 'ELIGIBLE'
        and db.status in ('APPROVED', 'IN_PROGRESS')
    )
  ) then raise exception 'SOURCE_EVIDENCE_APPEND_ONLY'; end if;
  return old;
end;
$$;

create or replace function app.prevent_commercial_integrity_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'COMMERCIAL_INTEGRITY_EVENT_APPEND_ONLY:%', tg_table_name;
end;
$$;

create or replace function app.capture_commercial_integrity_audit()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  snapshot jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  safe_snapshot jsonb;
  org_id uuid := nullif(snapshot ->> 'organization_id', '')::uuid;
  row_id uuid := nullif(snapshot ->> 'id', '')::uuid;
begin
  safe_snapshot := case tg_table_name
    when 'source_evidence' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id', 'organization_id', snapshot -> 'organization_id',
      'subject_type', snapshot -> 'subject_type', 'subject_id', snapshot -> 'subject_id',
      'field_name', snapshot -> 'field_name',
      'observed_at', snapshot -> 'observed_at', 'confidence', snapshot -> 'confidence',
      'checksum', snapshot -> 'checksum', 'created_at', snapshot -> 'created_at'
    ))
    when 'qualification_checks' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id', 'organization_id', snapshot -> 'organization_id',
      'lead_id', snapshot -> 'lead_id', 'industrial_over_100_kwp', snapshot -> 'industrial_over_100_kwp',
      'outside_annex_a', snapshot -> 'outside_annex_a',
      'verified_target_role', snapshot -> 'verified_target_role',
      'explicit_interest', snapshot -> 'explicit_interest',
      'monthly_spend_mxn', snapshot -> 'monthly_spend_mxn',
      'evidence_record_ids', snapshot -> 'evidence_record_ids',
      'evaluated_by', snapshot -> 'evaluated_by', 'evaluated_at', snapshot -> 'evaluated_at'
    ))
    when 'qualification_evidence_links' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id', 'organization_id', snapshot -> 'organization_id',
      'qualification_check_id', snapshot -> 'qualification_check_id',
      'lead_id', snapshot -> 'lead_id', 'criterion', snapshot -> 'criterion',
      'source_evidence_id', snapshot -> 'source_evidence_id',
      'evidence_checksum', snapshot -> 'evidence_checksum', 'created_at', snapshot -> 'created_at'
    ))
    when 'attribution_events' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id', 'organization_id', snapshot -> 'organization_id',
      'account_id', snapshot -> 'account_id', 'contact_id', snapshot -> 'contact_id',
      'first_contact_message_id', snapshot -> 'first_contact_message_id',
      'first_contact_at', snapshot -> 'first_contact_at',
      'attribution_expires_at', snapshot -> 'attribution_expires_at',
      'created_at', snapshot -> 'created_at'
    ))
    when 'payments' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id', 'organization_id', snapshot -> 'organization_id',
      'opportunity_id', snapshot -> 'opportunity_id', 'paid_at', snapshot -> 'paid_at',
      'is_first_payment', snapshot -> 'is_first_payment',
      'evidence_record_id', snapshot -> 'evidence_record_id',
      'created_at', snapshot -> 'created_at'
    ))
    when 'commissions' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id', 'organization_id', snapshot -> 'organization_id',
      'opportunity_id', snapshot -> 'opportunity_id', 'payment_id', snapshot -> 'payment_id',
      'attribution_event_id', snapshot -> 'attribution_event_id',
      'commission_rate', snapshot -> 'commission_rate', 'commission_mxn', snapshot -> 'commission_mxn',
      'status', snapshot -> 'status',
      'created_at', snapshot -> 'created_at'
    ))
    else jsonb_build_object('redaction', 'NO_COMMERCIAL_ALLOWLIST')
  end;

  insert into public.audit_log (
    organization_id, actor_user_id, action, record_type, record_id, old_data, new_data
  ) values (
    org_id, auth.uid(), tg_op, tg_table_name, row_id,
    case when tg_op in ('UPDATE', 'DELETE') then safe_snapshot else null end,
    case when tg_op in ('INSERT', 'UPDATE') then safe_snapshot else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function app.record_source_evidence(
  target_organization_id uuid,
  target_subject_type text,
  target_subject_id uuid,
  target_field_name text,
  target_source_url text,
  target_source_name text,
  target_observed_at timestamptz,
  target_confidence public.source_confidence,
  target_value_json jsonb,
  target_checksum text
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  normalized_subject_type text := lower(btrim(target_subject_type));
  normalized_field_name text := lower(btrim(target_field_name));
  existing_id uuid;
  created_id uuid;
  subject_exists boolean;
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'SOURCE_EVIDENCE_OPERATOR_ROLE_REQUIRED'; end if;
  if normalized_subject_type not in ('lead', 'account', 'contact', 'prequote', 'message', 'opportunity')
    or normalized_field_name not in (
      'industrial_over_100_kwp', 'outside_annex_a', 'verified_target_role',
      'explicit_interest', 'monthly_spend_mxn', 'first_payment_mxn'
    )
    or target_subject_id is null
    or target_source_url is null or target_source_url !~ '^https?://[^[:space:]]+$'
    or nullif(btrim(target_source_name), '') is null
    or target_observed_at is null or target_observed_at > clock_timestamp() + interval '5 minutes'
    or target_value_json is null or target_value_json = 'null'::jsonb
    or target_checksum is null or target_checksum !~ '^[a-f0-9]{64}$'
  then raise exception 'SOURCE_EVIDENCE_INVALID'; end if;

  subject_exists := case normalized_subject_type
    when 'lead' then exists (
      select 1 from public.leads where organization_id = target_organization_id and id = target_subject_id
    )
    when 'account' then exists (
      select 1 from public.accounts where organization_id = target_organization_id and id = target_subject_id and not is_deleted
    )
    when 'contact' then exists (
      select 1 from public.contacts where organization_id = target_organization_id and id = target_subject_id and not is_deleted
    )
    when 'prequote' then exists (
      select 1 from public.prequotes where organization_id = target_organization_id and id = target_subject_id
    )
    when 'message' then exists (
      select 1 from public.messages where organization_id = target_organization_id and id = target_subject_id
    )
    when 'opportunity' then exists (
      select 1 from public.opportunities where organization_id = target_organization_id and id = target_subject_id
    )
    else false
  end;
  if not subject_exists then raise exception 'SOURCE_EVIDENCE_SUBJECT_NOT_FOUND_OR_TENANT_MISMATCH'; end if;

  select id into existing_id
  from public.source_evidence
  where organization_id = target_organization_id
    and lower(subject_type) = normalized_subject_type
    and subject_id = target_subject_id
    and lower(field_name) = normalized_field_name
    and checksum = target_checksum;
  if found then return existing_id; end if;

  insert into public.source_evidence (
    organization_id, subject_type, subject_id, field_name, source_url, source_name,
    observed_at, confidence, value_json, checksum, created_by
  ) values (
    target_organization_id, normalized_subject_type, target_subject_id, normalized_field_name,
    target_source_url, btrim(target_source_name), target_observed_at, target_confidence,
    target_value_json, target_checksum, auth.uid()
  ) returning id into created_id;
  return created_id;
end;
$$;

create or replace function app.qualify_lead_strict(
  target_organization_id uuid,
  target_lead_id uuid,
  target_industrial_over_100_kwp boolean,
  target_outside_annex_a boolean,
  target_verified_target_role boolean,
  target_explicit_interest boolean,
  target_monthly_spend_mxn numeric,
  target_evidence_record_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  lead_record public.leads%rowtype;
  existing_check public.qualification_checks%rowtype;
  evidence_record public.source_evidence%rowtype;
  normalized_evidence_ids uuid[];
  created_check_id uuid;
  criterion_name text;
  industrial_found boolean := false;
  annex_found boolean := false;
  role_found boolean := false;
  interest_found boolean := false;
  spend_found boolean := false;
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'LEAD_QUALIFICATION_ROLE_REQUIRED'; end if;
  if not (
    target_industrial_over_100_kwp is true
    and target_outside_annex_a is true
    and target_verified_target_role is true
    and (target_explicit_interest is true or coalesce(target_monthly_spend_mxn, 0) > 20000)
  ) then raise exception 'STRICT_LEAD_EVIDENCE_INCOMPLETE'; end if;
  if cardinality(coalesce(target_evidence_record_ids, '{}'::uuid[])) not between 4 and 5 then
    raise exception 'QUALIFICATION_EVIDENCE_CARDINALITY_INVALID';
  end if;

  select array_agg(distinct evidence_id order by evidence_id)
  into normalized_evidence_ids
  from unnest(target_evidence_record_ids) evidence_id;
  if cardinality(normalized_evidence_ids) <> cardinality(target_evidence_record_ids) then
    raise exception 'QUALIFICATION_EVIDENCE_DUPLICATE_ID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':lead:' || target_lead_id::text, 0
  ));
  select * into lead_record
  from public.leads
  where organization_id = target_organization_id and id = target_lead_id
  for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;

  select * into existing_check
  from public.qualification_checks
  where organization_id = target_organization_id and lead_id = target_lead_id;
  if found then
    if lead_record.contractual_qualified
      and existing_check.industrial_over_100_kwp is not distinct from target_industrial_over_100_kwp
      and existing_check.outside_annex_a is not distinct from target_outside_annex_a
      and existing_check.verified_target_role is not distinct from target_verified_target_role
      and existing_check.explicit_interest is not distinct from target_explicit_interest
      and existing_check.monthly_spend_mxn is not distinct from target_monthly_spend_mxn
      and (select array_agg(distinct evidence_id order by evidence_id)
           from unnest(existing_check.evidence_record_ids) evidence_id) = normalized_evidence_ids
      and app.qualification_evidence_is_strict(target_organization_id, target_lead_id)
    then return jsonb_build_object('status', 'DUPLICATE', 'lead_id', target_lead_id); end if;
    raise exception 'LEAD_QUALIFICATION_IMMUTABLE';
  end if;

  if (
    select count(*) from public.source_evidence se
    where se.organization_id = target_organization_id and se.id = any(normalized_evidence_ids)
  ) <> cardinality(normalized_evidence_ids) then
    raise exception 'QUALIFICATION_EVIDENCE_NOT_FOUND_OR_TENANT_MISMATCH';
  end if;

  insert into public.qualification_checks (
    organization_id, lead_id, industrial_over_100_kwp, outside_annex_a,
    verified_target_role, explicit_interest, monthly_spend_mxn,
    evidence_record_ids, evaluated_by, evaluated_at
  ) values (
    target_organization_id, target_lead_id, target_industrial_over_100_kwp,
    target_outside_annex_a, target_verified_target_role, target_explicit_interest,
    target_monthly_spend_mxn, normalized_evidence_ids, auth.uid(), clock_timestamp()
  ) returning id into created_check_id;

  for evidence_record in
    select * from public.source_evidence
    where organization_id = target_organization_id and id = any(normalized_evidence_ids)
    order by id
  loop
    if evidence_record.confidence not in ('HIGH', 'VERIFIED')
      or evidence_record.checksum is null or evidence_record.checksum !~ '^[a-f0-9]{64}$'
      or evidence_record.source_url is null or evidence_record.source_url !~ '^https?://[^[:space:]]+$'
      or nullif(btrim(evidence_record.source_name), '') is null
      or evidence_record.observed_at > clock_timestamp() + interval '5 minutes'
    then raise exception 'QUALIFICATION_EVIDENCE_NOT_VERIFIABLE'; end if;
    if not app.evidence_subject_matches_lead(
      target_organization_id, target_lead_id,
      evidence_record.subject_type, evidence_record.subject_id
    ) then raise exception 'QUALIFICATION_EVIDENCE_SUBJECT_MISMATCH'; end if;

    criterion_name := lower(evidence_record.field_name);
    if criterion_name = 'industrial_over_100_kwp' then
      if industrial_found or lower(evidence_record.subject_type) not in ('lead', 'account', 'prequote')
        or evidence_record.value_json <> 'true'::jsonb
      then raise exception 'QUALIFICATION_EVIDENCE_INDUSTRIAL_INVALID'; end if;
      industrial_found := true;
    elsif criterion_name = 'outside_annex_a' then
      if annex_found or lower(evidence_record.subject_type) not in ('lead', 'account')
        or evidence_record.value_json <> 'true'::jsonb
      then raise exception 'QUALIFICATION_EVIDENCE_ANNEX_INVALID'; end if;
      annex_found := true;
    elsif criterion_name = 'verified_target_role' then
      if role_found or lower(evidence_record.subject_type) not in ('lead', 'contact')
        or evidence_record.value_json <> 'true'::jsonb
      then raise exception 'QUALIFICATION_EVIDENCE_ROLE_INVALID'; end if;
      role_found := true;
    elsif criterion_name = 'explicit_interest' then
      if interest_found or lower(evidence_record.subject_type) not in ('lead', 'message', 'prequote')
        or evidence_record.value_json <> 'true'::jsonb
      then raise exception 'QUALIFICATION_EVIDENCE_INTEREST_INVALID'; end if;
      interest_found := true;
    elsif criterion_name = 'monthly_spend_mxn' then
      if spend_found or lower(evidence_record.subject_type) not in ('lead', 'prequote')
        or jsonb_typeof(evidence_record.value_json) <> 'number'
        or (evidence_record.value_json #>> '{}')::numeric <= 20000
        or (evidence_record.value_json #>> '{}')::numeric is distinct from target_monthly_spend_mxn
      then raise exception 'QUALIFICATION_EVIDENCE_SPEND_INVALID'; end if;
      spend_found := true;
    else
      raise exception 'QUALIFICATION_EVIDENCE_FIELD_INVALID';
    end if;

    insert into public.qualification_evidence_links (
      organization_id, qualification_check_id, lead_id, criterion,
      source_evidence_id, evidence_checksum
    ) values (
      target_organization_id, created_check_id, target_lead_id, criterion_name,
      evidence_record.id, evidence_record.checksum
    );
  end loop;

  if not industrial_found or not annex_found or not role_found
    or (target_explicit_interest and not interest_found)
    or (not target_explicit_interest and not spend_found)
  then raise exception 'STRICT_LEAD_RELATIONAL_EVIDENCE_INCOMPLETE'; end if;

  update public.leads
  set status = 'QUALIFIED', contractual_qualified = true,
      qualification_reason = 'STRICT_RELATIONAL_EVIDENCE_VERIFIED', updated_at = clock_timestamp()
  where id = target_lead_id and organization_id = target_organization_id;

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id, 'lead', target_lead_id, 'lead.contractual_qualified',
    'strict-lead-v2:' || target_lead_id::text,
    jsonb_build_object('lead_id', target_lead_id, 'qualification_check_id', created_check_id)
  ) on conflict (organization_id, idempotency_key) do nothing;

  return jsonb_build_object(
    'status', 'QUALIFIED', 'lead_id', target_lead_id,
    'qualification_check_id', created_check_id
  );
end;
$$;

create or replace function app.enforce_lead_qualification_transition()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.contractual_qualified or new.status = 'QUALIFIED' then
      raise exception 'STRICT_LEAD_CREATION_MUST_START_UNQUALIFIED';
    end if;
    return new;
  end if;
  if new.contractual_qualified = old.contractual_qualified and new.status = old.status then
    return new;
  end if;
  if old.contractual_qualified and (
    not new.contractual_qualified or new.status <> 'QUALIFIED'
  ) then raise exception 'STRICT_LEAD_QUALIFICATION_IMMUTABLE'; end if;
  if new.contractual_qualified then
    if new.status <> 'QUALIFIED' then raise exception 'STRICT_LEAD_STATUS_MISMATCH'; end if;
    if not app.qualification_evidence_is_strict(new.organization_id, new.id) then
      raise exception 'STRICT_LEAD_RELATIONAL_EVIDENCE_INCOMPLETE';
    end if;
  elsif new.status = 'QUALIFIED' then
    raise exception 'QUALIFIED_STATUS_REQUIRES_CONTRACTUAL_FLAG';
  end if;
  return new;
end;
$$;

create or replace function app.enforce_opportunity_transition()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  stage_order integer;
  old_stage_order integer;
  lead_record public.leads%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.stage not in ('PROSPECTING', 'CONVERSATION') then
      raise exception 'OPPORTUNITY_CREATION_STAGE_INVALID';
    end if;
  else
    if old.stage in ('CLOSED_WON', 'CLOSED_LOST') and new is distinct from old then
      raise exception 'CLOSED_OPPORTUNITY_IMMUTABLE';
    end if;
    stage_order := array_position(
      array['PROSPECTING', 'CONVERSATION', 'MEETING_CONFIRMED', 'DISCOVERY_HELD', 'QUALIFIED', 'TECHNICAL_VISIT', 'PROPOSAL', 'DECISION', 'CLOSED_WON', 'CLOSED_LOST']::text[],
      new.stage::text
    );
    old_stage_order := array_position(
      array['PROSPECTING', 'CONVERSATION', 'MEETING_CONFIRMED', 'DISCOVERY_HELD', 'QUALIFIED', 'TECHNICAL_VISIT', 'PROPOSAL', 'DECISION', 'CLOSED_WON', 'CLOSED_LOST']::text[],
      old.stage::text
    );
    if old.stage in ('QUALIFIED', 'TECHNICAL_VISIT', 'PROPOSAL', 'DECISION')
      and new.stage <> 'CLOSED_LOST' and stage_order < old_stage_order
    then raise exception 'OPPORTUNITY_STAGE_REGRESSION_REJECTED'; end if;
    if new.stage not in ('CLOSED_WON', 'CLOSED_LOST') and stage_order > old_stage_order + 1 then
      raise exception 'OPPORTUNITY_STAGE_SKIP_REJECTED';
    end if;
  end if;

  if new.lead_id is not null then
    select * into lead_record from public.leads
    where organization_id = new.organization_id and id = new.lead_id;
    if not found or lead_record.account_id is distinct from new.account_id then
      raise exception 'OPPORTUNITY_LEAD_ACCOUNT_MISMATCH';
    end if;
  end if;

  if new.stage in ('QUALIFIED', 'TECHNICAL_VISIT', 'PROPOSAL', 'DECISION', 'CLOSED_WON') then
    if new.lead_id is null or not lead_record.contractual_qualified then
      raise exception 'QUALIFIED_PIPELINE_REQUIRES_STRICT_LEAD';
    end if;
    if not (
      new.economic_buyer and new.active_pain and new.business_impact and new.timing_under_90_days
      and coalesce(new.value_mxn, 0) > 0
      and nullif(btrim(new.next_action), '') is not null
      and new.next_action_at is not null
    ) then raise exception 'QUALIFIED_PIPELINE_EVIDENCE_INCOMPLETE'; end if;
  end if;
  if new.stage = 'PROPOSAL' and not exists (
    select 1 from public.proposals p
    where p.organization_id = new.organization_id and p.opportunity_id = new.id and p.delivered_at is not null
  ) then raise exception 'PROPOSAL_STAGE_REQUIRES_DELIVERY_EVIDENCE'; end if;
  if new.stage = 'CLOSED_WON' and not exists (
    select 1 from public.approvals a
    where a.organization_id = new.organization_id
      and a.subject_type = 'opportunity_closed_won'
      and a.subject_id = new.id and a.decision = 'APPROVED'
  ) then raise exception 'CLOSED_WON_REQUIRES_APPROVAL_EVIDENCE'; end if;
  return new;
end;
$$;

create or replace function app.enforce_approval_append_only()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  actor_id uuid;
begin
  if tg_op <> 'INSERT' then raise exception 'APPROVAL_APPEND_ONLY'; end if;
  actor_id := auth.uid();
  if actor_id is not null and new.decided_by <> actor_id then
    raise exception 'APPROVAL_ACTOR_MISMATCH';
  end if;
  if new.subject_type in (
    'campaign_first_send_release', 'rollout_wave_release',
    'contractual_monthly_report_issue', 'recovery_experiment_release'
  ) and (
    actor_id is null
    or not app.has_role(new.organization_id, array['teckel_admin'::public.user_role])
  ) then raise exception 'CONTROLLED_RELEASE_APPROVAL_JORGE_ONLY'; end if;
  if new.subject_type = 'final_handoff_acceptance' and (
    actor_id is null
    or not app.has_role(new.organization_id, array['ennco_admin'::public.user_role])
  ) then raise exception 'HANDOFF_ACCEPTANCE_ENNCO_ADMIN_REQUIRED'; end if;
  if new.subject_type = 'opportunity_closed_won' and (
    actor_id is null
    or not app.has_role(new.organization_id, array[
      'ennco_admin'::public.user_role, 'teckel_admin'::public.user_role
    ])
    or not exists (
      select 1 from public.opportunities o
      where o.organization_id = new.organization_id and o.id = new.subject_id
    )
  ) then raise exception 'CLOSED_WON_APPROVAL_ADMIN_REQUIRED'; end if;
  return new;
end;
$$;

create or replace function app.attribution_event_is_valid(
  target_organization_id uuid,
  target_account_id uuid,
  target_contact_id uuid,
  target_message_id uuid,
  target_first_contact_at timestamptz,
  target_expires_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select coalesce((
    select m.id = target_message_id
      and m.contact_id = target_contact_id
      and m.sent_at = target_first_contact_at
      and target_expires_at = m.sent_at + interval '12 months'
    from public.messages m
    join public.campaign_enrollments ce
      on ce.organization_id = m.organization_id and ce.id = m.enrollment_id
    where m.organization_id = target_organization_id
      and ce.account_id = target_account_id
      and m.direction = 'OUTBOUND'
      and m.status in ('SENT', 'DELIVERED')
      and m.sent_at is not null
      and nullif(btrim(m.provider_message_id), '') is not null
      and m.contact_id is not null
      and m.contact_id = ce.contact_id
    order by m.sent_at, m.created_at, m.id
    limit 1
  ), false);
$$;

create or replace function app.payment_evidence_is_verified(
  target_organization_id uuid,
  target_opportunity_id uuid,
  target_evidence_record_id uuid,
  target_amount_mxn numeric,
  target_paid_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  evidence_record public.source_evidence%rowtype;
begin
  select * into evidence_record
  from public.source_evidence
  where organization_id = target_organization_id and id = target_evidence_record_id;
  if not found
    or lower(evidence_record.subject_type) <> 'opportunity'
    or evidence_record.subject_id <> target_opportunity_id
    or lower(evidence_record.field_name) <> 'first_payment_mxn'
    or evidence_record.confidence not in ('HIGH', 'VERIFIED')
    or evidence_record.checksum is null or evidence_record.checksum !~ '^[a-f0-9]{64}$'
    or evidence_record.source_url is null or evidence_record.source_url !~ '^https?://[^[:space:]]+$'
    or nullif(btrim(evidence_record.source_name), '') is null
    or evidence_record.observed_at < target_paid_at
    or evidence_record.observed_at > clock_timestamp() + interval '5 minutes'
    or jsonb_typeof(evidence_record.value_json) <> 'object'
    or (evidence_record.value_json ->> 'amount_mxn') is null
    or (evidence_record.value_json ->> 'paid_at') is null
    or (evidence_record.value_json ->> 'amount_mxn')::numeric is distinct from target_amount_mxn
    or (evidence_record.value_json ->> 'paid_at')::timestamptz is distinct from target_paid_at
  then return false; end if;
  return true;
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    return false;
end;
$$;

create or replace function app.commission_event_is_valid(
  target_organization_id uuid,
  target_opportunity_id uuid,
  target_payment_id uuid,
  target_attribution_event_id uuid,
  target_commission_rate numeric,
  target_commission_mxn numeric,
  target_status text
)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from public.opportunities o
    join public.payments p
      on p.organization_id = o.organization_id and p.opportunity_id = o.id
    join public.attribution_events ae
      on ae.organization_id = o.organization_id and ae.account_id = o.account_id
    where o.organization_id = target_organization_id
      and o.id = target_opportunity_id
      and o.stage = 'CLOSED_WON'
      and p.id = target_payment_id
      and p.is_first_payment
      and ae.id = target_attribution_event_id
      and p.paid_at >= ae.first_contact_at
      and p.paid_at <= ae.attribution_expires_at
      and target_commission_rate = 0.02
      and target_commission_mxn = round(p.amount_mxn * 0.02, 2)
      and target_status = 'EARNED'
  );
$$;

create or replace function app.enforce_attribution_insert()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if not app.attribution_event_is_valid(
    new.organization_id, new.account_id, new.contact_id,
    new.first_contact_message_id, new.first_contact_at, new.attribution_expires_at
  ) then raise exception 'ATTRIBUTION_MUST_USE_FIRST_REAL_OUTBOUND'; end if;
  return new;
end;
$$;

create or replace function app.enforce_first_payment_insert()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if not new.is_first_payment or new.paid_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'FIRST_PAYMENT_INVALID';
  end if;
  if not exists (
    select 1 from public.opportunities o
    where o.organization_id = new.organization_id
      and o.id = new.opportunity_id and o.stage = 'CLOSED_WON'
  ) then raise exception 'FIRST_PAYMENT_REQUIRES_CLOSED_WON'; end if;
  if not app.payment_evidence_is_verified(
    new.organization_id, new.opportunity_id, new.evidence_record_id,
    new.amount_mxn, new.paid_at
  ) then raise exception 'FIRST_PAYMENT_EVIDENCE_NOT_VERIFIED'; end if;
  return new;
end;
$$;

create or replace function app.enforce_commission_insert()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if not app.commission_event_is_valid(
    new.organization_id, new.opportunity_id, new.payment_id,
    new.attribution_event_id, new.commission_rate, new.commission_mxn, new.status
  ) then raise exception 'COMMISSION_NOT_EARNED'; end if;
  return new;
end;
$$;

create or replace function app.record_first_contact_attribution(
  target_organization_id uuid,
  target_account_id uuid,
  target_message_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  target_message public.messages%rowtype;
  existing_event public.attribution_events%rowtype;
  created_event public.attribution_events%rowtype;
  idempotency_hash text := encode(digest(coalesce(target_idempotency_key, ''), 'sha256'), 'hex');
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'ATTRIBUTION_OPERATOR_ROLE_REQUIRED'; end if;
  if target_idempotency_key is null or target_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$' then
    raise exception 'ATTRIBUTION_IDEMPOTENCY_KEY_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':attribution:' || target_account_id::text, 0
  ));

  select m.* into target_message
  from public.messages m
  join public.campaign_enrollments ce
    on ce.organization_id = m.organization_id and ce.id = m.enrollment_id
  where m.organization_id = target_organization_id
    and m.id = target_message_id
    and ce.account_id = target_account_id
    and m.direction = 'OUTBOUND'
    and m.status in ('SENT', 'DELIVERED')
    and m.sent_at is not null
    and nullif(btrim(m.provider_message_id), '') is not null
    and m.contact_id = ce.contact_id;
  if not found then raise exception 'ATTRIBUTION_MESSAGE_NOT_REAL_OR_TENANT_MISMATCH'; end if;
  if not app.attribution_event_is_valid(
    target_organization_id, target_account_id, target_message.contact_id,
    target_message.id, target_message.sent_at, target_message.sent_at + interval '12 months'
  ) then raise exception 'ATTRIBUTION_MESSAGE_NOT_FIRST'; end if;

  select * into existing_event
  from public.attribution_events
  where organization_id = target_organization_id
    and (account_id = target_account_id or idempotency_key = idempotency_hash);
  if found then
    if existing_event.account_id = target_account_id
      and existing_event.first_contact_message_id = target_message_id
      and existing_event.idempotency_key = idempotency_hash
    then return jsonb_build_object('status', 'DUPLICATE', 'attribution_event_id', existing_event.id); end if;
    raise exception 'ATTRIBUTION_IDEMPOTENCY_CONFLICT';
  end if;

  insert into public.attribution_events (
    organization_id, account_id, contact_id, first_contact_message_id,
    first_contact_at, attribution_expires_at, idempotency_key
  ) values (
    target_organization_id, target_account_id, target_message.contact_id, target_message.id,
    target_message.sent_at, target_message.sent_at + interval '12 months', idempotency_hash
  ) returning * into created_event;

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id, 'attribution', created_event.id, 'attribution.first_contact_recorded',
    'commercial:' || idempotency_hash,
    jsonb_build_object('attribution_event_id', created_event.id, 'account_id', target_account_id)
  ) on conflict (organization_id, idempotency_key) do nothing;
  return jsonb_build_object('status', 'RECORDED', 'attribution_event_id', created_event.id);
end;
$$;

create or replace function app.record_first_payment(
  target_organization_id uuid,
  target_opportunity_id uuid,
  target_amount_mxn numeric,
  target_paid_at timestamptz,
  target_evidence_record_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  existing_payment public.payments%rowtype;
  created_payment public.payments%rowtype;
  idempotency_hash text := encode(digest(coalesce(target_idempotency_key, ''), 'sha256'), 'hex');
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'PAYMENT_OPERATOR_ROLE_REQUIRED'; end if;
  if target_amount_mxn is null or target_amount_mxn <= 0
    or target_paid_at is null or target_paid_at > clock_timestamp() + interval '5 minutes'
    or target_idempotency_key is null or target_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$'
  then raise exception 'FIRST_PAYMENT_INPUT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':first-payment:' || target_opportunity_id::text, 0
  ));

  select * into existing_payment from public.payments
  where organization_id = target_organization_id
    and (opportunity_id = target_opportunity_id and is_first_payment
      or idempotency_key = idempotency_hash);
  if found then
    if existing_payment.opportunity_id = target_opportunity_id
      and existing_payment.amount_mxn = target_amount_mxn
      and existing_payment.paid_at = target_paid_at
      and existing_payment.evidence_record_id = target_evidence_record_id
      and existing_payment.idempotency_key = idempotency_hash
    then return jsonb_build_object('status', 'DUPLICATE', 'payment_id', existing_payment.id); end if;
    raise exception 'FIRST_PAYMENT_IDEMPOTENCY_CONFLICT';
  end if;

  insert into public.payments (
    organization_id, opportunity_id, amount_mxn, paid_at,
    is_first_payment, evidence_record_id, idempotency_key
  ) values (
    target_organization_id, target_opportunity_id, target_amount_mxn, target_paid_at,
    true, target_evidence_record_id, idempotency_hash
  ) returning * into created_payment;

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id, 'payment', created_payment.id, 'payment.first_verified',
    'commercial:' || idempotency_hash,
    jsonb_build_object('payment_id', created_payment.id, 'opportunity_id', target_opportunity_id)
  ) on conflict (organization_id, idempotency_key) do nothing;
  return jsonb_build_object('status', 'RECORDED', 'payment_id', created_payment.id);
end;
$$;

create or replace function app.record_earned_commission(
  target_organization_id uuid,
  target_opportunity_id uuid,
  target_payment_id uuid,
  target_attribution_event_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  payment_record public.payments%rowtype;
  existing_commission public.commissions%rowtype;
  created_commission public.commissions%rowtype;
  calculated_commission numeric(16,2);
  idempotency_hash text := encode(digest(coalesce(target_idempotency_key, ''), 'sha256'), 'hex');
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'COMMISSION_OPERATOR_ROLE_REQUIRED'; end if;
  if target_idempotency_key is null or target_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$' then
    raise exception 'COMMISSION_IDEMPOTENCY_KEY_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':commission:' || target_payment_id::text, 0
  ));
  select * into payment_record from public.payments
  where organization_id = target_organization_id and id = target_payment_id;
  if not found then raise exception 'COMMISSION_PAYMENT_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  calculated_commission := round(payment_record.amount_mxn * 0.02, 2);

  select * into existing_commission from public.commissions
  where organization_id = target_organization_id
    and (payment_id = target_payment_id or idempotency_key = idempotency_hash);
  if found then
    if existing_commission.opportunity_id = target_opportunity_id
      and existing_commission.payment_id = target_payment_id
      and existing_commission.attribution_event_id = target_attribution_event_id
      and existing_commission.idempotency_key = idempotency_hash
    then return jsonb_build_object('status', 'DUPLICATE', 'commission_id', existing_commission.id); end if;
    raise exception 'COMMISSION_IDEMPOTENCY_CONFLICT';
  end if;

  insert into public.commissions (
    organization_id, opportunity_id, payment_id, attribution_event_id,
    commission_rate, commission_mxn, status, idempotency_key
  ) values (
    target_organization_id, target_opportunity_id, target_payment_id, target_attribution_event_id,
    0.02, calculated_commission, 'EARNED', idempotency_hash
  ) returning * into created_commission;

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id, 'commission', created_commission.id, 'commission.earned',
    'commercial:' || idempotency_hash,
    jsonb_build_object('commission_id', created_commission.id, 'payment_id', target_payment_id)
  ) on conflict (organization_id, idempotency_key) do nothing;
  return jsonb_build_object('status', 'EARNED', 'commission_id', created_commission.id);
end;
$$;

drop trigger if exists source_evidence_append_only on public.source_evidence;
create trigger source_evidence_append_only
before update or delete on public.source_evidence
for each row execute function app.enforce_source_evidence_append_only();

drop trigger if exists qualification_checks_append_only on public.qualification_checks;
create trigger qualification_checks_append_only
before update or delete on public.qualification_checks
for each row execute function app.prevent_commercial_integrity_mutation();

drop trigger if exists qualification_evidence_links_append_only on public.qualification_evidence_links;
create trigger qualification_evidence_links_append_only
before update or delete on public.qualification_evidence_links
for each row execute function app.prevent_commercial_integrity_mutation();

drop trigger if exists attribution_events_insert_gate on public.attribution_events;
create trigger attribution_events_insert_gate
before insert on public.attribution_events
for each row execute function app.enforce_attribution_insert();
drop trigger if exists attribution_events_append_only on public.attribution_events;
create trigger attribution_events_append_only
before update or delete on public.attribution_events
for each row execute function app.prevent_commercial_integrity_mutation();

drop trigger if exists payments_insert_gate on public.payments;
create trigger payments_insert_gate
before insert on public.payments
for each row execute function app.enforce_first_payment_insert();
drop trigger if exists payments_append_only on public.payments;
create trigger payments_append_only
before update or delete on public.payments
for each row execute function app.prevent_commercial_integrity_mutation();

drop trigger if exists commissions_insert_gate on public.commissions;
create trigger commissions_insert_gate
before insert on public.commissions
for each row execute function app.enforce_commission_insert();
drop trigger if exists commissions_append_only on public.commissions;
create trigger commissions_append_only
before update or delete on public.commissions
for each row execute function app.prevent_commercial_integrity_mutation();

drop trigger if exists opportunities_strict_stage_transition on public.opportunities;
create trigger opportunities_strict_stage_transition
before insert or update on public.opportunities
for each row execute function app.enforce_opportunity_transition();

drop trigger if exists leads_strict_qualification_transition on public.leads;
create trigger leads_strict_qualification_transition
before insert or update of contractual_qualified, status on public.leads
for each row execute function app.enforce_lead_qualification_transition();

drop trigger if exists qualification_checks_audit on public.qualification_checks;
drop trigger if exists source_evidence_commercial_audit on public.source_evidence;
create trigger source_evidence_commercial_audit
after insert or update or delete on public.source_evidence
for each row execute function app.capture_commercial_integrity_audit();
drop trigger if exists qualification_checks_commercial_audit on public.qualification_checks;
create trigger qualification_checks_commercial_audit
after insert or update or delete on public.qualification_checks
for each row execute function app.capture_commercial_integrity_audit();
drop trigger if exists qualification_evidence_links_commercial_audit on public.qualification_evidence_links;
create trigger qualification_evidence_links_commercial_audit
after insert or update or delete on public.qualification_evidence_links
for each row execute function app.capture_commercial_integrity_audit();
drop trigger if exists attribution_events_commercial_audit on public.attribution_events;
create trigger attribution_events_commercial_audit
after insert or update or delete on public.attribution_events
for each row execute function app.capture_commercial_integrity_audit();
drop trigger if exists payments_commercial_audit on public.payments;
create trigger payments_commercial_audit
after insert or update or delete on public.payments
for each row execute function app.capture_commercial_integrity_audit();
drop trigger if exists commissions_commercial_audit on public.commissions;
create trigger commissions_commercial_audit
after insert or update or delete on public.commissions
for each row execute function app.capture_commercial_integrity_audit();

drop policy if exists source_evidence_operator_write on public.source_evidence;
drop policy if exists leads_operator_write on public.leads;
drop policy if exists qualification_checks_operator_write on public.qualification_checks;
drop policy if exists payments_operator_write on public.payments;
drop policy if exists attribution_events_operator_write on public.attribution_events;
drop policy if exists commissions_operator_write on public.commissions;

revoke insert, update, delete, truncate on public.source_evidence from authenticated;
revoke insert, update, delete, truncate on public.leads from authenticated;
revoke insert, update, delete, truncate on public.qualification_checks from authenticated;
revoke insert, update, delete, truncate on public.qualification_evidence_links from authenticated;
revoke insert, update, delete, truncate on public.payments from authenticated;
revoke insert, update, delete, truncate on public.attribution_events from authenticated;
revoke insert, update, delete, truncate on public.commissions from authenticated;

revoke all on function app.evidence_subject_matches_lead(uuid, uuid, text, uuid) from public;
revoke all on function app.qualification_evidence_is_strict(uuid, uuid) from public;
revoke all on function app.enforce_source_evidence_append_only() from public;
revoke all on function app.prevent_commercial_integrity_mutation() from public;
revoke all on function app.capture_commercial_integrity_audit() from public;
revoke all on function app.record_source_evidence(uuid, text, uuid, text, text, text, timestamptz, public.source_confidence, jsonb, text) from public;
revoke all on function app.attribution_event_is_valid(uuid, uuid, uuid, uuid, timestamptz, timestamptz) from public;
revoke all on function app.payment_evidence_is_verified(uuid, uuid, uuid, numeric, timestamptz) from public;
revoke all on function app.commission_event_is_valid(uuid, uuid, uuid, uuid, numeric, numeric, text) from public;
revoke all on function app.enforce_attribution_insert() from public;
revoke all on function app.enforce_first_payment_insert() from public;
revoke all on function app.enforce_commission_insert() from public;
revoke all on function app.record_first_contact_attribution(uuid, uuid, uuid, text) from public;
revoke all on function app.record_first_payment(uuid, uuid, numeric, timestamptz, uuid, text) from public;
revoke all on function app.record_earned_commission(uuid, uuid, uuid, uuid, text) from public;

do $$
begin
  if exists (
    select 1 from public.leads l
    where l.contractual_qualified
      and not app.qualification_evidence_is_strict(l.organization_id, l.id)
  ) then raise exception 'M014_PREFLIGHT_UNVERIFIED_QUALIFIED_LEAD'; end if;
  if exists (
    select 1 from public.attribution_events ae
    where not app.attribution_event_is_valid(
      ae.organization_id, ae.account_id, ae.contact_id, ae.first_contact_message_id,
      ae.first_contact_at, ae.attribution_expires_at
    )
  ) then raise exception 'M014_PREFLIGHT_INVALID_ATTRIBUTION'; end if;
  if exists (
    select 1 from public.payments p
    join public.opportunities o
      on o.organization_id = p.organization_id and o.id = p.opportunity_id
    where not p.is_first_payment or o.stage <> 'CLOSED_WON'
      or not app.payment_evidence_is_verified(
        p.organization_id, p.opportunity_id, p.evidence_record_id, p.amount_mxn, p.paid_at
      )
  ) then raise exception 'M014_PREFLIGHT_INVALID_PAYMENT'; end if;
  if exists (
    select 1 from public.commissions c
    where not app.commission_event_is_valid(
      c.organization_id, c.opportunity_id, c.payment_id, c.attribution_event_id,
      c.commission_rate, c.commission_mxn, c.status
    )
  ) then raise exception 'M014_PREFLIGHT_INVALID_COMMISSION'; end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.qualification_evidence_links to authenticated;
    grant execute on function app.record_source_evidence(uuid, text, uuid, text, text, text, timestamptz, public.source_confidence, jsonb, text) to authenticated;
    grant execute on function app.qualify_lead_strict(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]) to authenticated;
    grant execute on function app.record_first_contact_attribution(uuid, uuid, uuid, text) to authenticated;
    grant execute on function app.record_first_payment(uuid, uuid, numeric, timestamptz, uuid, text) to authenticated;
    grant execute on function app.record_earned_commission(uuid, uuid, uuid, uuid, text) to authenticated;
  end if;
end;
$$;

commit;
