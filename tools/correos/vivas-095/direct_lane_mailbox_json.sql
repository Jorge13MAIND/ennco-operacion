CREATE OR REPLACE FUNCTION app.direct_lane_mailbox_json(target_mailbox mailboxes)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'mailbox_id',target_mailbox.id,
    'normalized_email',target_mailbox.normalized_email,
    'domain',target_mailbox.domain,
    'sender_name',coalesce(target_mailbox.direct_lane_display_name,target_mailbox.sender_name),
    'status',target_mailbox.direct_lane_status,
    'credential_active',exists(select 1 from public.direct_lane_credentials c
      where c.organization_id=target_mailbox.organization_id and c.mailbox_id=target_mailbox.id and c.status='ACTIVE'),
    'credential_connected_at',(select max(c.created_at) from public.direct_lane_credentials c
      where c.organization_id=target_mailbox.organization_id and c.mailbox_id=target_mailbox.id and c.status='ACTIVE'),
    'ramp_mode',target_mailbox.direct_lane_ramp_mode,
    'fixed_cap',target_mailbox.direct_lane_fixed_cap,
    'cap_max',target_mailbox.direct_lane_cap_max,
    'effective_cap',app.direct_lane_effective_cap(target_mailbox),
    'ramp_schedule',to_jsonb(target_mailbox.direct_lane_ramp_schedule),
    'ramp_anchor_at',target_mailbox.direct_lane_ramp_anchor_at,
    'ramp_week',app.direct_lane_ramp_week(target_mailbox),
    'new_today',app.direct_lane_new_today(target_mailbox.organization_id,target_mailbox.id),
    'new_cap',app.direct_lane_effective_cap(target_mailbox),
    'ceiling',target_mailbox.direct_lane_cap_max,
    'sent_today',app.direct_lane_sent_today(target_mailbox.organization_id,target_mailbox.id),
    'queued',(select count(*) from public.messages m where m.organization_id=target_mailbox.organization_id
      and m.mailbox_id=target_mailbox.id and m.lane='DIRECT' and m.direction='OUTBOUND' and m.status in ('QUEUED','SENDING')),
    'sent_total',(select count(*) from public.messages m where m.organization_id=target_mailbox.organization_id
      and m.mailbox_id=target_mailbox.id and m.lane='DIRECT' and m.direction='OUTBOUND' and m.status in ('SENT','DELIVERED')),
    'first_send_at',target_mailbox.direct_lane_first_send_at,
    'is_client_primary',target_mailbox.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP',
    'sync',(select jsonb_build_object('status',s.status,'last_history_id',s.last_history_id,'last_synced_at',s.last_synced_at,'last_error_code',s.last_error_code)
      from public.mailbox_sync_cursors s where s.organization_id=target_mailbox.organization_id and s.mailbox_id=target_mailbox.id),
    'pending_invitation',(select jsonb_build_object('expires_at',a.expires_at,'status',a.status,'created_at',a.created_at)
      from public.direct_lane_authorizations a where a.organization_id=target_mailbox.organization_id and a.mailbox_id=target_mailbox.id
        and a.status in ('PENDING','ARMED') and a.expires_at>clock_timestamp() order by a.created_at desc limit 1),
    'last_error',(select t.outcome from public.direct_lane_ticks t where t.organization_id=target_mailbox.organization_id
      and t.mailbox_id=target_mailbox.id and t.tick_kind in ('SETTLE','SYNC') and t.outcome like '%FAIL%' order by t.created_at desc limit 1)
  )
$function$

