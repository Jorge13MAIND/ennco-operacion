CREATE OR REPLACE FUNCTION public.configure_direct_lane_mailbox(target_organization_id uuid, target_mailbox_id uuid, target_patch jsonb, target_reason text, target_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare actor uuid; request_sha text; replay jsonb; mailbox_record public.mailboxes%rowtype; new_status text; response jsonb;
begin
  actor := app.direct_lane_assert_operator(target_organization_id);
  request_sha := encode(digest(convert_to(concat_ws(E'\n','configure_direct_lane_mailbox',target_organization_id::text,
    target_mailbox_id::text,coalesce(target_patch::text,''),coalesce(target_reason,'')),'utf8'),'sha256'),'hex');
  replay := app.direct_lane_command_replay(target_organization_id,target_idempotency_key,request_sha);
  if replay is not null then return replay; end if;
  if length(btrim(coalesce(target_reason,'')))<3 then raise exception 'DIRECT_LANE_REASON_REQUIRED'; end if;
  if target_patch is null or jsonb_typeof(target_patch)<>'object' then raise exception 'DIRECT_LANE_PATCH_INVALID'; end if;
  if exists (select 1 from jsonb_object_keys(target_patch) k where k not in ('status','ramp_mode','fixed_cap','cap_max','display_name','ramp_schedule','ramp_anchor_at')) then
    raise exception 'DIRECT_LANE_PATCH_KEY_UNKNOWN';
  end if;
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id for update;
  if not found then raise exception 'DIRECT_LANE_MAILBOX_NOT_FOUND'; end if;
  new_status := coalesce(target_patch->>'status',mailbox_record.direct_lane_status);
  if new_status='CONNECTED' and not exists (select 1 from public.direct_lane_credentials c
    where c.organization_id=target_organization_id and c.mailbox_id=target_mailbox_id and c.status='ACTIVE') then
    raise exception 'DIRECT_LANE_CREDENTIAL_MISSING';
  end if;
  if mailbox_record.direct_lane_status='KILLED' and new_status<>'KILLED'
    and not app.has_role(target_organization_id,array['teckel_admin']::public.user_role[]) then
    raise exception 'DIRECT_LANE_UNKILL_REQUIRES_ADMIN';
  end if;
  -- Grant, 7-sep: el buzon principal del cliente puede llegar a 25 contactos
  -- nuevos al dia; con seguimientos, techo total 60 (era 20).
  if coalesce(target_patch->>'ramp_mode',mailbox_record.direct_lane_ramp_mode)='SCHEDULE'
    and not (target_patch ? 'ramp_schedule') and mailbox_record.direct_lane_ramp_schedule is null then
    raise exception 'DIRECT_LANE_RAMP_SCHEDULE_REQUIRED';
  end if;
  if mailbox_record.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP'
    and coalesce((target_patch->>'cap_max')::integer,mailbox_record.direct_lane_cap_max)>60 then
    raise exception 'DIRECT_LANE_CLIENT_MAILBOX_CAP_LIMIT';
  end if;
  update public.mailboxes set
    direct_lane_status=new_status,
    direct_lane_ramp_mode=coalesce(target_patch->>'ramp_mode',direct_lane_ramp_mode),
    direct_lane_fixed_cap=coalesce((target_patch->>'fixed_cap')::integer,direct_lane_fixed_cap),
    direct_lane_cap_max=coalesce((target_patch->>'cap_max')::integer,direct_lane_cap_max),
    direct_lane_display_name=coalesce(nullif(btrim(target_patch->>'display_name'),''),direct_lane_display_name),
    direct_lane_ramp_schedule=case when target_patch ? 'ramp_schedule'
      then (select array_agg((t.x)::integer order by t.ord) from jsonb_array_elements_text(target_patch->'ramp_schedule') with ordinality as t(x,ord))
      else direct_lane_ramp_schedule end,
    direct_lane_ramp_anchor_at=case when target_patch ? 'ramp_anchor_at' then (target_patch->>'ramp_anchor_at')::timestamptz else direct_lane_ramp_anchor_at end,
    updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=target_mailbox_id
  returning * into mailbox_record;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,'DIRECT_LANE_MAILBOX_CONFIGURED','mailboxes',target_mailbox_id,
    jsonb_build_object('patch',target_patch,'reason',btrim(target_reason)));
  response := jsonb_build_object('status','CONFIGURED','mailbox',app.direct_lane_mailbox_json(mailbox_record));
  return app.direct_lane_command_record(target_organization_id,'CONFIGURE_MAILBOX',target_idempotency_key,request_sha,response,actor);
end $function$

