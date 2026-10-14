CREATE OR REPLACE FUNCTION app.crm_reminders_work(target_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare items jsonb := '[]'::jsonb; local_now timestamp := clock_timestamp() at time zone 'America/Mexico_City'; row_value record;
begin
  perform pg_advisory_xact_lock(hashtextextended('crm-reminders:' || target_org::text, 0));
  if not coalesce((select reminders_enabled from app.crm_settings where organization_id = target_org), false)
    or extract(isodow from local_now) > 5 or local_now::time < time '08:00' or local_now::time >= time '19:00' then
    return jsonb_build_object('status', 'CRM_REMINDERS', 'items', items, 'chat_ids', '[]'::jsonb);
  end if;
  for row_value in
    select 'TAREA' kind, t.id, t.title what, t.due_at due, r.id record_id from public.crm_tasks t
      join public.crm_records r on r.id = t.record_id
      where t.organization_id = target_org and t.status = 'PENDIENTE' and t.due_at <= clock_timestamp() and t.reminded_at is null
    union all
    select 'SIGUIENTE', r.id, r.next_action, r.next_action_at, r.id from public.crm_records r
      where r.organization_id = target_org and r.stage not in ('GANADO', 'PERDIDO', 'DESCARTADO')
        and r.next_action_at <= clock_timestamp() and r.reminded_at is null and nullif(btrim(r.next_action), '') is not null
    order by 4 limit 20
  loop
    if row_value.kind = 'TAREA' then update public.crm_tasks set reminded_at = clock_timestamp() where id = row_value.id;
    else update public.crm_records set reminded_at = clock_timestamp() where id = row_value.id; end if;
    items := items || jsonb_build_array(jsonb_build_object('kind', row_value.kind, 'id', row_value.id, 'what', row_value.what,
      'due_at', row_value.due, 'record', (select app.crm_record_json(r) - 'last_reply_body' from public.crm_records r where r.id = row_value.record_id)));
  end loop;
  return jsonb_build_object('status', 'CRM_REMINDERS', 'items', items,
    'chat_ids', (select to_jsonb(s.telegram_chat_ids) from app.email_sdr_settings s where s.organization_id = target_org));
end $function$

