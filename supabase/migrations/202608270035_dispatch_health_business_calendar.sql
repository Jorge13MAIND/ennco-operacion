begin;

-- M035 el informe de salud expone el horizonte del calendario hábil.
--
-- Complemento de M034. Sembrar el calendario arregla el HOY; esto arregla el
-- MAÑANA: sin este dato, el watchdog no puede avisar antes de que se vuelva a
-- agotar, y el modo de falla es silencioso (revientan la solicitud de
-- aprobación operativa y el ruteo de las respuestas positivas, que es
-- justamente donde la máquina gana dinero).
--
-- Un gate local nunca podría atrapar esto porque es un dato de producción.
-- El umbral vive en src/lib/dispatch/watchdog.ts: aviso bajo 90 días hábiles
-- por delante, crítico bajo 20.
--
-- Se parchea la definición VIVA en lugar de transcribir las ~120 líneas de
-- read_dispatch_health, y se verifica que el reemplazo haya ocurrido: si el
-- patrón no aparece, la migración falla en vez de dejar el informe sin el dato.

do $migration$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'read_dispatch_health';

  if definition is null then raise exception 'M035_HEALTH_FUNCTION_NOT_FOUND'; end if;
  if position('business_calendar' in definition) > 0 then return; end if;

  patched := replace(
    definition,
    '''send_window_open'',app.hybrid_dispatch_window_is_open(clock_timestamp())',
    '''send_window_open'',app.hybrid_dispatch_window_is_open(clock_timestamp()),'
    || '''business_calendar'',jsonb_build_object(''future_business_days'','
    || '(select count(*) from public.reporting_calendar_days c where c.organization_id=target_organization_id'
    || ' and c.jurisdiction=''MX'' and c.evidence_class=''live'' and c.is_business_day'
    || ' and c.calendar_date >= (clock_timestamp() at time zone ''America/Mexico_City'')::date))'
  );

  if patched = definition then raise exception 'M035_HEALTH_PATTERN_NOT_FOUND'; end if;
  execute patched;
end
$migration$;

commit;
