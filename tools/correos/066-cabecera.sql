-- 066 · Campaña v4 con gancho, 100 correos al día y rotación de buzones (junta #6, 22-sep-2026).
--
-- Lo que se acordó con Jorge y queda aplicado aquí:
--   · Cuatro toques por ronda, a los días 0, 2, 4 y 6. El gancho va solo en el primero y se
--     redacta como hallazgo con su fuente ("leí que…, no sé si siga vigente; si es así…").
--   · Texto 25 % más corto que la v3.
--   · 20 correos por buzón al día, contando seguimientos: 100 entre los cinco.
--   · Si pasan los cuatro toques sin respuesta, se esperan siete días y arranca otra ronda de
--     cuatro desde el siguiente buzón que no le ha escrito, con otro texto. Cinco buzones,
--     cinco rondas; después el contacto se deja.
--   · Una respuesta, un rebote o una baja detiene al contacto en todos los buzones.
--
-- Generado por tools/correos/gen-066.py. Las funciones vivas se parchan, no se reescriben.

begin;

set local app.operations_rpc_write = 'on';

/* ---------- Rondas ---------- */

alter table public.campaign_enrollments
  add column if not exists rotation_round smallint not null default 1,
  add column if not exists rotation_origin_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_enrollments_rotation_round_check') then
    alter table public.campaign_enrollments add constraint campaign_enrollments_rotation_round_check check (rotation_round between 1 and 5);
  end if;
end $$;
comment on column public.campaign_enrollments.rotation_round is
  'Ronda de rotación: 1 es la primera secuencia; cada ronda siguiente sale de otro buzón (junta #6).';
comment on column public.campaign_enrollments.rotation_origin_id is
  'Inscripción de la ronda 1 de la que viene esta ronda. Nulo en la ronda 1.';

-- Tope de toques por ronda. La campaña vieja tiene ocho toques; con la regla nueva cierra en el
-- cuarto y el contacto pasa a rotación.
alter table public.campaigns add column if not exists direct_lane_max_touches smallint;
comment on column public.campaigns.direct_lane_max_touches is
  'Toques por ronda. Al pasar de este número la inscripción se da por terminada y entra a rotación.';

/* ---------- Tope de toques y guarda de pausa (antes de escribir) ---------- */

create or replace function app.direct_lane_enrollment_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare max_touches smallint;
begin
  -- settle avanza al toque siguiente; si ya no le toca por la regla de cuatro, se cierra la ronda.
  if new.status = 'ACTIVE' and new.next_touch_number is distinct from old.next_touch_number then
    select c.direct_lane_max_touches into max_touches from public.campaigns c where c.id = new.campaign_id;
    if max_touches is not null and new.next_touch_number > max_touches then
      new.status := 'COMPLETED';
      new.stopped_reason := 'SEQUENCE_COMPLETED';
      new.next_touch_at := null;
    end if;
  end if;
  -- Un "fuera de oficina" que llega a una ronda ya cerrada no la reabre en pausa si el contacto
  -- ya va en otra ronda: solo puede haber una inscripción abierta por contacto.
  if old.status = 'COMPLETED' and new.status = 'PAUSED' and exists (
    select 1 from public.campaign_enrollments x
    where x.organization_id = new.organization_id and x.contact_id = new.contact_id and x.id <> new.id
      and x.status in ('PENDING', 'ACTIVE', 'PAUSED')) then
    new.status := old.status;
    new.stopped_reason := old.stopped_reason;
    new.next_touch_at := old.next_touch_at;
  end if;
  return new;
end $$;

drop trigger if exists enrollments_rotation_guard on public.campaign_enrollments;
create trigger enrollments_rotation_guard
  before update on public.campaign_enrollments
  for each row execute function app.direct_lane_enrollment_guard();

/* ---------- Rotación ---------- */

create or replace function app.direct_lane_rotate(target_enrollment_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $$
declare
  e public.campaign_enrollments%rowtype;
  rot public.campaigns%rowtype;
  ct public.contacts%rowtype;
  acc public.accounts%rowtype;
  next_round smallint;
  version_value integer;
  version_id uuid;
  wait_days integer;
  used uuid[];
  ordered uuid[];
  current_idx integer;
  total integer;
  chosen uuid;
  last_sent timestamptz;
  start_at timestamptz;
  new_id uuid;
begin
  select * into e from public.campaign_enrollments where id = target_enrollment_id;
  if not found then return null; end if;
  next_round := e.rotation_round + 1;

  -- La campaña que lleva las rondas es la última aprobada en marcha que declara rotación.
  select * into rot from public.campaigns c
  where c.organization_id = e.organization_id and c.lane = 'DIRECT' and c.direct_lane_state = 'RUNNING'
    and c.manifest_json ? 'rotation'
  order by c.approved_at desc nulls last limit 1;
  if not found then return null; end if;

  select (r->>'version')::integer into version_value
  from jsonb_array_elements(rot.manifest_json->'rotation'->'rounds') r
  where (r->>'round')::integer = next_round;
  if version_value is null then return null; end if; -- ya se usaron todas las rondas

  select sv.id into version_id from public.sequence_versions sv
  where sv.organization_id = e.organization_id and sv.campaign_id = rot.id and sv.version = version_value;
  if version_id is null then return null; end if;

  select * into ct from public.contacts where id = e.contact_id;
  select * into acc from public.accounts where id = e.account_id;
  if ct.id is null or acc.id is null or not ct.verified or ct.is_deleted or acc.is_deleted
    or app.is_suppressed(e.organization_id, acc.id, ct.normalized_email, acc.primary_domain) then
    return null;
  end if;
  -- Nada de rotar a quien ya respondió, rebotó o pidió baja, ni a quien ya tiene otra ronda abierta.
  if exists (select 1 from public.campaign_enrollments x
    where x.organization_id = e.organization_id and x.contact_id = e.contact_id
      and x.status in ('PENDING', 'ACTIVE', 'PAUSED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'SUPPRESSED')) then
    return null;
  end if;

  -- Siguiente buzón conectado, en orden, que todavía no le haya escrito a este contacto.
  select array_agg(distinct x.mailbox_id) into used from public.campaign_enrollments x
  where x.organization_id = e.organization_id and x.contact_id = e.contact_id;
  select array_agg(m.id order by m.normalized_email) into ordered from public.mailboxes m
  where m.organization_id = e.organization_id and m.direct_lane_status = 'CONNECTED';
  total := coalesce(cardinality(ordered), 0);
  current_idx := coalesce(array_position(ordered, e.mailbox_id), 0);
  for i in 1..total loop
    chosen := ordered[1 + mod(current_idx - 1 + i, total)];
    exit when not (chosen = any (coalesce(used, '{}'::uuid[])));
    chosen := null;
  end loop;
  if chosen is null then return null; end if;

  wait_days := coalesce((rot.manifest_json->'rotation'->>'wait_days')::integer, 7);
  select max(m.sent_at) into last_sent from public.messages m
  where m.organization_id = e.organization_id and m.enrollment_id = e.id and m.direction = 'OUTBOUND';
  start_at := greatest(coalesce(last_sent, clock_timestamp()) + make_interval(days => wait_days), clock_timestamp());

  insert into public.campaign_enrollments(organization_id, campaign_id, sequence_version_id, account_id, contact_id,
    mailbox_id, status, next_touch_number, next_touch_at, rotation_round, rotation_origin_id)
  values (e.organization_id, rot.id, version_id, e.account_id, e.contact_id,
    chosen, 'PENDING', 1, start_at, next_round, coalesce(e.rotation_origin_id, e.id))
  returning id into new_id;

  insert into public.audit_log(organization_id, action, record_type, record_id, new_data)
  values (e.organization_id, 'DIRECT_LANE_ROTATION_SCHEDULED', 'campaign_enrollments', new_id,
    jsonb_build_object('from_enrollment', e.id, 'round', next_round, 'mailbox_id', chosen, 'starts_at', start_at));
  return new_id;
end $$;

create or replace function app.direct_lane_enrollment_after()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status in ('REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'SUPPRESSED') then
    -- Si contesta un correo de una ronda anterior, se cancela la ronda que ya estaba agendada.
    update public.campaign_enrollments
    set status = 'COMPLETED', stopped_reason = 'CONTACT_' || new.status::text, next_touch_at = null, updated_at = clock_timestamp()
    where organization_id = new.organization_id and contact_id = new.contact_id and id <> new.id
      and status in ('PENDING', 'ACTIVE', 'PAUSED');
  elsif new.status = 'COMPLETED' and new.stopped_reason = 'SEQUENCE_COMPLETED' then
    perform app.direct_lane_rotate(new.id);
  end if;
  return null;
end $$;

drop trigger if exists enrollments_rotation_after on public.campaign_enrollments;
create trigger enrollments_rotation_after
  after update on public.campaign_enrollments
  for each row execute function app.direct_lane_enrollment_after();

revoke all on function app.direct_lane_rotate(uuid) from public, anon, authenticated;
