begin;

-- Hiperpersonalización (22-sep-2026): un tercer dato en las plantillas, {{gancho}}.
--
-- Hasta hoy el motor solo sabía sustituir {{first_name}} y {{company}}: el mismo correo para
-- todos con el nombre cambiado. Esto agrega una línea propia de cada empresa, con su fuente,
-- su fecha y su nivel de confianza, aprobada por una persona antes de salir. Si una empresa no
-- tiene gancho aprobado se usa el de su sector y ciudad; si tampoco hay, el párrafo desaparece
-- limpio en vez de dejar un hueco.
--
-- Nada se inventa: un gancho sin fuente no se puede aprobar.

/* ---------- Dónde vive el gancho ---------- */

create table if not exists public.ennco_account_hooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  account_id uuid not null,
  hook_text text not null check (length(btrim(hook_text)) between 20 and 400),
  source_url text check (source_url is null or source_url ~ '^https?://'),
  source_name text,
  observed_at date,
  confidence text not null default 'MEDIA' check (confidence in ('ALTA','MEDIA','BAJA')),
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','REJECTED')),
  rubric_version text not null default 'gancho-v1-2026-09-22',
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, account_id) references public.accounts(organization_id, id) on delete cascade
);
-- Un solo gancho aprobado por empresa; los rechazados y borradores conviven para dejar rastro.
create unique index if not exists ennco_account_hooks_approved_unique
  on public.ennco_account_hooks (organization_id, account_id) where status = 'APPROVED';
create index if not exists ennco_account_hooks_org_status_idx on public.ennco_account_hooks (organization_id, status);

/* Gancho de respaldo por sector y estado. El más específico gana. */
create table if not exists public.ennco_hook_fallbacks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  sector text,
  state text,
  hook_text text not null check (length(btrim(hook_text)) between 20 and 400),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, sector, state)
);

alter table public.ennco_account_hooks enable row level security;
alter table public.ennco_hook_fallbacks enable row level security;
drop policy if exists ennco_account_hooks_member_read on public.ennco_account_hooks;
create policy ennco_account_hooks_member_read on public.ennco_account_hooks for select using (app.is_member(organization_id));
drop policy if exists ennco_hook_fallbacks_member_read on public.ennco_hook_fallbacks;
create policy ennco_hook_fallbacks_member_read on public.ennco_hook_fallbacks for select using (app.is_member(organization_id));
revoke insert, update, delete, truncate on public.ennco_account_hooks, public.ennco_hook_fallbacks from authenticated, anon;
grant select on public.ennco_account_hooks, public.ennco_hook_fallbacks to authenticated;

/* ---------- Qué gancho le toca a una empresa ---------- */

create or replace function app.hook_for_account(target_organization_id uuid, target_account_id uuid)
returns text language sql stable set search_path=public,app,pg_temp as $$
  select coalesce(
    (select h.hook_text from public.ennco_account_hooks h
      where h.organization_id = target_organization_id and h.account_id = target_account_id and h.status = 'APPROVED' limit 1),
    (select f.hook_text from public.ennco_hook_fallbacks f
      join public.accounts a on a.organization_id = f.organization_id and a.id = target_account_id
      where f.organization_id = target_organization_id and f.active
        and (f.sector is null or lower(f.sector) = lower(a.sector))
        and (f.state is null or lower(f.state) = lower(a.state))
      order by (f.sector is not null)::int + (f.state is not null)::int desc
      limit 1),
    '');
$$;

/* ---------- Render con gancho ---------- */

create or replace function app.direct_lane_render(target_template text, target_full_name text, target_company text, target_hook text)
returns text language sql immutable set search_path=pg_catalog as $$
  select
    -- Sin gancho, el párrafo entero se va y no queda un renglón en blanco.
    regexp_replace(
      replace(replace(replace(coalesce(target_template,''),
        '{{first_name}}', coalesce(nullif(split_part(btrim(coalesce(target_full_name,'')),' ',1),''),'hola')),
        '{{company}}', coalesce(nullif(btrim(target_company),''),'su planta')),
        '{{gancho}}', coalesce(btrim(target_hook),'')),
      E'\n{3,}', E'\n\n', 'g');
$$;

/* ---------- El claim pasa el gancho al render ---------- */

create or replace function public.claim_direct_lane_dispatch(target_organization_id uuid, target_mailbox_id uuid, dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare mailbox_record public.mailboxes%rowtype; campaign_record public.campaigns%rowtype; candidate record;
  reply_record public.messages%rowtype; inbound_record public.messages%rowtype; previous_message public.messages%rowtype;
  sent_count integer; new_count integer; cap integer; ceiling integer; thread_json jsonb;
  rendered_subject text; rendered_body text; hook_text text; attempt_value integer; idempotency_value text;
  correlation_value uuid := gen_random_uuid(); message_id_value uuid;
begin
  if auth.uid() is not null and not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id;
  if not found then return jsonb_build_object('status','NOOP','reason','MAILBOX_NOT_FOUND'); end if;
  if mailbox_record.direct_lane_status<>'CONNECTED' or mailbox_record.kill_switch then
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'MAILBOX_NOT_CONNECTED',jsonb_build_object('status',mailbox_record.direct_lane_status));
  end if;
  if not app.direct_lane_window_open(mailbox_record) then
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'OUTSIDE_SEND_WINDOW','{}'::jsonb);
  end if;
  if not app.direct_lane_pacing_ok(target_organization_id,target_mailbox_id) then
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'PACING_HOLD','{}'::jsonb);
  end if;

  ceiling := app.direct_lane_daily_cap(mailbox_record);
  sent_count := app.direct_lane_sent_today(target_organization_id,target_mailbox_id);
  if sent_count>=ceiling then
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'DAILY_CAP_REACHED',jsonb_build_object('sent_today',sent_count,'ceiling',ceiling));
  end if;
  cap := ceiling; new_count := app.direct_lane_new_today(target_organization_id,target_mailbox_id);

  -- Prioridad 1: una respuesta escrita por el operador, en el hilo original y con copia a Paco.
  select * into reply_record from public.messages
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id and lane='DIRECT' and direction='OUTBOUND'
    and status='QUEUED' and touch_number is null
  order by created_at limit 1 for update skip locked;
  if found then
    update public.messages set status='SENDING',updated_at=clock_timestamp() where id=reply_record.id;
    select m.* into inbound_record from public.provider_events e join public.messages m on m.organization_id=e.organization_id and m.id=e.message_id
    where e.organization_id=target_organization_id and e.id=reply_record.reply_to_provider_event_id;
    select * into previous_message from public.messages
    where organization_id=target_organization_id and id=(select (pe.payload_json->>'related_outbound_message_id')::uuid from public.provider_events pe where pe.id=reply_record.reply_to_provider_event_id);
    thread_json := jsonb_strip_nulls(jsonb_build_object(
      'provider_thread_id',coalesce(reply_record.provider_thread_id,inbound_record.provider_thread_id,previous_message.provider_thread_id),
      'in_reply_to',coalesce(inbound_record.rfc_message_id,previous_message.rfc_message_id),
      'references',to_jsonb(array_remove(array[previous_message.rfc_message_id,inbound_record.rfc_message_id],null))));
    perform app.direct_lane_tick(target_organization_id,target_mailbox_id,reply_record.id,'CLAIM','CLAIMED_REPLY',null);
    return jsonb_build_object('status','CLAIMED','kind','REPLY','message_id',reply_record.id,'mailbox_id',target_mailbox_id,
      'from_email',mailbox_record.normalized_email,'from_name',coalesce(mailbox_record.direct_lane_display_name,mailbox_record.sender_name),
      'to_email',reply_record.normalized_to,'cc_emails',to_jsonb(reply_record.cc_emails),'subject',reply_record.subject,
      'body_text',reply_record.body_text,'touch_number',null,'thread',case when thread_json ? 'provider_thread_id' and thread_json ? 'in_reply_to' then thread_json else null end,
      'enrollment_id',reply_record.enrollment_id,'sent_today',sent_count,'daily_cap',cap);
  end if;

  -- Prioridad 2: el siguiente toque vencido. Los seguimientos van antes que los primeros contactos.
  select ce.id as enrollment_id, ce.next_touch_number as touch_value, ce.status as enrollment_status,
    ct.id as contact_id, ct.full_name, ct.normalized_email as contact_email, a.legal_name, a.id as account_id,
    st.subject_template, st.body_template, c.id as campaign_id
  into candidate
  from public.campaign_enrollments ce
  join public.campaigns c on c.organization_id=ce.organization_id and c.id=ce.campaign_id
  join public.contacts ct on ct.organization_id=ce.organization_id and ct.id=ce.contact_id
  join public.accounts a on a.organization_id=ce.organization_id and a.id=ce.account_id
  join public.sequence_touches st on st.organization_id=ce.organization_id and st.sequence_version_id=ce.sequence_version_id and st.touch_number=ce.next_touch_number
  where ce.organization_id=target_organization_id and ce.mailbox_id=target_mailbox_id
    and c.lane='DIRECT' and (c.direct_lane_state='RUNNING' or (dry_run and c.direct_lane_state in ('DRAFT','RUNNING','PAUSED')))
    and ce.status in ('PENDING','ACTIVE') and coalesce(ce.next_touch_at,clock_timestamp())<=clock_timestamp()
    and ct.verified and not ct.is_deleted and not a.is_deleted
    and not app.is_suppressed(target_organization_id,a.id,ct.normalized_email,a.primary_domain)
    and not exists (select 1 from public.messages m2 where m2.organization_id=target_organization_id and m2.enrollment_id=ce.id
      and m2.direction='OUTBOUND' and m2.touch_number=ce.next_touch_number
      and (case when dry_run then m2.status<>'FAILED' else m2.status not in ('FAILED','DRY_RUN') end))
    and (ce.next_touch_number>1 or new_count<cap)
  order by (ce.next_touch_number=1), ce.next_touch_at nulls first, ce.created_at
  limit 1 for update of ce skip locked;
  if candidate.enrollment_id is null then
    if new_count>=cap and exists (select 1 from public.campaign_enrollments ce2
        join public.campaigns c2 on c2.organization_id=ce2.organization_id and c2.id=ce2.campaign_id
        where ce2.organization_id=target_organization_id and ce2.mailbox_id=target_mailbox_id and c2.lane='DIRECT'
          and c2.direct_lane_state='RUNNING' and ce2.status in ('PENDING','ACTIVE') and ce2.next_touch_number=1
          and coalesce(ce2.next_touch_at,clock_timestamp())<=clock_timestamp()) then
      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'NEW_CONTACT_CAP_REACHED',
        jsonb_build_object('sent_today',sent_count,'ceiling',ceiling,'new_today',new_count,'new_cap',cap));
    end if;
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'NO_ELIGIBLE_ENVELOPE',
      jsonb_build_object('sent_today',sent_count,'ceiling',ceiling,'new_today',new_count,'new_cap',cap));
  end if;

  hook_text := app.hook_for_account(target_organization_id, candidate.account_id);
  rendered_subject := left(app.direct_lane_render(candidate.subject_template,candidate.full_name,candidate.legal_name,hook_text),180);
  rendered_body := app.direct_lane_render(candidate.body_template,candidate.full_name,candidate.legal_name,hook_text);
  thread_json := null;
  if candidate.touch_value>1 then
    select * into previous_message from public.messages
    where organization_id=target_organization_id and enrollment_id=candidate.enrollment_id and direction='OUTBOUND'
      and touch_number=candidate.touch_value-1 and status in ('SENT','DELIVERED')
    order by sent_at desc nulls last limit 1;
    if previous_message.id is not null and previous_message.provider_thread_id is not null and previous_message.rfc_message_id is not null then
      thread_json := jsonb_build_object('provider_thread_id',previous_message.provider_thread_id,'in_reply_to',previous_message.rfc_message_id,
        'references',to_jsonb(array[previous_message.rfc_message_id]));
    end if;
  end if;

  select count(*)+1 into attempt_value from public.messages
  where organization_id=target_organization_id and enrollment_id=candidate.enrollment_id and direction='OUTBOUND'
    and touch_number=candidate.touch_value and status='FAILED';
  idempotency_value := 'direct-dispatch:'||candidate.enrollment_id::text||':t'||candidate.touch_value::text||':a'||attempt_value::text
    ||case when dry_run then ':shadow' else '' end;

  if not dry_run and candidate.enrollment_status='PENDING' then
    update public.campaign_enrollments set status='ACTIVE',updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=candidate.enrollment_id and status='PENDING';
  end if;

  insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,lane,touch_number,
    normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id,provider_thread_id)
  values (target_organization_id,candidate.enrollment_id,target_mailbox_id,candidate.contact_id,'OUTBOUND',
    case when dry_run then 'DRY_RUN'::public.message_status else 'SENDING'::public.message_status end,'DIRECT',candidate.touch_value,
    candidate.contact_email,mailbox_record.normalized_email,rendered_subject,rendered_body,idempotency_value,correlation_value,
    thread_json->>'provider_thread_id')
  on conflict (organization_id,idempotency_key) do nothing
  returning id into message_id_value;
  if message_id_value is null then
    select id into message_id_value from public.messages where organization_id=target_organization_id and idempotency_key=idempotency_value;
  end if;
  perform app.direct_lane_tick(target_organization_id,target_mailbox_id,message_id_value,'CLAIM',case when dry_run then 'SHADOW_CLAIMED' else 'CLAIMED_TOUCH' end,
    jsonb_build_object('touch',candidate.touch_value,'attempt',attempt_value,'hook',hook_text<>''));
  return jsonb_build_object('status',case when dry_run then 'SHADOW_CLAIMED' else 'CLAIMED' end,'kind','TOUCH','message_id',message_id_value,
    'mailbox_id',target_mailbox_id,'from_email',mailbox_record.normalized_email,
    'from_name',coalesce(mailbox_record.direct_lane_display_name,mailbox_record.sender_name),
    'to_email',candidate.contact_email,'cc_emails','[]'::jsonb,'subject',rendered_subject,'body_text',rendered_body,
    'touch_number',candidate.touch_value,'thread',thread_json,'enrollment_id',candidate.enrollment_id,
    'sent_today',sent_count,'daily_cap',cap,'attempt',attempt_value);
end $$;

/* ---------- Escritura de ganchos ---------- */

create or replace function public.account_hook_save(target_organization_id uuid, target_account_id uuid, target_hook_text text,
  target_source_url text, target_source_name text, target_observed_at date, target_confidence text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare h public.ennco_account_hooks;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_source_url is null and coalesce(target_confidence,'MEDIA') <> 'BAJA' then raise exception 'HOOK_SOURCE_REQUIRED'; end if;
  insert into public.ennco_account_hooks(organization_id,account_id,hook_text,source_url,source_name,observed_at,confidence,status,created_by)
  values (target_organization_id,target_account_id,btrim(target_hook_text),target_source_url,target_source_name,target_observed_at,coalesce(target_confidence,'MEDIA'),'DRAFT',auth.uid())
  returning * into h;
  return jsonb_build_object('id',h.id,'accountId',h.account_id,'hookText',h.hook_text,'status',h.status,'confidence',h.confidence);
end $$;

create or replace function public.account_hook_review(target_organization_id uuid, target_id uuid, target_status text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare h public.ennco_account_hooks;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_status not in ('APPROVED','REJECTED','DRAFT') then raise exception 'HOOK_STATUS_INVALID'; end if;
  -- Un gancho sin fuente no se aprueba: la regla del plan es que nada se inventa.
  if target_status='APPROVED' and not exists (select 1 from public.ennco_account_hooks x where x.organization_id=target_organization_id and x.id=target_id and x.source_url is not null) then
    raise exception 'HOOK_SOURCE_REQUIRED';
  end if;
  if target_status='APPROVED' then
    update public.ennco_account_hooks set status='REJECTED', updated_at=now()
    where organization_id=target_organization_id and status='APPROVED'
      and account_id=(select account_id from public.ennco_account_hooks where organization_id=target_organization_id and id=target_id);
  end if;
  update public.ennco_account_hooks set status=target_status, reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now()
  where organization_id=target_organization_id and id=target_id returning * into h;
  if not found then raise exception 'HOOK_NOT_FOUND'; end if;
  return jsonb_build_object('id',h.id,'accountId',h.account_id,'status',h.status);
end $$;

create or replace function public.hooks_read(target_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  return jsonb_build_object(
    'hooks', coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'accountId',h.account_id,'account',a.legal_name,'sector',a.sector,'state',a.state,
        'hookText',h.hook_text,'sourceUrl',h.source_url,'sourceName',h.source_name,'observedAt',h.observed_at,'confidence',h.confidence,
        'status',h.status,'createdAt',h.created_at) order by h.status, a.legal_name)
      from public.ennco_account_hooks h join public.accounts a on a.organization_id=h.organization_id and a.id=h.account_id
      where h.organization_id=target_organization_id), '[]'::jsonb),
    'fallbacks', coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'sector',f.sector,'state',f.state,'hookText',f.hook_text,'active',f.active) order by f.sector nulls last, f.state nulls last)
      from public.ennco_hook_fallbacks f where f.organization_id=target_organization_id), '[]'::jsonb));
end $$;

revoke all on function app.hook_for_account(uuid,uuid) from public, anon, authenticated;
revoke all on function app.direct_lane_render(text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.account_hook_save(uuid,uuid,text,text,text,date,text) from public;
revoke all on function public.account_hook_review(uuid,uuid,text) from public;
revoke all on function public.hooks_read(uuid) from public;
grant execute on function public.account_hook_save(uuid,uuid,text,text,text,date,text) to authenticated;
grant execute on function public.account_hook_review(uuid,uuid,text) to authenticated;
grant execute on function public.hooks_read(uuid) to authenticated;

/* ---------- Secuencias de 4 a 8 toques ---------- */
-- El plan acorta la secuencia a seis toques en catorce días; la RPC exigía exactamente ocho.

create or replace function public.create_direct_lane_campaign(
  target_organization_id uuid, target_name text, target_cc_on_reply_email text,
  target_sequence jsonb, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; request_sha text; replay jsonb; manifest jsonb; manifest_sha text; campaign_id uuid;
  variant jsonb; touch jsonb; version_id uuid; variant_index integer := 0; response jsonb; touch_count integer;
begin
  actor := app.direct_lane_assert_operator(target_organization_id);
  request_sha := encode(digest(convert_to(concat_ws(E'\n','create_direct_lane_campaign',target_organization_id::text,
    coalesce(target_name,''),coalesce(target_cc_on_reply_email,''),coalesce(target_sequence::text,'')),'utf8'),'sha256'),'hex');
  replay := app.direct_lane_command_replay(target_organization_id,target_idempotency_key,request_sha);
  if replay is not null then return replay; end if;
  if length(btrim(coalesce(target_name,'')))<3 then raise exception 'DIRECT_LANE_CAMPAIGN_NAME_REQUIRED'; end if;
  if target_cc_on_reply_email is not null and target_cc_on_reply_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'DIRECT_LANE_CC_EMAIL_INVALID';
  end if;
  if target_sequence is null or jsonb_typeof(target_sequence->'variants')<>'array' or jsonb_array_length(target_sequence->'variants')<>4
    or (target_sequence->>'content_sha256') !~ '^[a-f0-9]{64}$' then
    raise exception 'DIRECT_LANE_SEQUENCE_INVALID';
  end if;
  touch_count := jsonb_array_length(target_sequence->'day_offsets');
  if touch_count < 4 or touch_count > 8 then raise exception 'DIRECT_LANE_SEQUENCE_LENGTH_INVALID'; end if;
  manifest := jsonb_build_object(
    'lane','DIRECT',
    'cc_on_reply_email',lower(target_cc_on_reply_email),
    'sequence_source',target_sequence->>'source',
    'sequence_source_sha256',target_sequence->>'source_sha256',
    'content_sha256',target_sequence->>'content_sha256',
    'day_offsets',target_sequence->'day_offsets',
    'variants',(select jsonb_agg(jsonb_build_object('key',v->>'key','version',(v->>'version')::integer,'content_sha256',v->>'content_sha256'))
      from jsonb_array_elements(target_sequence->'variants') v));
  manifest_sha := encode(digest(convert_to(manifest::text,'utf8'),'sha256'),'hex');
  if exists (select 1 from public.campaigns where organization_id=target_organization_id and manifest_sha256=manifest_sha) then
    raise exception 'DIRECT_LANE_CAMPAIGN_DUPLICATE';
  end if;
  insert into public.campaigns(organization_id,name,status,lane,direct_lane_state,manifest_json,manifest_sha256)
  values (target_organization_id,btrim(target_name),'DRAFT','DIRECT','DRAFT',manifest,manifest_sha)
  returning id into campaign_id;
  for variant in select * from jsonb_array_elements(target_sequence->'variants') loop
    variant_index := variant_index+1;
    if jsonb_array_length(variant->'touches')<>touch_count then raise exception 'DIRECT_LANE_VARIANT_TOUCHES_INVALID'; end if;
    insert into public.sequence_versions(organization_id,campaign_id,version,sender_name,sender_title,content_sha256)
    values (target_organization_id,campaign_id,variant_index,target_sequence->>'sender_name',target_sequence->>'sender_title',variant->>'content_sha256')
    returning id into version_id;
    for touch in select * from jsonb_array_elements(variant->'touches') loop
      insert into public.sequence_touches(organization_id,sequence_version_id,touch_number,day_offset,subject_template,body_template)
      values (target_organization_id,version_id,(touch->>'touch_number')::smallint,(touch->>'day_offset')::smallint,touch->>'subject',touch->>'body');
    end loop;
  end loop;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,'DIRECT_LANE_CAMPAIGN_CREATED','campaigns',campaign_id,
    jsonb_build_object('manifest_sha256',manifest_sha,'variants',4,'touches',touch_count));
  response := jsonb_build_object('status','CREATED','campaign_id',campaign_id,'manifest_sha256',manifest_sha);
  return app.direct_lane_command_record(target_organization_id,'CREATE_CAMPAIGN',target_idempotency_key,request_sha,response,actor);
end $$;

commit;
