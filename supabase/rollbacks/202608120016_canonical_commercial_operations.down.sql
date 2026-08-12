begin;

drop trigger if exists messages_automatic_first_attribution on public.messages;
drop function if exists app.auto_record_first_contact_attribution();

revoke execute on function app.create_opportunity_from_strict_lead(uuid, uuid, public.commercial_stage, text) from authenticated;
revoke execute on function app.transition_opportunity(uuid, uuid, public.commercial_stage, boolean, boolean, boolean, boolean, numeric, text, timestamptz) from authenticated;
revoke execute on function app.transition_opportunity(uuid, uuid, public.commercial_stage, numeric, text, timestamptz) from authenticated;
revoke execute on function app.schedule_meeting(uuid, uuid, timestamptz, text) from authenticated;
revoke execute on function app.record_first_payment(uuid, uuid, numeric, timestamptz, uuid, text) from authenticated;
revoke execute on function app.record_first_payment_with_evidence(uuid, uuid, numeric, timestamptz, text, text, timestamptz, public.source_confidence, text, text) from authenticated;
revoke execute on function app.record_first_contact_attribution(uuid, uuid, uuid, text) from authenticated;
revoke execute on function app.record_earned_commission(uuid, uuid, uuid, uuid, text) from authenticated;

drop function if exists app.create_opportunity_from_strict_lead(uuid, uuid, public.commercial_stage, text);
drop function if exists app.transition_opportunity(uuid, uuid, public.commercial_stage, boolean, boolean, boolean, boolean, numeric, text, timestamptz);
drop function if exists app.schedule_meeting(uuid, uuid, timestamptz, text);
drop function if exists app.record_first_payment_with_evidence(uuid, uuid, numeric, timestamptz, text, text, timestamptz, public.source_confidence, text, text);

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
begin
  raise exception 'M016_ROLLED_BACK_OPPORTUNITY_TRANSITION_DISABLED';
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
begin
  raise exception 'M016_ROLLED_BACK_FIRST_PAYMENT_DISABLED';
end;
$$;

create or replace function app.block_real_outbound_without_m016()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.direction = 'OUTBOUND'
    and new.status in ('SENT', 'DELIVERED')
    and new.sent_at is not null
    and nullif(btrim(new.provider_message_id), '') is not null
  then raise exception 'M016_ROLLED_BACK_REAL_OUTBOUND_DISABLED'; end if;
  return new;
end;
$$;

create trigger messages_m016_rollback_fail_closed
before insert or update of status, provider_message_id, sent_at on public.messages
for each row execute function app.block_real_outbound_without_m016();

revoke all on function app.transition_opportunity(uuid, uuid, public.commercial_stage, numeric, text, timestamptz) from public;
revoke all on function app.record_first_payment(uuid, uuid, numeric, timestamptz, uuid, text) from public;
revoke all on function app.block_real_outbound_without_m016() from public;

drop policy if exists opportunities_operator_write on public.opportunities;
drop policy if exists meetings_operator_write on public.meetings;
revoke insert, update, delete, truncate on public.opportunities from authenticated;
revoke insert, update, delete, truncate on public.meetings from authenticated;

commit;
