begin;

-- M043 la categoría de rol SAFETY existe.
--
-- Cierra un hueco que el handover del 1-sep dejó documentado y sin arreglar:
-- el copy tiene cuatro variantes (dirección, mantenimiento, seguridad e
-- higiene, compras) pero el clasificador de cargos sólo conocía cuatro
-- categorías que NO incluían seguridad. Un "Coordinador de Seguridad e
-- Higiene" caía en OTHER, y OTHER no cuenta para el mínimo de 150 contactos
-- ni puede ser el contacto de un lead calificado.
--
-- La consecuencia práctica: la variante de copy que más apela al miedo real
-- del comprador (el arco eléctrico y el acta) era la única que el sistema no
-- podía asignar a nadie.
--
-- Cuatro piezas enumeran las categorías y las cuatro se tocan aquí, porque
-- ampliar una sola dejaría el sistema incoherente: el clasificador que asigna,
-- la restricción que valida, el alta que compara ambas, la verificación que
-- exige rol objetivo, y el inventario que cuenta hacia el 75/150.
--
-- Ninguna fila cambia de categoría: las que ya están en OTHER se quedan ahí
-- hasta que alguien las reclasifique con el flujo de revisión normal.

-- ---------------------------------------------------------------------------
-- A. El clasificador reconoce seguridad e higiene
-- ---------------------------------------------------------------------------
-- Va DESPUÉS de mantenimiento a propósito: "gerente de seguridad e higiene y
-- mantenimiento" pertenece a mantenimiento, que es quien decide la póliza.
create or replace function app.research_role_category(target_role_title text)
returns text language plpgsql immutable set search_path to 'public','pg_catalog' as $function$
declare normalized text:=regexp_replace(lower(public.unaccent(coalesce(target_role_title,''))),'[^a-z0-9]+',' ','g');
begin
  if normalized ~ '(^| )(ceo|chief executive officer|director general|gerente general|managing director|founder|fundador|fundadora|owner|propietario|propietaria|dueno|duena)( |$)'
    then return 'CEO';
  elsif normalized ~ '(^| )(plant (director|manager|head)|site (director|manager|head)|director de planta|directora de planta|gerente de planta|jefe de planta|jefa de planta|director de operaciones de planta|directora de operaciones de planta|gerente de operaciones de planta)( |$)'
    then return 'PLANT_DIRECTOR';
  elsif normalized ~ '(^| )(maintenance|mantenimiento|facilities (director|manager|head)|facility (director|manager|head)|gerente de instalaciones|jefe de instalaciones|jefa de instalaciones)( |$)'
    then return 'MAINTENANCE';
  elsif normalized ~ '(^| )(procurement|purchasing|compras|adquisiciones|strategic sourcing|sourcing manager|buyer|comprador|compradora|supply chain (director|manager|head))( |$)'
    then return 'PROCUREMENT';
  elsif normalized ~ '(^| )(ehs|hse|sso|hseq|safety|seguridad e higiene|seguridad industrial|higiene y seguridad|salud y seguridad|seguridad y salud|health and safety|environment health and safety|proteccion civil|coordinador de seguridad|coordinadora de seguridad|jefe de seguridad|jefa de seguridad|gerente de seguridad|supervisor de seguridad|supervisora de seguridad)( |$)'
    then return 'SAFETY';
  else return 'OTHER'; end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- B. La restricción acepta el dominio ampliado
-- ---------------------------------------------------------------------------
alter table public.research_contact_candidates
  drop constraint if exists research_contact_candidates_role_category_check;
alter table public.research_contact_candidates
  add constraint research_contact_candidates_role_category_check
  check (role_category = any (array['CEO','PLANT_DIRECTOR','MAINTENANCE','PROCUREMENT','SAFETY','OTHER']));

-- ---------------------------------------------------------------------------
-- C. Alta, verificación e inventario cuentan SAFETY
-- ---------------------------------------------------------------------------
-- Se parchea la definición VIVA de cada función y se verifica el reemplazo. Si
-- un ancla no aparece la migración falla, en vez de dejar el sistema a medias
-- con una categoría que se puede escribir pero no se puede verificar ni contar.
do $migration$
declare
  objetivo record;
  definition text;
  patched text;
begin
  for objetivo in
    select * from (values
      ('upsert_contact_candidate',   '''CEO'',''PLANT_DIRECTOR'',''MAINTENANCE'',''PROCUREMENT'',''OTHER'''),
      ('verify_contact_candidate',   '''CEO'',''PLANT_DIRECTOR'',''MAINTENANCE'',''PROCUREMENT'''),
      ('assess_research_inventory',  '''CEO'',''PLANT_DIRECTOR'',''MAINTENANCE'',''PROCUREMENT''')
    ) as t(nombre, ancla)
  loop
    select pg_get_functiondef(p.oid) into definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = objetivo.nombre;

    if definition is null then
      raise exception 'M043_FUNCION_NO_ENCONTRADA_%', objetivo.nombre;
    end if;

    if position('SAFETY' in definition) > 0 then continue; end if;

    if objetivo.nombre = 'upsert_contact_candidate' then
      patched := replace(definition, objetivo.ancla,
        '''CEO'',''PLANT_DIRECTOR'',''MAINTENANCE'',''PROCUREMENT'',''SAFETY'',''OTHER''');
    else
      patched := replace(definition, objetivo.ancla,
        '''CEO'',''PLANT_DIRECTOR'',''MAINTENANCE'',''PROCUREMENT'',''SAFETY''');
    end if;

    if patched = definition then
      raise exception 'M043_ANCLA_NO_ENCONTRADA_%', objetivo.nombre;
    end if;

    execute patched;
  end loop;
end
$migration$;

-- ---------------------------------------------------------------------------
-- D. Comprobación: el clasificador debe reconocer los cargos reales
-- ---------------------------------------------------------------------------
do $verificacion$
begin
  if app.research_role_category('Coordinador de Seguridad e Higiene') <> 'SAFETY' then
    raise exception 'M043_SAFETY_NO_CLASIFICA';
  end if;
  if app.research_role_category('EHS Manager') <> 'SAFETY' then
    raise exception 'M043_EHS_NO_CLASIFICA';
  end if;
  -- Mantenimiento sigue ganando cuando el cargo mezcla ambas áreas.
  if app.research_role_category('Gerente de Mantenimiento') <> 'MAINTENANCE' then
    raise exception 'M043_MANTENIMIENTO_REGRESION';
  end if;
  if app.research_role_category('Director General') <> 'CEO' then
    raise exception 'M043_CEO_REGRESION';
  end if;
end
$verificacion$;

commit;
