begin;

lock table public.provider_activation_gates in share row exclusive mode;

alter table public.provider_activation_gates
  drop constraint if exists provider_activation_gates_gate_code_check;

update public.provider_activation_gates
set gate_code='OPERATOR_COVERAGE'
where gate_code='OPERATOR_BACKUP';

alter table public.provider_activation_gates
  add constraint provider_activation_gates_gate_code_check check (gate_code in (
    'CONTRACT_ARCHIVED','PRIVACY_APPROVED','APOLLO_TERMS_ACCEPTED','APOLLO_OWNERSHIP_ENNCO',
    'MFA_RECOVERY','BUDGET_APPROVED','GOOGLE_CLOUD_READY','RESEND_READY','SENTRY_READY',
    'CHECKLY_READY','OPERATOR_PRIMARY','OPERATOR_COVERAGE','ANEXO_A_BOUND','COPY_APPROVED','PILOT_APPROVED'
  ));

create or replace function app.provider_control_requirements()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'CONTRACT_ARCHIVED','PRIVACY_APPROVED','APOLLO_TERMS_ACCEPTED','APOLLO_OWNERSHIP_ENNCO',
    'MFA_RECOVERY','BUDGET_APPROVED','GOOGLE_CLOUD_READY','RESEND_READY','SENTRY_READY',
    'CHECKLY_READY','OPERATOR_PRIMARY','OPERATOR_COVERAGE','ANEXO_A_BOUND','COPY_APPROVED','PILOT_APPROVED'
  ]::text[]
$$;

commit;
