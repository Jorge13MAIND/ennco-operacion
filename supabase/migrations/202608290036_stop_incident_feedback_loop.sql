begin;

-- M036 cortar el bucle exponencial de incidentes autogenerados.
--
-- Hallazgo del 29-ago-2026: 2,522 incidentes P1 abiertos, multiplicándose en
-- cada corrida del watchdog. El ciclo:
--
--   incidente -> evento 'incident.opened' en el outbox -> nadie lo drena
--   (runGmailSync lo reclamaba, no lo entendía y hacía `continue` sin marcarlo)
--   -> el barredor lo veía detenido >120s y abría un incidente 'outbox:<id>'
--   -> ese incidente generaba OTRO 'incident.opened'. Exponencial.
--
-- Un segundo ciclo, menor, por la vía del SLA: cada incidente abre un caso
-- INCIDENT_ACK a 60 minutos; al vencer, el barredor abría un incidente
-- 'sla:<id>' que a su vez abría su propio caso INCIDENT_ACK.
--
-- CONSECUENCIA REAL: isControlCadenceReleaseAllowed exige open_p1 = 0, así que
-- con el bucle vivo NINGÚN envío externo podía salir jamás. El canary habría
-- fallado el día del primer envío sin que nadie entendiera por qué.
--
-- La causa raíz de código va en src/lib/dispatch/sync.ts: todo evento reclamado
-- del outbox debe salir del limbo, completado o fallado. Aquí sólo se corta la
-- recursión del barredor, que es la que multiplicaba.
--
--   a) deja de abrir incidentes 'outbox:' por eventos 'incident.opened'. La
--      entrega de esas alertas YA la vigila la regla 'alert-delivery:', que es
--      específica; la regla genérica la duplicaba y era el motor del bucle.
--   b) deja de abrir incidentes 'sla:' por casos INCIDENT_ACK de incidentes que
--      el propio barredor generó.
--
-- Se parchea la definición VIVA y se verifica que ambos reemplazos ocurran; si
-- un patrón no aparece, la migración falla en vez de dejar el bucle abierto.

do $migration$
declare
  definicion text;
  parchada text;
begin
  select pg_get_functiondef(p.oid) into definicion
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname = 'run_operations_watchdog';
  if definicion is null then raise exception 'M036_WATCHDOG_NO_ENCONTRADO'; end if;
  if position('o.event_type <> ''incident.opened''' in definicion) > 0 then return; end if;

  parchada := replace(
    definicion,
    'from public.event_outbox o where o.organization_id=target_organization_id and o.status in (''PENDING'',''PROCESSING'',''FAILED'')
      and coalesce(o.locked_at,o.created_at)<target_evaluated_at-interval ''120 seconds''',
    'from public.event_outbox o where o.organization_id=target_organization_id and o.status in (''PENDING'',''PROCESSING'',''FAILED'')
      and o.event_type <> ''incident.opened''
      and coalesce(o.locked_at,o.created_at)<target_evaluated_at-interval ''120 seconds'''
  );
  if parchada = definicion then raise exception 'M036_PATRON_OUTBOX_NO_ENCONTRADO'; end if;

  definicion := parchada;
  parchada := replace(
    definicion,
    'from public.operational_sla_cases s where s.organization_id=target_organization_id and s.status=''OPEN'' and s.due_at<target_evaluated_at',
    'from public.operational_sla_cases s where s.organization_id=target_organization_id and s.status=''OPEN'' and s.due_at<target_evaluated_at
      and not exists(
        select 1 from public.incidents di
        where di.organization_id=s.organization_id and di.id=s.subject_id
          and (di.incident_key like ''outbox:%'' or di.incident_key like ''sla:%'')
      )'
  );
  if parchada = definicion then raise exception 'M036_PATRON_SLA_NO_ENCONTRADO'; end if;

  execute parchada;
end
$migration$;

commit;
