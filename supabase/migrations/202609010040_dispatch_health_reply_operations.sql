begin;

-- M040 el informe de salud expone el estado de las respuestas y del responsable.
--
-- Pareja de docs/external/sla-de-respuesta.md. Dos modos de falla que ningún
-- gate local puede ver porque son datos de producción:
--   1. Respuestas REPLY en UNREVIEWED: no disparan nada por sí mismas y el
--      plazo de las 18:00 (ENNCO-CLIENT-SLA-2026-08-12-V1) corre aunque nadie
--      las haya abierto. El watchdog alerta si la más vieja pasa de 2 horas.
--   2. operational_assignments sin fila ACTIVE: review_reply_and_route no
--      falla, asigna owner NULL y abre un caso P1 que nadie puede cerrar
--      (complete_operational_task_v2 exige TASK_OWNER_REQUIRED). En live el
--      watchdog lo marca CRITICAL.
--
-- Mismo patrón que M035: se parchea la definición VIVA de read_dispatch_health
-- y se verifica el reemplazo; si el ancla no aparece, la migración falla en
-- lugar de dejar el informe sin el dato. Los umbrales viven en
-- src/lib/dispatch/watchdog.ts.

do $migration$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'read_dispatch_health';

  if definition is null then raise exception 'M040_HEALTH_FUNCTION_NOT_FOUND'; end if;
  if position('reply_operations' in definition) > 0 then return; end if;

  patched := replace(
    definition,
    '''send_window_open'',app.hybrid_dispatch_window_is_open(clock_timestamp())',
    '''send_window_open'',app.hybrid_dispatch_window_is_open(clock_timestamp()),'
    || '''reply_operations'',jsonb_build_object('
    || '''unreviewed_replies'',(select count(*) from public.provider_events e'
    || ' where e.organization_id=target_organization_id and e.event_kind=''REPLY'''
    || ' and e.reply_classification=''UNREVIEWED''),'
    || '''oldest_unreviewed_minutes'',(select floor(extract(epoch from (clock_timestamp()-min(e.observed_at)))/60)'
    || ' from public.provider_events e where e.organization_id=target_organization_id'
    || ' and e.event_kind=''REPLY'' and e.reply_classification=''UNREVIEWED''),'
    || '''open_reply_cases'',(select count(*) from public.operational_sla_cases s'
    || ' where s.organization_id=target_organization_id and s.case_type=''POSITIVE_REPLY'''
    || ' and s.status=''OPEN''),'
    || '''assignment_active'',exists(select 1 from public.operational_assignments oa'
    || ' where oa.organization_id=target_organization_id and oa.status=''ACTIVE'''
    || ' and app.operations_assignment_is_active(oa.organization_id)))'
  );

  if patched = definition then raise exception 'M040_HEALTH_PATTERN_NOT_FOUND'; end if;
  execute patched;
end
$migration$;

commit;
