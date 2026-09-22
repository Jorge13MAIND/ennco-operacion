CREATE OR REPLACE FUNCTION app.direct_lane_enroll_core(target_organization_id uuid, target_campaign_id uuid, target_mailbox_id uuid, target_contact_ids uuid[], target_max_count integer, actor uuid, audit_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare campaign_record public.campaigns%rowtype;
  mailbox_ids uuid[]; mailbox_cursor integer := 0; candidate record; chosen_mailbox uuid;
  variant_key text; version_id uuid; enrolled integer := 0; skipped_suppressed integer := 0;
  skipped_unverified integer := 0; skipped_enrolled integer := 0; by_variant jsonb := '{}'::jsonb;
  by_mailbox jsonb := '{}'::jsonb; new_status public.enrollment_status; response jsonb; limit_value integer;
begin
  limit_value := least(greatest(coalesce(target_max_count,50),1),500);
  select * into campaign_record from public.campaigns where organization_id=target_organization_id and id=target_campaign_id and lane='DIRECT';
  if not found then raise exception 'DIRECT_LANE_CAMPAIGN_NOT_FOUND'; end if;
  if campaign_record.direct_lane_state not in ('DRAFT','RUNNING','PAUSED') then raise exception 'DIRECT_LANE_CAMPAIGN_COMPLETED'; end if;
  if target_mailbox_id is not null then
    if not exists (select 1 from public.mailboxes m where m.organization_id=target_organization_id and m.id=target_mailbox_id
      and m.direct_lane_status in ('CONNECTED','PAUSED')) then raise exception 'DIRECT_LANE_MAILBOX_NOT_CONNECTED'; end if;
    mailbox_ids := array[target_mailbox_id];
  else
    -- DEC-112: el reparto por defecto incluye al buzon principal del cliente.
    select array_agg(m.id order by m.normalized_email) into mailbox_ids from public.mailboxes m
    where m.organization_id=target_organization_id and m.direct_lane_status='CONNECTED';
    if mailbox_ids is null or cardinality(mailbox_ids)=0 then
      select array_agg(m.id order by m.normalized_email) into mailbox_ids from public.mailboxes m
      where m.organization_id=target_organization_id and m.direct_lane_status='CONNECTED';
    end if;
    if mailbox_ids is null or cardinality(mailbox_ids)=0 then raise exception 'DIRECT_LANE_NO_CONNECTED_MAILBOX'; end if;
  end if;
  for candidate in
    select c.id as contact_id, c.account_id, c.role_title, c.verified, c.normalized_email, a.primary_domain,
      exists (select 1 from public.campaign_enrollments ce where ce.organization_id=target_organization_id and ce.contact_id=c.id
        and ce.status in ('PENDING','ACTIVE','PAUSED')) as already_enrolled
    from public.contacts c join public.accounts a on a.organization_id=c.organization_id and a.id=c.account_id
    where c.organization_id=target_organization_id and not c.is_deleted and not a.is_deleted
      and (target_contact_ids is null or c.id=any(target_contact_ids))
    order by a.tier nulls last, c.verified desc, c.created_at
  loop
    if enrolled>=limit_value then exit; end if;
    if candidate.already_enrolled then skipped_enrolled := skipped_enrolled+1; continue; end if;
    if not candidate.verified then skipped_unverified := skipped_unverified+1; continue; end if;
    if app.is_suppressed(target_organization_id,candidate.account_id,candidate.normalized_email,candidate.primary_domain) then
      skipped_suppressed := skipped_suppressed+1; continue;
    end if;
    variant_key := app.direct_lane_variant_for_role(candidate.role_title);
    select sv.id into version_id from public.sequence_versions sv
    join jsonb_array_elements(campaign_record.manifest_json->'variants') v on (v->>'version')::integer=sv.version and v->>'key'=variant_key
    where sv.organization_id=target_organization_id and sv.campaign_id=target_campaign_id limit 1;
    if version_id is null then raise exception 'DIRECT_LANE_VARIANT_VERSION_MISSING: %', variant_key; end if;
    mailbox_cursor := mailbox_cursor+1;
    chosen_mailbox := mailbox_ids[1+mod(mailbox_cursor-1,cardinality(mailbox_ids))];
    insert into public.campaign_enrollments(organization_id,campaign_id,sequence_version_id,account_id,contact_id,mailbox_id,status,next_touch_number,next_touch_at)
    values (target_organization_id,target_campaign_id,version_id,candidate.account_id,candidate.contact_id,chosen_mailbox,'PENDING',1,clock_timestamp())
    returning status into new_status;
    if new_status='SUPPRESSED' then skipped_suppressed := skipped_suppressed+1; continue; end if;
    enrolled := enrolled+1;
    by_variant := jsonb_set(by_variant,array[variant_key],to_jsonb(coalesce((by_variant->>variant_key)::integer,0)+1));
    by_mailbox := jsonb_set(by_mailbox,array[chosen_mailbox::text],to_jsonb(coalesce((by_mailbox->>chosen_mailbox::text)::integer,0)+1));
  end loop;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,audit_action,'campaigns',target_campaign_id,
    jsonb_build_object('enrolled',enrolled,'skipped_suppressed',skipped_suppressed,'skipped_unverified',skipped_unverified,
      'skipped_enrolled',skipped_enrolled,'by_variant',by_variant,'by_mailbox',by_mailbox));
  return jsonb_build_object('status','ENROLLED','campaign_id',target_campaign_id,'enrolled',enrolled,
    'skipped_suppressed',skipped_suppressed,'skipped_unverified',skipped_unverified,'skipped_enrolled',skipped_enrolled,
    'by_variant',by_variant,'by_mailbox',by_mailbox);
end $function$

