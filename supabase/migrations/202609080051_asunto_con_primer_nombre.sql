-- M051: el asunto lleva el primer nombre de quien recibe el correo.
--
-- Grant, 2026-09-08: "El subject del correo debe llevar el primer nombre de la
-- persona a la que se envia el correo. De misma forma que lleva el contenido.
-- El subject debe llevar '[Name], sobre tu instalacion electrica.'"
--
-- El copy fuente (docs/external/secuencia-ennco-copy.md) y el JSON generado ya
-- traen los 32 asuntos nuevos, y con eso basta para las campanas que se creen
-- de aqui en adelante. Esta migracion existe por la campana YA APROBADA: al
-- crearla, create_direct_lane_campaign materializo el copy en sequence_touches,
-- asi que sin esto el motor seguiria mandando los asuntos viejos a los ~1,400
-- contactos que faltan por inscribir. La campana se localiza por el sha de
-- contenido de su manifiesto (el anterior o el nuevo, para poder reaplicarla),
-- de modo que en una base nueva (CI) no encuentra nada y no toca una fila.
--
-- Ademas del texto se actualizan los sha de cada variante y el manifiesto, para
-- que la huella guardada siga describiendo el copy real; el manifest_sha256 se
-- recalcula con la misma expresion que usa create_direct_lane_campaign.

do $$
declare
  sha_secuencia_anterior constant text := '3e3909e6a06ab049a2113e11f5a541f1335efbdbcca09a08ce888d44764da557';
  sha_secuencia_nueva    constant text := 'eaf154058d848f9cfea464e398b6c795dd99978ed41f66d726dc3c3ab021c90e';
  sha_fuente_nueva       constant text := 'a9b61f3ed9674b20dd3e08a9aec482a22f0c76a1a54cb5ccd1ad4c6376cb2a3b';
  sha_por_variante constant jsonb := jsonb_build_object(
    '1', 'a50a0d8a7304fcf6f8f90c2047a963fda98eee8ec3499979bc5f2f31017b9792',
    '2', '3b0ec4a8dff51688ad12915d4afcb0df0c17882b37242be35c11a58a6ac147c0',
    '3', 'faaef4c2bd5fe0579bde25a5348aa309732997655df87ad5d074175c5fd18cf6',
    '4', '5cbe9cc438977b20db9ea3de388d5ceb244be81464a394d4fee5327305ba016b'
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
    set subject_template = nuevo.subject_template
    from (values
      (1, 1, '{{first_name}}, sobre tu instalación eléctrica.'),
      (1, 2, '{{first_name}}, sobre mi correo anterior'),
      (1, 3, '{{first_name}}, sé que estás ocupado'),
      (1, 4, '{{first_name}}, su último mantenimiento eléctrico'),
      (1, 5, '{{first_name}}, esto es importante para {{company}}'),
      (1, 6, '{{first_name}}, lo que no se ve en el recibo'),
      (1, 7, '{{first_name}}, ¿te lo mando por escrito?'),
      (1, 8, '{{first_name}}, cierro el tema'),
      (2, 1, '{{first_name}}, sobre tu instalación eléctrica.'),
      (2, 2, '{{first_name}}, qué hacemos exactamente'),
      (2, 3, '{{first_name}}, sé que traes mil cosas'),
      (2, 4, '{{first_name}}, ¿ya toca revisión?'),
      (2, 5, '{{first_name}}, esto es importante para {{company}}'),
      (2, 6, '{{first_name}}, con qué sustentar lo que pides'),
      (2, 7, '{{first_name}}, el análisis por escrito'),
      (2, 8, '{{first_name}}, cierro el seguimiento'),
      (3, 1, '{{first_name}}, sobre tu instalación eléctrica.'),
      (3, 2, '{{first_name}}, para que quede claro qué hacemos'),
      (3, 3, '{{first_name}}, sé que andas ocupado'),
      (3, 4, '{{first_name}}, ¿quedó documentada la última revisión?'),
      (3, 5, '{{first_name}}, esto es importante para {{company}}'),
      (3, 6, '{{first_name}}, lo dicho y lo escrito'),
      (3, 7, '{{first_name}}, para tu expediente'),
      (3, 8, '{{first_name}}, cierro por ahora'),
      (4, 1, '{{first_name}}, sobre tu instalación eléctrica.'),
      (4, 2, '{{first_name}}, qué incluye y qué no'),
      (4, 3, '{{first_name}}, sé que ves muchos proveedores'),
      (4, 4, '{{first_name}}, ¿qué incluye su póliza hoy?'),
      (4, 5, '{{first_name}}, esto es importante para {{company}}'),
      (4, 6, '{{first_name}}, con qué defender la partida'),
      (4, 7, '{{first_name}}, antes de pedir propuestas'),
      (4, 8, '{{first_name}}, te dejo la hoja y cierro el tema')
    ) as nuevo(version, touch_number, subject_template),
    public.sequence_versions sv
    where sv.id = st.sequence_version_id
      and sv.campaign_id = campana.id
      and sv.version = nuevo.version
      and st.touch_number = nuevo.touch_number
      and st.subject_template is distinct from nuevo.subject_template;
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
        campana.organization_id, null, 'DIRECT_LANE_CAMPAIGN_SUBJECTS_PERSONALIZED', 'campaigns', campana.id,
        jsonb_build_object('manifest_sha256', campana.manifest_sha256,
                           'content_sha256', campana.manifest_json->>'content_sha256'),
        jsonb_build_object(
          'manifest_sha256', encode(extensions.digest(convert_to(manifiesto::text, 'utf8'), 'sha256'), 'hex'),
          'content_sha256', sha_secuencia_nueva,
          'touches_updated', toques_actualizados,
          'authorized_by', 'Grant Keegan, teckel_admin, 2026-09-08',
          'reason', 'El asunto lleva el primer nombre del destinatario'));
    end if;
  end loop;
end $$;
