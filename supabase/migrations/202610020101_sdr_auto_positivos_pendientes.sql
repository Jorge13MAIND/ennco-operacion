-- 101 · Respuestas automáticas a positivos de nuevo en AUTO, sin dejar positivos atorados (2-oct-2026).
-- Grant: "Mejor que sí se envíe el correo a Carlos con el CC de Paco ahorita. Y ya configúralo que se
-- envíe con el nuevo copy automatizado de ahora en adelante." (Jorge lo había pasado a REVIEW el 1-oct.)
--
-- El hueco: un positivo que llega mientras el modo está en REVIEW queda en estado REVIEW, y WORK solo
-- toma casos READY; al volver a AUTO se quedaba atorado (le pasó a Carlos Ortiz, Eurotranciatura, 30-sep).
-- Ahora, cada vez que el modo cambia a AUTO (por SQL o por set_email_sdr_mode), los positivos claros
-- elegibles sin enviar de los últimos 3 días regresan a READY. Los más viejos se quedan para revisión
-- humana: contestar "gracias" con días de atraso lo decide una persona.
-- El texto que sale es la plantilla vigente (positivos-v2, una oración) con CC de manifest_json.cc_on_reply_email.
-- Reversa: update app.email_sdr_settings set mode='REVIEW';

begin;

create or replace function app.email_sdr_requeue_positives()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare requeued integer;
begin
  if new.mode = 'AUTO' and old.mode is distinct from 'AUTO' then
    update public.email_sdr_cases sc set state = 'READY', send_after = null, lease_until = null, updated_at = clock_timestamp()
    from public.provider_events e
    where sc.organization_id = new.organization_id and e.organization_id = sc.organization_id and e.id = sc.provider_event_id
      and sc.state = 'REVIEW' and sc.message_id is null and not sc.approved
      and sc.decision->>'subtype' in ('POSITIVE_ACCEPT','POSITIVE_VISIT')
      and sc.decision->>'eligible' = 'true' and sc.decision->'gates' = '[]'::jsonb
      and e.observed_at > clock_timestamp() - interval '3 days';
    get diagnostics requeued = row_count;
    insert into public.audit_log(organization_id, action, record_type, new_data)
    values (new.organization_id, 'EMAIL_SDR_POSITIVES_REQUEUED', 'email_sdr_settings',
      jsonb_build_object('requeued', requeued, 'max_age', '3 days'));
  end if;
  return new;
end $$;
revoke all on function app.email_sdr_requeue_positives() from public;

drop trigger if exists email_sdr_settings_requeue_positives on app.email_sdr_settings;
create trigger email_sdr_settings_requeue_positives
  after update of mode on app.email_sdr_settings
  for each row execute function app.email_sdr_requeue_positives();

update app.email_sdr_settings set mode = 'AUTO', updated_at = clock_timestamp()
where organization_id = 'e0000000-0000-4000-8000-000000000001';

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('e0000000-0000-4000-8000-000000000001', '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', 'EMAIL_SDR_MODE', 'email_sdr_settings',
  'e0000000-0000-4000-8000-000000000001',
  jsonb_build_object('mode','AUTO','previous_mode','REVIEW','source','migración 101',
    'order','Grant 2-oct: enviar a Carlos con CC a Paco y dejar el copy automático de una oración de ahora en adelante'));

commit;
