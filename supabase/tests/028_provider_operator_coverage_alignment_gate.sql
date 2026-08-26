\set ON_ERROR_STOP on

do $$
declare requirements text[]:=app.provider_control_requirements();
begin
  if cardinality(requirements)<>15
    or (select count(distinct code) from unnest(requirements) code)<>15
    or not ('OPERATOR_COVERAGE'=any(requirements))
    or 'OPERATOR_BACKUP'=any(requirements)
  then raise exception 'M028_PROVIDER_REQUIREMENTS_INVALID:%',requirements; end if;
end $$;

insert into public.organizations(id,slug,legal_name)
values ('28000000-0000-4000-8000-000000000001','m028-ennco','M028 Synthetic ENNCO');
insert into public.organization_users(organization_id,user_id,role,active)
values ('28000000-0000-4000-8000-000000000001','28100000-0000-4000-8000-000000000001','teckel_admin',true);
insert into public.provider_accounts(
  id,organization_id,provider_code,environment,ownership_status,terms_status,plan_name,
  legal_owner,seat_count,billing_frequency,mfa_status,recovery_status,monthly_budget_mxn,
  hard_cap_mxn,evidence_sha256,delivery_status,active
) values (
  '28200000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001',
  'APOLLO','PRODUCTION','ENNCO_OWNED','VERIFIED','Professional','ENNCO',1,'MONTHLY',
  'ENABLED','VERIFIED',1782,1782,repeat('a',64),'BLOCKED',false
);

insert into public.provider_activation_gates(
  organization_id,provider_account_id,gate_code,status,evidence_sha256,evidence_class,recorded_by,recorded_at
)
select '28000000-0000-4000-8000-000000000001','28200000-0000-4000-8000-000000000001',
  code,'PASS',encode(digest('m028:'||code,'sha256'),'hex'),'synthetic_demo',
  '28100000-0000-4000-8000-000000000001','2026-08-20T18:00:00Z'
from unnest(app.provider_control_requirements()) code;

do $$
declare result jsonb;
begin
  if (select count(*) from public.provider_activation_gates
      where organization_id='28000000-0000-4000-8000-000000000001')<>15
  then raise exception 'M028_GATE_CARDINALITY_INVALID'; end if;
  if not exists(
    select 1 from public.provider_activation_gates
    where organization_id='28000000-0000-4000-8000-000000000001'
      and gate_code='OPERATOR_COVERAGE'
  ) then raise exception 'M028_OPERATOR_COVERAGE_GATE_MISSING'; end if;
  begin
    insert into public.provider_activation_gates(
      organization_id,provider_account_id,gate_code,status,evidence_sha256,evidence_class,recorded_by
    ) values (
      '28000000-0000-4000-8000-000000000001','28200000-0000-4000-8000-000000000001',
      'OPERATOR_BACKUP','PASS',repeat('b',64),'synthetic_demo','28100000-0000-4000-8000-000000000001'
    );
    raise exception 'M028_LEGACY_BACKUP_GATE_ACCEPTED';
  exception when check_violation then null; end;
  result:=app.evaluate_outbound_provider_readiness_as_system(
    '28000000-0000-4000-8000-000000000001','2026-08-20T18:00:00Z'
  );
  if (result->>'activation_gates_passed')::integer<>15
    or (result->>'live_gates_passed')::integer<>0
    or result->>'release_state'<>'HOLD'
  then raise exception 'M028_READINESS_CARDINALITY_INVALID:%',result; end if;
end $$;

select 'PROVIDER_OPERATOR_COVERAGE_ALIGNMENT_FORWARD_PASS' as result;
