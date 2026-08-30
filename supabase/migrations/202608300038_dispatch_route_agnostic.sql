begin;

-- M038 el motor deja de estar clavado al buzon de Francisco.
--
-- Contexto (29-ago-2026): Francisco quedo fuera del programa. Su buzon
-- contacto@ennco.com.mx sale del canal y los envios pasan a los tres buzones
-- del carril aislado, que viven en dominios de Teckel con DNS y DKIM propios.
--
-- Hasta ahora dos funciones filtraban por eligibility_route =
-- EXISTING_PRIMARY_GMAIL_RAMP, asi que el motor SOLO podia despachar desde su
-- buzon. Con el fuera del canal, el motor se habria quedado sin nada que
-- despachar y sin decir por que.
--
-- El filtro correcto no es la ruta: es el RELEASE. Un release solo existe para
-- un buzon que ya paso sus compuertas, incluida la del calentamiento de 42
-- dias del carril aislado. Quitar el filtro de ruta no relaja ningun control;
-- mueve la decision al lugar donde ya vive.

do $migration$
declare
  definicion text;
  parchada text;
  restantes integer;
begin
  select pg_get_functiondef(p.oid) into definicion
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname = 'hybrid_dispatch_active_release';
  if definicion is null then raise exception 'M038_ACTIVE_RELEASE_NO_ENCONTRADA'; end if;
  if position('eligibility_route' in definicion) > 0 then
    parchada := replace(definicion, '    and m.eligibility_route=''EXISTING_PRIMARY_GMAIL_RAMP''
', '');
    if parchada = definicion then raise exception 'M038_PATRON_RELEASE_NO_ENCONTRADO'; end if;
    execute parchada;
  end if;

  select pg_get_functiondef(p.oid) into definicion
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'read_dispatch_health';
  if definicion is null then raise exception 'M038_HEALTH_NO_ENCONTRADA'; end if;
  if position('m.eligibility_route=''EXISTING_PRIMARY_GMAIL_RAMP''' in definicion) > 0 then
    parchada := replace(definicion, '    and m.eligibility_route=''EXISTING_PRIMARY_GMAIL_RAMP''
', '');
    if parchada = definicion then raise exception 'M038_PATRON_HEALTH_NO_ENCONTRADO'; end if;
    execute parchada;
  end if;

  select count(*) into restantes
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app','public')
    and p.proname in ('hybrid_dispatch_active_release','read_dispatch_health')
    and pg_get_functiondef(p.oid) like '%EXISTING_PRIMARY_GMAIL_RAMP%';
  if restantes > 0 then raise exception 'M038_QUEDAN_% FUNCIONES_ATADAS', restantes; end if;
end
$migration$;

commit;
