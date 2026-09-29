-- 095 · El panel de buzones solo muestra un error de envío si es posterior al último envío exitoso,
-- y se cierra la inscripción que quedó pausada por el fallo del 25-sep (29-sep-2026).
--
-- Caso: fcuellar@enncoenergia.com mostraba SEND_FAILED_DIRECT_LANE_SEND_UNKNOWN_ERROR desde el 25-sep.
-- El toque 4 a jluckie@gualaclosures.com falló 3 veces: la compuerta de autorización de Jorge
-- rechazó la ronda 2 que la rotación creaba dentro del settle, y eso tumbó el registro de un envío
-- que Gmail probablemente sí aceptó (corregido en la 094). La inscripción se cierra sin reintentar
-- ni rotar, para no mandarle el mismo correo otra vez.

begin;

set local app.operations_rpc_write = 'on';

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
      and t.mailbox_id=target_mailbox.id and t.tick_kind in ('SETTLE','SYNC') and t.outcome like '%FAIL%'
      -- Solo un fallo posterior al último envío exitoso: uno ya superado dejaba la etiqueta roja para siempre.
      and t.created_at > coalesce((select max(t2.created_at) from public.direct_lane_ticks t2 where t2.organization_id=target_mailbox.organization_id
        and t2.mailbox_id=target_mailbox.id and t2.tick_kind='SETTLE' and t2.outcome='SENT'), '-infinity'::timestamptz)
      order by t.created_at desc limit 1)
  )
$function$;

update public.campaign_enrollments set status='COMPLETED', stopped_reason='CLOSED_AFTER_AMBIGUOUS_T4', next_touch_at=null, updated_at=clock_timestamp()
where id='e1b48b4b-e685-46bf-8d89-30f722a01c53' and status='PAUSED';

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('e0000000-0000-4000-8000-000000000001', '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', 'DIRECT_LANE_ENROLLMENT_CLOSED', 'campaign_enrollments',
  'e1b48b4b-e685-46bf-8d89-30f722a01c53',
  jsonb_build_object('reason','Toque 4 del 25-sep con 3 intentos fallidos por la compuerta en la rotación; Gmail probablemente lo aceptó. Sin reintento ni ronda 2.'));

commit;
