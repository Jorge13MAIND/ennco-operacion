begin;

-- Paco can be configured only after his actual Control Room identity is verified.
create function public.configure_email_sdr_backup(target_organization_id uuid,target_backup_user_id uuid,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare assignment public.operational_assignments%rowtype; replay jsonb; response jsonb;
begin
  perform app.operations_assert_operator(target_organization_id,true);
  replay:=app.operations_command_begin(target_organization_id,'configure_email_sdr_backup',target_idempotency_key,
    jsonb_build_object('backup_user_id',target_backup_user_id));
  if replay is not null then return replay; end if;
  select * into assignment from public.operational_assignments
    where organization_id=target_organization_id and status='ACTIVE' for update;
  if not found or assignment.primary_user_id is null then raise exception 'SDR_PRIMARY_OWNER_MISSING'; end if;
  if assignment.primary_user_id=target_backup_user_id or not exists(
    select 1 from public.organization_users ou where ou.organization_id=target_organization_id
      and ou.user_id=target_backup_user_id and ou.active
      and ou.role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator')) then
    raise exception 'SDR_BACKUP_IDENTITY_NOT_ACTIVE';
  end if;
  update public.operational_assignments set backup_user_id=target_backup_user_id,
    coverage_mode='PRIMARY_BACKUP',source_reference='email-sdr-backup-2026-09-23',
    configured_by=auth.uid(),configured_at=clock_timestamp(),updated_at=clock_timestamp()
    where organization_id=target_organization_id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,new_data)
    values(target_organization_id,auth.uid(),'EMAIL_SDR_BACKUP_CONFIGURED','operational_assignments',
      jsonb_build_object('primary_user_id',assignment.primary_user_id,'backup_user_id',target_backup_user_id));
  response:=jsonb_build_object('status','CONFIGURED','primary_user_id',assignment.primary_user_id,
    'backup_user_id',target_backup_user_id);
  return app.operations_command_finish(target_organization_id,'configure_email_sdr_backup',target_idempotency_key,response);
end $$;
revoke all on function public.configure_email_sdr_backup(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.configure_email_sdr_backup(uuid,uuid,text) to authenticated;

create or replace function public.ack_email_sdr_alert(target_organization_id uuid,target_case_id uuid)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare c public.email_sdr_cases%rowtype; actor uuid; delivered integer; owner_hash text;
begin
  actor:=app.direct_lane_assert_operator(target_organization_id);
  select * into c from public.email_sdr_cases where organization_id=target_organization_id and id=target_case_id;
  if c.id is null then return jsonb_build_object('status','NOT_FOUND'); end if;
  if actor is distinct from c.owner_user_id and not exists(
    select 1 from public.operational_assignments a
    join public.organization_users ou on ou.organization_id=a.organization_id and ou.user_id=a.backup_user_id and ou.active
    join public.notification_deliveries n on n.organization_id=a.organization_id
    join public.event_outbox o on o.organization_id=n.organization_id and o.id=n.outbox_event_id
    where a.organization_id=target_organization_id and a.status='ACTIVE' and a.coverage_mode='PRIMARY_BACKUP'
      and a.backup_user_id=actor and o.aggregate_id=c.provider_event_id
      and o.event_type in ('gmail.reply','gmail.auto_reply') and n.channel='CONTROL_ROOM'
      and n.status<>'DELIVERED' and n.created_at<=clock_timestamp()-interval '30 minutes') then
    return jsonb_build_object('status','NOT_OWNER_OR_BACKUP');
  end if;
  owner_hash:=encode(digest(c.owner_user_id::text,'sha256'),'hex');
  update public.notification_deliveries n set status='DELIVERED',delivered_at=clock_timestamp(),
    attempt_count=n.attempt_count+1,provider_id='control-room:'||actor::text||':'||c.id::text,last_error=null
    from public.event_outbox o where n.organization_id=target_organization_id and n.outbox_event_id=o.id
      and o.organization_id=n.organization_id and o.aggregate_id=c.provider_event_id and o.event_type in ('gmail.reply','gmail.auto_reply')
      and n.channel='CONTROL_ROOM' and n.destination_hash=owner_hash and n.status<>'DELIVERED';
  get diagnostics delivered=row_count;
  update public.event_outbox o set status='DELIVERED',delivered_at=clock_timestamp(),locked_at=null,last_error=null
    where o.organization_id=target_organization_id and o.aggregate_id=c.provider_event_id
      and o.event_type in ('gmail.reply','gmail.auto_reply') and o.status<>'DELIVERED'
      and exists(select 1 from public.notification_deliveries n where n.outbox_event_id=o.id
        and n.organization_id=o.organization_id and n.channel='CONTROL_ROOM' and n.status='DELIVERED');
  if delivered>0 then
    insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
      values(target_organization_id,actor,'EMAIL_SDR_ALERT_ACK','email_sdr_cases',c.id,
        jsonb_build_object('backup',actor is distinct from c.owner_user_id));
  end if;
  return jsonb_build_object('status','ACKNOWLEDGED','deliveries',delivered);
end $$;

create or replace function public.read_email_sdr_cases(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if not app.is_member(target_organization_id) then raise exception 'SDR_MEMBER_REQUIRED'; end if;
  return coalesce((select jsonb_agg(row_json) from (select jsonb_build_object(
    'id',c.id,'provider_event_id',c.provider_event_id,'owner_user_id',c.owner_user_id,'state',c.state,
    'reply_classification',e.reply_classification,
    'thread_hash',c.thread_hash,'next_action',c.next_action,'updated_at',c.updated_at,'decision',c.decision,
    'contact_email',m.normalized_from,'mailbox_email',mb.normalized_email,'subject',m.subject,
    'thread',ec.thread_json,'captured_at',ec.captured_at,
    'can_ack',exists(select 1 from public.notification_deliveries n
      join public.event_outbox o on o.organization_id=n.organization_id and o.id=n.outbox_event_id
      where n.organization_id=target_organization_id and o.aggregate_id=c.provider_event_id
        and o.event_type in ('gmail.reply','gmail.auto_reply') and n.channel='CONTROL_ROOM' and n.status<>'DELIVERED'
        and (c.owner_user_id=auth.uid() or (n.created_at<=clock_timestamp()-interval '30 minutes'
          and exists(select 1 from public.operational_assignments a where a.organization_id=target_organization_id
            and a.status='ACTIVE' and a.coverage_mode='PRIMARY_BACKUP' and a.backup_user_id=auth.uid()))))
    ) row_json
    from public.email_sdr_cases c join public.provider_events e on e.id=c.provider_event_id and e.organization_id=c.organization_id
    join public.messages m on m.id=e.message_id and m.organization_id=e.organization_id
    join public.mailboxes mb on mb.id=m.mailbox_id and mb.organization_id=m.organization_id
    left join public.email_conversations ec on ec.organization_id=m.organization_id and ec.mailbox_id=m.mailbox_id and ec.provider_thread_id=m.provider_thread_id
    where c.organization_id=target_organization_id order by c.updated_at desc limit 100) rows),'[]'::jsonb);
end $$;

commit;
