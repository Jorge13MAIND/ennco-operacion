begin;

-- P0 commercial-integrity controls intentionally remain fail closed during rollback.
drop policy if exists source_evidence_operator_write on public.source_evidence;
drop policy if exists leads_operator_write on public.leads;
drop policy if exists qualification_checks_operator_write on public.qualification_checks;
drop policy if exists payments_operator_write on public.payments;
drop policy if exists attribution_events_operator_write on public.attribution_events;
drop policy if exists commissions_operator_write on public.commissions;

revoke insert, update, delete, truncate on public.source_evidence from authenticated;
revoke insert, update, delete, truncate on public.leads from authenticated;
revoke insert, update, delete, truncate on public.qualification_checks from authenticated;
revoke insert, update, delete, truncate on public.qualification_evidence_links from authenticated;
revoke insert, update, delete, truncate on public.payments from authenticated;
revoke insert, update, delete, truncate on public.attribution_events from authenticated;
revoke insert, update, delete, truncate on public.commissions from authenticated;

do $$
begin
  if (
    select count(*) from pg_constraint
    where conname in (
      'qualification_checks_lead_tenant_fkey',
      'opportunities_account_tenant_fkey', 'opportunities_lead_tenant_fkey',
      'payments_opportunity_tenant_fkey', 'payments_evidence_tenant_fkey',
      'attribution_events_account_tenant_fkey', 'attribution_events_contact_tenant_fkey',
      'attribution_events_message_tenant_fkey',
      'commissions_opportunity_tenant_fkey', 'commissions_payment_tenant_fkey',
      'commissions_attribution_tenant_fkey'
    )
  ) <> 11 then raise exception 'M014_ROLLBACK_TENANT_CONSTRAINTS_MISSING'; end if;

  if (
    select count(*) from pg_trigger
    where not tgisinternal and tgname in (
      'source_evidence_append_only', 'qualification_checks_append_only',
      'qualification_evidence_links_append_only', 'attribution_events_append_only',
      'payments_append_only', 'commissions_append_only',
      'attribution_events_insert_gate', 'payments_insert_gate', 'commissions_insert_gate',
      'opportunities_strict_stage_transition'
    )
  ) <> 10 then raise exception 'M014_ROLLBACK_GATES_MISSING'; end if;

  if to_regclass('public.qualification_evidence_links') is null then
    raise exception 'M014_ROLLBACK_RELATIONAL_EVIDENCE_MISSING';
  end if;
end;
$$;

commit;
