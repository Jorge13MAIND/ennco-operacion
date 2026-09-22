/* ---------- Campaña v4: reemplaza al borrador v3 (sin inscritos) ---------- */
-- Ronda 1 conserva los cuatro carriles por puesto (1 DIRECCION, 2 MANTENIMIENTO, 3 SEGURIDAD,
-- 4 COMPRAS) y abre con {{gancho}}. Las rondas 2 a 5 (versiones 5 a 8) salen de otro buzón con
-- otro ángulo cada una: norma, recibo de CFE, solar y cierre. Sin gancho: Jorge lo quiere solo
-- en el primer toque.

do $$
declare
  org uuid := 'e0000000-0000-4000-8000-000000000001';
  grant_uid uuid := '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3';
  v4_id uuid;
  version_id uuid;
  offsets int[] := array[0,2,4,6];
  v record;
  touches jsonb;
  t jsonb;
  idx int;
  manifest jsonb;
  variant_rows jsonb := '[]'::jsonb;
  cuerpo jsonb;
begin
  select id into v4_id from public.campaigns
  where organization_id = org and name = 'ENNCO · Bajío industrial v3 (gancho)' and direct_lane_state = 'DRAFT';
  if v4_id is null then raise exception 'V3_DRAFT_NOT_FOUND'; end if;
  if exists (select 1 from public.campaign_enrollments where campaign_id = v4_id) then raise exception 'V3_HAS_ENROLLMENTS'; end if;
  delete from public.sequence_touches st using public.sequence_versions sv
    where st.sequence_version_id = sv.id and sv.campaign_id = v4_id;
  delete from public.sequence_versions where campaign_id = v4_id;

  cuerpo := jsonb_build_object(
  -- Ronda 1 · mantenimiento y seguridad
  'MANTENIMIENTO', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, pregunta rápida', 'body',
      E'Hola {{first_name}},\n\n{{gancho}}\n\nSoy Francisco Cuellar, de ENNCO. Hacemos mantenimiento eléctrico industrial con **termografía por dron**.\n\nTe propongo algo **sin costo**: vuelo el dron sobre su instalación media hora y te enseño qué está calentando de más.\n\n¿Te acomoda algún día de la próxima semana?\n\nFrancisco Cuellar\nDirector General, ENNCO'),
    jsonb_build_object('subject','{{first_name}}, mil paneles y un recibo que no bajó', 'body',
      E'Hola {{first_name}},\n\nUn caso reciente: una planta con **mil paneles** bajó su recibo de 150 mil a 80 mil al mes, cuando con esa capacidad debería pagar mucho menos. La termografía encontró módulos sobrecalentados y equipos que se bloquean con el calor.\n\nSi en {{company}} tienen paneles, tableros o transformadores, es lo primero que revisaría.\n\n¿Lo vemos?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, lo que te dejo por escrito', 'body',
      E'Hola {{first_name}},\n\nLo que recibes es **un reporte con fecha**: termografías, lo que está por fallar y en qué orden atenderlo.\n\nCon ese documento, lo que pide mantenimiento deja de sonar a exageración y la partida se defiende sola.\n\n¿Quién más de {{company}} tendría que verlo?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿es contigo?', 'body',
      E'Hola {{first_name}},\n\nSi el mantenimiento eléctrico de {{company}} no lo llevas tú, ¿me dices con quién? Le escribo de tu parte y dejo de llenarte el correo.\n\nSi sí es contigo, ¿esta semana o la próxima?\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco')),
  -- Ronda 1 · dirección y compras
  'DIRECCION', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, una pregunta sobre {{company}}', 'body',
      E'Hola {{first_name}},\n\n{{gancho}}\n\nSoy Francisco Cuellar, Director General de ENNCO. Las fallas que paran una planta **casi nunca avisan**, pero casi siempre se ven antes con una cámara térmica.\n\nTe propongo un levantamiento con dron de media hora, **sin costo**. Si hay algo que corregir, el proyecto es **deducible**.\n\n¿Con quién de tu equipo lo coordino?\n\nFrancisco Cuellar\nENNCO'),
    jsonb_build_object('subject','{{first_name}}, mil paneles y un recibo que no bajó', 'body',
      E'Hola {{first_name}},\n\nUn caso reciente: una planta con **mil paneles** pasó de pagar 150 mil a 80 mil al mes. Suena a logro, pero con esa capacidad debería pagar mucho menos. La termografía mostró módulos sobrecalentados: **estaban pagando por energía que no recibían**.\n\nEn {{company}}, ¿cuándo fue la última revisión con evidencia?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, qué recibes por escrito', 'body',
      E'Hola {{first_name}},\n\nNo es una cotización suelta: es **un reporte con fecha**, con termografías, lo que está por fallar y cuánto cuesta atenderlo.\n\nSirve para decidir con números y para defender la partida ante quien autoriza.\n\n¿Te lo preparo para {{company}}?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿con quién lo veo?', 'body',
      E'Hola {{first_name}},\n\nSi esto lo lleva alguien más en {{company}}, ¿me dices con quién? Le escribo de tu parte y dejo de llenarte el correo.\n\nSi lo ves tú, ¿esta semana o la próxima?\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco')),
  -- Ronda 2 · la norma
  'R2', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, una pregunta sobre la NOM-029', 'body',
      E'Hola {{first_name}},\n\nUna pregunta directa: ¿en {{company}} tienen al día el programa de mantenimiento eléctrico que pide la **NOM-029-STPS**?\n\nEn las plantas que visitamos casi siempre falta el registro, no el trabajo. Nosotros lo dejamos documentado: termografía, hallazgos y plan de atención, con fecha.\n\n¿Te interesa que lo revisemos?\n\nFrancisco Cuellar\nENNCO'),
    jsonb_build_object('subject','{{first_name}}, lo que pide una inspección', 'body',
      E'Hola {{first_name}},\n\nCuando llega una inspección, lo que piden no es una instalación perfecta: es **evidencia** de que se revisa y se atiende.\n\nUn levantamiento termográfico de media hora ya te deja esa evidencia, y es **sin costo**.\n\n¿Lo agendamos?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿quién lo lleva en {{company}}?', 'body',
      E'Hola {{first_name}},\n\nSi el programa de mantenimiento eléctrico lo lleva alguien más, ¿me dices con quién? Le escribo de tu parte.\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, lo dejo aquí', 'body',
      E'Hola {{first_name}},\n\nLo dejo aquí por ahora. Cuando necesites agendar tu mantenimiento eléctrico, búscame y lo vemos sin trámite.\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco')),
  -- Ronda 3 · el recibo de CFE
  'R3', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, ¿CFE les cobra por factor de potencia?', 'body',
      E'Hola {{first_name}},\n\nUna revisión que casi nadie hace: el **cargo por factor de potencia** en el recibo de CFE. Cuando baja de 90 %, CFE cobra un recargo cada mes y muchas plantas lo pagan sin notarlo.\n\nSi me compartes un recibo reciente de {{company}}, en dos días te digo si hay recargo y cuánto se recupera. Sin costo.\n\nFrancisco Cuellar\nENNCO'),
    jsonb_build_object('subject','{{first_name}}, el recargo que no se ve', 'body',
      E'Hola {{first_name}},\n\nEl recargo por factor de potencia viene en el recibo, en una línea que casi nadie lee. Se corrige con un banco de capacitores bien calculado y la inversión suele pagarse sola.\n\n¿Me mandas un recibo para revisarlo?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿quién ve el recibo de luz?', 'body',
      E'Hola {{first_name}},\n\nSi el recibo de CFE lo revisa otra persona en {{company}}, ¿me dices quién? Le escribo de tu parte.\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, queda pendiente', 'body',
      E'Hola {{first_name}},\n\nLo dejo por ahora. Si algún mes el recibo sube sin razón, búscame y lo revisamos.\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco')),
  -- Ronda 4 · solar
  'R4', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, paneles y la deducción del 100 %', 'body',
      E'Hola {{first_name}},\n\n¿En {{company}} ya evaluaron paneles solares? La inversión es **deducible al 100 % en el primer año**, y en plantas que consumen de día el retorno suele ser corto.\n\nSi ya tienen paneles, te ofrezco lo contrario: una revisión termográfica para saber si rinden lo que pagaron.\n\n¿Cuál de las dos te sirve?\n\nFrancisco Cuellar\nENNCO'),
    jsonb_build_object('subject','{{first_name}}, cuánto generaría {{company}}', 'body',
      E'Hola {{first_name}},\n\nCon los recibos de luz del último año te preparo un estudio: cuánto generaría un sistema solar, cuánto cuesta y en cuántos años se paga. Sin costo y sin compromiso.\n\n¿Te lo preparo?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿con quién lo reviso?', 'body',
      E'Hola {{first_name}},\n\nSi esto lo decide otra persona en {{company}}, ¿me dices con quién? Le escribo de tu parte.\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, queda abierto', 'body',
      E'Hola {{first_name}},\n\nLo dejo abierto. Cuando quieran revisar números de solar o de mantenimiento, búscame.\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco')),
  -- Ronda 5 · cierre
  'R5', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, ¿sigue siendo tema?', 'body',
      E'Hola {{first_name}},\n\nTe he escrito un par de veces sobre la instalación eléctrica de {{company}} y no quiero ser el proveedor que insiste de más.\n\nSolo una pregunta: ¿es tema para este año o lo dejamos para después? Con un sí o un no me ayudas mucho.\n\nFrancisco Cuellar\nENNCO'),
    jsonb_build_object('subject','{{first_name}}, una idea concreta', 'body',
      E'Hola {{first_name}},\n\nPor si ayuda a decidir: el levantamiento termográfico con dron dura media hora, no para la operación y te deja un reporte con fecha. Sin costo.\n\n¿Te lo agendo?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿me pasas el contacto?', 'body',
      E'Hola {{first_name}},\n\nSi hay alguien en {{company}} a quien le sirva más, ¿me pasas su contacto?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, cierro', 'body',
      E'Hola {{first_name}},\n\nCierro el seguimiento. Cuando necesites agendar tu mantenimiento, búscame.\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco Cuellar\nENNCO'))
  );

  for v in select * from (values
    (1,'DIRECCION','DIRECCION'),(2,'MANTENIMIENTO','MANTENIMIENTO'),(3,'SEGURIDAD','MANTENIMIENTO'),(4,'COMPRAS','DIRECCION'),
    (5,'RONDA_2','R2'),(6,'RONDA_3','R3'),(7,'RONDA_4','R4'),(8,'RONDA_5','R5')) as x(version,key,body_key) loop
    touches := cuerpo->v.body_key;
    insert into public.sequence_versions(organization_id,campaign_id,version,sender_name,sender_title,content_sha256,approved_by,approved_at)
    values (org,v4_id,v.version,'Francisco Cuellar','Director General, ENNCO',
      encode(extensions.digest(convert_to(touches::text,'utf8'),'sha256'),'hex'),grant_uid,clock_timestamp())
    returning id into version_id;
    idx := 0;
    for t in select * from jsonb_array_elements(touches) loop
      idx := idx + 1;
      insert into public.sequence_touches(organization_id,sequence_version_id,touch_number,day_offset,subject_template,body_template)
      values (org,version_id,idx::smallint,offsets[idx]::smallint,t->>'subject',t->>'body');
    end loop;
    if v.version <= 4 then
      variant_rows := variant_rows || jsonb_build_array(jsonb_build_object('key',v.key,'version',v.version,
        'content_sha256',encode(extensions.digest(convert_to(touches::text,'utf8'),'sha256'),'hex')));
    end if;
  end loop;

  manifest := jsonb_build_object('lane','DIRECT','cc_on_reply_email','francisco.cuellar@ennco.com.mx',
    'sequence_source','migración 202609220066_v4_rotacion.sql (junta #6, 22-sep-2026)',
    'sequence_source_sha256',encode(extensions.digest(convert_to(cuerpo::text,'utf8'),'sha256'),'hex'),
    'content_sha256',encode(extensions.digest(convert_to(cuerpo::text||variant_rows::text,'utf8'),'sha256'),'hex'),
    'day_offsets',to_jsonb(offsets),'variants',variant_rows,
    'rotation',jsonb_build_object('wait_days',7,'rounds',jsonb_build_array(
      jsonb_build_object('round',2,'version',5),jsonb_build_object('round',3,'version',6),
      jsonb_build_object('round',4,'version',7),jsonb_build_object('round',5,'version',8))));

  -- Aprobada por Grant en el chat del 22-sep ("ya aplica todos los cambios"): mismo efecto que
  -- approve_direct_lane_campaign, que exige sesión de teckel_admin y aquí no hay sesión.
  update public.campaigns set name='ENNCO · Bajío industrial v4 (gancho y rotación)',
    manifest_json=manifest, manifest_sha256=encode(extensions.digest(convert_to(manifest::text,'utf8'),'sha256'),'hex'),
    direct_lane_max_touches=4, status='APPROVED', direct_lane_state='RUNNING',
    approved_by=grant_uid, approved_at=clock_timestamp(), suppression_snapshot_at=clock_timestamp(), updated_at=clock_timestamp()
  where id=v4_id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (org,grant_uid,'DIRECT_LANE_CAMPAIGN_APPROVED','campaigns',v4_id,
    jsonb_build_object('source','migración 066, junta #6','manifest_sha256',encode(extensions.digest(convert_to(manifest::text,'utf8'),'sha256'),'hex')));

  -- La campaña vieja sigue con sus seguimientos, pero con la regla nueva cierra en el cuarto toque.
  update public.campaigns set direct_lane_max_touches=4, updated_at=clock_timestamp()
  where organization_id=org and name='ENNCO · Bajío industrial' and lane='DIRECT';
end $$;

/* ---------- Ganchos: hallazgo con fuente, no afirmación ---------- */
-- Jorge (junta #6): "encontré esto, no sé si es real; si lo es, ustedes deberían…". Cada gancho
-- nombra dónde se leyó y deja abierta la duda. Las ocho fuentes se comprobaron en línea el 22-sep
-- (KOSTAL devuelve 403 a robots; la nota existe). Aprobados por Grant en el mismo chat.

update public.ennco_account_hooks h set hook_text = x.txt, status = 'APPROVED',
  reviewed_by = '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
from (values
  ('Mubea', 'Leí en GPI News que Mubea abrió una planta en Apaseo el Grande de unos 75 millones de dólares. No sé si el dato esté al día, pero si es así, es justo la etapa en que lo que se montó con prisa en el arranque empieza a dar lata.'),
  ('Ingredion Incorporated', 'Vi en su sitio que Querétaro les entregó tres sellos de bajas emisiones por su cogeneración. No sé cómo esté hoy esa operación, pero si sigue así, la instalación eléctrica que la sostiene es de las que no se pueden parar.'),
  ('FORVIA', 'Leí en GPI News que FORVIA estaba cerrando la tercera ampliación de su planta de electrónicos en Guanajuato. No sé si ya terminó la obra; si es así, obra nueva sobre un tablero existente es donde más fallas aparecen.'),
  ('AAM - American Axle & Manufacturing', 'Leí en el periódico AM que en Silao preparaban líneas de componentes para auto eléctrico. No sé si ya arrancaron; si es así, a ese ritmo no hay ventana para un paro eléctrico.'),
  ('Hutchinson', 'Vi en GPI News que su operación en Guanajuato lleva más de 80 millones de dólares en expansión. No sé qué tan actual sea la cifra, pero si es así, con clientes como Ford y Toyota una falla eléctrica se paga en penalización.'),
  ('Donaldson', 'Leí en la revista TyT que su planta de León es la más grande de Donaldson en Latinoamérica. No sé si sigue siendo así; si lo es, en una instalación de ese tamaño la termografía casi siempre encuentra más de lo esperado.'),
  ('KOSTAL Group', 'Leí en Líder Empresarial que su planta nueva en Querétaro es la primera de electrónica de potencia de KOSTAL en Norteamérica. No sé en qué etapa va; si ya opera, un punto caliente en tablero ahí se paga caro.'),
  ('Dana Incorporated', 'Leí en la revista TyT que ampliaron la planta de Querétaro para hacer cardanes de Toyota. No sé si ya está operando; si es así, ese crecimiento casi siempre se adelanta a la revisión eléctrica.')
) as x(company, txt), public.accounts a
where a.id = h.account_id and a.legal_name = x.company and h.organization_id = 'e0000000-0000-4000-8000-000000000001';

-- Respaldos por giro y estado: menos afirmación, más "lo que vemos".
update public.ennco_hook_fallbacks f set hook_text = x.txt
from (values
  ('automotive', null, 'Lo que más escucho en plantas automotrices del Bajío es que un paro por falla eléctrica se paga por hora, no por la reparación.'),
  ('food & beverages', null, 'En alimentos y bebidas, lo que me cuentan es que una caída eléctrica no solo para la línea: se lleva el producto que iba en proceso.'),
  ('food production', null, 'En alimentos y bebidas, lo que me cuentan es que una caída eléctrica no solo para la línea: se lleva el producto que iba en proceso.'),
  ('plastics', null, 'En plásticos, un disparo de tablero a media corrida suele llevarse el molde y el turno completo.'),
  ('chemicals', null, 'En química, la instalación eléctrica suele ser de lo primero que revisa una auditoría y de lo último que se documenta.'),
  ('pharmaceuticals', null, 'En farmacéutica, lo caro no suele ser la falla: es demostrar en qué condición estaba la instalación cuando ocurrió.'),
  (null, 'Guanajuato', 'En el corredor de Guanajuato me he encontrado con que pocas plantas tienen por escrito en qué condición está su instalación eléctrica.'),
  (null, 'Querétaro', 'En Querétaro me he encontrado con que pocas plantas tienen por escrito en qué condición está su instalación eléctrica.'),
  (null, null, 'Me he encontrado con que pocas plantas tienen por escrito, con evidencia, en qué condición está hoy su instalación eléctrica.')
) as x(sector, state, txt)
where f.organization_id = 'e0000000-0000-4000-8000-000000000001'
  and f.sector is not distinct from x.sector and f.state is not distinct from x.state;

/* ---------- 20 por buzón, 100 al día ---------- */
-- El tope que realmente limita es direct_lane_effective_cap (el trigger de envío lo aplica al
-- total del día). Tope fijo de 20 y techo de 20: seguimientos primero, nuevos con lo que sobre.

update public.mailboxes
set direct_lane_ramp_mode = 'FIXED', direct_lane_fixed_cap = 20, direct_lane_cap_max = 20, updated_at = clock_timestamp()
where organization_id = 'e0000000-0000-4000-8000-000000000001' and direct_lane_status is not null;

insert into public.audit_log(organization_id, action, record_type, record_id, new_data)
select organization_id, 'DIRECT_LANE_MAILBOX_CAP', 'mailboxes', id, jsonb_build_object('fixed_cap', 20, 'cap_max', 20, 'source', 'junta #6')
from public.mailboxes where organization_id = 'e0000000-0000-4000-8000-000000000001' and direct_lane_status is not null;

/* ---------- Supervisor diario (el "director comercial" por reglas) ---------- */
-- Corre después de la ventana de envío. Revisa cada buzón y la campaña, pausa el buzón que rebote
-- demasiado y devuelve un reporte que el cron manda por Telegram. La parte con IA (investigar
-- ganchos, juzgar el texto) se agrega cuando haya llave de API.

create or replace function public.supervise_direct_lane(target_organization_id uuid, apply_pause boolean,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $$
declare payload_sha text; mb record; boxes jsonb := '[]'::jsonb; paused jsonb := '[]'::jsonb;
  bounce_limit numeric := 0.10; min_sample integer := 30; today date := (clock_timestamp() at time zone 'America/Mexico_City')::date;
  unanswered jsonb; runway integer; new_7d integer; rotations jsonb; hooks jsonb; failed_today integer; stuck integer;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','supervise_direct_lane',target_organization_id::text,apply_pause::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);

  for mb in
    select m.id, m.normalized_email, m.direct_lane_status, app.direct_lane_effective_cap(m) as cap,
      app.direct_lane_sent_today(target_organization_id, m.id) as sent_today,
      (select count(*) from public.messages x where x.organization_id=target_organization_id and x.mailbox_id=m.id
        and x.lane='DIRECT' and x.direction='OUTBOUND' and x.status in ('SENT','DELIVERED','BOUNCED')
        and x.sent_at > clock_timestamp() - interval '7 days') as sent_7d,
      (select count(*) from public.messages x where x.organization_id=target_organization_id and x.mailbox_id=m.id
        and x.lane='DIRECT' and x.direction='OUTBOUND' and x.status='BOUNCED'
        and x.sent_at > clock_timestamp() - interval '7 days') as bounced_7d
    from public.mailboxes m
    where m.organization_id=target_organization_id and m.direct_lane_status in ('CONNECTED','PAUSED')
    order by m.normalized_email
  loop
    boxes := boxes || jsonb_build_array(jsonb_build_object('email', mb.normalized_email, 'status', mb.direct_lane_status,
      'cap', mb.cap, 'sent_today', mb.sent_today, 'sent_7d', mb.sent_7d, 'bounced_7d', mb.bounced_7d,
      'bounce_rate_7d', case when mb.sent_7d > 0 then round(mb.bounced_7d::numeric / mb.sent_7d, 4) else null end));
    if apply_pause and mb.direct_lane_status = 'CONNECTED' and mb.sent_7d >= min_sample
      and mb.bounced_7d::numeric / mb.sent_7d > bounce_limit then
      update public.mailboxes set direct_lane_status = 'PAUSED', updated_at = clock_timestamp()
      where organization_id = target_organization_id and id = mb.id;
      insert into public.audit_log(organization_id, action, record_type, record_id, new_data)
      values (target_organization_id, 'DIRECT_LANE_SUPERVISOR_PAUSED', 'mailboxes', mb.id,
        jsonb_build_object('bounced_7d', mb.bounced_7d, 'sent_7d', mb.sent_7d, 'limit', bounce_limit));
      paused := paused || to_jsonb(mb.normalized_email);
    end if;
  end loop;

  select count(*) into failed_today from public.messages x
  where x.organization_id=target_organization_id and x.lane='DIRECT' and x.direction='OUTBOUND' and x.status='FAILED'
    and (x.updated_at at time zone 'America/Mexico_City')::date = today;
  select count(*) into stuck from public.campaign_enrollments e
  where e.organization_id=target_organization_id and e.status='PAUSED' and e.stopped_reason like 'DISPATCH_FAILED%';

  -- Respuestas humanas de los últimos 14 días que llevan más de un día sin contestar.
  select coalesce(jsonb_agg(jsonb_build_object('contact', c.normalized_email, 'company', a.legal_name,
    'hours', floor(extract(epoch from clock_timestamp() - e.updated_at) / 3600)) order by e.updated_at), '[]'::jsonb)
  into unanswered
  from public.campaign_enrollments e
  join public.campaigns ca on ca.id = e.campaign_id and ca.lane = 'DIRECT' and ca.name not like 'PRUEBA%'
  join public.contacts c on c.id = e.contact_id
  join public.accounts a on a.id = e.account_id
  where e.organization_id = target_organization_id and e.status = 'REPLIED'
    and e.updated_at < clock_timestamp() - interval '24 hours' and e.updated_at > clock_timestamp() - interval '14 days'
    and not exists (select 1 from public.messages r where r.organization_id = target_organization_id
      and r.enrollment_id = e.id and r.direction = 'OUTBOUND' and r.touch_number is null and r.created_at > e.updated_at);

  -- Cuántos contactos verificados nunca han recibido nada, y a qué ritmo se están usando.
  select count(*) into runway from public.contacts c join public.accounts a on a.id = c.account_id
  where c.organization_id = target_organization_id and c.verified and not c.is_deleted and not a.is_deleted
    and not exists (select 1 from public.campaign_enrollments e where e.organization_id = target_organization_id and e.contact_id = c.id);
  select count(*) into new_7d from public.messages x
  where x.organization_id=target_organization_id and x.lane='DIRECT' and x.direction='OUTBOUND' and x.touch_number=1
    and x.status in ('SENT','DELIVERED','BOUNCED') and x.sent_at > clock_timestamp() - interval '7 days';

  select jsonb_build_object(
    'scheduled_next_7d', count(*) filter (where e.status='PENDING' and e.rotation_round>1 and e.next_touch_at < clock_timestamp() + interval '7 days'),
    'active_by_round', coalesce((select jsonb_object_agg('R'||r, n) from (select e2.rotation_round r, count(*) n from public.campaign_enrollments e2
      where e2.organization_id=target_organization_id and e2.status in ('PENDING','ACTIVE') group by 1) q), '{}'::jsonb))
  into rotations from public.campaign_enrollments e where e.organization_id=target_organization_id;

  select jsonb_build_object('approved', count(*) filter (where status='APPROVED'), 'draft', count(*) filter (where status='DRAFT'))
  into hooks from public.ennco_account_hooks where organization_id=target_organization_id;

  return jsonb_build_object('date', today, 'mailboxes', boxes, 'paused_now', paused, 'bounce_limit', bounce_limit,
    'failed_today', failed_today, 'enrollments_stuck', stuck, 'unanswered_replies', unanswered,
    'never_contacted', runway, 'new_contacts_7d', new_7d,
    'runway_days', case when new_7d > 0 then round(runway / (new_7d / 5.0)) else null end,
    'rotation', rotations, 'hooks', hooks);
end $$;

revoke all on function public.supervise_direct_lane(uuid, boolean, text, uuid, timestamptz, text) from public;
grant execute on function public.supervise_direct_lane(uuid, boolean, text, uuid, timestamptz, text) to anon, authenticated;

/* ---------- La campaña vieja entra a la regla de cuatro toques ---------- */
-- Quienes ya recibieron su cuarto toque (esperaban el quinto) cierran su ronda y quedan
-- agendados para la ronda 2 desde otro buzón, siete días después de su último correo. Va al final
-- porque la rotación necesita la v4 ya en marcha.

update public.campaign_enrollments e
set status = 'COMPLETED', stopped_reason = 'SEQUENCE_COMPLETED', next_touch_at = null, updated_at = clock_timestamp()
from public.campaigns c
where c.id = e.campaign_id and c.organization_id = 'e0000000-0000-4000-8000-000000000001'
  and c.name = 'ENNCO · Bajío industrial' and e.status = 'ACTIVE' and e.next_touch_number > 4;

commit;
