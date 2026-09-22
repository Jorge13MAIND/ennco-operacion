CREATE OR REPLACE FUNCTION public.autoenroll_direct_lane(target_organization_id uuid, target_mailbox_id uuid, proof_command_id text, proof_nonce uuid, proof_expires_at timestamp with time zone, proof_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare payload_sha text; mailbox_record public.mailboxes%rowtype; campaign_id uuid; room integer; pending_new integer; response jsonb;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','autoenroll_direct_lane',target_organization_id::text,target_mailbox_id::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id;
  if not found or mailbox_record.direct_lane_status<>'CONNECTED' then return jsonb_build_object('status','SKIPPED','reason','MAILBOX_NOT_CONNECTED'); end if;
  select c.id into campaign_id from public.campaigns c where c.organization_id=target_organization_id and c.lane='DIRECT' and c.direct_lane_state='RUNNING'
    order by c.approved_at desc nulls last limit 1;
  if campaign_id is null then return jsonb_build_object('status','SKIPPED','reason','NO_RUNNING_CAMPAIGN'); end if;
  -- cupo = tope de nuevos del dia - nuevos ya enviados hoy - toques 1 ya en cola para este buzon
  select count(*) into pending_new from public.campaign_enrollments e
    where e.organization_id=target_organization_id and e.mailbox_id=target_mailbox_id and e.status='PENDING' and e.next_touch_number=1;
  room := app.direct_lane_effective_cap(mailbox_record) - app.direct_lane_new_today(target_organization_id,target_mailbox_id) - pending_new;
  if room<=0 then return jsonb_build_object('status','SKIPPED','reason','NO_ROOM','pending_new',pending_new); end if;
  response := app.direct_lane_enroll_core(target_organization_id,campaign_id,target_mailbox_id,null,room,null,'DIRECT_LANE_CONTACTS_AUTOENROLLED');
  return response || jsonb_build_object('room',room,'pending_new',pending_new);
end $function$

