-- 103 · El primer contacto que rebotó ya no tumba el registro de envíos (6-oct-2026).
-- app.auto_record_first_contact_attribution lanzaba AUTO_ATTRIBUTION_EARLIER_MESSAGE_CONFLICT cuando la
-- atribución de la empresa apuntaba a un correo que después rebotó: el settle SENT fallaba, el envío
-- quedaba AMBIGUOUS y el buzón se pausaba (fcuellar@enncoindustrial, 6-oct 11:25). 15 empresas estaban
-- en ese caso. Ahora se conserva la atribución original y el envío se registra.
-- Definición viva en tools/correos/vivas-103/.

begin;

CREATE OR REPLACE FUNCTION app.auto_record_first_contact_attribution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  enrollment_record public.campaign_enrollments%rowtype;
  earliest_message_id uuid;
  existing_event public.attribution_events%rowtype;
  created_event_id uuid;
  idempotency_hash text;
begin
  if new.direction <> 'OUTBOUND'
    or new.status not in ('SENT', 'DELIVERED')
    or new.sent_at is null
    or nullif(btrim(new.provider_message_id), '') is null
    or new.enrollment_id is null
    or new.contact_id is null
  then return new; end if;

  select * into enrollment_record
  from public.campaign_enrollments
  where organization_id = new.organization_id and id = new.enrollment_id;
  if not found or enrollment_record.contact_id <> new.contact_id then
    raise exception 'AUTO_ATTRIBUTION_ENROLLMENT_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    new.organization_id::text || ':attribution:' || enrollment_record.account_id::text, 0
  ));
  select m.id into earliest_message_id
  from public.messages m
  join public.campaign_enrollments ce
    on ce.organization_id = m.organization_id and ce.id = m.enrollment_id
  where m.organization_id = new.organization_id
    and ce.account_id = enrollment_record.account_id
    and m.direction = 'OUTBOUND'
    and m.status in ('SENT', 'DELIVERED')
    and m.sent_at is not null
    and nullif(btrim(m.provider_message_id), '') is not null
    and m.contact_id = ce.contact_id
  order by m.sent_at, m.created_at, m.id
  limit 1;
  if earliest_message_id is distinct from new.id then return new; end if;

  select * into existing_event
  from public.attribution_events
  where organization_id = new.organization_id
    and account_id = enrollment_record.account_id;
  if found then
    if existing_event.first_contact_message_id = new.id then return new; end if;
    -- 6-oct: si la atribución vigente apunta a un primer correo que no se entregó (rebotó), se
    -- respeta tal cual (la tabla es de solo inserción y de ella dependen las comisiones) y el envío
    -- nuevo se registra sin romper el settle. Antes esto tiraba el settle y pausaba el buzón.
    if not exists (select 1 from public.messages fm where fm.organization_id = new.organization_id
        and fm.id = existing_event.first_contact_message_id and fm.status in ('SENT','DELIVERED')) then
      return new;
    end if;
    raise exception 'AUTO_ATTRIBUTION_EARLIER_MESSAGE_CONFLICT';
  end if;

  idempotency_hash := encode(digest(
    'auto-attribution:' || new.organization_id::text || ':' || enrollment_record.account_id::text,
    'sha256'
  ), 'hex');
  insert into public.attribution_events (
    organization_id, account_id, contact_id, first_contact_message_id,
    first_contact_at, attribution_expires_at, idempotency_key
  ) values (
    new.organization_id, enrollment_record.account_id, new.contact_id, new.id,
    new.sent_at, new.sent_at + interval '12 months', idempotency_hash
  ) on conflict (organization_id, account_id) do nothing
  returning id into created_event_id;

  if created_event_id is not null then
    insert into public.event_outbox (
      organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
    ) values (
      new.organization_id, 'attribution', created_event_id, 'attribution.first_contact_recorded',
      'automatic-attribution:' || idempotency_hash,
      jsonb_build_object(
        'attribution_event_id', created_event_id,
        'account_id', enrollment_record.account_id,
        'source', 'AUTOMATIC_FIRST_REAL_OUTBOUND'
      )
    ) on conflict (organization_id, idempotency_key) do nothing;
  end if;
  return new;
end;
$function$;

commit;
