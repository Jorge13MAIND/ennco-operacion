\set ON_ERROR_STOP on

do $$
begin
  if has_table_privilege('authenticated', 'public.event_outbox', 'INSERT')
    or has_table_privilege('authenticated', 'public.event_outbox', 'UPDATE')
    or has_table_privilege('authenticated', 'public.event_outbox', 'DELETE')
  then raise exception 'ROLLBACK_RESTORED_OUTBOX_DML'; end if;

  if (
    select count(*) from pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname in ('leads_account_tenant_fkey', 'leads_contact_tenant_fkey', 'leads_prequote_tenant_fkey')
  ) <> 3 then raise exception 'ROLLBACK_REMOVED_TENANT_FKS'; end if;

  if position(
    'batch_record.status <> ''DRAFT'''
    in pg_get_functiondef('app.create_contact_deletion_item(uuid,uuid,timestamptz)'::regprocedure)
  ) = 0 then raise exception 'ROLLBACK_RESTORED_POST_APPROVAL_ITEM_BYPASS'; end if;
end;
$$;

do $$
begin
  begin
    insert into public.deletion_items (
      organization_id, batch_id, subject_id, subject_hash, retention_due_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '61111111-1111-4111-8111-111111111111',
      '32111111-1111-4111-8111-111111111111',
      repeat('b', 64),
      now() - interval '1 day'
    );
    raise exception 'ROLLBACK_RESTORED_DIRECT_POST_APPROVAL_ITEM_BYPASS';
  exception
    when others then
      if sqlerrm <> 'DELETION_BATCH_ITEMS_FROZEN' then raise; end if;
  end;
end;
$$;

set request.jwt.claim.sub = '83111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal1';
set role authenticated;

do $$
begin
  if app.is_member('11111111-1111-4111-8111-111111111111') then
    raise exception 'ROLLBACK_RESTORED_AAL1_BYPASS';
  end if;
  if exists (select 1 from public.contacts) then
    raise exception 'ROLLBACK_RESTORED_AAL1_RLS_READ';
  end if;
end;
$$;

reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

\echo 'SECURITY_CONSISTENCY_ROLLBACK_GATE_PASS'
