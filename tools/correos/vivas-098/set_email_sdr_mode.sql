CREATE OR REPLACE FUNCTION public.set_email_sdr_mode(target_organization_id uuid, target_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare cfg app.email_sdr_settings%rowtype; reviewed integer;
begin
  if not app.has_role(target_organization_id,array['teckel_admin'::public.user_role]) then raise exception 'SDR_ADMIN_REQUIRED'; end if;
  if target_mode not in ('PAUSED','REVIEW','AUTO') then raise exception 'SDR_MODE_INVALID'; end if;
  select * into cfg from app.email_sdr_settings where organization_id=target_organization_id for update;
  if cfg.organization_id is null then raise exception 'SDR_NOT_CONFIGURED'; end if;
  if target_mode='AUTO' then
    select count(*) into reviewed from public.email_sdr_cases c join public.messages m on m.id=c.message_id and m.organization_id=c.organization_id
      join public.provider_events e on e.id=c.provider_event_id and e.organization_id=c.organization_id
      join public.messages inbound on inbound.id=e.message_id and inbound.organization_id=e.organization_id
      where c.organization_id=target_organization_id and c.approved and c.reviewed_by is not null and c.reviewed_policy_version=cfg.policy_version
        and c.decision->>'eligible'='true' and m.status in ('SENT','DELIVERED') and m.provider_message_id is not null and m.rfc_message_id is not null
        and m.provider_thread_id=inbound.provider_thread_id;
    if reviewed<2 or cfg.acceptance_evidence->>'tests_passed' is distinct from 'true' or cfg.acceptance_evidence->>'pause_resume_verified' is distinct from 'true'
      then raise exception 'SDR_REVIEWED_CANARIES_REQUIRED'; end if;
  end if;
  update app.email_sdr_settings set mode=target_mode,updated_at=clock_timestamp() where organization_id=target_organization_id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,new_data)
    values(target_organization_id,auth.uid(),'EMAIL_SDR_MODE','email_sdr_settings',jsonb_build_object('mode',target_mode,'previous_mode',cfg.mode));
  return jsonb_build_object('status','UPDATED','mode',target_mode);
end $function$
