-- M053: vocabulario solar en la campana viva.
--
-- Paco, junta del 9-sep (Jorge y Grant presentes): "el negocio es solar". Sale
-- "acometidas" del toque 1 de MANTENIMIENTO ("instalaciones fotovoltaicas" en
-- su lugar) y la lista de servicios del toque 2 abre en las cuatro variantes
-- con "instalaciones y mantenimiento fotovoltaico", con las palabras de Paco.
--
-- El copy fuente y el JSON generado ya traen el cambio; esta migracion lo lleva
-- a la campana YA APROBADA, cuyo copy quedo congelado en sequence_touches. Igual
-- que la 051: se localiza por el sha de contenido del manifiesto (anterior o
-- nuevo, para poder reaplicarla), escribe asunto y cuerpo de los 32 toques
-- desde el JSON, actualiza los sha por variante y el manifiesto, y lo anota en
-- audit_log. En una base nueva (CI) no encuentra nada y no toca una fila.

do $$
declare
  sha_secuencia_anterior constant text := 'eaf154058d848f9cfea464e398b6c795dd99978ed41f66d726dc3c3ab021c90e';
  sha_secuencia_nueva    constant text := 'b1ec779fd7f29391ff89457639b748e99ae33adea7c7f9da0f8bc3cda8cdb7f6';
  sha_fuente_nueva       constant text := 'db30c4d5e0a1e60b2ccd0fc3886ad50f727f57d36a987b75a2b4c368923408f0';
  sha_por_variante constant jsonb := jsonb_build_object(
    '1', '049e808b7c63d8e87009c30800a668aea704e61f350f90f90edde59381245bf4',
    '2', '7aff5154239836eb50a8b09ab86170657398278bcdfeb2fdc6dc6b8c87b6c5c3',
    '3', 'ccd275161ea592b9355550f9ca514ac4a7dc9e944fcf08f973ece9cf62660ea4',
    '4', '21ccc342f653a6c993ed00d9c0e20c8d83ba3a30609126c69a47b2846c620fc1'
  );
  campana record;
  manifiesto jsonb;
  toques_actualizados integer;
begin
  for campana in
    select id, organization_id, manifest_json, manifest_sha256
    from public.campaigns
    where lane = 'DIRECT'
      and manifest_json->>'content_sha256' in (sha_secuencia_anterior, sha_secuencia_nueva)
  loop
    update public.sequence_touches st
    set subject_template = nuevo.subject_template,
        body_template = nuevo.body_template
    from (values
      (1, 1, '{{first_name}}, sobre tu instalación eléctrica.', 'Hola {{first_name}},

Soy Francisco Cuellar, Director General de ENNCO.

Te escribo porque trabajamos con plantas industriales en la parte eléctrica: mantenimiento, adecuaciones y el costo del servicio, y entregamos un reporte claro de qué conviene atender y qué no.

Ya va a terminar el año y sé que probablemente quieran lograr sus resultados financieros.

¿Cuándo podrías recibirme en tus oficinas para revisar cómo está su instalación y dejarte un análisis real de lo que encontremos?

Si tú no te encargas de llevar esto, ¿podrías dirigirme con la persona encargada por favor?

Saludos y espero saber de ti pronto.

Francisco Cuellar
Director General, ENNCO'),
      (1, 2, '{{first_name}}, sobre mi correo anterior', 'Hola {{first_name}},

Tal vez mi correo anterior no te pudo dar la claridad de qué hacemos y por qué es relevante para ti.

Hacemos esto:
Instalaciones y mantenimiento fotovoltaico, obra eléctrica industrial, subestaciones y transformadores, mantenimiento eléctrico y proyectos de energía.

Y te podemos ayudar con esto:
Bajar lo que pagan de luz, y que un problema eléctrico no les detenga la producción.

Avísame si puedo llamarte o programar una reunión con ustedes esta semana.

Saludos,

Francisco
Director General, ENNCO'),
      (1, 3, '{{first_name}}, sé que estás ocupado', 'Hola {{first_name}},

Sé que estás muy ocupado, pero así como ustedes tienen certeza de cuándo pueden aportar valor a un cliente, yo tengo total certeza de que puedo ayudarles considerablemente a bajar su costo de energía y a evitar paros por falla eléctrica.

¿Cuándo podemos platicar, o con quién de tu empresa debería platicar?

Saludos,

Francisco'),
      (1, 4, '{{first_name}}, su último mantenimiento eléctrico', 'Hola {{first_name}},

¿Cuándo fue la última vez que hicieron su mantenimiento eléctrico?

Hoy podrían estar pagando mucho más de luz y afectando su P&L por esto mismo.

¿Quieres que agende una visita para verificarlo, o cuándo tienen programado su siguiente mantenimiento?

Saludos,

Francisco'),
      (1, 5, '{{first_name}}, esto es importante para {{company}}', 'Hola {{first_name}},

Te insisto porque de verdad creo que esto es importante para {{company}}.

La instalación eléctrica es de las pocas cosas que, cuando fallan, paran todo. Y cuando está bien atendida, se nota en el recibo de luz cada mes.

¿Te parece si lo revisamos juntos, o me dices con quién lo debo ver?

Saludos,

Francisco'),
      (1, 6, '{{first_name}}, lo que no se ve en el recibo', 'Hola {{first_name}},

Si nunca han medido cómo está su instalación, lo más probable es que estén pagando de más sin saberlo. No es una falla de nadie, es que no se ve.

¿Me dejas mostrarte cómo se ve eso en números?

Saludos,

Francisco'),
      (1, 7, '{{first_name}}, ¿te lo mando por escrito?', 'Hola {{first_name}},

¿Te sirve si en lugar de una reunión te mando primero el análisis por escrito?

Así lo revisas con calma, lo pasas con quien tenga que verlo, y si tiene sentido nos sentamos después.

¿Te lo mando?

Saludos,

Francisco'),
      (1, 8, '{{first_name}}, cierro el tema', 'Hola {{first_name}},

Cierro el tema para no incomodarte. Te agradezco el tiempo.

Si en algún momento quieren revisar su instalación eléctrica o su costo de energía, aquí estoy.

Si prefieres que no te escriba más, respóndeme la palabra baja y lo registro hoy mismo.

Saludos,

Francisco'),
      (2, 1, '{{first_name}}, sobre tu instalación eléctrica.', 'Hola {{first_name}},

Soy Francisco Cuellar, Director General de ENNCO.

Te escribo porque trabajamos con plantas industriales en el mantenimiento de su instalación eléctrica: tableros, transformadores e instalaciones fotovoltaicas, y entregamos un reporte de lo que encontramos y de lo que conviene atender primero.

Sé que en tu área lo que cuenta es que la planta no se detenga.

¿Cuándo podrías recibirme para revisar cómo está la instalación y darte un análisis real de lo que encontremos?

Si esto no lo llevas tú, ¿podrías dirigirme con la persona encargada por favor?

Saludos y espero saber de ti pronto.

Francisco Cuellar
Director General, ENNCO'),
      (2, 2, '{{first_name}}, qué hacemos exactamente', 'Hola {{first_name}},

Tal vez mi correo anterior no te pudo dar la claridad de qué hacemos y por qué es relevante para ti.

Hacemos esto:
Instalaciones y mantenimiento fotovoltaico, mantenimiento eléctrico industrial, subestaciones, transformadores y tableros.

Y te podemos ayudar con esto:
Encontrar lo que está por fallar antes de que pare la línea, y dejarte por escrito en qué condición está todo.

Avísame si puedo llamarte o programar una reunión con ustedes esta semana.

Saludos,

Francisco
Director General, ENNCO'),
      (2, 3, '{{first_name}}, sé que traes mil cosas', 'Hola {{first_name}},

Sé que estás muy ocupado, pero así como tú sabes qué equipo te va a dar problemas antes de que los dé, yo tengo total certeza de que puedo ayudarles considerablemente a evitar un paro por falla eléctrica y a bajar su costo de energía.

¿Cuándo podemos platicar, o con quién de tu empresa debería platicar?

Saludos,

Francisco'),
      (2, 4, '{{first_name}}, ¿ya toca revisión?', 'Hola {{first_name}},

¿Cuándo fue la última vez que hicieron su mantenimiento eléctrico?

Hoy podrían estar pagando más de luz y con algo por fallar sin que se note todavía.

¿Quieres que agende una visita para verificarlo, o cuándo tienen programado su siguiente mantenimiento?

Saludos,

Francisco'),
      (2, 5, '{{first_name}}, esto es importante para {{company}}', 'Hola {{first_name}},

Te insisto porque de verdad creo que esto es importante para {{company}}.

Lo que tira una planta casi nunca avisa, y casi siempre estaba a la vista de quien la abrió a tiempo.

¿Te parece si lo revisamos juntos, o me dices con quién lo debo ver?

Saludos,

Francisco'),
      (2, 6, '{{first_name}}, con qué sustentar lo que pides', 'Hola {{first_name}},

Algo que me comentan seguido los jefes de mantenimiento: el problema no es técnico, es que lo que piden suena a exageración sin un documento que lo respalde.

El análisis que te dejo convierte tu criterio en un reporte con fecha.

¿Te lo preparo?

Saludos,

Francisco'),
      (2, 7, '{{first_name}}, el análisis por escrito', 'Hola {{first_name}},

¿Te sirve si en lugar de una reunión te mando primero el análisis por escrito?

Así lo revisas con calma, lo pasas con quien tenga que autorizarlo, y si tiene sentido nos sentamos después.

¿Te lo mando?

Saludos,

Francisco'),
      (2, 8, '{{first_name}}, cierro el seguimiento', 'Hola {{first_name}},

Cierro el seguimiento para no insistir. Te agradezco el tiempo.

Si en algún momento quieren revisar la instalación eléctrica de {{company}}, me escribes y lo agendamos sin más trámite.

Si prefieres que no te escriba más, respóndeme la palabra baja y lo registro hoy mismo.

Saludos,

Francisco'),
      (3, 1, '{{first_name}}, sobre tu instalación eléctrica.', 'Hola {{first_name}},

Soy Francisco Cuellar, Director General de ENNCO.

Te escribo porque trabajamos con plantas industriales revisando y documentando su instalación eléctrica: qué hay, en qué condiciones está y qué se atendió, listo para una auditoría.

Sé que en tu área lo que cuenta es poder demostrar en qué condiciones está todo, con fecha y por escrito.

¿Cuándo podrías recibirme para revisar la instalación y dejarte un análisis real de lo que encontremos?

Si esto no lo llevas tú, ¿podrías dirigirme con la persona encargada por favor?

Saludos y espero saber de ti pronto.

Francisco Cuellar
Director General, ENNCO'),
      (3, 2, '{{first_name}}, para que quede claro qué hacemos', 'Hola {{first_name}},

Tal vez mi correo anterior no te pudo dar la claridad de qué hacemos y por qué es relevante para ti.

Hacemos esto:
Instalaciones y mantenimiento fotovoltaico, revisión y mantenimiento de instalaciones eléctricas industriales, con reporte de lo observado.

Y te podemos ayudar con esto:
Que tengas por escrito y con fecha en qué condición está cada parte, y que lo que esté mal se corrija antes de que sea un problema.

Avísame si puedo llamarte o programar una reunión con ustedes esta semana.

Saludos,

Francisco
Director General, ENNCO'),
      (3, 3, '{{first_name}}, sé que andas ocupado', 'Hola {{first_name}},

Sé que estás muy ocupado, pero así como ustedes tienen certeza de qué condición hay que documentar y cuándo, yo tengo total certeza de que puedo ayudarles considerablemente a tener su instalación eléctrica revisada y con respaldo por escrito.

¿Cuándo podemos platicar, o con quién de tu empresa debería platicar?

Saludos,

Francisco'),
      (3, 4, '{{first_name}}, ¿quedó documentada la última revisión?', 'Hola {{first_name}},

¿Cuándo fue la última revisión de la instalación eléctrica, y quedó documentada?

Lo pregunto porque ese registro es el primero que se busca cuando alguien pide cuentas, y muchas plantas descubren que no lo tienen justo ese día.

¿Quieres que agende una visita para dejarlo armado?

Saludos,

Francisco'),
      (3, 5, '{{first_name}}, esto es importante para {{company}}', 'Hola {{first_name}},

Te insisto porque de verdad creo que esto es importante para {{company}}.

El expediente de la instalación eléctrica se arma en uno de dos momentos: con calma, o a las prisas cuando ya lo están pidiendo. El primero sale mejor.

¿Te parece si lo dejamos armado, o me dices con quién lo debo ver?

Saludos,

Francisco'),
      (3, 6, '{{first_name}}, lo dicho y lo escrito', 'Hola {{first_name}},

Un hallazgo dicho en una junta se olvida en dos semanas. Un hallazgo con fecha y medición ya no, y además te respalda a ti.

Eso es lo que queda cuando revisamos una planta.

¿Te ayudo a generarlo?

Saludos,

Francisco'),
      (3, 7, '{{first_name}}, para tu expediente', 'Hola {{first_name}},

¿Te sirve si en lugar de una reunión te mando primero el análisis por escrito?

Así lo revisas con calma, lo integras a tu expediente, y si tiene sentido nos sentamos después.

¿Te lo mando?

Saludos,

Francisco'),
      (3, 8, '{{first_name}}, cierro por ahora', 'Hola {{first_name}},

Cierro el tema para no insistir. Te agradezco el tiempo de leerme.

Si algún día necesitas el registro documentado de la instalación de {{company}}, aquí estoy.

Si prefieres que no te escriba más, respóndeme la palabra baja y lo registro hoy mismo.

Saludos,

Francisco'),
      (4, 1, '{{first_name}}, sobre tu instalación eléctrica.', 'Hola {{first_name}},

Soy Francisco Cuellar, Director General de ENNCO.

Te escribo porque trabajamos con plantas industriales en servicios eléctricos, y lo primero que entregamos es un alcance por escrito: qué incluye, qué no y por qué, para que las propuestas se comparen parejo.

Sé que en compras lo difícil no es conseguir precios, es saber si son comparables.

¿Cuándo podrías recibirme para darte un análisis real de esto y mostrarte cómo lo estructuramos?

Si esto no lo llevas tú, ¿podrías dirigirme con la persona encargada por favor?

Saludos y espero saber de ti pronto.

Francisco Cuellar
Director General, ENNCO'),
      (4, 2, '{{first_name}}, qué incluye y qué no', 'Hola {{first_name}},

Tal vez mi correo anterior no te pudo dar la claridad de qué hacemos y por qué es relevante para ti.

Hacemos esto:
Instalaciones y mantenimiento fotovoltaico, obra eléctrica industrial, subestaciones, transformadores y pólizas de mantenimiento.

Y te podemos ayudar con esto:
Definir un alcance claro para que todas las propuestas que pidas se coticen contra lo mismo, y bajar lo que pagan de luz.

Avísame si puedo llamarte o programar una reunión con ustedes esta semana.

Saludos,

Francisco
Director General, ENNCO'),
      (4, 3, '{{first_name}}, sé que ves muchos proveedores', 'Hola {{first_name}},

Sé que estás muy ocupado, pero así como ustedes tienen certeza de cuándo un proveedor conviene y cuándo no, yo tengo total certeza de que puedo ayudarles considerablemente a comparar parejo sus propuestas eléctricas y a bajar ese costo.

¿Cuándo podemos platicar, o con quién de tu empresa debería platicar?

Saludos,

Francisco'),
      (4, 4, '{{first_name}}, ¿qué incluye su póliza hoy?', 'Hola {{first_name}},

¿Cuándo fue la última vez que compararon lo que incluye su póliza de mantenimiento eléctrico?

Hoy podrían estar pagando más de luz, o pagando una póliza que no revisa lo que debería.

¿Quieres que agende una visita para verificarlo, o cuándo revisan ese contrato?

Saludos,

Francisco'),
      (4, 5, '{{first_name}}, esto es importante para {{company}}', 'Hola {{first_name}},

Te insisto porque de verdad creo que esto es importante para {{company}}.

Sin saber en qué condición está lo que se va a mantener, cada proveedor cotiza sobre supuestos distintos y las propuestas no son comparables, aunque en la tabla lo parezcan.

¿Te parece si lo revisamos juntos, o me dices con quién lo debo ver?

Saludos,

Francisco'),
      (4, 6, '{{first_name}}, con qué defender la partida', 'Hola {{first_name}},

Cuando mantenimiento pide y dirección pregunta por qué, quien queda en medio es compras.

Un análisis con lo observado y sus prioridades resuelve esa discusión antes de que empiece, y te deja con qué defender la partida.

¿Te lo preparo?

Saludos,

Francisco'),
      (4, 7, '{{first_name}}, antes de pedir propuestas', 'Hola {{first_name}},

¿Te sirve si en lugar de una reunión te mando primero el análisis por escrito?

Así lo revisas con calma, lo usas para pedir propuestas parejas, y si tiene sentido nos sentamos después.

¿Te lo mando?

Saludos,

Francisco'),
      (4, 8, '{{first_name}}, te dejo la hoja y cierro el tema', 'Hola {{first_name}},

Cierro el seguimiento. Te agradezco el tiempo de leerme.

Si abren revisión de mantenimiento eléctrico, con gusto participamos. Y si no, el alcance que te comenté te sirve igual con cualquier proveedor.

Si prefieres que no te escriba más, respóndeme la palabra baja y lo registro hoy mismo.

Saludos,

Francisco')
    ) as nuevo(version, touch_number, subject_template, body_template),
    public.sequence_versions sv
    where sv.id = st.sequence_version_id
      and sv.campaign_id = campana.id
      and sv.version = nuevo.version
      and st.touch_number = nuevo.touch_number
      and (st.subject_template is distinct from nuevo.subject_template or st.body_template is distinct from nuevo.body_template);
    get diagnostics toques_actualizados = row_count;

    update public.sequence_versions sv
    set content_sha256 = sha_por_variante->>sv.version::text
    where sv.campaign_id = campana.id
      and sha_por_variante ? sv.version::text;

    manifiesto := campana.manifest_json
      || jsonb_build_object('content_sha256', sha_secuencia_nueva, 'sequence_source_sha256', sha_fuente_nueva)
      || jsonb_build_object('variants', (
           select jsonb_agg(jsonb_build_object(
                    'key', v->>'key',
                    'version', (v->>'version')::integer,
                    'content_sha256', coalesce(sha_por_variante->>(v->>'version'), v->>'content_sha256'))
                  order by (v->>'version')::integer)
           from jsonb_array_elements(campana.manifest_json->'variants') v));

    -- Idempotente: si el manifiesto ya describe este copy no se reescribe nada
    -- ni se anota un cambio que no ocurrio.
    if manifiesto is distinct from campana.manifest_json then
      update public.campaigns
      set manifest_json = manifiesto,
          manifest_sha256 = encode(extensions.digest(convert_to(manifiesto::text, 'utf8'), 'sha256'), 'hex'),
          updated_at = now()
      where id = campana.id;

      insert into public.audit_log (organization_id, actor_user_id, action, record_type, record_id, old_data, new_data)
      values (
        campana.organization_id, null, 'DIRECT_LANE_CAMPAIGN_COPY_SOLAR_WORDING', 'campaigns', campana.id,
        jsonb_build_object('manifest_sha256', campana.manifest_sha256,
                           'content_sha256', campana.manifest_json->>'content_sha256'),
        jsonb_build_object(
          'manifest_sha256', encode(extensions.digest(convert_to(manifiesto::text, 'utf8'), 'sha256'), 'hex'),
          'content_sha256', sha_secuencia_nueva,
          'touches_updated', toques_actualizados,
          'authorized_by', 'Grant Keegan, teckel_admin, 2026-09-10; vocabulario de Paco en la junta del 9-sep',
          'reason', 'El negocio es solar: sale acometidas, entran instalaciones y mantenimiento fotovoltaico'));
    end if;
  end loop;
end $$;
