begin;

-- M039 las compuertas del primer envío dejan de nombrar a un proveedor que ya
-- no presta el servicio y a un cliente que ya no participa.
--
-- Contexto. Tres de los treinta códigos de `public.first_send_gate_code`
-- quedaron anclados a supuestos que dejaron de ser ciertos:
--
--   APOLLO_WARMUP_42_DAYS   Apollo discontinuó su calentamiento en 2024 por
--                           incumplir políticas de Gmail (DEC-107). El
--                           requisito de 42 días SIGUE VIGENTE y quedó
--                           re-anclado en fuentes independientes de 2026: el
--                           piso actual es 30 días y el rango recomendado para
--                           dominios nuevos es de 4 a 8 semanas. Lo que cambia
--                           es quién lo ejecuta, así que el código deja de
--                           nombrar al proveedor.
--
--   COPY_APPROVED_FRANCISCO Decisión de Jorge del 29-ago: el cliente quedó
--   TECHNICAL_APPROVED_PACO fuera del programa y no aprueba nada. Ambas pasan a
--                           satisfacerse con aprobación de `teckel_admin`, y
--                           Jorge asume el riesgo de la cláusula 07. El copy se
--                           sigue congelando con hash: cualquier cambio
--                           posterior reabre la compuerta, igual que antes.
--
-- Lo que NO cambia: siguen siendo treinta compuertas, todas obligatorias, y
-- ninguna pasa sin evidencia. Esto es un renombre, no un relajamiento.
--
-- Patrón tomado de la migración 023, que ya renombró
-- DOMAIN_AGE_35_DAYS -> APOLLO_WARMUP_42_DAYS con su rollback espejo.

alter type public.first_send_gate_code
  rename value 'APOLLO_WARMUP_42_DAYS' to 'WARMUP_42_DAYS_COMPLETE';

alter type public.first_send_gate_code
  rename value 'COPY_APPROVED_FRANCISCO' to 'COPY_APPROVED_AND_FROZEN';

alter type public.first_send_gate_code
  rename value 'TECHNICAL_APPROVED_PACO' to 'TECHNICAL_APPROVED_TECKEL';

-- Falla cerrado: si alguno no quedó renombrado, la migración no se da por buena.
do $verificacion$
declare viejos text;
begin
  select string_agg(e.enumlabel, ', ') into viejos
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  where t.typname = 'first_send_gate_code'
    and e.enumlabel in ('APOLLO_WARMUP_42_DAYS', 'COPY_APPROVED_FRANCISCO', 'TECHNICAL_APPROVED_PACO');
  if viejos is not null then
    raise exception 'M039_CODIGOS_VIEJOS_PRESENTES: %', viejos;
  end if;

  if (select count(*) from pg_type t join pg_enum e on e.enumtypid = t.oid
      where t.typname = 'first_send_gate_code') <> 30 then
    raise exception 'M039_CONTEO_DE_COMPUERTAS_ALTERADO';
  end if;
end
$verificacion$;

commit;
