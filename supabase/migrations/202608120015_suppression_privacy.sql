begin;

alter table app.private_runtime_config
  add column if not exists suppression_hmac_secret text;

update app.private_runtime_config
set suppression_hmac_secret = encode(
  hmac(
    convert_to('ENNCO:SUPPRESSION:HMAC:V1:' || organization_id::text, 'UTF8'),
    convert_to(prequote_ingest_secret, 'UTF8'),
    'sha256'
  ),
  'hex'
)
where suppression_hmac_secret is null;

alter table app.private_runtime_config
  drop constraint if exists private_runtime_config_suppression_hmac_secret_check;
alter table app.private_runtime_config
  add constraint private_runtime_config_suppression_hmac_secret_check
  check (suppression_hmac_secret is null or suppression_hmac_secret ~ '^[a-f0-9]{64}$');

alter table public.suppression_entries
  add column if not exists account_hmac text,
  add column if not exists email_hmac text,
  add column if not exists domain_hmac text;

create or replace function app.compute_suppression_hmac(
  target_organization_id uuid,
  target_identity_type text,
  target_identity_value text
)
returns text
language plpgsql
stable
security definer
set search_path = app, public, pg_temp
as $$
declare
  runtime_secret text;
  normalized_identity_type text := upper(btrim(target_identity_type));
  normalized_identity_value text := lower(btrim(target_identity_value));
begin
  if target_organization_id is null
    or normalized_identity_type not in ('ACCOUNT', 'EMAIL', 'DOMAIN')
    or nullif(normalized_identity_value, '') is null
  then raise exception 'SUPPRESSION_HMAC_INPUT_INVALID'; end if;

  select suppression_hmac_secret into runtime_secret
  from app.private_runtime_config
  where organization_id = target_organization_id;
  if not found or runtime_secret is null then
    raise exception 'SUPPRESSION_HMAC_SECRET_MISSING';
  end if;

  return encode(
    hmac(
      convert_to(
        target_organization_id::text || ':' || normalized_identity_type || ':' || normalized_identity_value,
        'UTF8'
      ),
      convert_to(runtime_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.suppression_entries se
    left join app.private_runtime_config rc on rc.organization_id = se.organization_id
    where rc.suppression_hmac_secret is null
  ) then raise exception 'M015_BACKFILL_SUPPRESSION_SECRET_MISSING'; end if;
end;
$$;

drop index if exists public.suppression_account_unique;
drop index if exists public.suppression_email_unique;
drop index if exists public.suppression_domain_unique;

alter table public.suppression_entries
  drop constraint if exists suppression_entries_check,
  drop constraint if exists suppression_entries_normalized_email_check,
  drop constraint if exists suppression_entries_normalized_domain_check;

update public.suppression_entries
set account_hmac = case when account_id is null then null else
      app.compute_suppression_hmac(organization_id, 'ACCOUNT', account_id::text) end,
    email_hmac = case when normalized_email is null then null else
      app.compute_suppression_hmac(organization_id, 'EMAIL', normalized_email) end,
    domain_hmac = case when normalized_domain is null then null else
      app.compute_suppression_hmac(organization_id, 'DOMAIN', normalized_domain) end
where account_hmac is null and email_hmac is null and domain_hmac is null
  and (account_id is not null or normalized_email is not null or normalized_domain is not null);

update public.suppression_entries
set account_id = null, normalized_email = null, normalized_domain = null
where account_id is not null or normalized_email is not null or normalized_domain is not null;

alter table public.suppression_entries
  drop constraint if exists suppression_entries_private_identity_check,
  drop constraint if exists suppression_entries_hmac_shape_check,
  drop constraint if exists suppression_entries_permanent_dnc_check;
alter table public.suppression_entries
  add constraint suppression_entries_private_identity_check check (
    account_id is null and normalized_email is null and normalized_domain is null
    and num_nonnulls(account_hmac, email_hmac, domain_hmac) >= 1
  ),
  add constraint suppression_entries_hmac_shape_check check (
    (account_hmac is null or account_hmac ~ '^[a-f0-9]{64}$')
    and (email_hmac is null or email_hmac ~ '^[a-f0-9]{64}$')
    and (domain_hmac is null or domain_hmac ~ '^[a-f0-9]{64}$')
  ),
  add constraint suppression_entries_permanent_dnc_check check (
    kind not in ('UNSUBSCRIBE', 'HARD_BOUNCE', 'DNC') or expires_at is null
  );

create unique index if not exists suppression_account_hmac_unique
on public.suppression_entries (organization_id, kind, account_hmac)
where account_hmac is not null and expires_at is null;
create unique index if not exists suppression_email_hmac_unique
on public.suppression_entries (organization_id, kind, email_hmac)
where email_hmac is not null and expires_at is null;
create unique index if not exists suppression_domain_hmac_unique
on public.suppression_entries (organization_id, kind, domain_hmac)
where domain_hmac is not null and expires_at is null;

create or replace function app.protect_suppression_identity()
returns trigger
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
declare
  computed_account_hmac text;
  computed_email_hmac text;
  computed_domain_hmac text;
begin
  if tg_op = 'DELETE' then raise exception 'SUPPRESSION_DNC_APPEND_ONLY'; end if;

  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
      or new.kind is distinct from old.kind
      or new.account_hmac is distinct from old.account_hmac
      or new.email_hmac is distinct from old.email_hmac
      or new.domain_hmac is distinct from old.domain_hmac
      or new.account_id is not null
      or new.normalized_email is not null
      or new.normalized_domain is not null
    then raise exception 'SUPPRESSION_IDENTITY_IMMUTABLE'; end if;
    if old.kind in ('UNSUBSCRIBE', 'HARD_BOUNCE', 'DNC') and new.expires_at is not null then
      raise exception 'SUPPRESSION_PERMANENT_DNC_REQUIRED';
    end if;
    return new;
  end if;

  if new.account_hmac is not null or new.email_hmac is not null or new.domain_hmac is not null then
    raise exception 'SUPPRESSION_DIRECT_HMAC_FORBIDDEN';
  end if;
  if num_nonnulls(new.account_id, new.normalized_email, new.normalized_domain) < 1 then
    raise exception 'SUPPRESSION_IDENTITY_REQUIRED';
  end if;

  computed_account_hmac := case when new.account_id is null then null else
    app.compute_suppression_hmac(new.organization_id, 'ACCOUNT', new.account_id::text) end;
  computed_email_hmac := case when new.normalized_email is null then null else
    app.compute_suppression_hmac(new.organization_id, 'EMAIL', new.normalized_email) end;
  computed_domain_hmac := case when new.normalized_domain is null then null else
    app.compute_suppression_hmac(new.organization_id, 'DOMAIN', new.normalized_domain) end;

  new.account_hmac := computed_account_hmac;
  new.email_hmac := computed_email_hmac;
  new.domain_hmac := computed_domain_hmac;
  new.account_id := null;
  new.normalized_email := null;
  new.normalized_domain := null;
  if new.kind in ('UNSUBSCRIBE', 'HARD_BOUNCE', 'DNC') then new.expires_at := null; end if;
  return new;
end;
$$;

drop trigger if exists suppression_entries_private_identity on public.suppression_entries;
create trigger suppression_entries_private_identity
before insert or update or delete on public.suppression_entries
for each row execute function app.protect_suppression_identity();

create or replace function app.prevent_suppression_secret_rotation()
returns trigger
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and exists (
    select 1 from public.suppression_entries se where se.organization_id = old.organization_id
  ) then raise exception 'SUPPRESSION_SECRET_REQUIRED_FOR_EXISTING_DNC'; end if;
  if tg_op = 'UPDATE'
    and new.suppression_hmac_secret is distinct from old.suppression_hmac_secret
    and exists (
      select 1 from public.suppression_entries se where se.organization_id = old.organization_id
    )
  then raise exception 'SUPPRESSION_SECRET_ROTATION_REQUIRES_CONTROLLED_REHASH'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists private_runtime_config_suppression_secret_guard on app.private_runtime_config;
create trigger private_runtime_config_suppression_secret_guard
before update of suppression_hmac_secret or delete on app.private_runtime_config
for each row execute function app.prevent_suppression_secret_rotation();

create or replace function app.is_suppressed(
  target_organization_id uuid,
  target_account_id uuid,
  target_email text,
  target_domain text
)
returns boolean
language plpgsql
stable
security definer
set search_path = app, public, pg_temp
as $$
declare
  runtime_secret text;
  target_account_hmac text;
  target_email_hmac text;
  target_domain_hmac text;
  derived_domain_hmac text;
  normalized_derived_domain text := lower(btrim(split_part(coalesce(target_email, ''), '@', 2)));
begin
  if target_organization_id is null then return true; end if;
  select suppression_hmac_secret into runtime_secret
  from app.private_runtime_config
  where organization_id = target_organization_id;
  if not found or runtime_secret is null then return true; end if;

  target_account_hmac := case when target_account_id is null then null else
    app.compute_suppression_hmac(target_organization_id, 'ACCOUNT', target_account_id::text) end;
  target_email_hmac := case when nullif(btrim(target_email), '') is null then null else
    app.compute_suppression_hmac(target_organization_id, 'EMAIL', target_email) end;
  target_domain_hmac := case when nullif(btrim(target_domain), '') is null then null else
    app.compute_suppression_hmac(target_organization_id, 'DOMAIN', target_domain) end;
  derived_domain_hmac := case when nullif(normalized_derived_domain, '') is null then null else
    app.compute_suppression_hmac(target_organization_id, 'DOMAIN', normalized_derived_domain) end;

  return exists (
    select 1
    from public.suppression_entries se
    where se.organization_id = target_organization_id
      and (se.expires_at is null or se.expires_at > now())
      and (
        se.account_hmac = target_account_hmac
        or se.email_hmac = target_email_hmac
        or se.domain_hmac = target_domain_hmac
        or se.domain_hmac = derived_domain_hmac
      )
  );
end;
$$;

create or replace function app.ensure_deletion_dnc_suppression()
returns trigger
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
declare
  account_domain text;
begin
  if new.is_deleted and not old.is_deleted then
    select primary_domain into account_domain
    from public.accounts
    where organization_id = old.organization_id and id = old.account_id;

    insert into public.suppression_entries (
      organization_id, kind, account_id, normalized_email, normalized_domain,
      reason, effective_at, expires_at
    ) values (
      old.organization_id, 'DNC', old.account_id, old.normalized_email,
      coalesce(nullif(lower(btrim(account_domain)), ''), nullif(lower(split_part(old.normalized_email, '@', 2)), '')),
      'RETENTION_CONTACT_DELETION', clock_timestamp(), null
    ) on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_deletion_dnc_suppression on public.contacts;
create trigger contacts_deletion_dnc_suppression
before update of is_deleted on public.contacts
for each row execute function app.ensure_deletion_dnc_suppression();

revoke all on function app.compute_suppression_hmac(uuid, text, text) from public;
revoke all on function app.protect_suppression_identity() from public;
revoke all on function app.prevent_suppression_secret_rotation() from public;
revoke all on function app.ensure_deletion_dnc_suppression() from public;
revoke all on function app.is_suppressed(uuid, uuid, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function app.compute_suppression_hmac(uuid, text, text) from authenticated;
    revoke select on public.suppression_entries from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function app.compute_suppression_hmac(uuid, text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke execute on function app.compute_suppression_hmac(uuid, text, text) from service_role;
  end if;
end;
$$;

commit;
