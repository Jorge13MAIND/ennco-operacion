begin;

-- M041 carril directo: el motor envía desde los buzones que Teckel ya tiene,
-- sin KMS, sin broker PKCE con AAL2 y sin release híbrido.
--
-- Por qué existe. El carril híbrido (M029/M030/M032) sólo puede enviar desde
-- contacto@ennco.com.mx (literal en src/lib/gmail/outbound-client.ts y en la
-- ruta del cron), exige un sobre KMS que nunca existió porque el proyecto de
-- Google Cloud no tiene facturación, y ata cada envío a un release con 30
-- compuertas. Resultado verificado el 2-sep-2026: cero correos enviados.
--
-- Qué conserva. Las mismas tablas (mailboxes, campaigns, sequence_*,
-- campaign_enrollments, messages, provider_events) y los candados que sí
-- importan para el contrato: supresión (Anexo A, baja, rebote, DNC), kill
-- switch global, autorización externa, texto plano ≤100 palabras, sin ligas
-- en el toque 1, tope diario por buzón, y el rastro de evidencia (audit log,
-- atribución automática del primer contacto, respuestas enlazadas).
--
-- Qué NO exige. Ni release híbrido, ni lote de primer envío, ni canary, ni
-- watchdog fresco, ni cadencia, ni 42 días de warmup: el calentamiento lo
-- ejecuta SmartLead fuera de la plataforma (decisión de Grant, 2-sep-2026).
-- Los cuatro triggers que imponían eso sobre public.messages reciben un
-- bypass explícito cuando lane = 'DIRECT'; el carril tiene su propio trigger.
--
-- Credenciales. El refresh token se cifra con AES-256-GCM y una llave de
-- aplicación que vive sólo en Vercel (ENNCO_DIRECT_LANE_VAULT_KEY). La base
-- guarda ciphertext, id de llave y hash; nunca el secreto. Lectura sólo por
-- RPC con prueba HMAC (misma app.verify_dispatch_proof de M032).
--
-- Consentimiento. Por invitación: el operador genera una liga firmada, quien
-- posee el buzón la abre (Grant/Jorge para los propios, Paco para el suyo) y
-- autoriza en Google. El callback no exige sesión del Control Room: exige el
-- estado armado, la cookie sellada y que la identidad de Google sea EXACTAMENTE
-- el buzón invitado.

-- ---------------------------------------------------------------------------
-- A. messages: carril, hilo y copia
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists lane text not null default 'HYBRID',
  add column if not exists provider_thread_id text,
  add column if not exists rfc_message_id text,
  add column if not exists cc_emails text[] not null default '{}',
  add column if not exists reply_to_provider_event_id uuid references public.provider_events(id);
alter table public.messages drop constraint if exists messages_lane_check;
alter table public.messages add constraint messages_lane_check check (lane in ('HYBRID','DIRECT'));
-- Un check no admite subconsultas: la validación de la copia vive en una
-- función inmutable (máximo 5 direcciones, todas en minúsculas).
create or replace function app.direct_lane_cc_emails_valid(target_emails text[])
returns boolean language sql immutable set search_path=pg_catalog as $$
  select coalesce(cardinality(target_emails),0) <= 5
    and coalesce((select bool_and(x = lower(x) and x ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') from unnest(target_emails) x), true)
$$;
alter table public.messages drop constraint if exists messages_cc_emails_lower_check;
alter table public.messages add constraint messages_cc_emails_lower_check check (app.direct_lane_cc_emails_valid(cc_emails));
create index if not exists messages_direct_lane_outbound_idx
  on public.messages (organization_id, mailbox_id, status, created_at)
  where lane = 'DIRECT' and direction = 'OUTBOUND';

-- ---------------------------------------------------------------------------
-- B. campaigns: carril y estado propio (no se toca el candado del canary)
-- ---------------------------------------------------------------------------
alter table public.campaigns
  add column if not exists lane text not null default 'HYBRID',
  add column if not exists direct_lane_state text not null default 'NOT_APPLICABLE';
alter table public.campaigns drop constraint if exists campaigns_lane_check;
alter table public.campaigns add constraint campaigns_lane_check check (lane in ('HYBRID','DIRECT'));
alter table public.campaigns drop constraint if exists campaigns_direct_lane_state_check;
alter table public.campaigns add constraint campaigns_direct_lane_state_check check (
  direct_lane_state in ('NOT_APPLICABLE','DRAFT','RUNNING','PAUSED','COMPLETED')
  and ((lane = 'DIRECT') = (direct_lane_state <> 'NOT_APPLICABLE'))
);

-- ---------------------------------------------------------------------------
-- C. mailboxes: estado del carril y tope diario
-- ---------------------------------------------------------------------------
alter table public.mailboxes
  add column if not exists direct_lane_status text not null default 'DISCONNECTED',
  add column if not exists direct_lane_ramp_mode text not null default 'AUTO',
  add column if not exists direct_lane_fixed_cap integer not null default 5,
  add column if not exists direct_lane_cap_max integer not null default 40,
  add column if not exists direct_lane_first_send_at timestamptz,
  add column if not exists direct_lane_display_name text;
alter table public.mailboxes drop constraint if exists mailboxes_direct_lane_status_check;
alter table public.mailboxes add constraint mailboxes_direct_lane_status_check check (
  direct_lane_status in ('DISCONNECTED','CONNECTED','PAUSED','KILLED'));
alter table public.mailboxes drop constraint if exists mailboxes_direct_lane_ramp_check;
alter table public.mailboxes add constraint mailboxes_direct_lane_ramp_check check (
  direct_lane_ramp_mode in ('AUTO','FIXED')
  and direct_lane_fixed_cap between 0 and 100
  and direct_lane_cap_max between 0 and 100);

-- El buzón del cliente (dominio principal de su empresa) nunca pasa de 20/día:
-- el riesgo de pasarse no es perder una campaña, es quemar el correo real de
-- ENNCO. Se fija aquí para que ningún operador tenga que acordarse.
update public.mailboxes set direct_lane_cap_max = 20
where eligibility_route = 'EXISTING_PRIMARY_GMAIL_RAMP' and direct_lane_cap_max > 20;

-- ---------------------------------------------------------------------------
-- D. Tablas del carril
-- ---------------------------------------------------------------------------
create table if not exists public.direct_lane_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  normalized_email text not null check (normalized_email = lower(normalized_email)),
  ciphertext text not null check (length(ciphertext) between 40 and 65536),
  key_id text not null check (key_id ~ '^app-aes256gcm:v[0-9]+:[a-f0-9]{16}$'),
  credential_sha256 text not null check (credential_sha256 ~ '^[a-f0-9]{64}$'),
  google_subject_sha256 text not null check (google_subject_sha256 ~ '^[a-f0-9]{64}$'),
  granted_scopes text[] not null,
  token_issued_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
  revoked_reason text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, mailbox_id) references public.mailboxes (organization_id, id) on delete cascade
);
create unique index if not exists direct_lane_credentials_active_unique
  on public.direct_lane_credentials (organization_id, mailbox_id) where status = 'ACTIVE';

create table if not exists public.direct_lane_authorizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  invitation_token_sha256 text not null check (invitation_token_sha256 ~ '^[a-f0-9]{64}$'),
  state_sha256 text check (state_sha256 is null or state_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'PENDING' check (status in ('PENDING','ARMED','CONSUMED','EXPIRED','REVOKED')),
  expires_at timestamptz not null,
  armed_at timestamptz,
  consumed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, invitation_token_sha256),
  foreign key (organization_id, mailbox_id) references public.mailboxes (organization_id, id) on delete cascade
);
create unique index if not exists direct_lane_authorizations_state_unique
  on public.direct_lane_authorizations (organization_id, state_sha256) where state_sha256 is not null;

create table if not exists public.direct_lane_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  command_type text not null,
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb not null,
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table if not exists public.direct_lane_ticks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid,
  message_id uuid,
  tick_kind text not null check (tick_kind in ('CLAIM','SETTLE','SYNC','AUTH','HEALTH')),
  outcome text not null check (outcome ~ '^[A-Z0-9_]{2,64}$'),
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists direct_lane_ticks_recent_idx on public.direct_lane_ticks (organization_id, created_at desc);

alter table public.direct_lane_credentials enable row level security;
alter table public.direct_lane_credentials force row level security;
alter table public.direct_lane_authorizations enable row level security;
alter table public.direct_lane_authorizations force row level security;
alter table public.direct_lane_commands enable row level security;
alter table public.direct_lane_commands force row level security;
alter table public.direct_lane_ticks enable row level security;
alter table public.direct_lane_ticks force row level security;
revoke all on table public.direct_lane_credentials, public.direct_lane_authorizations, public.direct_lane_commands
  from public, anon, authenticated, service_role;
revoke all on table public.direct_lane_ticks from public, anon, authenticated, service_role;
drop policy if exists direct_lane_ticks_member_read on public.direct_lane_ticks;
create policy direct_lane_ticks_member_read on public.direct_lane_ticks for select using (app.is_member(organization_id));
grant select on table public.direct_lane_ticks to authenticated;

-- ---------------------------------------------------------------------------
-- E. Helpers internos (owner-only)
-- ---------------------------------------------------------------------------
create or replace function app.direct_lane_assert_operator(target_organization_id uuid)
returns uuid language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not app.has_role(target_organization_id,
    array['teckel_admin','teckel_operator','ennco_admin']::public.user_role[]) then
    raise exception 'DIRECT_LANE_OPERATOR_REQUIRED';
  end if;
  return actor;
end $$;

create or replace function app.direct_lane_command_replay(
  target_organization_id uuid, target_idempotency_key text, target_request_sha256 text)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare existing public.direct_lane_commands%rowtype;
begin
  if target_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'DIRECT_LANE_IDEMPOTENCY_KEY_INVALID'; end if;
  select * into existing from public.direct_lane_commands
  where organization_id=target_organization_id and idempotency_key=target_idempotency_key;
  if not found then return null; end if;
  if existing.request_sha256<>target_request_sha256 then raise exception 'DIRECT_LANE_IDEMPOTENCY_KEY_REUSE_MISMATCH'; end if;
  return existing.response_json || jsonb_build_object('replayed',true);
end $$;

create or replace function app.direct_lane_command_record(
  target_organization_id uuid, target_command_type text, target_idempotency_key text,
  target_request_sha256 text, target_response jsonb, target_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
begin
  insert into public.direct_lane_commands(organization_id,command_type,idempotency_key,request_sha256,response_json,actor_user_id)
  values (target_organization_id,target_command_type,target_idempotency_key,target_request_sha256,target_response,target_actor);
  return target_response || jsonb_build_object('replayed',false);
end $$;

create or replace function app.direct_lane_tick(
  target_organization_id uuid, target_mailbox_id uuid, target_message_id uuid,
  target_kind text, target_outcome text, target_detail jsonb)
returns void language sql security definer set search_path=public,app,pg_temp as $$
  insert into public.direct_lane_ticks(organization_id,mailbox_id,message_id,tick_kind,outcome,detail_json)
  values (target_organization_id,target_mailbox_id,target_message_id,target_kind,target_outcome,coalesce(target_detail,'{}'::jsonb));
$$;

create or replace function app.direct_lane_noop(
  target_organization_id uuid, target_mailbox_id uuid, target_reason text, target_detail jsonb)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
begin
  perform app.direct_lane_tick(target_organization_id,target_mailbox_id,null,'CLAIM',target_reason,target_detail);
  return jsonb_strip_nulls(jsonb_build_object('status','NOOP','reason',target_reason,'mailbox_id',target_mailbox_id,'detail',target_detail));
end $$;

-- Rampa por buzón. AUTO sigue la instrucción de Jorge (5 → 10 → 20 → 40) por
-- semanas desde el primer envío real del buzón; FIXED usa el valor que el
-- operador fijó. En ambos casos manda direct_lane_cap_max como techo.
create or replace function app.direct_lane_effective_cap(target_mailbox public.mailboxes)
returns integer language plpgsql immutable set search_path=pg_catalog as $$
declare days_since integer; ramp integer;
begin
  if target_mailbox.direct_lane_ramp_mode='FIXED' then
    return least(target_mailbox.direct_lane_fixed_cap,target_mailbox.direct_lane_cap_max);
  end if;
  if target_mailbox.direct_lane_first_send_at is null then
    return least(5,target_mailbox.direct_lane_cap_max);
  end if;
  days_since := floor(extract(epoch from (clock_timestamp()-target_mailbox.direct_lane_first_send_at))/86400)::integer;
  ramp := case when days_since<7 then 5 when days_since<14 then 10 when days_since<21 then 20 else 40 end;
  return least(ramp,target_mailbox.direct_lane_cap_max);
end $$;

create or replace function app.direct_lane_sent_today(target_organization_id uuid, target_mailbox_id uuid)
returns integer language sql stable security definer set search_path=public,pg_temp as $$
  select count(*)::integer from public.messages m
  where m.organization_id=target_organization_id and m.mailbox_id=target_mailbox_id
    and m.lane='DIRECT' and m.direction='OUTBOUND'
    and m.status in ('QUEUED','SENDING','SENT','DELIVERED')
    and (m.created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date
$$;

-- Espejo exacto de src/lib/correos/roles.ts. Seguridad antes que mantenimiento
-- a propósito: "seguridad, higiene y mantenimiento" responde al miedo del acta.
create or replace function app.direct_lane_variant_for_role(target_role text)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare role_value text := lower(coalesce(target_role,''));
begin
  if role_value ~ '(compras|comprador|purchas|procurement|buyer|sourcing|abastecimiento|adquisicion|supply chain|suministro)' then return 'COMPRAS'; end if;
  if role_value ~ '(seguridad|higiene|\mehs\M|\mhse\M|\msafety\M|medio ambiente|environment)' then return 'SEGURIDAD'; end if;
  if role_value ~ '(manten|maintenance|planta|plant|ingenier|engineer|facilit|operaci|production|producci|electric|el[eé]ctric)' then return 'MANTENIMIENTO'; end if;
  return 'DIRECCION';
end $$;

create or replace function app.direct_lane_render(target_template text, target_full_name text, target_company text)
returns text language sql immutable set search_path=pg_catalog as $$
  select replace(replace(coalesce(target_template,''),
    '{{first_name}}', coalesce(nullif(split_part(btrim(coalesce(target_full_name,'')),' ',1),''),'hola')),
    '{{company}}', coalesce(nullif(btrim(target_company),''),'su planta'))
$$;

create or replace function app.direct_lane_mailbox_json(target_mailbox public.mailboxes)
returns jsonb language sql stable security definer set search_path=public,app,pg_temp as $$
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
$$;

create or replace function app.direct_lane_health_as_system(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare controls_record public.runtime_controls%rowtype; result jsonb;
begin
  select * into controls_record from public.runtime_controls where organization_id=target_organization_id;
  select jsonb_build_object(
    'mailboxes',coalesce((select jsonb_agg(app.direct_lane_mailbox_json(m) order by m.normalized_email) from public.mailboxes m
      where m.organization_id=target_organization_id and m.provider='gmail'),'[]'::jsonb),
    'totals',jsonb_build_object(
      'sent_today',(select count(*) from public.messages m where m.organization_id=target_organization_id and m.lane='DIRECT'
        and m.direction='OUTBOUND' and m.status in ('SENT','DELIVERED')
        and (m.created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date),
      'shadow_today',(select count(*) from public.messages m where m.organization_id=target_organization_id and m.lane='DIRECT'
        and m.direction='OUTBOUND' and m.status='DRY_RUN'
        and (m.created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date),
      'queued',(select count(*) from public.messages m where m.organization_id=target_organization_id and m.lane='DIRECT'
        and m.direction='OUTBOUND' and m.status in ('QUEUED','SENDING')),
      'failed_today',(select count(*) from public.messages m where m.organization_id=target_organization_id and m.lane='DIRECT'
        and m.direction='OUTBOUND' and m.status='FAILED'
        and (m.created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date),
      'sent_total',(select count(*) from public.messages m where m.organization_id=target_organization_id and m.lane='DIRECT'
        and m.direction='OUTBOUND' and m.status in ('SENT','DELIVERED')),
      'replies_unreviewed',(select count(*) from public.provider_events e where e.organization_id=target_organization_id
        and e.event_kind='REPLY' and e.reply_classification='UNREVIEWED'),
      'due_now',(select count(*) from public.campaign_enrollments ce join public.campaigns c on c.organization_id=ce.organization_id and c.id=ce.campaign_id
        where ce.organization_id=target_organization_id and c.lane='DIRECT' and c.direct_lane_state='RUNNING'
          and ce.status in ('PENDING','ACTIVE') and coalesce(ce.next_touch_at,clock_timestamp())<=clock_timestamp())),
    'flags',jsonb_build_object(
      'global_kill_switch',coalesce(controls_record.global_kill_switch,true),
      'external_send_allowed',coalesce(controls_record.external_send_allowed,false),
      'annex_a_ready',app.annex_a_manifest_is_ready(target_organization_id),
      'send_window_open',app.hybrid_dispatch_window_is_open(clock_timestamp()),
      'running_campaigns',(select count(*) from public.campaigns c where c.organization_id=target_organization_id and c.lane='DIRECT' and c.direct_lane_state='RUNNING')),
    'last_tick',(select jsonb_build_object('tick_kind',t.tick_kind,'outcome',t.outcome,'created_at',t.created_at,'mailbox_id',t.mailbox_id)
      from public.direct_lane_ticks t where t.organization_id=target_organization_id order by t.created_at desc limit 1)
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- F. Trigger propio del carril sobre public.messages
-- ---------------------------------------------------------------------------
create or replace function app.enforce_direct_lane_release()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
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
    if word_count>100 then raise exception 'DIRECT_LANE_WORD_LIMIT_EXCEEDED'; end if;
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
end $$;

drop trigger if exists messages_aaa_m041_direct_lane on public.messages;
create trigger messages_aaa_m041_direct_lane
before insert or update of status, direction, lane, mailbox_id on public.messages
for each row execute function app.enforce_direct_lane_release();

-- ---------------------------------------------------------------------------
-- G. Bypass explícito en los cuatro triggers del carril híbrido
-- ---------------------------------------------------------------------------
-- Mismo patrón que M035/M040: se parchea la definición VIVA y la migración
-- falla si el ancla no aparece, en lugar de dejar un trigger a medias.
do $patch$
declare fn text; def text; patched text;
begin
  foreach fn in array array['enforce_hybrid_outbound_release','enforce_scaled_outbound_release',
    'enforce_operations_send_health','enforce_control_cadence_send_health'] loop
    select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname=fn and p.pronargs=0;
    if def is null then raise exception 'M041_TRIGGER_FUNCTION_NOT_FOUND: %', fn; end if;
    if position('M041 direct lane bypass' in def)>0 then continue; end if;
    patched := regexp_replace(def, E'\nbegin\n',
      E'\nbegin\n  if new.lane = ''DIRECT'' then return new; end if; -- M041 direct lane bypass\n');
    if patched=def then raise exception 'M041_TRIGGER_PATTERN_NOT_FOUND: %', fn; end if;
    execute patched;
  end loop;
end
$patch$;

-- El informe de salud del motor expone el carril directo (mismo parche
-- textual que M040, sobre el ancla que M040 dejó intacta).
do $health$
declare def text; patched text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='read_dispatch_health';
  if def is null then raise exception 'M041_HEALTH_FUNCTION_NOT_FOUND'; end if;
  if position('direct_lane' in def)>0 then return; end if;
  patched := replace(def,
    '''send_window_open'',app.hybrid_dispatch_window_is_open(clock_timestamp())',
    '''send_window_open'',app.hybrid_dispatch_window_is_open(clock_timestamp()),''direct_lane'',app.direct_lane_health_as_system(target_organization_id)');
  if patched=def then raise exception 'M041_HEALTH_PATTERN_NOT_FOUND'; end if;
  execute patched;
end
$health$;

-- ---------------------------------------------------------------------------
-- H. RPCs de sesión (operador del Control Room)
-- ---------------------------------------------------------------------------
create or replace function public.create_direct_lane_invitation(
  target_organization_id uuid, target_mailbox_id uuid, target_token_sha256 text,
  target_expires_at timestamptz, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; request_sha text; replay jsonb; mailbox_record public.mailboxes%rowtype; auth_id uuid; response jsonb;
begin
  actor := app.direct_lane_assert_operator(target_organization_id);
  request_sha := encode(digest(convert_to(concat_ws(E'\n','create_direct_lane_invitation',target_organization_id::text,
    target_mailbox_id::text,target_token_sha256,target_expires_at::text),'utf8'),'sha256'),'hex');
  replay := app.direct_lane_command_replay(target_organization_id,target_idempotency_key,request_sha);
  if replay is not null then return replay; end if;
  if target_token_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'DIRECT_LANE_INVITATION_TOKEN_INVALID'; end if;
  if target_expires_at<=clock_timestamp() or target_expires_at>clock_timestamp()+interval '14 days' then
    raise exception 'DIRECT_LANE_INVITATION_EXPIRY_INVALID';
  end if;
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id and provider='gmail';
  if not found then raise exception 'DIRECT_LANE_MAILBOX_NOT_FOUND'; end if;
  if mailbox_record.direct_lane_status='KILLED' then raise exception 'DIRECT_LANE_MAILBOX_KILLED'; end if;
  update public.direct_lane_authorizations set status='EXPIRED'
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id and status in ('PENDING','ARMED');
  insert into public.direct_lane_authorizations(organization_id,mailbox_id,invitation_token_sha256,expires_at,created_by)
  values (target_organization_id,target_mailbox_id,target_token_sha256,target_expires_at,actor)
  returning id into auth_id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,'DIRECT_LANE_INVITATION_CREATED','mailboxes',target_mailbox_id,
    jsonb_build_object('authorization_id',auth_id,'expires_at',target_expires_at));
  perform app.direct_lane_tick(target_organization_id,target_mailbox_id,null,'AUTH','INVITATION_CREATED',jsonb_build_object('authorization_id',auth_id));
  response := jsonb_build_object('status','CREATED','invitation_id',auth_id,'mailbox_id',target_mailbox_id,
    'normalized_email',mailbox_record.normalized_email,'expires_at',target_expires_at);
  return app.direct_lane_command_record(target_organization_id,'CREATE_INVITATION',target_idempotency_key,request_sha,response,actor);
end $$;

create or replace function public.revoke_direct_lane_credential(
  target_organization_id uuid, target_mailbox_id uuid, target_reason text, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; request_sha text; replay jsonb; revoked integer; response jsonb;
begin
  actor := app.direct_lane_assert_operator(target_organization_id);
  request_sha := encode(digest(convert_to(concat_ws(E'\n','revoke_direct_lane_credential',target_organization_id::text,
    target_mailbox_id::text,coalesce(target_reason,'')),'utf8'),'sha256'),'hex');
  replay := app.direct_lane_command_replay(target_organization_id,target_idempotency_key,request_sha);
  if replay is not null then return replay; end if;
  if length(btrim(coalesce(target_reason,'')))<3 then raise exception 'DIRECT_LANE_REASON_REQUIRED'; end if;
  update public.direct_lane_credentials set status='REVOKED',revoked_reason=btrim(target_reason),revoked_at=clock_timestamp()
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id and status='ACTIVE';
  get diagnostics revoked=row_count;
  update public.mailboxes set direct_lane_status='DISCONNECTED',credential_status='REVOKED',updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=target_mailbox_id;
  update public.direct_lane_authorizations set status='REVOKED'
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id and status in ('PENDING','ARMED');
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,'DIRECT_LANE_CREDENTIAL_REVOKED','mailboxes',target_mailbox_id,
    jsonb_build_object('revoked',revoked,'reason',btrim(target_reason)));
  perform app.direct_lane_tick(target_organization_id,target_mailbox_id,null,'AUTH','CREDENTIAL_REVOKED',jsonb_build_object('revoked',revoked));
  response := jsonb_build_object('status','REVOKED','mailbox_id',target_mailbox_id,'revoked',revoked);
  return app.direct_lane_command_record(target_organization_id,'REVOKE_CREDENTIAL',target_idempotency_key,request_sha,response,actor);
end $$;

create or replace function public.configure_direct_lane_mailbox(
  target_organization_id uuid, target_mailbox_id uuid, target_patch jsonb, target_reason text, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; request_sha text; replay jsonb; mailbox_record public.mailboxes%rowtype; new_status text; response jsonb;
begin
  actor := app.direct_lane_assert_operator(target_organization_id);
  request_sha := encode(digest(convert_to(concat_ws(E'\n','configure_direct_lane_mailbox',target_organization_id::text,
    target_mailbox_id::text,coalesce(target_patch::text,''),coalesce(target_reason,'')),'utf8'),'sha256'),'hex');
  replay := app.direct_lane_command_replay(target_organization_id,target_idempotency_key,request_sha);
  if replay is not null then return replay; end if;
  if length(btrim(coalesce(target_reason,'')))<3 then raise exception 'DIRECT_LANE_REASON_REQUIRED'; end if;
  if target_patch is null or jsonb_typeof(target_patch)<>'object' then raise exception 'DIRECT_LANE_PATCH_INVALID'; end if;
  if exists (select 1 from jsonb_object_keys(target_patch) k where k not in ('status','ramp_mode','fixed_cap','cap_max','display_name')) then
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
  if mailbox_record.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP'
    and coalesce((target_patch->>'cap_max')::integer,mailbox_record.direct_lane_cap_max)>20 then
    raise exception 'DIRECT_LANE_CLIENT_MAILBOX_CAP_LIMIT';
  end if;
  update public.mailboxes set
    direct_lane_status=new_status,
    direct_lane_ramp_mode=coalesce(target_patch->>'ramp_mode',direct_lane_ramp_mode),
    direct_lane_fixed_cap=coalesce((target_patch->>'fixed_cap')::integer,direct_lane_fixed_cap),
    direct_lane_cap_max=coalesce((target_patch->>'cap_max')::integer,direct_lane_cap_max),
    direct_lane_display_name=coalesce(nullif(btrim(target_patch->>'display_name'),''),direct_lane_display_name),
    updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=target_mailbox_id
  returning * into mailbox_record;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,'DIRECT_LANE_MAILBOX_CONFIGURED','mailboxes',target_mailbox_id,
    jsonb_build_object('patch',target_patch,'reason',btrim(target_reason)));
  response := jsonb_build_object('status','CONFIGURED','mailbox',app.direct_lane_mailbox_json(mailbox_record));
  return app.direct_lane_command_record(target_organization_id,'CONFIGURE_MAILBOX',target_idempotency_key,request_sha,response,actor);
end $$;

create or replace function public.create_direct_lane_campaign(
  target_organization_id uuid, target_name text, target_cc_on_reply_email text,
  target_sequence jsonb, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; request_sha text; replay jsonb; manifest jsonb; manifest_sha text; campaign_id uuid;
  variant jsonb; touch jsonb; version_id uuid; variant_index integer := 0; response jsonb;
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
    if jsonb_array_length(variant->'touches')<>8 then raise exception 'DIRECT_LANE_VARIANT_TOUCHES_INVALID'; end if;
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
    jsonb_build_object('manifest_sha256',manifest_sha,'variants',4));
  response := jsonb_build_object('status','CREATED','campaign_id',campaign_id,'manifest_sha256',manifest_sha);
  return app.direct_lane_command_record(target_organization_id,'CREATE_CAMPAIGN',target_idempotency_key,request_sha,response,actor);
end $$;

create or replace function public.approve_direct_lane_campaign(
  target_organization_id uuid, target_campaign_id uuid, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; request_sha text; replay jsonb; campaign_record public.campaigns%rowtype; response jsonb;
begin
  actor := app.direct_lane_assert_operator(target_organization_id);
  -- Sustituye la aprobación del cliente (DEC-108): sólo teckel_admin.
  if not app.has_role(target_organization_id,array['teckel_admin']::public.user_role[]) then
    raise exception 'DIRECT_LANE_APPROVAL_REQUIRES_ADMIN';
  end if;
  request_sha := encode(digest(convert_to(concat_ws(E'\n','approve_direct_lane_campaign',target_organization_id::text,target_campaign_id::text),'utf8'),'sha256'),'hex');
  replay := app.direct_lane_command_replay(target_organization_id,target_idempotency_key,request_sha);
  if replay is not null then return replay; end if;
  select * into campaign_record from public.campaigns where organization_id=target_organization_id and id=target_campaign_id and lane='DIRECT' for update;
  if not found then raise exception 'DIRECT_LANE_CAMPAIGN_NOT_FOUND'; end if;
  if campaign_record.direct_lane_state<>'DRAFT' then raise exception 'DIRECT_LANE_CAMPAIGN_NOT_DRAFT'; end if;
  update public.campaigns set status='APPROVED',direct_lane_state='RUNNING',approved_by=actor,approved_at=clock_timestamp(),
    suppression_snapshot_at=clock_timestamp(),updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=target_campaign_id;
  update public.sequence_versions set approved_by=actor,approved_at=clock_timestamp()
  where organization_id=target_organization_id and campaign_id=target_campaign_id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,'DIRECT_LANE_CAMPAIGN_APPROVED','campaigns',target_campaign_id,
    jsonb_build_object('manifest_sha256',campaign_record.manifest_sha256));
  response := jsonb_build_object('status','RUNNING','campaign_id',target_campaign_id);
  return app.direct_lane_command_record(target_organization_id,'APPROVE_CAMPAIGN',target_idempotency_key,request_sha,response,actor);
end $$;

create or replace function public.set_direct_lane_campaign_state(
  target_organization_id uuid, target_campaign_id uuid, target_state text, target_reason text, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; request_sha text; replay jsonb; campaign_record public.campaigns%rowtype; response jsonb;
begin
  actor := app.direct_lane_assert_operator(target_organization_id);
  request_sha := encode(digest(convert_to(concat_ws(E'\n','set_direct_lane_campaign_state',target_organization_id::text,
    target_campaign_id::text,coalesce(target_state,''),coalesce(target_reason,'')),'utf8'),'sha256'),'hex');
  replay := app.direct_lane_command_replay(target_organization_id,target_idempotency_key,request_sha);
  if replay is not null then return replay; end if;
  if target_state not in ('RUNNING','PAUSED','COMPLETED') then raise exception 'DIRECT_LANE_CAMPAIGN_STATE_INVALID'; end if;
  if length(btrim(coalesce(target_reason,'')))<3 then raise exception 'DIRECT_LANE_REASON_REQUIRED'; end if;
  select * into campaign_record from public.campaigns where organization_id=target_organization_id and id=target_campaign_id and lane='DIRECT' for update;
  if not found then raise exception 'DIRECT_LANE_CAMPAIGN_NOT_FOUND'; end if;
  if campaign_record.approved_at is null then raise exception 'DIRECT_LANE_CAMPAIGN_NOT_APPROVED'; end if;
  if campaign_record.direct_lane_state='COMPLETED' then raise exception 'DIRECT_LANE_CAMPAIGN_COMPLETED'; end if;
  update public.campaigns set direct_lane_state=target_state,
    status=case when target_state='PAUSED' then 'PAUSED'::public.campaign_status when target_state='COMPLETED' then 'COMPLETED'::public.campaign_status else 'APPROVED'::public.campaign_status end,
    updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=target_campaign_id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,'DIRECT_LANE_CAMPAIGN_STATE','campaigns',target_campaign_id,
    jsonb_build_object('from',campaign_record.direct_lane_state,'to',target_state,'reason',btrim(target_reason)));
  response := jsonb_build_object('status',target_state,'campaign_id',target_campaign_id);
  return app.direct_lane_command_record(target_organization_id,'CAMPAIGN_STATE',target_idempotency_key,request_sha,response,actor);
end $$;

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
  limit_value := least(greatest(coalesce(target_max_count,50),1),500);
  select * into campaign_record from public.campaigns where organization_id=target_organization_id and id=target_campaign_id and lane='DIRECT';
  if not found then raise exception 'DIRECT_LANE_CAMPAIGN_NOT_FOUND'; end if;
  if campaign_record.direct_lane_state not in ('DRAFT','RUNNING','PAUSED') then raise exception 'DIRECT_LANE_CAMPAIGN_COMPLETED'; end if;
  if target_mailbox_id is not null then
    if not exists (select 1 from public.mailboxes m where m.organization_id=target_organization_id and m.id=target_mailbox_id
      and m.direct_lane_status in ('CONNECTED','PAUSED')) then raise exception 'DIRECT_LANE_MAILBOX_NOT_CONNECTED'; end if;
    mailbox_ids := array[target_mailbox_id];
  else
    select array_agg(m.id order by m.normalized_email) into mailbox_ids from public.mailboxes m
    where m.organization_id=target_organization_id and m.direct_lane_status='CONNECTED'
      and m.eligibility_route<>'EXISTING_PRIMARY_GMAIL_RAMP';
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
  values (target_organization_id,actor,'DIRECT_LANE_CONTACTS_ENROLLED','campaigns',target_campaign_id,
    jsonb_build_object('enrolled',enrolled,'skipped_suppressed',skipped_suppressed,'skipped_unverified',skipped_unverified,
      'skipped_enrolled',skipped_enrolled,'by_variant',by_variant));
  response := jsonb_build_object('status','ENROLLED','campaign_id',target_campaign_id,'enrolled',enrolled,
    'skipped_suppressed',skipped_suppressed,'skipped_unverified',skipped_unverified,'skipped_enrolled',skipped_enrolled,
    'by_variant',by_variant,'by_mailbox',by_mailbox);
  return app.direct_lane_command_record(target_organization_id,'ENROLL_CONTACTS',target_idempotency_key,request_sha,response,actor);
end $$;

create or replace function public.enqueue_direct_lane_reply(
  target_organization_id uuid, target_provider_event_id uuid, target_body_text text, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; request_sha text; replay jsonb; event_record public.provider_events%rowtype;
  inbound_record public.messages%rowtype; outbound_record public.messages%rowtype; enrollment_record public.campaign_enrollments%rowtype;
  mailbox_record public.mailboxes%rowtype; contact_record public.contacts%rowtype; campaign_record public.campaigns%rowtype;
  cc_value text; subject_value text; message_id_value uuid; response jsonb;
begin
  actor := app.direct_lane_assert_operator(target_organization_id);
  request_sha := encode(digest(convert_to(concat_ws(E'\n','enqueue_direct_lane_reply',target_organization_id::text,
    target_provider_event_id::text,encode(digest(convert_to(coalesce(target_body_text,''),'utf8'),'sha256'),'hex')),'utf8'),'sha256'),'hex');
  replay := app.direct_lane_command_replay(target_organization_id,target_idempotency_key,request_sha);
  if replay is not null then return replay; end if;
  if length(btrim(coalesce(target_body_text,'')))<10 then raise exception 'DIRECT_LANE_REPLY_BODY_REQUIRED'; end if;
  select * into event_record from public.provider_events where organization_id=target_organization_id and id=target_provider_event_id and event_kind='REPLY';
  if not found then raise exception 'DIRECT_LANE_REPLY_EVENT_NOT_FOUND'; end if;
  select * into inbound_record from public.messages where organization_id=target_organization_id and id=event_record.message_id and direction='INBOUND';
  if not found then raise exception 'DIRECT_LANE_INBOUND_NOT_FOUND'; end if;
  select * into enrollment_record from public.campaign_enrollments where organization_id=target_organization_id and id=inbound_record.enrollment_id;
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=inbound_record.mailbox_id;
  select * into contact_record from public.contacts where organization_id=target_organization_id and id=enrollment_record.contact_id;
  select * into campaign_record from public.campaigns where organization_id=target_organization_id and id=enrollment_record.campaign_id;
  select * into outbound_record from public.messages
  where organization_id=target_organization_id and id=(event_record.payload_json->>'related_outbound_message_id')::uuid;
  cc_value := case when campaign_record.lane='DIRECT' then lower(campaign_record.manifest_json->>'cc_on_reply_email') else null end;
  subject_value := coalesce(nullif(btrim(inbound_record.subject),''),outbound_record.subject,'Seguimiento');
  if subject_value !~* '^re:' then subject_value := 'Re: '||subject_value; end if;
  insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,lane,touch_number,
    normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id,provider_thread_id,cc_emails,reply_to_provider_event_id)
  values (target_organization_id,enrollment_record.id,mailbox_record.id,contact_record.id,'OUTBOUND','QUEUED','DIRECT',null,
    contact_record.normalized_email,mailbox_record.normalized_email,left(subject_value,180),btrim(target_body_text),
    'direct-reply:'||target_idempotency_key,gen_random_uuid(),
    coalesce(inbound_record.provider_thread_id,outbound_record.provider_thread_id),
    case when cc_value is null then '{}'::text[] else array[cc_value] end,
    target_provider_event_id)
  returning id into message_id_value;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,'DIRECT_LANE_REPLY_QUEUED','messages',message_id_value,
    jsonb_build_object('provider_event_id',target_provider_event_id,'cc',cc_value,'body_sha256',encode(digest(convert_to(btrim(target_body_text),'utf8'),'sha256'),'hex')));
  response := jsonb_build_object('status','QUEUED','message_id',message_id_value,'mailbox_id',mailbox_record.id,'cc',cc_value);
  return app.direct_lane_command_record(target_organization_id,'ENQUEUE_REPLY',target_idempotency_key,request_sha,response,actor);
end $$;

create or replace function public.read_direct_lane_overview(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  select app.direct_lane_health_as_system(target_organization_id) || jsonb_build_object(
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object(
        'campaign_id',c.id,'name',c.name,'state',c.direct_lane_state,'approved_at',c.approved_at,'created_at',c.created_at,
        'manifest_sha256',c.manifest_sha256,'cc_on_reply_email',c.manifest_json->>'cc_on_reply_email',
        'enrollments',(select coalesce(jsonb_object_agg(s.status,s.n),'{}'::jsonb) from (
          select ce.status::text as status,count(*) as n from public.campaign_enrollments ce
          where ce.organization_id=c.organization_id and ce.campaign_id=c.id group by ce.status) s),
        'by_variant',(select coalesce(jsonb_object_agg(v.key,v.n),'{}'::jsonb) from (
          select mv->>'key' as key,count(ce.id) as n
          from jsonb_array_elements(c.manifest_json->'variants') mv
          left join public.sequence_versions sv on sv.organization_id=c.organization_id and sv.campaign_id=c.id and sv.version=(mv->>'version')::integer
          left join public.campaign_enrollments ce on ce.organization_id=c.organization_id and ce.sequence_version_id=sv.id
          group by mv->>'key') v)
      ) order by c.created_at desc)
      from public.campaigns c where c.organization_id=target_organization_id and c.lane='DIRECT'),'[]'::jsonb),
    'enrollable_contacts',(select count(*) from public.contacts ct join public.accounts a on a.organization_id=ct.organization_id and a.id=ct.account_id
      where ct.organization_id=target_organization_id and ct.verified and not ct.is_deleted and not a.is_deleted
        and not exists (select 1 from public.campaign_enrollments ce where ce.organization_id=ct.organization_id and ce.contact_id=ct.id and ce.status in ('PENDING','ACTIVE','PAUSED'))
        and not app.is_suppressed(ct.organization_id,a.id,ct.normalized_email,a.primary_domain)),
    'unverified_contacts',(select count(*) from public.contacts ct where ct.organization_id=target_organization_id and not ct.verified and not ct.is_deleted),
    'recent_messages',coalesce((select jsonb_agg(jsonb_build_object(
        'message_id',m.id,'direction',m.direction,'status',m.status,'touch_number',m.touch_number,'kind',case when m.direction='INBOUND' then 'INBOUND' when m.touch_number is null then 'REPLY' else 'TOUCH' end,
        'mailbox_email',mb.normalized_email,'counterparty',case when m.direction='INBOUND' then m.normalized_from else m.normalized_to end,
        'account',a.legal_name,'contact',ct.full_name,'subject',m.subject,'created_at',m.created_at,'sent_at',m.sent_at,'cc',m.cc_emails,
        'last_error',(select t.outcome from public.direct_lane_ticks t where t.organization_id=m.organization_id and t.message_id=m.id and t.tick_kind='SETTLE' order by t.created_at desc limit 1)
      ) order by m.created_at desc)
      from (select * from public.messages mm where mm.organization_id=target_organization_id and (mm.lane='DIRECT' or mm.direction='INBOUND')
        order by mm.created_at desc limit 60) m
      left join public.mailboxes mb on mb.organization_id=m.organization_id and mb.id=m.mailbox_id
      left join public.contacts ct on ct.organization_id=m.organization_id and ct.id=m.contact_id
      left join public.accounts a on a.organization_id=ct.organization_id and a.id=ct.account_id),'[]'::jsonb),
    'pending_replies',coalesce((select jsonb_agg(jsonb_build_object(
        'provider_event_id',e.id,'classification',e.reply_classification,'observed_at',e.observed_at,'message_id',e.message_id,
        'subject',m.subject,'body_text',left(coalesce(m.body_text,''),1200),'from_email',m.normalized_from,
        'mailbox_email',mb.normalized_email,'account',a.legal_name,'contact',ct.full_name,'role_title',ct.role_title,
        'already_answered',exists(select 1 from public.messages r where r.organization_id=e.organization_id and r.reply_to_provider_event_id=e.id and r.status not in ('FAILED','QUARANTINED'))
      ) order by e.observed_at desc)
      from (select * from public.provider_events ee where ee.organization_id=target_organization_id and ee.event_kind='REPLY' order by ee.observed_at desc limit 40) e
      join public.messages m on m.organization_id=e.organization_id and m.id=e.message_id
      left join public.mailboxes mb on mb.organization_id=m.organization_id and mb.id=m.mailbox_id
      left join public.contacts ct on ct.organization_id=m.organization_id and ct.id=m.contact_id
      left join public.accounts a on a.organization_id=ct.organization_id and a.id=ct.account_id),'[]'::jsonb),
    'upcoming',coalesce((select jsonb_agg(jsonb_build_object('day',d.day,'touches',d.n) order by d.day)
      from (select (ce.next_touch_at at time zone 'America/Mexico_City')::date as day,count(*) as n
        from public.campaign_enrollments ce join public.campaigns c on c.organization_id=ce.organization_id and c.id=ce.campaign_id
        where ce.organization_id=target_organization_id and c.lane='DIRECT' and ce.status in ('PENDING','ACTIVE') and ce.next_touch_at is not null
          and ce.next_touch_at<clock_timestamp()+interval '14 days'
        group by 1 order by 1 limit 14) d),'[]'::jsonb),
    'recent_ticks',coalesce((select jsonb_agg(jsonb_build_object('tick_kind',t.tick_kind,'outcome',t.outcome,'created_at',t.created_at,'mailbox_id',t.mailbox_id,'detail',t.detail_json) order by t.created_at desc)
      from (select * from public.direct_lane_ticks tt where tt.organization_id=target_organization_id order by tt.created_at desc limit 20) t),'[]'::jsonb)
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- I. RPCs del runtime (prueba HMAC, sin sesión)
-- ---------------------------------------------------------------------------
create or replace function public.read_direct_lane_invitation(
  target_organization_id uuid, target_token_sha256 text,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; auth_record public.direct_lane_authorizations%rowtype; mailbox_record public.mailboxes%rowtype;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','read_direct_lane_invitation',target_organization_id::text,coalesce(target_token_sha256,'')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  select * into auth_record from public.direct_lane_authorizations
  where organization_id=target_organization_id and invitation_token_sha256=target_token_sha256;
  if not found or auth_record.status not in ('PENDING','ARMED') or auth_record.expires_at<=clock_timestamp() then
    return jsonb_build_object('status','INVALID');
  end if;
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=auth_record.mailbox_id;
  return jsonb_build_object('status','VALID','invitation_id',auth_record.id,'mailbox_id',mailbox_record.id,
    'normalized_email',mailbox_record.normalized_email,'sender_name',coalesce(mailbox_record.direct_lane_display_name,mailbox_record.sender_name),
    'expires_at',auth_record.expires_at,'is_client_primary',mailbox_record.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP');
end $$;

create or replace function public.arm_direct_lane_authorization(
  target_organization_id uuid, target_token_sha256 text, target_state_sha256 text,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; auth_record public.direct_lane_authorizations%rowtype; mailbox_record public.mailboxes%rowtype;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','arm_direct_lane_authorization',target_organization_id::text,
    coalesce(target_token_sha256,''),coalesce(target_state_sha256,'')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  if target_state_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'DIRECT_LANE_STATE_INVALID'; end if;
  select * into auth_record from public.direct_lane_authorizations
  where organization_id=target_organization_id and invitation_token_sha256=target_token_sha256 for update;
  if not found or auth_record.status not in ('PENDING','ARMED') or auth_record.expires_at<=clock_timestamp() then
    raise exception 'DIRECT_LANE_INVITATION_INVALID';
  end if;
  update public.direct_lane_authorizations set status='ARMED',state_sha256=target_state_sha256,armed_at=clock_timestamp() where id=auth_record.id;
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=auth_record.mailbox_id;
  perform app.direct_lane_tick(target_organization_id,mailbox_record.id,null,'AUTH','ARMED',jsonb_build_object('authorization_id',auth_record.id));
  return jsonb_build_object('status','ARMED','authorization_id',auth_record.id,'mailbox_id',mailbox_record.id,'normalized_email',mailbox_record.normalized_email);
end $$;

create or replace function public.complete_direct_lane_authorization(
  target_organization_id uuid, target_state_sha256 text, target_normalized_email text, target_google_subject_sha256 text,
  target_ciphertext text, target_key_id text, target_credential_sha256 text, target_scopes text[], target_token_issued_at timestamptz,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; auth_record public.direct_lane_authorizations%rowtype; mailbox_record public.mailboxes%rowtype;
  existing public.direct_lane_credentials%rowtype; credential_id uuid;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','complete_direct_lane_authorization',target_organization_id::text,
    coalesce(target_state_sha256,''),coalesce(target_normalized_email,''),coalesce(target_google_subject_sha256,''),
    coalesce(target_credential_sha256,''),coalesce(target_key_id,'')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  select * into auth_record from public.direct_lane_authorizations
  where organization_id=target_organization_id and state_sha256=target_state_sha256 for update;
  if not found then raise exception 'DIRECT_LANE_AUTHORIZATION_NOT_FOUND'; end if;
  if auth_record.status='CONSUMED' then
    select * into existing from public.direct_lane_credentials
    where organization_id=target_organization_id and mailbox_id=auth_record.mailbox_id and credential_sha256=target_credential_sha256;
    if found then return jsonb_build_object('status','DUPLICATE','credential_id',existing.id,'mailbox_id',auth_record.mailbox_id); end if;
    raise exception 'DIRECT_LANE_AUTHORIZATION_CONSUMED';
  end if;
  if auth_record.status<>'ARMED' or auth_record.expires_at<=clock_timestamp() then raise exception 'DIRECT_LANE_AUTHORIZATION_NOT_ARMED'; end if;
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=auth_record.mailbox_id for update;
  if lower(coalesce(target_normalized_email,''))<>mailbox_record.normalized_email then raise exception 'DIRECT_LANE_IDENTITY_MISMATCH'; end if;
  if target_scopes is null or not (target_scopes @> array['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly']) then
    raise exception 'DIRECT_LANE_SCOPES_INCOMPLETE';
  end if;
  update public.direct_lane_credentials set status='REVOKED',revoked_reason='REPLACED_BY_NEW_CONSENT',revoked_at=clock_timestamp()
  where organization_id=target_organization_id and mailbox_id=mailbox_record.id and status='ACTIVE';
  insert into public.direct_lane_credentials(organization_id,mailbox_id,normalized_email,ciphertext,key_id,credential_sha256,
    google_subject_sha256,granted_scopes,token_issued_at)
  values (target_organization_id,mailbox_record.id,mailbox_record.normalized_email,target_ciphertext,target_key_id,target_credential_sha256,
    target_google_subject_sha256,target_scopes,coalesce(target_token_issued_at,clock_timestamp()))
  returning id into credential_id;
  update public.direct_lane_authorizations set status='CONSUMED',consumed_at=clock_timestamp() where id=auth_record.id;
  update public.mailboxes set direct_lane_status=case when direct_lane_status='KILLED' then 'KILLED' else 'CONNECTED' end,
    credential_status='OAUTH_CONNECTED',updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=mailbox_record.id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,auth_record.created_by,'DIRECT_LANE_MAILBOX_CONNECTED','mailboxes',mailbox_record.id,
    jsonb_build_object('credential_id',credential_id,'credential_sha256',target_credential_sha256,'key_id',target_key_id,'scope_count',cardinality(target_scopes)));
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values (target_organization_id,'mailbox',mailbox_record.id,'direct_lane.mailbox_connected','direct-lane-connected:'||credential_id::text,
    jsonb_build_object('mailbox_id',mailbox_record.id,'credential_sha256',target_credential_sha256))
  on conflict (organization_id,idempotency_key) do nothing;
  perform app.direct_lane_tick(target_organization_id,mailbox_record.id,null,'AUTH','CONNECTED',jsonb_build_object('credential_id',credential_id));
  return jsonb_build_object('status','CONNECTED','credential_id',credential_id,'mailbox_id',mailbox_record.id,'normalized_email',mailbox_record.normalized_email);
end $$;

create or replace function public.read_direct_lane_credential(
  target_organization_id uuid, target_mailbox_id uuid,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; credential public.direct_lane_credentials%rowtype; mailbox_record public.mailboxes%rowtype;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','read_direct_lane_credential',target_organization_id::text,target_mailbox_id::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id;
  if not found or mailbox_record.direct_lane_status not in ('CONNECTED','PAUSED') then raise exception 'DIRECT_LANE_MAILBOX_NOT_CONNECTED'; end if;
  select * into credential from public.direct_lane_credentials
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id and status='ACTIVE';
  if not found then raise exception 'DIRECT_LANE_CREDENTIAL_MISSING'; end if;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,null,'DIRECT_LANE_CREDENTIAL_READ','mailboxes',target_mailbox_id,
    jsonb_build_object('credential_sha256',credential.credential_sha256));
  return jsonb_build_object('ciphertext',credential.ciphertext,'key_id',credential.key_id,'credential_sha256',credential.credential_sha256,
    'normalized_email',credential.normalized_email,'granted_scopes',to_jsonb(credential.granted_scopes));
end $$;

create or replace function public.read_direct_lane_health(
  target_organization_id uuid, proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','read_direct_lane_health',target_organization_id::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  return app.direct_lane_health_as_system(target_organization_id);
end $$;

create or replace function public.claim_direct_lane_dispatch(
  target_organization_id uuid, target_mailbox_id uuid, dry_run boolean,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; mailbox_record public.mailboxes%rowtype; controls_record public.runtime_controls%rowtype;
  cap integer; sent_count integer; last_outbound_at timestamptz; pace_seconds integer; stuck integer;
  reply_record public.messages%rowtype; inbound_record public.messages%rowtype; candidate record; previous_message public.messages%rowtype;
  message_id_value uuid; correlation_value uuid := gen_random_uuid(); attempt_value integer; idempotency_value text;
  thread_json jsonb; rendered_subject text; rendered_body text; unsubscribe_enrollment uuid;
begin
  if dry_run is null then raise exception 'DIRECT_LANE_CLAIM_INPUT_INVALID'; end if;
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','claim_direct_lane_dispatch',target_organization_id::text,
    target_mailbox_id::text,dry_run::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  perform pg_advisory_xact_lock(hashtextextended('direct-lane:'||target_mailbox_id::text,0));

  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id;
  if not found then return app.direct_lane_noop(target_organization_id,target_mailbox_id,'MAILBOX_NOT_FOUND',null); end if;
  if mailbox_record.direct_lane_status<>'CONNECTED' or not exists (select 1 from public.direct_lane_credentials c
    where c.organization_id=target_organization_id and c.mailbox_id=target_mailbox_id and c.status='ACTIVE') then
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'MAILBOX_NOT_CONNECTED',jsonb_build_object('status',mailbox_record.direct_lane_status));
  end if;

  -- Un SENDING de más de 15 minutos es un envío que murió a medias: sale del
  -- limbo como FAILED para que el siguiente intento pueda ocurrir (lección de
  -- los 2,522 incidentes: nada se queda pendiente para siempre).
  update public.messages set status='FAILED',updated_at=clock_timestamp()
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id and lane='DIRECT'
    and direction='OUTBOUND' and status='SENDING' and updated_at<clock_timestamp()-interval '15 minutes';
  get diagnostics stuck=row_count;
  if stuck>0 then perform app.direct_lane_tick(target_organization_id,target_mailbox_id,null,'CLAIM','STUCK_SENDING_FAILED',jsonb_build_object('count',stuck)); end if;

  if not dry_run then
    select * into controls_record from public.runtime_controls where organization_id=target_organization_id;
    if not found or controls_record.global_kill_switch or not controls_record.external_send_allowed then
      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'RUNTIME_HOLD',null);
    end if;
    if not app.hybrid_dispatch_window_is_open(clock_timestamp()) then
      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'OUTSIDE_SEND_WINDOW',null);
    end if;
    if not app.annex_a_manifest_is_ready(target_organization_id) then
      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'ANNEX_A_NOT_READY',null);
    end if;
  end if;

  cap := app.direct_lane_effective_cap(mailbox_record);
  sent_count := app.direct_lane_sent_today(target_organization_id,target_mailbox_id);
  if sent_count>=cap then
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'BUDGET_EXHAUSTED',jsonb_build_object('sent_today',sent_count,'daily_cap',cap));
  end if;

  if not dry_run then
    -- Ritmo: cuenta lo que ya salió o está saliendo. Una respuesta QUEUED del
    -- operador todavía no ha tocado Gmail y no debe frenar su propio envío.
    select max(coalesce(sent_at,created_at)) into last_outbound_at from public.messages
    where organization_id=target_organization_id and mailbox_id=target_mailbox_id and lane='DIRECT' and direction='OUTBOUND'
      and status in ('SENDING','SENT','DELIVERED')
      and (created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date;
    if last_outbound_at is not null then
      pace_seconds := 240+mod(abs(hashtextextended(to_char(clock_timestamp() at time zone 'America/Mexico_City','YYYY-MM-DD')||':'||target_mailbox_id::text||':'||sent_count::text,0)),180)::integer;
      if last_outbound_at>clock_timestamp()-make_interval(secs=>pace_seconds) then
        return app.direct_lane_noop(target_organization_id,target_mailbox_id,'PACING_HOLD',jsonb_build_object('next_eligible_at',last_outbound_at+make_interval(secs=>pace_seconds)));
      end if;
    end if;

    -- Prioridad 1: una respuesta escrita por el operador. Se copia a quien la
    -- campaña indique (Paco) y sale en el hilo original.
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
  end if;

  -- Prioridad 2: el siguiente toque vencido de una inscripción de este buzón.
  select ce.id as enrollment_id, ce.next_touch_number as touch_value, ce.status as enrollment_status, ce.sequence_version_id,
    ct.id as contact_id, ct.full_name, ct.normalized_email as contact_email, a.legal_name, a.id as account_id, a.primary_domain,
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
  order by ce.next_touch_at nulls first, ce.created_at
  limit 1 for update of ce skip locked;
  if candidate.enrollment_id is null then
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'NO_ELIGIBLE_ENVELOPE',jsonb_build_object('sent_today',sent_count,'daily_cap',cap));
  end if;

  rendered_subject := left(app.direct_lane_render(candidate.subject_template,candidate.full_name,candidate.legal_name),180);
  rendered_body := app.direct_lane_render(candidate.body_template,candidate.full_name,candidate.legal_name);
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
    jsonb_build_object('touch',candidate.touch_value,'attempt',attempt_value));
  return jsonb_build_object('status',case when dry_run then 'SHADOW_CLAIMED' else 'CLAIMED' end,'kind','TOUCH','message_id',message_id_value,
    'mailbox_id',target_mailbox_id,'from_email',mailbox_record.normalized_email,
    'from_name',coalesce(mailbox_record.direct_lane_display_name,mailbox_record.sender_name),
    'to_email',candidate.contact_email,'cc_emails','[]'::jsonb,'subject',rendered_subject,'body_text',rendered_body,
    'touch_number',candidate.touch_value,'thread',thread_json,'enrollment_id',candidate.enrollment_id,
    'sent_today',sent_count,'daily_cap',cap,'attempt',attempt_value);
end $$;

create or replace function public.settle_direct_lane_dispatch(
  target_organization_id uuid, target_message_id uuid, target_outcome text, target_provider_message_id text,
  target_provider_thread_id text, target_rfc_message_id text, target_error_code text,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; message_record public.messages%rowtype; enrollment_record public.campaign_enrollments%rowtype;
  current_offset integer; next_offset integer; failed_attempts integer; sent_at_value timestamptz := clock_timestamp();
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','settle_direct_lane_dispatch',target_organization_id::text,target_message_id::text,
    coalesce(target_outcome,''),coalesce(target_provider_message_id,''),coalesce(target_provider_thread_id,''),
    coalesce(target_rfc_message_id,''),coalesce(target_error_code,'')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  if target_outcome not in ('SENT','FAILED') then raise exception 'DIRECT_LANE_SETTLE_OUTCOME_INVALID'; end if;
  select * into message_record from public.messages
  where organization_id=target_organization_id and id=target_message_id and lane='DIRECT' and direction='OUTBOUND' for update;
  if not found then raise exception 'DIRECT_LANE_MESSAGE_NOT_FOUND'; end if;
  if message_record.status in ('SENT','DELIVERED','FAILED','BOUNCED','QUARANTINED') then
    return jsonb_build_object('status',case when message_record.status::text=target_outcome or (message_record.status='DELIVERED' and target_outcome='SENT') then 'DUPLICATE' else 'BLOCKED' end,
      'message_id',target_message_id,'current_status',message_record.status);
  end if;
  if target_outcome='SENT' then
    if message_record.status<>'SENDING' or nullif(btrim(coalesce(target_provider_message_id,'')),'') is null then
      raise exception 'DIRECT_LANE_SETTLE_SENT_INVALID';
    end if;
    update public.messages set status='SENT',sent_at=sent_at_value,provider_message_id=target_provider_message_id,
      provider_thread_id=coalesce(target_provider_thread_id,provider_thread_id),rfc_message_id=coalesce(target_rfc_message_id,rfc_message_id),
      updated_at=clock_timestamp()
    where id=message_record.id;
    update public.mailboxes set direct_lane_first_send_at=coalesce(direct_lane_first_send_at,sent_at_value),updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=message_record.mailbox_id;
    if message_record.touch_number is not null then
      select * into enrollment_record from public.campaign_enrollments where organization_id=target_organization_id and id=message_record.enrollment_id for update;
      select st.day_offset into current_offset from public.sequence_touches st
      where st.organization_id=target_organization_id and st.sequence_version_id=enrollment_record.sequence_version_id and st.touch_number=message_record.touch_number;
      select st.day_offset into next_offset from public.sequence_touches st
      where st.organization_id=target_organization_id and st.sequence_version_id=enrollment_record.sequence_version_id and st.touch_number=message_record.touch_number+1;
      if next_offset is null then
        update public.campaign_enrollments set status='COMPLETED',stopped_reason='SEQUENCE_COMPLETED',next_touch_at=null,updated_at=clock_timestamp()
        where id=enrollment_record.id;
      else
        update public.campaign_enrollments set status='ACTIVE',next_touch_number=message_record.touch_number+1,
          next_touch_at=sent_at_value+make_interval(days=>greatest(0,next_offset-coalesce(current_offset,0))),updated_at=clock_timestamp()
        where id=enrollment_record.id and status in ('PENDING','ACTIVE');
      end if;
    end if;
    perform app.direct_lane_tick(target_organization_id,message_record.mailbox_id,message_record.id,'SETTLE','SENT',
      jsonb_build_object('touch',message_record.touch_number,'kind',case when message_record.touch_number is null then 'REPLY' else 'TOUCH' end));
    return jsonb_build_object('status','SETTLED','outcome','SENT','message_id',message_record.id);
  end if;
  update public.messages set status='FAILED',updated_at=clock_timestamp() where id=message_record.id;
  if message_record.touch_number is not null then
    select count(*) into failed_attempts from public.messages
    where organization_id=target_organization_id and enrollment_id=message_record.enrollment_id and direction='OUTBOUND'
      and touch_number=message_record.touch_number and status='FAILED';
    if failed_attempts>=3 then
      update public.campaign_enrollments set status='PAUSED',stopped_reason='DISPATCH_FAILED_'||coalesce(target_error_code,'UNKNOWN'),next_touch_at=null,updated_at=clock_timestamp()
      where organization_id=target_organization_id and id=message_record.enrollment_id and status in ('PENDING','ACTIVE');
    end if;
  end if;
  perform app.direct_lane_tick(target_organization_id,message_record.mailbox_id,message_record.id,'SETTLE','SEND_FAILED_'||coalesce(regexp_replace(upper(target_error_code),'[^A-Z0-9_]','_','g'),'UNKNOWN'),
    jsonb_build_object('touch',message_record.touch_number,'attempts',failed_attempts));
  return jsonb_build_object('status','SETTLED','outcome','FAILED','message_id',message_record.id,'error_code',target_error_code,'attempts',failed_attempts);
end $$;

create or replace function public.annotate_direct_lane_inbound(
  target_organization_id uuid, target_provider_event_id uuid, target_rfc_message_id text, target_provider_thread_id text,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; event_record public.provider_events%rowtype; updated integer;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','annotate_direct_lane_inbound',target_organization_id::text,target_provider_event_id::text,
    coalesce(target_rfc_message_id,''),coalesce(target_provider_thread_id,'')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  select * into event_record from public.provider_events where organization_id=target_organization_id and id=target_provider_event_id;
  if not found or event_record.message_id is null then return jsonb_build_object('status','SKIPPED'); end if;
  update public.messages set rfc_message_id=coalesce(nullif(btrim(target_rfc_message_id),''),rfc_message_id),
    provider_thread_id=coalesce(nullif(btrim(target_provider_thread_id),''),provider_thread_id),updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=event_record.message_id and direction='INBOUND';
  get diagnostics updated=row_count;
  return jsonb_build_object('status',case when updated>0 then 'ANNOTATED' else 'SKIPPED' end,'message_id',event_record.message_id);
end $$;

-- ---------------------------------------------------------------------------
-- J. Privilegios
-- ---------------------------------------------------------------------------
revoke all on function app.direct_lane_assert_operator(uuid) from public,anon,authenticated,service_role;
revoke all on function app.direct_lane_command_replay(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function app.direct_lane_command_record(uuid,text,text,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function app.direct_lane_tick(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function app.direct_lane_noop(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function app.direct_lane_effective_cap(public.mailboxes) from public,anon,authenticated,service_role;
revoke all on function app.direct_lane_sent_today(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function app.direct_lane_variant_for_role(text) from public,anon,authenticated,service_role;
revoke all on function app.direct_lane_render(text,text,text) from public,anon,authenticated,service_role;
revoke all on function app.direct_lane_mailbox_json(public.mailboxes) from public,anon,authenticated,service_role;
revoke all on function app.direct_lane_health_as_system(uuid) from public,anon,authenticated,service_role;
revoke all on function app.enforce_direct_lane_release() from public,anon,authenticated,service_role;
revoke all on function app.direct_lane_cc_emails_valid(text[]) from public,anon,authenticated,service_role;

revoke all on function public.create_direct_lane_invitation(uuid,uuid,text,timestamptz,text) from public,anon,service_role;
revoke all on function public.revoke_direct_lane_credential(uuid,uuid,text,text) from public,anon,service_role;
revoke all on function public.configure_direct_lane_mailbox(uuid,uuid,jsonb,text,text) from public,anon,service_role;
revoke all on function public.create_direct_lane_campaign(uuid,text,text,jsonb,text) from public,anon,service_role;
revoke all on function public.approve_direct_lane_campaign(uuid,uuid,text) from public,anon,service_role;
revoke all on function public.set_direct_lane_campaign_state(uuid,uuid,text,text,text) from public,anon,service_role;
revoke all on function public.enroll_direct_lane_contacts(uuid,uuid,uuid,uuid[],integer,text) from public,anon,service_role;
revoke all on function public.enqueue_direct_lane_reply(uuid,uuid,text,text) from public,anon,service_role;
revoke all on function public.read_direct_lane_overview(uuid) from public,anon,service_role;
grant execute on function public.create_direct_lane_invitation(uuid,uuid,text,timestamptz,text) to authenticated;
grant execute on function public.revoke_direct_lane_credential(uuid,uuid,text,text) to authenticated;
grant execute on function public.configure_direct_lane_mailbox(uuid,uuid,jsonb,text,text) to authenticated;
grant execute on function public.create_direct_lane_campaign(uuid,text,text,jsonb,text) to authenticated;
grant execute on function public.approve_direct_lane_campaign(uuid,uuid,text) to authenticated;
grant execute on function public.set_direct_lane_campaign_state(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.enroll_direct_lane_contacts(uuid,uuid,uuid,uuid[],integer,text) to authenticated;
grant execute on function public.enqueue_direct_lane_reply(uuid,uuid,text,text) to authenticated;
grant execute on function public.read_direct_lane_overview(uuid) to authenticated;

revoke all on function public.read_direct_lane_invitation(uuid,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.arm_direct_lane_authorization(uuid,text,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.complete_direct_lane_authorization(uuid,text,text,text,text,text,text,text[],timestamptz,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.read_direct_lane_credential(uuid,uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.read_direct_lane_health(uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_direct_lane_dispatch(uuid,uuid,boolean,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.settle_direct_lane_dispatch(uuid,uuid,text,text,text,text,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.annotate_direct_lane_inbound(uuid,uuid,text,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.read_direct_lane_invitation(uuid,text,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.arm_direct_lane_authorization(uuid,text,text,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.complete_direct_lane_authorization(uuid,text,text,text,text,text,text,text[],timestamptz,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.read_direct_lane_credential(uuid,uuid,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.read_direct_lane_health(uuid,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.claim_direct_lane_dispatch(uuid,uuid,boolean,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.settle_direct_lane_dispatch(uuid,uuid,text,text,text,text,text,text,uuid,timestamptz,text) to anon,authenticated;
grant execute on function public.annotate_direct_lane_inbound(uuid,uuid,text,text,text,uuid,timestamptz,text) to anon,authenticated;

commit;
