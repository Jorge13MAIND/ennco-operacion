CREATE OR REPLACE FUNCTION app.enforce_direct_lane_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare mailbox_record public.mailboxes%rowtype; controls_record public.runtime_controls%rowtype;
  enrollment_record public.campaign_enrollments%rowtype; contact_record public.contacts%rowtype;
  account_record public.accounts%rowtype; campaign_record public.campaigns%rowtype;
  word_count integer; cap integer; sent_today integer;
begin
  if new.lane<>'DIRECT' or new.direction<>'OUTBOUND' or new.status in ('DRAFT','DRY_RUN') then return new; end if;
  if new.mailbox_id is null or new.contact_id is null or new.enrollment_id is null then
    raise exception 'DIRECT_LANE_REFERENCE_REQUIRED';
  end if;
  if tg_op='INSERT' then
    if new.status not in ('QUEUED','SENDING') then raise exception 'DIRECT_LANE_INSERT_STATUS_INVALID'; end if;
  else
    if new.status is not distinct from old.status then return new; end if;
    if old.status='DRY_RUN' then raise exception 'DIRECT_LANE_DRY_RUN_IMMUTABLE'; end if;
    if not (
      (old.status='QUEUED' and new.status in ('SENDING','FAILED','QUARANTINED'))
      or (old.status='SENDING' and new.status in ('SENT','FAILED','QUARANTINED'))
      or (old.status='SENT' and new.status in ('DELIVERED','BOUNCED'))
      or (old.status='DELIVERED' and new.status='BOUNCED')
      or (old.status='FAILED' and new.status='QUEUED' and new.touch_number is null)
    ) then raise exception 'DIRECT_LANE_STATUS_TRANSITION_INVALID'; end if;
    if new.status in ('FAILED','QUARANTINED','DELIVERED','BOUNCED') then return new; end if;
    if new.status='SENT' then
      if nullif(btrim(new.provider_message_id),'') is null or new.sent_at is null then
        raise exception 'DIRECT_LANE_SENT_REQUIRES_PROVIDER_ID';
      end if;
      return new;
    end if;
  end if;

  -- A partir de aquí el mensaje está a punto de salir (QUEUED o SENDING).
  select * into mailbox_record from public.mailboxes where organization_id=new.organization_id and id=new.mailbox_id;
  if not found or mailbox_record.direct_lane_status<>'CONNECTED' then raise exception 'DIRECT_LANE_MAILBOX_NOT_CONNECTED'; end if;
  if not exists (select 1 from public.direct_lane_credentials c
    where c.organization_id=new.organization_id and c.mailbox_id=new.mailbox_id and c.status='ACTIVE') then
    raise exception 'DIRECT_LANE_CREDENTIAL_MISSING';
  end if;
  if new.normalized_from is distinct from mailbox_record.normalized_email then raise exception 'DIRECT_LANE_FROM_IDENTITY_DRIFT'; end if;
  select * into controls_record from public.runtime_controls where organization_id=new.organization_id;
  if not found or controls_record.global_kill_switch or not controls_record.external_send_allowed then
    raise exception 'DIRECT_LANE_RUNTIME_HOLD';
  end if;
  select * into enrollment_record from public.campaign_enrollments where organization_id=new.organization_id and id=new.enrollment_id;
  if not found then raise exception 'DIRECT_LANE_ENROLLMENT_NOT_FOUND'; end if;
  select * into contact_record from public.contacts where organization_id=new.organization_id and id=enrollment_record.contact_id;
  select * into account_record from public.accounts where organization_id=new.organization_id and id=enrollment_record.account_id;
  if contact_record.id is null or account_record.id is null or not contact_record.verified or contact_record.is_deleted or account_record.is_deleted
    or new.normalized_to is distinct from contact_record.normalized_email
    or app.is_suppressed(new.organization_id,account_record.id,contact_record.normalized_email,account_record.primary_domain) then
    raise exception 'DIRECT_LANE_RECIPIENT_NOT_ELIGIBLE';
  end if;
  select * into campaign_record from public.campaigns where organization_id=new.organization_id and id=enrollment_record.campaign_id;
  word_count := cardinality(regexp_split_to_array(btrim(coalesce(new.body_text,'')),'\s+'));
  if coalesce(new.body_text,'') ~ '<[^>]+>' then raise exception 'DIRECT_LANE_PLAIN_TEXT_REQUIRED'; end if;
  if new.touch_number is not null then
    if campaign_record.lane<>'DIRECT' or campaign_record.direct_lane_state<>'RUNNING' or campaign_record.approved_at is null then
      raise exception 'DIRECT_LANE_CAMPAIGN_NOT_RUNNING';
    end if;
    if enrollment_record.status not in ('PENDING','ACTIVE') then raise exception 'DIRECT_LANE_ENROLLMENT_NOT_ACTIVE'; end if;
    if word_count>120 then raise exception 'DIRECT_LANE_WORD_LIMIT_EXCEEDED'; end if;
    if new.touch_number=1 and (coalesce(new.body_text,'')~*'(https?://|www\.|mailto:)' or coalesce(new.subject,'')~*'(https?://|www\.)') then
      raise exception 'DIRECT_LANE_FIRST_TOUCH_LINK_FORBIDDEN';
    end if;
  else
    if new.reply_to_provider_event_id is null then raise exception 'DIRECT_LANE_REPLY_REFERENCE_REQUIRED'; end if;
    if word_count>400 then raise exception 'DIRECT_LANE_REPLY_TOO_LONG'; end if;
  end if;
  if tg_op='INSERT' then
    cap := app.direct_lane_effective_cap(mailbox_record);
    sent_today := app.direct_lane_sent_today(new.organization_id,new.mailbox_id);
    if sent_today>=cap then raise exception 'DIRECT_LANE_DAILY_CAP_EXCEEDED'; end if;
  end if;
  return new;
end $function$

