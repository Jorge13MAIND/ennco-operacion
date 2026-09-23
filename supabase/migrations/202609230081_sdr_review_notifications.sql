begin;
create function app.email_sdr_notification() returns trigger language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
begin
  if new.owner_user_id is not null then
    insert into public.notification_deliveries(organization_id,outbox_event_id,channel,destination_hash)
      select new.organization_id,o.id,'CONTROL_ROOM',encode(digest(new.owner_user_id::text,'sha256'),'hex')
      from public.event_outbox o where o.organization_id=new.organization_id and o.aggregate_id=new.provider_event_id and o.event_type in ('gmail.reply','gmail.auto_reply')
      on conflict(outbox_event_id,channel,destination_hash) do nothing;
  end if;
  return new;
end $$;
revoke all on function app.email_sdr_notification() from public,anon,authenticated,service_role;
create trigger email_sdr_notification after insert on public.email_sdr_cases for each row execute function app.email_sdr_notification();
create function public.ack_email_sdr_alert(target_organization_id uuid,target_case_id uuid)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare c public.email_sdr_cases%rowtype; actor uuid; delivered integer;
begin
  actor:=app.direct_lane_assert_operator(target_organization_id);
  select * into c from public.email_sdr_cases where organization_id=target_organization_id and id=target_case_id and owner_user_id=actor;
  if c.id is null then return jsonb_build_object('status','NOT_OWNER'); end if;
  update public.notification_deliveries n set status='DELIVERED',delivered_at=clock_timestamp(),attempt_count=n.attempt_count+1,
    provider_id='control-room:'||actor::text||':'||c.id::text,last_error=null
    from public.event_outbox o where n.organization_id=target_organization_id and n.outbox_event_id=o.id
      and o.organization_id=n.organization_id and o.aggregate_id=c.provider_event_id and o.event_type in ('gmail.reply','gmail.auto_reply')
      and n.channel='CONTROL_ROOM' and n.destination_hash=encode(digest(actor::text,'sha256'),'hex') and n.status<>'DELIVERED';
  get diagnostics delivered=row_count;
  update public.event_outbox o set status='DELIVERED',delivered_at=clock_timestamp(),locked_at=null,last_error=null
    where o.organization_id=target_organization_id and o.aggregate_id=c.provider_event_id and o.event_type in ('gmail.reply','gmail.auto_reply') and o.status<>'DELIVERED'
      and exists(select 1 from public.notification_deliveries n where n.outbox_event_id=o.id and n.organization_id=o.organization_id and n.channel='CONTROL_ROOM' and n.status='DELIVERED');
  return jsonb_build_object('status','ACKNOWLEDGED','deliveries',delivered);
end $$;
revoke all on function public.ack_email_sdr_alert(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ack_email_sdr_alert(uuid,uuid) to authenticated;
create function public.set_email_sdr_mode(target_organization_id uuid,target_mode text)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
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
    if reviewed<5 or cfg.acceptance_evidence->>'tests_passed' is distinct from 'true' or cfg.acceptance_evidence->>'pause_resume_verified' is distinct from 'true'
      then raise exception 'SDR_FIVE_REVIEWED_CANARIES_REQUIRED'; end if;
  end if;
  update app.email_sdr_settings set mode=target_mode,updated_at=clock_timestamp() where organization_id=target_organization_id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,new_data)
    values(target_organization_id,auth.uid(),'EMAIL_SDR_MODE','email_sdr_settings',jsonb_build_object('mode',target_mode,'previous_mode',cfg.mode));
  return jsonb_build_object('status','UPDATED','mode',target_mode);
end $$;
revoke all on function public.set_email_sdr_mode(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_email_sdr_mode(uuid,text) to authenticated;
create function public.read_email_sdr_status(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if not app.is_member(target_organization_id) then raise exception 'SDR_MEMBER_REQUIRED'; end if;
  return coalesce((select jsonb_build_object('mode',s.mode,'policy_version',s.policy_version,'model_calls_enabled',s.max_model_calls_daily>0,
    'reviewed_canaries',(select count(*) from public.email_sdr_cases c join public.messages m on m.id=c.message_id and m.organization_id=c.organization_id
      where c.organization_id=s.organization_id and c.approved and c.reviewed_by is not null and c.reviewed_policy_version=s.policy_version and c.decision->>'eligible'='true'
        and m.status in ('SENT','DELIVERED') and m.provider_message_id is not null and m.rfc_message_id is not null
        and m.provider_thread_id=(select im.provider_thread_id from public.provider_events pe join public.messages im on im.id=pe.message_id and im.organization_id=pe.organization_id where pe.id=c.provider_event_id and pe.organization_id=c.organization_id)),
    'pending_alerts',(select count(*) from public.notification_deliveries n where n.organization_id=s.organization_id and n.channel='CONTROL_ROOM' and n.status<>'DELIVERED'),
    'legacy_open_incidents',(select count(*) from public.incidents i where i.organization_id=s.organization_id and i.opened_at<'2026-09-23T00:00:00-06:00' and i.status in ('OPEN','ACKNOWLEDGED','CONTAINED')))
    from app.email_sdr_settings s where organization_id=target_organization_id),'{}'::jsonb);
end $$;
revoke all on function public.read_email_sdr_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_email_sdr_status(uuid) to authenticated;
create function public.read_email_sdr_cases(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if not app.is_member(target_organization_id) then raise exception 'SDR_MEMBER_REQUIRED'; end if;
  return coalesce((select jsonb_agg(row_json) from (select jsonb_build_object(
    'id',c.id,'provider_event_id',c.provider_event_id,'owner_user_id',c.owner_user_id,'state',c.state,
    'thread_hash',c.thread_hash,'next_action',c.next_action,'updated_at',c.updated_at,'decision',c.decision,
    'contact_email',m.normalized_from,'mailbox_email',mb.normalized_email,'subject',m.subject,
    'thread',ec.thread_json,'captured_at',ec.captured_at) row_json
    from public.email_sdr_cases c join public.provider_events e on e.id=c.provider_event_id and e.organization_id=c.organization_id
    join public.messages m on m.id=e.message_id and m.organization_id=e.organization_id
    join public.mailboxes mb on mb.id=m.mailbox_id and mb.organization_id=m.organization_id
    left join public.email_conversations ec on ec.organization_id=m.organization_id and ec.mailbox_id=m.mailbox_id and ec.provider_thread_id=m.provider_thread_id
    where c.organization_id=target_organization_id order by c.updated_at desc limit 100) rows),'[]'::jsonb);
end $$;
revoke all on function public.read_email_sdr_cases(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_email_sdr_cases(uuid) to authenticated;
commit;
