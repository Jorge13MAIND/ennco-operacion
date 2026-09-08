begin;

-- M049: metricas reales, apertura, ciclo semanal e inscripcion automatica.
--
-- Grant (7-sep) pidio que todo se refleje en el panel y que cada viernes se
-- genere un ciclo de mejora con tasa de respuesta y tasa de apertura, y que
-- quede todo listo antes del primer envio real. Esta migracion agrega:
--   1. Apertura: messages.opened_at / open_count / open_tracked y la RPC
--      record_direct_lane_open (prueba HMAC del despacho; la ruta publica del
--      pixel solo la llama con un token firmado).
--   2. Estadisticas: app.direct_lane_stats_json (embudo, tasas, cortes por
--      buzon, variante, estado y semana) expuesta a operadores
--      (read_direct_lane_stats) y al cron (read_direct_lane_stats_system).
--   3. Reportes semanales: tabla direct_lane_weekly_reports +
--      store_direct_lane_weekly_report (cron) + read_direct_lane_weekly_reports.
--   4. Inscripcion automatica: el nucleo de inscripcion se separa en
--      app.direct_lane_enroll_core; enroll_direct_lane_contacts (operador)
--      lo usa, y autoenroll_direct_lane (cron, prueba HMAC) llena el cupo de
--      contactos nuevos del dia por buzon. DEC-112: el reparto por defecto
--      incluye al buzon principal del cliente.

alter table public.messages
  add column if not exists opened_at timestamptz,
  add column if not exists open_count integer not null default 0,
  add column if not exists open_tracked boolean not null default false;

create or replace function public.record_direct_lane_open(
  target_organization_id uuid, target_message_id uuid,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; updated integer;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','record_direct_lane_open',target_organization_id::text,target_message_id::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  update public.messages set opened_at=coalesce(opened_at,clock_timestamp()), open_count=open_count+1, updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=target_message_id and lane='DIRECT' and direction='OUTBOUND';
  get diagnostics updated=row_count;
  return jsonb_build_object('status',case when updated>0 then 'RECORDED' else 'IGNORED' end);
end $$;
revoke all on function public.record_direct_lane_open(uuid,uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.record_direct_lane_open(uuid,uuid,text,uuid,timestamptz,text) to anon,authenticated;

-- Marca de rastreo al liquidar: el despacho dice si el correo salio con pixel.
alter table public.messages alter column open_tracked set default false;

create or replace function app.direct_lane_stats_json(target_organization_id uuid, since_at timestamptz, until_at timestamptz)
returns jsonb language sql stable security definer set search_path=public,app,pg_temp as $$
  with env as (
    select m.id, m.mailbox_id, m.contact_id, m.enrollment_id, m.touch_number, m.status, m.created_at, m.opened_at, m.open_tracked,
      mb.normalized_email as mailbox, coalesce(nullif(a.state,''),'?') as state,
      app.direct_lane_variant_for_role(c.role_title) as variant,
      date_trunc('week', m.created_at at time zone 'America/Mexico_City')::date as week_start
    from public.messages m
    join public.mailboxes mb on mb.id=m.mailbox_id
    left join public.contacts c on c.id=m.contact_id
    left join public.accounts a on a.id=c.account_id
    where m.organization_id=target_organization_id and m.lane='DIRECT' and m.direction='OUTBOUND'
      and m.created_at>=since_at and m.created_at<until_at
      and m.status in ('SENT','DELIVERED','FAILED','BOUNCED')
  ),
  enr as (
    select e.id, e.status, e.updated_at, e.created_at, e.mailbox_id, e.contact_id
    from public.campaign_enrollments e join public.campaigns ca on ca.id=e.campaign_id
    where e.organization_id=target_organization_id and ca.lane='DIRECT'
  ),
  replies as (
    select distinct m.enrollment_id, m.mailbox_id, m.contact_id, m.created_at
    from public.messages m where m.organization_id=target_organization_id and m.lane='DIRECT' and m.direction='INBOUND'
      and m.created_at>=since_at and m.created_at<until_at
  ),
  positives as (
    select count(*) as n from public.provider_events pe join public.messages m on m.id=pe.message_id
    where pe.organization_id=target_organization_id and pe.reply_classification='POSITIVE'
      and m.lane='DIRECT' and pe.observed_at>=since_at and pe.observed_at<until_at
  ),
  grp as (
    select dim, key,
      count(*) filter (where status in ('SENT','DELIVERED')) as sends,
      count(distinct enrollment_id) filter (where touch_number=1 and status in ('SENT','DELIVERED')) as reached,
      count(*) filter (where status in ('FAILED','BOUNCED')) as failed,
      count(*) filter (where open_tracked and status in ('SENT','DELIVERED')) as tracked,
      count(*) filter (where open_tracked and opened_at is not null) as opened,
      count(distinct enrollment_id) filter (where enrollment_id in (select enrollment_id from replies)) as replied
    from (
      select 'mailbox' as dim, mailbox as key, * from env
      union all select 'variant', variant, * from env
      union all select 'state', state, * from env
      union all select 'week', week_start::text, * from env
    ) x group by dim, key
  )
  select jsonb_build_object(
    'since', since_at, 'until', until_at,
    'funnel', jsonb_build_object(
      'enrolled', (select count(*) from enr where created_at>=since_at and created_at<until_at),
      'reached', (select count(distinct enrollment_id) from env where touch_number=1 and status in ('SENT','DELIVERED')),
      'sends', (select count(*) from env where status in ('SENT','DELIVERED')),
      'failed', (select count(*) from env where status in ('FAILED','BOUNCED')),
      'bounced_enrollments', (select count(*) from enr where status='BOUNCED' and updated_at>=since_at and updated_at<until_at),
      'replied', (select count(*) from replies),
      'positive', (select n from positives),
      'unsubscribed', (select count(*) from enr where status='UNSUBSCRIBED' and updated_at>=since_at and updated_at<until_at),
      'tracked', (select count(*) from env where open_tracked and status in ('SENT','DELIVERED')),
      'opened', (select count(*) from env where open_tracked and opened_at is not null),
      'leads', (select count(*) from public.leads l where l.organization_id=target_organization_id and l.created_at>=since_at and l.created_at<until_at)
    ),
    'by', (select coalesce(jsonb_object_agg(dim, rows),'{}'::jsonb) from (
      select dim, jsonb_agg(jsonb_build_object('key',key,'sends',sends,'reached',reached,'failed',failed,'tracked',tracked,'opened',opened,'replied',replied) order by key) as rows
      from grp group by dim) d)
  )
$$;
revoke all on function app.direct_lane_stats_json(uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.read_direct_lane_stats(target_organization_id uuid, since_at timestamptz, until_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  return app.direct_lane_stats_json(target_organization_id, since_at, until_at);
end $$;
revoke all on function public.read_direct_lane_stats(uuid,timestamptz,timestamptz) from public,anon,service_role;
grant execute on function public.read_direct_lane_stats(uuid,timestamptz,timestamptz) to authenticated;

create or replace function public.read_direct_lane_stats_system(
  target_organization_id uuid, since_text text, until_text text,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql stable security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','read_direct_lane_stats_system',target_organization_id::text,since_text,until_text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  return app.direct_lane_stats_json(target_organization_id, since_text::timestamptz, until_text::timestamptz);
end $$;
revoke all on function public.read_direct_lane_stats_system(uuid,text,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.read_direct_lane_stats_system(uuid,text,text,text,uuid,timestamptz,text) to anon,authenticated;

create table if not exists public.direct_lane_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  week_start date not null,
  generated_at timestamptz not null default clock_timestamp(),
  metrics jsonb not null,
  previous jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  unique (organization_id, week_start)
);
alter table public.direct_lane_weekly_reports enable row level security;
revoke all on table public.direct_lane_weekly_reports from public,anon,authenticated,service_role;

create or replace function public.store_direct_lane_weekly_report(
  target_organization_id uuid, target_week_start text, target_metrics_text text, target_previous_text text, target_recommendations_text text,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; report_id uuid;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','store_direct_lane_weekly_report',target_organization_id::text,target_week_start,
    encode(digest(convert_to(coalesce(target_metrics_text,''),'utf8'),'sha256'),'hex')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  insert into public.direct_lane_weekly_reports(organization_id,week_start,metrics,previous,recommendations)
  values (target_organization_id,target_week_start::date,target_metrics_text::jsonb,nullif(target_previous_text,'')::jsonb,coalesce(nullif(target_recommendations_text,'')::jsonb,'[]'::jsonb))
  on conflict (organization_id,week_start) do update set metrics=excluded.metrics, previous=excluded.previous,
    recommendations=excluded.recommendations, generated_at=clock_timestamp()
  returning id into report_id;
  return jsonb_build_object('status','STORED','report_id',report_id);
end $$;
revoke all on function public.store_direct_lane_weekly_report(uuid,text,text,text,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.store_direct_lane_weekly_report(uuid,text,text,text,text,text,uuid,timestamptz,text) to anon,authenticated;

create or replace function public.read_direct_lane_weekly_reports(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('week_start',r.week_start,'generated_at',r.generated_at,'metrics',r.metrics,
    'previous',r.previous,'recommendations',r.recommendations) order by r.week_start desc)
    from public.direct_lane_weekly_reports r where r.organization_id=target_organization_id),'[]'::jsonb);
end $$;
revoke all on function public.read_direct_lane_weekly_reports(uuid) from public,anon,service_role;
grant execute on function public.read_direct_lane_weekly_reports(uuid) to authenticated;

-- Nucleo de inscripcion reutilizable (operador y cron).
create or replace function app.direct_lane_enroll_core(
  target_organization_id uuid, target_campaign_id uuid, target_mailbox_id uuid,
  target_contact_ids uuid[], target_max_count integer, actor uuid, audit_action text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
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
end $$;
revoke all on function app.direct_lane_enroll_core(uuid,uuid,uuid,uuid[],integer,uuid,text) from public,anon,authenticated,service_role;

create or replace function public.enroll_direct_lane_contacts(
  target_organization_id uuid, target_campaign_id uuid, target_mailbox_id uuid,
  target_contact_ids uuid[], target_max_count integer, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; request_sha text; replay jsonb; campaign_record public.campaigns%rowtype;
  mailbox_ids uuid[]; mailbox_cursor integer := 0; candidate record; chosen_mailbox uuid;
  variant_key text; version_id uuid; enrolled integer := 0; skipped_suppressed integer := 0;
  skipped_unverified integer := 0; skipped_enrolled integer := 0; by_variant jsonb := '{}'::jsonb;
  by_mailbox jsonb := '{}'::jsonb; new_status public.enrollment_status; response jsonb; limit_value integer;
begin
  actor := app.direct_lane_assert_operator(target_organization_id);
  request_sha := encode(digest(convert_to(concat_ws(E'\n','enroll_direct_lane_contacts',target_organization_id::text,
    target_campaign_id::text,coalesce(target_mailbox_id::text,''),coalesce(array_to_string(target_contact_ids,','),''),
    coalesce(target_max_count,0)::text),'utf8'),'sha256'),'hex');
  replay := app.direct_lane_command_replay(target_organization_id,target_idempotency_key,request_sha);
  if replay is not null then return replay; end if;
  response := app.direct_lane_enroll_core(target_organization_id,target_campaign_id,target_mailbox_id,target_contact_ids,target_max_count,actor,'DIRECT_LANE_CONTACTS_ENROLLED');
  return app.direct_lane_command_record(target_organization_id,'ENROLL_CONTACTS',target_idempotency_key,request_sha,response,actor);
end $$;

-- Inscripcion automatica: llena el cupo de contactos nuevos del dia por buzon.
create or replace function public.autoenroll_direct_lane(
  target_organization_id uuid, target_mailbox_id uuid,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
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
end $$;
revoke all on function public.autoenroll_direct_lane(uuid,uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.autoenroll_direct_lane(uuid,uuid,text,uuid,timestamptz,text) to anon,authenticated;

-- El despacho marca que el correo salio con pixel (para el denominador de apertura).
create or replace function public.mark_direct_lane_open_tracked(
  target_organization_id uuid, target_message_id uuid,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; updated integer;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','mark_direct_lane_open_tracked',target_organization_id::text,target_message_id::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  update public.messages set open_tracked=true, updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=target_message_id and lane='DIRECT' and direction='OUTBOUND';
  get diagnostics updated=row_count;
  return jsonb_build_object('status',case when updated>0 then 'MARKED' else 'IGNORED' end);
end $$;
revoke all on function public.mark_direct_lane_open_tracked(uuid,uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.mark_direct_lane_open_tracked(uuid,uuid,text,uuid,timestamptz,text) to anon,authenticated;

commit;
