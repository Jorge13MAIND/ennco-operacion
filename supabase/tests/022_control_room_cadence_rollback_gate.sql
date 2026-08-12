\set ON_ERROR_STOP on

do $$ begin
  if to_regprocedure('public.create_control_cadence_policy(uuid,integer,public.evidence_class,integer,jsonb,text)') is not null then raise exception 'M022_WRITE_RPC_SURVIVED_ROLLBACK'; end if;
  if to_regprocedure('public.evaluate_control_cadence_health(uuid,timestamptz)') is null then raise exception 'M022_ROLLBACK_READ_RPC_MISSING'; end if;
  if to_regprocedure('public.evaluate_operations_health(uuid,timestamptz)') is null then raise exception 'M022_ROLLBACK_DAMAGED_M020'; end if;
  if (select count(*) from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000001')<>5 then raise exception 'M022_ROLLBACK_LEDGER_NOT_PRESERVED'; end if;
end $$;

set request.jwt.claim.sub='22010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ begin
  if (public.evaluate_control_cadence_health('22000000-0000-4000-8000-000000000001',clock_timestamp())->>'state')<>'UNKNOWN' then raise exception 'M022_ROLLBACK_HEALTH_NOT_UNKNOWN'; end if;
  begin insert into public.control_cadence_evidence_items(organization_id,occurrence_id,window_key,evidence_type,completeness,evidence_class,evidence_sha256,recorded_by,idempotency_key)
    values('22000000-0000-4000-8000-000000000001',(select id from public.control_cadence_occurrences limit 1),'rollback','CHECKLIST','COMPLETE','live',repeat('1',64),'22010000-0000-4000-8000-000000000001',repeat('1',64));
    raise exception 'M022_ROLLBACK_DML_BYPASS'; exception when others then if sqlerrm='M022_ROLLBACK_DML_BYPASS' then raise; end if; end;
end $$;
reset role;

insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id)
values('22000000-0000-4000-8000-000000000001','OUTBOUND','DRY_RUN','m022-rollback-dry-run','22090000-0000-4000-8000-000000000003');
do $$ begin
  begin insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id)
    values('22000000-0000-4000-8000-000000000001','OUTBOUND','QUEUED','m022-rollback-real','22090000-0000-4000-8000-000000000004');
    raise exception 'M022_ROLLBACK_REAL_OUTBOUND_BYPASS'; exception when others then if sqlerrm='M022_ROLLBACK_REAL_OUTBOUND_BYPASS' then raise; end if; end;
end $$;

\echo 'CONTROL_CADENCE_ROLLBACK_GATE_PASS'
