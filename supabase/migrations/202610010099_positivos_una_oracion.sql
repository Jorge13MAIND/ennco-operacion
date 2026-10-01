-- 099 · Respuestas a positivos de una oración (1-oct-2026). Grant: "Tenemos que hacer esas respuestas
-- más simples. De una oración." Mismo texto para los dos subtipos (pide visita / acepta la oferta):
-- agradece y copia a Paco. Solo cambia app.email_sdr_templates; el CC sigue saliendo de
-- campaigns.manifest_json->>'cc_on_reply_email'.
-- Reversa: volver a correr el insert de plantillas de 202609300097_respuesta_positiva_auto.sql.

begin;

update app.email_sdr_templates
set body = E'Hola {{first_name}},\n\nGracias por la respuesta. Te copio mi correo principal, francisco.cuellar@ennco.com.mx, para darle seguimiento desde ahí.\n\nSaludos,\nFrancisco Cuellar\nENNCO',
  version = 'positivos-v2-2026-10-01', approved_by = 'Grant (1-oct)', approved_at = clock_timestamp()
where subtype in ('POSITIVE_ACCEPT', 'POSITIVE_VISIT');

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('e0000000-0000-4000-8000-000000000001', '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', 'EMAIL_SDR_TEMPLATES_UPDATED',
  'organizations', 'e0000000-0000-4000-8000-000000000001',
  jsonb_build_object('source','migración 099','version','positivos-v2-2026-10-01','subtypes',jsonb_build_array('POSITIVE_ACCEPT','POSITIVE_VISIT')));

commit;
