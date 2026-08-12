begin;

drop trigger if exists messages_m016_rollback_fail_closed on public.messages;
drop function if exists app.block_real_outbound_without_m016();

alter table public.opportunities add column if not exists creation_idempotency_key text;
alter table public.opportunities
  drop constraint if exists opportunities_creation_idempotency_key_check;
alter table public.opportunities
  add constraint opportunities_creation_idempotency_key_check check (
    creation_idempotency_key is null or creation_idempotency_key ~ '^[a-f0-9]{64}$'
  );
create unique index if not exists opportunities_organization_id_creation_key_unique
on public.opportunities (organization_id, creation_idempotency_key)
where creation_idempotency_key is not null;
create unique index if not exists opportunities_one_open_per_strict_lead
on public.opportunities (organization_id, lead_id)
where lead_id is not null and stage not in ('CLOSED_WON', 'CLOSED_LOST');

alter table public.meetings add column if not exists idempotency_key text;
update public.meetings
set idempotency_key = encode(digest('legacy-meeting:' || id::text, 'sha256'), 'hex')
where idempotency_key is null;
alter table public.meetings alter column idempotency_key set not null;
alter table public.meetings
  drop constraint if exists meetings_idempotency_key_check,
  add constraint meetings_idempotency_key_check check (idempotency_key ~ '^[a-f0-9]{64}$');
create unique index if not exists meetings_organization_id_idempotency_unique
on public.meetings (organization_id, idempotency_key);
alter table public.meetings
  drop constraint if exists meetings_opportunity_id_fkey,
  drop constraint if exists meetings_opportunity_tenant_fkey;
alter table public.meetings
  add constraint meetings_opportunity_tenant_fkey
    foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id)
    on delete cascade;

create or replace function app.create_opportunity_from_strict_lead(
  target_organization_id uuid,
  target_lead_id uuid,
  target_initial_stage public.commercial_stage,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  lead_record public.leads%rowtype;
  existing_opportunity public.opportunities%rowtype;
  created_opportunity public.opportunities%rowtype;
  idempotency_hash text := encode(digest(coalesce(target_idempotency_key, ''), 'sha256'), 'hex');
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'OPPORTUNITY_OPERATOR_ROLE_REQUIRED'; end if;
  if target_initial_stage not in ('PROSPECTING', 'CONVERSATION')
    or target_idempotency_key is null or target_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$'
  then raise exception 'OPPORTUNITY_CREATE_INPUT_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':opportunity-lead:' || target_lead_id::text, 0
  ));
  select * into lead_record from public.leads
  where organization_id = target_organization_id and id = target_lead_id
  for share;
  if not found then raise exception 'STRICT_LEAD_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  if not lead_record.contractual_qualified or lead_record.status <> 'QUALIFIED'
    or not app.qualification_evidence_is_strict(target_organization_id, target_lead_id)
    or lead_record.account_id is null
  then raise exception 'OPPORTUNITY_REQUIRES_STRICT_LEAD'; end if;

  select * into existing_opportunity
  from public.opportunities
  where organization_id = target_organization_id
    and (creation_idempotency_key = idempotency_hash
      or (lead_id = target_lead_id and stage not in ('CLOSED_WON', 'CLOSED_LOST')))
  order by created_at, id
  limit 1;
  if found then
    if existing_opportunity.lead_id = target_lead_id
      and existing_opportunity.account_id = lead_record.account_id
      and existing_opportunity.stage = target_initial_stage
      and existing_opportunity.creation_idempotency_key = idempotency_hash
    then return jsonb_build_object('status', 'DUPLICATE', 'opportunity_id', existing_opportunity.id); end if;
    raise exception 'OPPORTUNITY_IDEMPOTENCY_DRIFT';
  end if;

  insert into public.opportunities (
    organization_id, account_id, lead_id, stage, economic_buyer, active_pain,
    business_impact, timing_under_90_days, creation_idempotency_key
  ) values (
    target_organization_id, lead_record.account_id, lead_record.id, target_initial_stage,
    false, false, false, false, idempotency_hash
  ) returning * into created_opportunity;

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id, 'opportunity', created_opportunity.id, 'opportunity.created',
    'canonical-opportunity:' || idempotency_hash,
    jsonb_build_object('opportunity_id', created_opportunity.id, 'lead_id', target_lead_id)
  ) on conflict (organization_id, idempotency_key) do nothing;
  return jsonb_build_object('status', 'CREATED', 'opportunity_id', created_opportunity.id);
end;
$$;

create or replace function app.transition_opportunity(
  target_organization_id uuid,
  target_opportunity_id uuid,
  target_stage public.commercial_stage,
  target_economic_buyer boolean,
  target_active_pain boolean,
  target_business_impact boolean,
  target_timing_under_90_days boolean,
  target_value_mxn numeric,
  target_next_action text,
  target_next_action_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  affected integer;
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'OPPORTUNITY_OPERATOR_ROLE_REQUIRED'; end if;
  if octet_length(coalesce(target_next_action, '')) > 2000 then
    raise exception 'NEXT_ACTION_TOO_LARGE';
  end if;
  update public.opportunities
  set stage = target_stage,
      economic_buyer = coalesce(target_economic_buyer, false),
      active_pain = coalesce(target_active_pain, false),
      business_impact = coalesce(target_business_impact, false),
      timing_under_90_days = coalesce(target_timing_under_90_days, false),
      value_mxn = target_value_mxn,
      next_action = target_next_action,
      next_action_at = target_next_action_at,
      updated_at = clock_timestamp()
  where organization_id = target_organization_id and id = target_opportunity_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'OPPORTUNITY_NOT_FOUND'; end if;
  return jsonb_build_object('status', target_stage, 'opportunity_id', target_opportunity_id);
end;
$$;

create or replace function app.transition_opportunity(
  target_organization_id uuid,
  target_opportunity_id uuid,
  target_stage public.commercial_stage,
  target_value_mxn numeric,
  target_next_action text,
  target_next_action_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  opportunity_record public.opportunities%rowtype;
begin
  select * into opportunity_record from public.opportunities
  where organization_id = target_organization_id and id = target_opportunity_id;
  if not found then raise exception 'OPPORTUNITY_NOT_FOUND'; end if;
  return app.transition_opportunity(
    target_organization_id, target_opportunity_id, target_stage,
    opportunity_record.economic_buyer, opportunity_record.active_pain,
    opportunity_record.business_impact, opportunity_record.timing_under_90_days,
    target_value_mxn, target_next_action, target_next_action_at
  );
end;
$$;

create or replace function app.schedule_meeting(
  target_organization_id uuid,
  target_opportunity_id uuid,
  target_scheduled_at timestamptz,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  existing_meeting public.meetings%rowtype;
  created_meeting public.meetings%rowtype;
  idempotency_hash text := encode(digest(coalesce(target_idempotency_key, ''), 'sha256'), 'hex');
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'MEETING_OPERATOR_ROLE_REQUIRED'; end if;
  if target_scheduled_at is null or target_scheduled_at <= clock_timestamp()
    or target_idempotency_key is null or target_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$'
  then raise exception 'MEETING_INPUT_INVALID'; end if;
  if not exists (
    select 1 from public.opportunities o
    where o.organization_id = target_organization_id and o.id = target_opportunity_id
  ) then raise exception 'MEETING_OPPORTUNITY_NOT_FOUND_OR_TENANT_MISMATCH'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':meeting:' || idempotency_hash, 0
  ));
  select * into existing_meeting from public.meetings
  where organization_id = target_organization_id and idempotency_key = idempotency_hash;
  if found then
    if existing_meeting.opportunity_id = target_opportunity_id
      and existing_meeting.scheduled_at = target_scheduled_at
    then return jsonb_build_object('status', 'DUPLICATE', 'meeting_id', existing_meeting.id); end if;
    raise exception 'MEETING_IDEMPOTENCY_DRIFT';
  end if;

  insert into public.meetings (
    organization_id, opportunity_id, scheduled_at, idempotency_key
  ) values (
    target_organization_id, target_opportunity_id, target_scheduled_at, idempotency_hash
  ) returning * into created_meeting;
  return jsonb_build_object('status', 'SCHEDULED', 'meeting_id', created_meeting.id);
end;
$$;

create or replace function app.auto_record_first_contact_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  enrollment_record public.campaign_enrollments%rowtype;
  earliest_message_id uuid;
  existing_event public.attribution_events%rowtype;
  created_event_id uuid;
  idempotency_hash text;
begin
  if new.direction <> 'OUTBOUND'
    or new.status not in ('SENT', 'DELIVERED')
    or new.sent_at is null
    or nullif(btrim(new.provider_message_id), '') is null
    or new.enrollment_id is null
    or new.contact_id is null
  then return new; end if;

  select * into enrollment_record
  from public.campaign_enrollments
  where organization_id = new.organization_id and id = new.enrollment_id;
  if not found or enrollment_record.contact_id <> new.contact_id then
    raise exception 'AUTO_ATTRIBUTION_ENROLLMENT_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    new.organization_id::text || ':attribution:' || enrollment_record.account_id::text, 0
  ));
  select m.id into earliest_message_id
  from public.messages m
  join public.campaign_enrollments ce
    on ce.organization_id = m.organization_id and ce.id = m.enrollment_id
  where m.organization_id = new.organization_id
    and ce.account_id = enrollment_record.account_id
    and m.direction = 'OUTBOUND'
    and m.status in ('SENT', 'DELIVERED')
    and m.sent_at is not null
    and nullif(btrim(m.provider_message_id), '') is not null
    and m.contact_id = ce.contact_id
  order by m.sent_at, m.created_at, m.id
  limit 1;
  if earliest_message_id is distinct from new.id then return new; end if;

  select * into existing_event
  from public.attribution_events
  where organization_id = new.organization_id
    and account_id = enrollment_record.account_id;
  if found then
    if existing_event.first_contact_message_id = new.id then return new; end if;
    raise exception 'AUTO_ATTRIBUTION_EARLIER_MESSAGE_CONFLICT';
  end if;

  idempotency_hash := encode(digest(
    'auto-attribution:' || new.organization_id::text || ':' || enrollment_record.account_id::text,
    'sha256'
  ), 'hex');
  insert into public.attribution_events (
    organization_id, account_id, contact_id, first_contact_message_id,
    first_contact_at, attribution_expires_at, idempotency_key
  ) values (
    new.organization_id, enrollment_record.account_id, new.contact_id, new.id,
    new.sent_at, new.sent_at + interval '12 months', idempotency_hash
  ) on conflict (organization_id, account_id) do nothing
  returning id into created_event_id;

  if created_event_id is not null then
    insert into public.event_outbox (
      organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
    ) values (
      new.organization_id, 'attribution', created_event_id, 'attribution.first_contact_recorded',
      'automatic-attribution:' || idempotency_hash,
      jsonb_build_object(
        'attribution_event_id', created_event_id,
        'account_id', enrollment_record.account_id,
        'source', 'AUTOMATIC_FIRST_REAL_OUTBOUND'
      )
    ) on conflict (organization_id, idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_automatic_first_attribution on public.messages;
create trigger messages_automatic_first_attribution
after insert or update of status, provider_message_id, sent_at on public.messages
for each row execute function app.auto_record_first_contact_attribution();

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
  opportunity_record public.opportunities%rowtype;
  attribution_record public.attribution_events%rowtype;
  created_commission_id uuid;
  follow_up_task_id uuid;
  idempotency_hash text := encode(digest(coalesce(target_idempotency_key, ''), 'sha256'), 'hex');
  commission_key text;
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
    and ((opportunity_id = target_opportunity_id and is_first_payment)
      or idempotency_key = idempotency_hash);
  if found then
    if existing_payment.opportunity_id = target_opportunity_id
      and existing_payment.amount_mxn = target_amount_mxn
      and existing_payment.paid_at = target_paid_at
      and existing_payment.evidence_record_id = target_evidence_record_id
      and existing_payment.idempotency_key = idempotency_hash
    then return jsonb_build_object(
      'status', 'DUPLICATE', 'payment_id', existing_payment.id,
      'commission_id', (
        select c.id from public.commissions c
        where c.organization_id = target_organization_id and c.payment_id = existing_payment.id
      )
    ); end if;
    raise exception 'FIRST_PAYMENT_IDEMPOTENCY_CONFLICT';
  end if;

  select * into opportunity_record from public.opportunities
  where organization_id = target_organization_id and id = target_opportunity_id
  for share;
  if not found then raise exception 'FIRST_PAYMENT_OPPORTUNITY_NOT_FOUND'; end if;

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

  select * into attribution_record from public.attribution_events
  where organization_id = target_organization_id
    and account_id = opportunity_record.account_id
    and created_payment.paid_at >= first_contact_at
    and created_payment.paid_at <= attribution_expires_at
  order by first_contact_at, id
  limit 1;

  if found then
    commission_key := encode(digest(
      'auto-commission:' || created_payment.id::text || ':' || attribution_record.id::text,
      'sha256'
    ), 'hex');
    insert into public.commissions (
      organization_id, opportunity_id, payment_id, attribution_event_id,
      commission_rate, commission_mxn, status, idempotency_key
    ) values (
      target_organization_id, target_opportunity_id, created_payment.id, attribution_record.id,
      0.02, round(created_payment.amount_mxn * 0.02, 2), 'EARNED', commission_key
    ) returning id into created_commission_id;

    insert into public.event_outbox (
      organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
    ) values (
      target_organization_id, 'commission', created_commission_id, 'commission.earned',
      'automatic-commission:' || commission_key,
      jsonb_build_object(
        'commission_id', created_commission_id,
        'payment_id', created_payment.id,
        'source', 'AUTOMATIC_FIRST_PAYMENT'
      )
    ) on conflict (organization_id, idempotency_key) do nothing;
  else
    insert into public.tasks (
      organization_id, account_id, task_type, normalized_objective, owner_user_id,
      due_at, status
    ) values (
      target_organization_id, opportunity_record.account_id,
      'ATTRIBUTION_REVIEW', 'FIRST_PAYMENT_WITHOUT_ACTIVE_ATTRIBUTION',
      auth.uid(), clock_timestamp() + interval '1 day', 'OPEN'
    ) on conflict do nothing returning id into follow_up_task_id;

    insert into public.event_outbox (
      organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
    ) values (
      target_organization_id, 'payment', created_payment.id,
      'payment.attribution_review_required',
      'payment-attribution-review:' || created_payment.id::text,
      jsonb_build_object(
        'payment_id', created_payment.id,
        'opportunity_id', target_opportunity_id,
        'task_id', follow_up_task_id,
        'reason_code', 'NO_ACTIVE_ATTRIBUTION'
      )
    ) on conflict (organization_id, idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'status', 'RECORDED', 'payment_id', created_payment.id,
    'commission_id', created_commission_id,
    'follow_up_task_id', follow_up_task_id
  );
end;
$$;

create or replace function app.record_first_payment_with_evidence(
  target_organization_id uuid,
  target_opportunity_id uuid,
  target_amount_mxn numeric,
  target_paid_at timestamptz,
  target_source_url text,
  target_source_name text,
  target_observed_at timestamptz,
  target_confidence public.source_confidence,
  target_checksum text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  evidence_record_id uuid;
begin
  if target_confidence not in ('HIGH', 'VERIFIED')
    or target_observed_at is null
    or target_observed_at < target_paid_at
    or target_observed_at > clock_timestamp() + interval '5 minutes'
  then raise exception 'FIRST_PAYMENT_EVIDENCE_INPUT_INVALID'; end if;

  evidence_record_id := app.record_source_evidence(
    target_organization_id, 'opportunity', target_opportunity_id,
    'first_payment_mxn', target_source_url, target_source_name,
    target_observed_at, target_confidence,
    jsonb_build_object('amount_mxn', target_amount_mxn, 'paid_at', target_paid_at),
    target_checksum
  );

  return app.record_first_payment(
    target_organization_id, target_opportunity_id, target_amount_mxn,
    target_paid_at, evidence_record_id, target_idempotency_key
  ) || jsonb_build_object('evidence_record_id', evidence_record_id);
end;
$$;

drop policy if exists opportunities_operator_write on public.opportunities;
drop policy if exists meetings_operator_write on public.meetings;
revoke insert, update, delete, truncate on public.opportunities from authenticated;
revoke insert, update, delete, truncate on public.meetings from authenticated;

revoke all on function app.create_opportunity_from_strict_lead(uuid, uuid, public.commercial_stage, text) from public;
revoke all on function app.transition_opportunity(uuid, uuid, public.commercial_stage, boolean, boolean, boolean, boolean, numeric, text, timestamptz) from public;
revoke all on function app.transition_opportunity(uuid, uuid, public.commercial_stage, numeric, text, timestamptz) from public;
revoke all on function app.schedule_meeting(uuid, uuid, timestamptz, text) from public;
revoke all on function app.auto_record_first_contact_attribution() from public;
revoke all on function app.record_first_contact_attribution(uuid, uuid, uuid, text) from public;
revoke all on function app.record_first_payment(uuid, uuid, numeric, timestamptz, uuid, text) from public;
revoke all on function app.record_first_payment_with_evidence(uuid, uuid, numeric, timestamptz, text, text, timestamptz, public.source_confidence, text, text) from public;
revoke all on function app.record_earned_commission(uuid, uuid, uuid, uuid, text) from public;

do $$
begin
  if exists (
    select 1
    from public.opportunities o
    join public.leads l
      on l.organization_id = o.organization_id and l.id = o.lead_id
    where o.lead_id is not null
      and (l.account_id is distinct from o.account_id
        or not l.contractual_qualified
        or not app.qualification_evidence_is_strict(l.organization_id, l.id))
  ) then raise exception 'M016_PREFLIGHT_NON_STRICT_OPPORTUNITY'; end if;

  if exists (
    select 1
    from public.attribution_events ae
    where not app.attribution_event_is_valid(
      ae.organization_id, ae.account_id, ae.contact_id,
      ae.first_contact_message_id, ae.first_contact_at, ae.attribution_expires_at
    )
  ) then raise exception 'M016_PREFLIGHT_STALE_ATTRIBUTION'; end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function app.create_opportunity_from_strict_lead(uuid, uuid, public.commercial_stage, text) to authenticated;
    grant execute on function app.transition_opportunity(uuid, uuid, public.commercial_stage, boolean, boolean, boolean, boolean, numeric, text, timestamptz) to authenticated;
    grant execute on function app.schedule_meeting(uuid, uuid, timestamptz, text) to authenticated;
    grant execute on function app.record_meeting_outcome(uuid, uuid, timestamptz, boolean, text) to authenticated;
    grant execute on function app.record_first_payment_with_evidence(uuid, uuid, numeric, timestamptz, text, text, timestamptz, public.source_confidence, text, text) to authenticated;

    revoke execute on function app.record_first_payment(uuid, uuid, numeric, timestamptz, uuid, text) from authenticated;
    revoke execute on function app.transition_opportunity(uuid, uuid, public.commercial_stage, numeric, text, timestamptz) from authenticated;
    revoke execute on function app.record_first_contact_attribution(uuid, uuid, uuid, text) from authenticated;
    revoke execute on function app.record_earned_commission(uuid, uuid, uuid, uuid, text) from authenticated;
  end if;
end;
$$;

commit;
