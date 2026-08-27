begin;

-- M034 siembra del calendario hábil mexicano.
--
-- Hallazgo del 27-ago-2026: `public.reporting_calendar_days` estaba VACÍA en
-- producción, y `app.operations_business_deadline` levanta
-- OPERATIONS_BUSINESS_CALENDAR_INCOMPLETE cuando no encuentra el día hábil que
-- busca. Eso dejaba muertos dos caminos vivos:
--
--   1. `request_operational_approval`, que calcula un plazo de 3 días hábiles.
--      Sin calendario, NINGUNA aprobación operativa podía siquiera solicitarse,
--      incluida la del copy de campaña y la del primer envío del canary.
--   2. `review_reply_and_route` con clasificación POSITIVE, que calcula el
--      plazo del mismo día para el caso de SLA. Sin calendario, el sistema
--      reventaba exactamente en las respuestas buenas, que son la razón de ser
--      de la máquina.
--
-- Días inhábiles = sábados, domingos y los descansos obligatorios del artículo
-- 74 de la Ley Federal del Trabajo. El 1 de diciembre de transmisión del Poder
-- Ejecutivo (cada seis años: 2024, 2030) queda fuera del horizonte sembrado.
-- Jueves y Viernes Santo NO son descanso obligatorio de ley y no se marcan.
--
-- Horizonte: 2026-01-01 a 2027-12-31. La vigilancia de agotamiento vive en el
-- watchdog, no en un gate local, porque es un dato de producción.

do $migration$
declare
  target_org uuid;
  recorder uuid;
  source_hash text := encode(digest(
    'LFT-ART-74-DESCANSOS-OBLIGATORIOS|horizonte:2026-01-01..2027-12-31|jurisdiccion:MX',
    'sha256'), 'hex');
  inserted integer;
begin
  for target_org, recorder in
    select distinct on (ou.organization_id) ou.organization_id, ou.user_id
    from public.organization_users ou
    where ou.active and ou.role in ('teckel_admin', 'teckel_operator')
    order by ou.organization_id, ou.user_id
  loop
    with dias as (
      select d::date as calendar_date
      from generate_series('2026-01-01'::date, '2027-12-31'::date, interval '1 day') d
    ),
    anios as (select generate_series(2026, 2027) as y),
    festivos as (
      select make_date(y, 1, 1) as d from anios
      union all select make_date(y,2,1) + (((1 - extract(dow from make_date(y,2,1))::int) + 7) % 7) from anios
      union all select make_date(y,3,1) + (((1 - extract(dow from make_date(y,3,1))::int) + 7) % 7) + 14 from anios
      union all select make_date(y, 5, 1) from anios
      union all select make_date(y, 9, 16) from anios
      union all select make_date(y,11,1) + (((1 - extract(dow from make_date(y,11,1))::int) + 7) % 7) + 14 from anios
      union all select make_date(y, 12, 25) from anios
    )
    insert into public.reporting_calendar_days (
      organization_id, calendar_date, jurisdiction, is_business_day,
      evidence_class, source_sha256, recorded_by
    )
    select
      target_org,
      dias.calendar_date,
      'MX',
      extract(isodow from dias.calendar_date) between 1 and 5
        and not exists (select 1 from festivos f where f.d = dias.calendar_date),
      'live',
      source_hash,
      recorder
    from dias
    on conflict (organization_id, jurisdiction, calendar_date) do nothing;

    get diagnostics inserted = row_count;
    raise notice 'M034: organizacion % sembrada con % dias', target_org, inserted;
  end loop;
end
$migration$;

commit;
