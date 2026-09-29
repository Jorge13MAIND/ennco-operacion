CREATE OR REPLACE FUNCTION app.direct_lane_rotate(target_enrollment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
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
end $function$

