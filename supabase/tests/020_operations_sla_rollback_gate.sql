\set ON_ERROR_STOP on

do $$ begin
  if to_regprocedure('public.request_operational_approval(uuid,text,uuid,text,text,text)') is not null then raise exception 'M020_PUBLIC_RPC_SURVIVED_ROLLBACK'; end if;
  if to_regprocedure('public.request_closed_won_approval(uuid,uuid,text,text)') is not null then raise exception 'M020_CLOSED_WON_APPROVAL_RPC_SURVIVED_ROLLBACK'; end if;
  if to_regclass('public.approval_requests') is not null then raise exception 'M020_TABLE_SURVIVED_ROLLBACK'; end if;
  begin insert into public.tasks(organization_id,task_type,normalized_objective,due_at) values('32000000-0000-4000-8000-000000000001','ROLLBACK','must fail',now());
    raise exception 'M020_ROLLBACK_TASK_BYPASS'; exception when others then if sqlerrm='M020_ROLLBACK_TASK_BYPASS' then raise; end if; end;
  begin update public.incidents set status='RESOLVED' where organization_id='32000000-0000-4000-8000-000000000001';
    raise exception 'M020_ROLLBACK_INCIDENT_BYPASS'; exception when others then if sqlerrm='M020_ROLLBACK_INCIDENT_BYPASS' then raise; end if; end;
  begin insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id)
    values('32000000-0000-4000-8000-000000000001','OUTBOUND','QUEUED','m020-rollback-send','32040000-0000-4000-8000-000000000012');
    raise exception 'M020_ROLLBACK_SEND_BYPASS'; exception when others then if sqlerrm='M020_ROLLBACK_SEND_BYPASS' then raise; end if; end;
end $$;
\echo 'OPERATIONS_SLA_ROLLBACK_GATE_PASS'
