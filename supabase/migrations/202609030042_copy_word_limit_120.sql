begin;

-- M042 el tope de palabras del cuerpo sube de 100 a 120.
--
-- Motivo: el copy de la secuencia lo aprueba el CLIENTE (cláusula 07), y el
-- correo que Francisco Cuellar aprobó el 3-sep tiene 104 palabras. El tope de
-- 100 era una preferencia de Teckel por correos cortos en frío, no un requisito
-- de proveedor ni de ley. Entre recortar la voz aprobada del cliente y mover un
-- número nuestro, se mueve el número.
--
-- No se elimina la guardia: 120 sigue cortando el correo inflado, que es contra
-- lo que se puso el tope. La respuesta a un hilo ya tenía su propio límite de
-- 400 y no se toca.
--
-- Se parchean las definiciones VIVAS de los dos triggers que lo validan (M032
-- carril híbrido y M041 carril directo) y se verifica que el reemplazo ocurrió:
-- si el patrón no aparece, la migración falla en vez de dejar un tope a medias.

do $migration$
declare
  definition text;
  patched text;
begin
  -- 1. Carril híbrido (M032)
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname = 'enforce_hybrid_dispatch_envelope_contract';

  if definition is null then raise exception 'M042_HYBRID_FUNCTION_NOT_FOUND'; end if;

  if position('''\s+''))>100' in definition) > 0 then
    patched := replace(definition, '''\s+''))>100', '''\s+''))>120');
    if patched = definition then raise exception 'M042_HYBRID_PATTERN_NOT_REPLACED'; end if;
    execute patched;
  elsif position('''\s+''))>120' in definition) = 0 then
    raise exception 'M042_HYBRID_LIMIT_SHAPE_UNKNOWN';
  end if;

  -- 2. Carril directo (M041)
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname = 'enforce_direct_lane_release';

  if definition is null then raise exception 'M042_DIRECT_FUNCTION_NOT_FOUND'; end if;

  if position('word_count>100' in definition) > 0 then
    patched := replace(definition, 'word_count>100', 'word_count>120');
    if patched = definition then raise exception 'M042_DIRECT_PATTERN_NOT_REPLACED'; end if;
    execute patched;
  elsif position('word_count>120' in definition) = 0 then
    raise exception 'M042_DIRECT_LIMIT_SHAPE_UNKNOWN';
  end if;
end
$migration$;

commit;
