begin;

create or replace function app.provider_control_requirements()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'CONTRACT_ARCHIVED','PRIVACY_APPROVED','APOLLO_TERMS_ACCEPTED','APOLLO_OWNERSHIP_ENNCO',
    'MFA_RECOVERY','BUDGET_APPROVED','GOOGLE_CLOUD_READY','RESEND_READY','SENTRY_READY',
    'CHECKLY_READY','OPERATOR_PRIMARY','OPERATOR_COVERAGE','ANEXO_A_BOUND','COPY_APPROVED','PILOT_APPROVED',
    'M028_ROLLBACK_HOLD'
  ]::text[]
$$;

commit;
