\set ON_ERROR_STOP on

do $$ begin
  if to_regprocedure('public.apply_apollo_dedicated_provider_snapshot(uuid,jsonb,text)') is not null
  then raise exception 'M031_ROLLBACK_MUTATION_RPC_SURVIVED'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass
    and tgname='messages_aaa_m031_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M031_ROLLBACK_FAIL_CLOSED_TRIGGER_MISSING'; end if;
  if exists(select 1 from public.provider_accounts where organization_id='31000000-0000-4000-8000-000000000001'
    and provider_code='APOLLO' and environment='PRODUCTION' and (active or delivery_status<>'BLOCKED'))
  then raise exception 'M031_ROLLBACK_PROVIDER_NOT_BLOCKED'; end if;
  if (select count(*) from public.provider_accounts where organization_id='31000000-0000-4000-8000-000000000001'
      and custody_model='TECKEL_MANAGED_FOR_ENNCO' and workspace_mode='ENNCO_DEDICATED')<>1
  then raise exception 'M031_ROLLBACK_EVIDENCE_NOT_PRESERVED'; end if;
  if (select count(*) from public.mailboxes where organization_id='31000000-0000-4000-8000-000000000001')<>3
  then raise exception 'M031_ROLLBACK_MAILBOX_EVIDENCE_NOT_PRESERVED'; end if;
end $$;

select 'APOLLO_TECKEL_DEDICATED_ROLLBACK_GATE_PASS' as result;
