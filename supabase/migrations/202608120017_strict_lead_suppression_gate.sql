begin;

do $$
begin
  if to_regprocedure(
    'app.qualify_lead_strict_without_suppression(uuid,uuid,boolean,boolean,boolean,boolean,numeric,uuid[])'
  ) is null then
    alter function app.qualify_lead_strict(
      uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]
    ) rename to qualify_lead_strict_without_suppression;
  else
    drop function app.qualify_lead_strict(
      uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]
    );
  end if;
end;
$$;

create or replace function app.lock_suppression_subjects(
  target_organization_id uuid,
  target_account_id uuid,
  target_email text,
  target_domain text
)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  lock_key text;
  normalized_email text := lower(btrim(coalesce(target_email, '')));
  normalized_domain text := lower(btrim(coalesce(target_domain, '')));
  derived_domain text := lower(btrim(split_part(coalesce(target_email, ''), '@', 2)));
begin
  if target_organization_id is null then
    raise exception 'SUPPRESSION_LOCK_ORGANIZATION_REQUIRED';
  end if;
  for lock_key in
    select distinct candidate.key_value
    from unnest(array[
      case when target_account_id is null then null else
        target_organization_id::text || ':suppression:ACCOUNT:' || target_account_id::text end,
      case when normalized_email = '' then null else
        target_organization_id::text || ':suppression:EMAIL:' || normalized_email end,
      case when normalized_domain = '' then null else
        target_organization_id::text || ':suppression:DOMAIN:' || normalized_domain end,
      case when derived_domain = '' then null else
        target_organization_id::text || ':suppression:DOMAIN:' || derived_domain end
    ]) as candidate(key_value)
    where candidate.key_value is not null
    order by candidate.key_value
  loop
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  end loop;
end;
$$;

create or replace function app.lock_suppression_entry_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform app.lock_suppression_subjects(
      old.organization_id, old.account_id, old.normalized_email, old.normalized_domain
    );
    return old;
  end if;
  perform app.lock_suppression_subjects(
    new.organization_id, new.account_id, new.normalized_email, new.normalized_domain
  );
  return new;
end;
$$;

drop trigger if exists suppression_entries_a_qualification_mutex on public.suppression_entries;
create trigger suppression_entries_a_qualification_mutex
before insert or update or delete on public.suppression_entries
for each row execute function app.lock_suppression_entry_mutation();

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
  account_record public.accounts%rowtype;
  contact_record public.contacts%rowtype;
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'LEAD_QUALIFICATION_ROLE_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':lead:' || target_lead_id::text, 0
  ));
  select * into lead_record
  from public.leads
  where organization_id = target_organization_id and id = target_lead_id
  for update;
  if not found then raise exception 'LEAD_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  if lead_record.account_id is null or lead_record.contact_id is null then
    raise exception 'STRICT_LEAD_ACCOUNT_AND_CONTACT_REQUIRED';
  end if;

  select * into account_record
  from public.accounts
  where organization_id = target_organization_id
    and id = lead_record.account_id and not is_deleted
  for share;
  if not found then raise exception 'LEAD_ACCOUNT_NOT_FOUND_OR_TENANT_MISMATCH'; end if;

  select * into contact_record
  from public.contacts
  where organization_id = target_organization_id
    and id = lead_record.contact_id
    and account_id = account_record.id
    and not is_deleted
  for share;
  if not found then raise exception 'LEAD_CONTACT_NOT_FOUND_OR_TENANT_MISMATCH'; end if;

  perform app.lock_suppression_subjects(
    target_organization_id, account_record.id,
    contact_record.normalized_email, account_record.primary_domain
  );
  if app.is_suppressed(
    target_organization_id, account_record.id,
    contact_record.normalized_email, account_record.primary_domain
  ) then raise exception 'STRICT_LEAD_SUPPRESSED'; end if;

  return app.qualify_lead_strict_without_suppression(
    target_organization_id, target_lead_id,
    target_industrial_over_100_kwp, target_outside_annex_a,
    target_verified_target_role, target_explicit_interest,
    target_monthly_spend_mxn, target_evidence_record_ids
  );
end;
$$;

revoke all on function app.lock_suppression_subjects(uuid, uuid, text, text) from public;
revoke all on function app.lock_suppression_entry_mutation() from public;
revoke all on function app.qualify_lead_strict_without_suppression(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]) from public;
revoke all on function app.qualify_lead_strict(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function app.qualify_lead_strict_without_suppression(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]) from authenticated;
    grant execute on function app.qualify_lead_strict(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]) to authenticated;
  end if;
end;
$$;

commit;
