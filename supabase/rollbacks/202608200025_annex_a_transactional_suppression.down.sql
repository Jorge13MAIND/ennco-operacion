begin;

drop trigger if exists campaign_enrollments_aaa_annex_a_suppression on public.campaign_enrollments;
drop trigger if exists messages_aaa_m025_annex_a_release on public.messages;
drop trigger if exists provider_activation_gates_annex_a_binding on public.provider_activation_gates;

drop function if exists public.apply_annex_a_suppression_snapshot(uuid,jsonb,text);
drop function if exists app.enforce_annex_a_provider_gate();
drop function if exists app.enforce_annex_a_message_release();
drop function if exists app.enforce_annex_a_enrollment_suppression();
drop function if exists app.is_annex_a_account_suppressed(uuid,uuid);
drop function if exists app.annex_a_manifest_is_ready(uuid);
drop function if exists app.annex_a_identity_hmac(uuid,text,text);
drop function if exists app.annex_a_normalize_domain(text);
drop function if exists app.annex_a_normalize_name(text);

create or replace function app.block_m025_rollback_outbound()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.direction='OUTBOUND' and new.status<>'DRY_RUN' then
    raise exception 'M025_ROLLBACK_OUTBOUND_BLOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_aaa_m025_rollback_fail_closed on public.messages;
create trigger messages_aaa_m025_rollback_fail_closed
before insert or update of direction,status on public.messages
for each row execute function app.block_m025_rollback_outbound();

revoke all on function app.block_m025_rollback_outbound() from public,anon,authenticated,service_role;

commit;
