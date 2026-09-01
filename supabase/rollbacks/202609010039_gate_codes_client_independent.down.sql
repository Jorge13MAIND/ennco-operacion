begin;

-- Rollback espejo de M039. Devuelve los tres códigos a su nombre anterior.
-- Se conserva por simetría con la 023, aunque volver atrás reintroduce dos
-- compuertas que dependen de un cliente fuera del programa y una que nombra a
-- un proveedor que ya no calienta buzones.

alter type public.first_send_gate_code
  rename value 'WARMUP_42_DAYS_COMPLETE' to 'APOLLO_WARMUP_42_DAYS';

alter type public.first_send_gate_code
  rename value 'COPY_APPROVED_AND_FROZEN' to 'COPY_APPROVED_FRANCISCO';

alter type public.first_send_gate_code
  rename value 'TECHNICAL_APPROVED_TECKEL' to 'TECHNICAL_APPROVED_PACO';

commit;
