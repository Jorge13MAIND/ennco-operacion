begin;
-- A subquery inside ANY was interpreted as a set of uuid arrays in production.
create or replace function app.email_sdr_alert_work(target_org uuid)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare row_value record; stage_value text; claimed integer; pending jsonb:='[]'::jsonb; oldest_seconds integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('email-sdr-alerts:'||target_org::text,0));
  select max(extract(epoch from clock_timestamp()-n.created_at))::integer into oldest_seconds
    from public.email_sdr_cases c join public.event_outbox o
      on o.organization_id=c.organization_id and o.aggregate_id=c.provider_event_id
      and o.event_type in ('gmail.reply','gmail.auto_reply')
    join public.notification_deliveries n on n.organization_id=o.organization_id and n.outbox_event_id=o.id
    where c.organization_id=target_org and n.channel='CONTROL_ROOM' and n.status<>'DELIVERED';
  if coalesce(oldest_seconds,0)>=7200 then
    update public.campaigns ca set new_contacts_paused=true,updated_at=clock_timestamp()
      where ca.organization_id=target_org and not ca.new_contacts_paused
      and exists(select 1 from app.email_sdr_settings settings where settings.organization_id=target_org and ca.id=any(settings.campaign_ids));
    get diagnostics claimed=row_count;
    if claimed>0 then
      insert into public.audit_log(organization_id,action,record_type,new_data)
        values(target_org,'EMAIL_SDR_UNACKNOWLEDGED_PAUSE','campaigns',
          jsonb_build_object('paused_campaigns',claimed,'oldest_pending_seconds',oldest_seconds));
    end if;
  end if;
  for row_value in
    select c.id,min(n.created_at) as pending_since,
      max(case when a.status='ACTIVE' and a.coverage_mode='PRIMARY_BACKUP' and ou.active
        then a.backup_user_id::text else null end) as backup_user_id
    from public.email_sdr_cases c join public.event_outbox o
      on o.organization_id=c.organization_id and o.aggregate_id=c.provider_event_id
      and o.event_type in ('gmail.reply','gmail.auto_reply')
    join public.notification_deliveries n on n.organization_id=o.organization_id and n.outbox_event_id=o.id
    left join public.operational_assignments a on a.organization_id=c.organization_id
    left join public.organization_users ou on ou.organization_id=a.organization_id and ou.user_id=a.backup_user_id
    where c.organization_id=target_org and n.channel='CONTROL_ROOM' and n.status<>'DELIVERED'
      and n.created_at<=clock_timestamp()-interval '15 minutes'
    group by c.id order by min(n.created_at) limit 10
  loop
    stage_value:=case
      when row_value.pending_since<=clock_timestamp()-interval '2 hours' then 'OVERDUE'
      when row_value.pending_since<=clock_timestamp()-interval '30 minutes' and row_value.backup_user_id is not null then 'BACKUP'
      when row_value.pending_since<=clock_timestamp()-interval '30 minutes' then 'NO_BACKUP'
      else 'PRIMARY' end;
    claimed:=null;
    insert into app.email_sdr_alert_dispatch(organization_id,case_id,stage,attempts,last_attempt_at)
      values(target_org,row_value.id,stage_value,1,clock_timestamp())
      on conflict(organization_id,case_id,stage) do update set
        attempts=app.email_sdr_alert_dispatch.attempts+1,last_attempt_at=clock_timestamp()
      where app.email_sdr_alert_dispatch.provider_accepted_at is null
        and app.email_sdr_alert_dispatch.attempts<100
        and app.email_sdr_alert_dispatch.last_attempt_at<clock_timestamp()-interval '5 minutes'
      returning attempts into claimed;
    if claimed is not null then
      pending:=pending||jsonb_build_array(jsonb_build_object('case_id',row_value.id,'stage',stage_value,
        'pending_minutes',floor(extract(epoch from clock_timestamp()-row_value.pending_since)/60)::integer,
        'backup_configured',row_value.backup_user_id is not null));
    end if;
    claimed:=null;
  end loop;
  return jsonb_build_object('status','ALERT_WORK','alerts',pending,
    'oldest_pending_minutes',coalesce(oldest_seconds/60,0));
end $$;
commit;
