begin;

-- Secuencia v3 (22-sep-2026): seis toques en catorce días, con la voz de Paco y el gancho por empresa.
--
-- Qué cambia frente a la v1 que corre hoy:
--   · Cadencia 0-2-4-6-9-14 en vez de 0-3-7-14-28-42-60-75. Seis toques, no ocho.
--   · Abre con lo único que ha abierto puertas: el levantamiento termográfico con dron, gratis
--     y sin compromiso (junta #5: "no tiene costo, vuelo el dron, ellos ven lo que se hace").
--   · Cuenta el caso real de los mil paneles (recibo de 150 mil a 80 mil sin ahorro real).
--   · Vende el entregable escrito, que es el arma contra la objeción de Paco: "el segundo al
--     mando no le transmite al director… se hacen bolas con los números" (junta #1).
--   · Menciona la deducción del 30 % de ISR solo en el hilo de dirección y compras.
--   · Primer párrafo = {{gancho}}: la línea propia de esa planta, con fuente. Si no hay, desaparece.
--
-- Dos ángulos sobre los cuatro carriles por puesto que ya tenía el motor:
--   MANTENIMIENTO y SEGURIDAD → lo que está por fallar y el documento para defender la partida.
--   DIRECCION y COMPRAS       → lo que cuesta un paro y la deducibilidad.
--
-- Queda en DRAFT. Nadie recibe nada de esta campaña hasta que Jorge y Paco aprueben el texto y
-- alguien la ponga en RUNNING. La campaña vieja sigue corriendo con sus seguimientos.

do $$
declare
  org uuid := 'e0000000-0000-4000-8000-000000000001';
  campaign_id uuid;
  version_id uuid;
  offsets int[] := array[0,2,4,6,9,14];
  variant record;
  touches jsonb;
  t jsonb;
  idx int;
  manifest jsonb;
  variant_rows jsonb := '[]'::jsonb;
  firma_mant text := E'Francisco Cuellar\nDirector General, ENNCO';
  cuerpo jsonb;
begin
  if exists (select 1 from public.campaigns where organization_id=org and name='ENNCO · Bajío industrial v3 (gancho)') then
    raise notice 'la campaña v3 ya existe, no se vuelve a crear'; return;
  end if;

  -- Hilo A · mantenimiento, seguridad: lo que está por fallar y el reporte por escrito.
  cuerpo := jsonb_build_object('MANTENIMIENTO', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, los módulos que están en rojo', 'body',
      E'Hola {{first_name}},\n\n{{gancho}}\n\nSoy Francisco Cuellar, de ENNCO. Hacemos consultoría eléctrica industrial: mantenimiento de instalaciones fotovoltaicas, transformadores y tableros, con **termografía por dron**.\n\nTe propongo algo **sin costo y sin compromiso**: vuelo el dron térmico sobre su instalación, media hora, y te enseño en el momento qué módulos y qué conexiones están calentando más de lo que deberían.\n\n¿Qué día de la próxima semana te acomoda que pase?\n\n' || firma_mant),
    jsonb_build_object('subject','{{first_name}}, mil paneles y un recibo que no bajó', 'body',
      E'Hola {{first_name}},\n\nTe cuento un caso de hace unas semanas, porque se parece a lo que veo seguido.\n\nUna planta con **mil paneles** instalados pagaba 150 mil al mes de luz. Después de la instalación paga 80 mil. Suena bien hasta que haces la cuenta: con esa capacidad debería estar pagando mucho menos. La termografía mostró **módulos sobrecalentados y equipos mal ubicados que se bloquean con el calor**. Media hora de dron, y un plan de corrección.\n\nSi en {{company}} ya tienen paneles, es lo primero que revisaría. Si no, lo mismo aplica a tableros y transformadores.\n\n¿Te sirve que lo veamos?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, qué te dejo por escrito', 'body',
      E'Hola {{first_name}},\n\nPara que sepas qué recibes si me abres la puerta: **un reporte con fecha**, con las termografías, lo que está por fallar y en qué orden conviene atenderlo.\n\nLo hago así porque el problema casi nunca es técnico: es que lo que mantenimiento pide **suena a exageración sin un documento que lo respalde**. Con el reporte, la partida se defiende sola con dirección y con compras.\n\n¿Quién más de {{company}} tendría que verlo?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿es contigo?', 'body',
      E'Hola {{first_name}},\n\nSi el mantenimiento eléctrico de {{company}} no lo llevas tú, ¿me dices con quién? Le escribo mencionando que tú me dirigiste y dejo de llenarte el correo.\n\nSi sí es contigo: ¿esta semana o la próxima para el levantamiento?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿te lo mando por escrito primero?', 'body',
      E'Hola {{first_name}},\n\nEntiendo si una visita ahora no cabe. ¿Te sirve que te mande primero, **por escrito**, qué revisaríamos y qué entregamos? Lo lees con calma y, si tiene sentido, lo agendamos.\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, cierro por ahora', 'body',
      E'Hola {{first_name}},\n\nCierro el seguimiento para no insistir. Gracias por el tiempo.\n\nCuando toque agendar el mantenimiento eléctrico o revisar la instalación de {{company}}, búscame: **se agenda sin más trámite**.\n\nSi prefieres que no te escriba más, responde "baja" y lo registro hoy mismo.\n\n' || firma_mant)
  ));

  -- Hilo B · dirección, compras: lo que cuesta un paro y la deducción fiscal.
  cuerpo := cuerpo || jsonb_build_object('DIRECCION', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, lo que cuesta un paro eléctrico', 'body',
      E'Hola {{first_name}},\n\n{{gancho}}\n\nSoy Francisco Cuellar, Director General de ENNCO. Lo que tira una planta **casi nunca avisa**, y casi siempre estaba a la vista de quien la revisó a tiempo con una cámara térmica.\n\nTe propongo, **sin costo**, un levantamiento termográfico con dron de media hora. Te dejo un reporte con fecha de lo que está por fallar, y si conviene hacer algo, el proyecto es **deducible al 100 %** (30 % de ISR).\n\n¿Con quién de tu equipo lo coordino?\n\n' || firma_mant),
    jsonb_build_object('subject','{{first_name}}, mil paneles y un recibo que no bajó', 'body',
      E'Hola {{first_name}},\n\nUn caso de hace unas semanas: una planta con **mil paneles** pagaba 150 mil al mes de luz y hoy paga 80 mil. Suena a logro hasta que haces la cuenta: con esa capacidad instalada debería pagar mucho menos.\n\nLa termografía mostró módulos sobrecalentados y equipos mal ubicados que se bloquean con el calor. **Están pagando por energía que no reciben.**\n\nEn {{company}}, ¿cuándo fue la última revisión con evidencia de la instalación eléctrica?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, qué recibes por escrito', 'body',
      E'Hola {{first_name}},\n\nLo que entregamos no es una cotización suelta: es **un reporte con fecha**, con termografías, lo que está por fallar y en qué orden conviene atenderlo, con su costo.\n\nSirve para dos cosas: decidir con números y **defender la partida** ante quien autoriza.\n\n¿Te lo preparo para {{company}}?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿con quién lo veo?', 'body',
      E'Hola {{first_name}},\n\nSi esto lo lleva alguien más en {{company}}, ¿me dices con quién? Le escribo mencionando que tú me dirigiste y dejo de llenarte el correo.\n\nSi lo ves tú: ¿esta semana o la próxima para el levantamiento, sin costo?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿te lo mando por escrito primero?', 'body',
      E'Hola {{first_name}},\n\nSi una visita ahora no cabe, te mando primero **por escrito** qué revisaríamos, qué entregamos y cómo se aplica la deducción del 30 %. Lo revisas con calma y, si tiene sentido, lo agendamos.\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, cierro por ahora', 'body',
      E'Hola {{first_name}},\n\nCierro el seguimiento para no insistir. Gracias por el tiempo.\n\nCuando toque revisar la instalación eléctrica de {{company}}, búscame: **se agenda sin más trámite**.\n\nSi prefieres que no te escriba más, responde "baja" y lo registro hoy mismo.\n\n' || firma_mant)
  ));

  insert into public.campaigns(organization_id,name,status,lane,direct_lane_state,manifest_json,manifest_sha256)
  values (org,'ENNCO · Bajío industrial v3 (gancho)','DRAFT','DIRECT','DRAFT','{}'::jsonb,
    encode(extensions.digest(convert_to('ennco-v3-'||now()::text,'utf8'),'sha256'),'hex'))
  returning id into campaign_id;

  -- Mismo orden de versiones que la campaña viva: 1 DIRECCION, 2 MANTENIMIENTO, 3 SEGURIDAD, 4 COMPRAS.
  for variant in select * from (values (1,'DIRECCION','DIRECCION'),(2,'MANTENIMIENTO','MANTENIMIENTO'),(3,'SEGURIDAD','MANTENIMIENTO'),(4,'COMPRAS','DIRECCION')) as v(version,key,angle) loop
    touches := cuerpo->variant.angle;
    insert into public.sequence_versions(organization_id,campaign_id,version,sender_name,sender_title,content_sha256)
    values (org,campaign_id,variant.version,'Francisco Cuellar','Director General, ENNCO',
      encode(extensions.digest(convert_to(touches::text,'utf8'),'sha256'),'hex'))
    returning id into version_id;
    idx := 0;
    for t in select * from jsonb_array_elements(touches) loop
      idx := idx + 1;
      insert into public.sequence_touches(organization_id,sequence_version_id,touch_number,day_offset,subject_template,body_template)
      values (org,version_id,idx::smallint,offsets[idx]::smallint,t->>'subject',t->>'body');
    end loop;
    variant_rows := variant_rows || jsonb_build_array(jsonb_build_object('key',variant.key,'version',variant.version,
      'content_sha256',encode(extensions.digest(convert_to(touches::text,'utf8'),'sha256'),'hex')));
  end loop;

  manifest := jsonb_build_object('lane','DIRECT','cc_on_reply_email','francisco.cuellar@ennco.com.mx',
    'sequence_source','migración 202609220065_secuencia_v3.sql',
    'sequence_source_sha256',encode(extensions.digest(convert_to(cuerpo::text,'utf8'),'sha256'),'hex'),
    'content_sha256',encode(extensions.digest(convert_to(cuerpo::text||variant_rows::text,'utf8'),'sha256'),'hex'),
    'day_offsets',to_jsonb(offsets),'variants',variant_rows);
  update public.campaigns set manifest_json=manifest, manifest_sha256=encode(extensions.digest(convert_to(manifest::text,'utf8'),'sha256'),'hex')
  where id=campaign_id;
end $$;

/* ---------- Ganchos de respaldo por sector ---------- */
-- Cuando una empresa no tiene gancho propio aprobado. No inventan nada de esa planta:
-- hablan de su sector y su corredor, que es información pública y verificable.

insert into public.ennco_hook_fallbacks(organization_id, sector, state, hook_text) values
  ('e0000000-0000-4000-8000-000000000001','automotive',null,'En la proveeduría automotriz del Bajío, un paro de línea por falla eléctrica se paga por hora, no por reparación.'),
  ('e0000000-0000-4000-8000-000000000001','food & beverages',null,'En alimentos y bebidas, una caída eléctrica no solo para la línea: compromete el producto que va en proceso.'),
  ('e0000000-0000-4000-8000-000000000001','food production',null,'En alimentos y bebidas, una caída eléctrica no solo para la línea: compromete el producto que va en proceso.'),
  ('e0000000-0000-4000-8000-000000000001','plastics',null,'En plásticos, un disparo de tablero a media corrida se lleva el molde y el turno completo.'),
  ('e0000000-0000-4000-8000-000000000001','chemicals',null,'En química, la instalación eléctrica es de las primeras cosas que revisa una auditoría y de las últimas que se documenta.'),
  ('e0000000-0000-4000-8000-000000000001','pharmaceuticals',null,'En farmacéutica, lo que cuesta caro no es la falla: es tener que demostrar en qué condición estaba la instalación cuando ocurrió.'),
  ('e0000000-0000-4000-8000-000000000001',null,'Guanajuato','En el corredor industrial de Guanajuato, casi ninguna planta tiene por escrito en qué condición está su instalación eléctrica.'),
  ('e0000000-0000-4000-8000-000000000001',null,'Querétaro','En Querétaro, casi ninguna planta tiene por escrito en qué condición está su instalación eléctrica.'),
  ('e0000000-0000-4000-8000-000000000001',null,null,'Casi ninguna planta tiene por escrito, con evidencia, en qué condición está hoy su instalación eléctrica.')
on conflict (organization_id, sector, state) do nothing;

commit;
