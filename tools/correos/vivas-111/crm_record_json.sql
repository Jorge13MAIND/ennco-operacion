CREATE OR REPLACE FUNCTION app.crm_record_json(r crm_records)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  select to_jsonb(r) - 'organization_id' || jsonb_build_object(
    'owner_email', (select u.email from auth.users u where u.id = r.owner_user_id),
    'open_tasks', (select count(*) from public.crm_tasks t where t.record_id = r.id and t.status = 'PENDIENTE'),
    'next_task_at', (select min(t.due_at) from public.crm_tasks t where t.record_id = r.id and t.status = 'PENDIENTE'),
    'last_reply_body', (select left(m.body_text, 2000) from public.provider_events pe
      join public.messages m on m.organization_id = pe.organization_id and m.id = pe.message_id where pe.id = r.last_reply_event_id),
    'mailbox_email', (select mb.normalized_email from public.provider_events pe
      join public.messages m on m.organization_id = pe.organization_id and m.id = pe.message_id
      join public.mailboxes mb on mb.id = m.mailbox_id where pe.id = r.last_reply_event_id));
$function$

