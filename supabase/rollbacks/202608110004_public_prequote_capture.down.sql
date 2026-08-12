begin;

revoke all on function public.create_public_prequote(uuid, text, uuid, bigint, text, text, text, text) from public;
drop function if exists public.create_public_prequote(uuid, text, uuid, bigint, text, text, text, text);

drop table if exists public.public_prequote_rate_windows;
drop table if exists public.public_prequote_nonces;
drop table if exists app.private_runtime_config;

alter table public.prequotes
  drop constraint if exists prequotes_organization_idempotency_unique,
  drop constraint if exists prequotes_idempotency_key_format,
  drop constraint if exists prequotes_privacy_notice_version_format,
  drop constraint if exists prequotes_model_tenant_fkey;

alter table public.prequotes
  add constraint prequotes_model_id_fkey
  foreign key (model_id) references public.prequote_models(id);

alter table public.prequotes
  drop column if exists idempotency_key,
  drop column if exists privacy_notice_version;

alter table public.prequote_models
  drop constraint if exists prequote_models_organization_id_id_unique;

commit;
