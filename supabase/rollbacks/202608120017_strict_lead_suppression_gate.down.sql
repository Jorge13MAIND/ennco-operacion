begin;

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
begin
  raise exception 'M017_ROLLED_BACK_STRICT_QUALIFICATION_DISABLED';
end;
$$;

revoke all on function app.qualify_lead_strict(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]) from public;
revoke all on function app.qualify_lead_strict_without_suppression(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]) from public;
revoke all on function app.lock_suppression_subjects(uuid, uuid, text, text) from public;
revoke all on function app.lock_suppression_entry_mutation() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function app.qualify_lead_strict_without_suppression(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]) from authenticated;
    grant execute on function app.qualify_lead_strict(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]) to authenticated;
  end if;
end;
$$;

commit;
