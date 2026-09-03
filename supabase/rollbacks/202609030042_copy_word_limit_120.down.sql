begin;

-- Revierte M042: el tope de palabras del cuerpo vuelve a 100.
-- OJO: si ya hay copy aprobado de más de 100 palabras cargado en una campaña,
-- revertir esto lo deja sin poder despacharse. Revisar antes de correrlo.

do $rollback$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname = 'enforce_hybrid_dispatch_envelope_contract';
  if definition is null then raise exception 'M042_DOWN_HYBRID_FUNCTION_NOT_FOUND'; end if;
  if position('''\s+''))>120' in definition) > 0 then
    patched := replace(definition, '''\s+''))>120', '''\s+''))>100');
    if patched = definition then raise exception 'M042_DOWN_HYBRID_PATTERN_NOT_REPLACED'; end if;
    execute patched;
  end if;

  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname = 'enforce_direct_lane_release';
  if definition is null then raise exception 'M042_DOWN_DIRECT_FUNCTION_NOT_FOUND'; end if;
  if position('word_count>120' in definition) > 0 then
    patched := replace(definition, 'word_count>120', 'word_count>100');
    if patched = definition then raise exception 'M042_DOWN_DIRECT_PATTERN_NOT_REPLACED'; end if;
    execute patched;
  end if;
end
$rollback$;

commit;
