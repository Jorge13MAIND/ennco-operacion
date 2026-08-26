begin;

create or replace function app.hmac(
  target_data bytea,
  target_key bytea,
  target_algorithm text
)
returns bytea
language sql
immutable
set search_path = extensions, public, pg_catalog
as $$
  select hmac(target_data, target_key, target_algorithm)
$$;

revoke all on function app.hmac(bytea, bytea, text) from public;

commit;
