begin;
create function public.read_email_recovery_overview(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if not app.is_member(target_organization_id) then raise exception 'SDR_MEMBER_REQUIRED'; end if;
  return jsonb_build_object(
    'commercial_event_ids',coalesce((select jsonb_agg(pe.id) from public.provider_events pe
      join public.messages m on m.id=pe.message_id and m.organization_id=pe.organization_id
      join public.campaign_enrollments ce on ce.id=m.enrollment_id and ce.organization_id=m.organization_id
      join public.campaigns ca on ca.id=ce.campaign_id and ca.organization_id=ce.organization_id
      where pe.organization_id=target_organization_id and pe.event_kind in ('REPLY','AUTO_REPLY') and ca.lane='DIRECT' and ca.name !~* '^PRUEBA'),'[]'::jsonb),
    'unmatched',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,normalized_from,subject,body_text,next_action from public.email_recovery_review
      where organization_id=target_organization_id order by created_at desc limit 100) r),'[]'::jsonb));
end $$;
revoke all on function public.read_email_recovery_overview(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_email_recovery_overview(uuid) to authenticated;
commit;
