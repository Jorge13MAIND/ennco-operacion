"""Genera supabase/migrations/202610090105_oscar_contexto_y_telegram.sql (9-oct-2026, Grant).

Grant, 9-oct:
  · El correo automático a una respuesta positiva lleva en CC a Paco y ahora también a Oscar
    (oscar.ojeda@ennco.com.mx), con el copy nuevo: "Perfecto <nombre>, pongo en CC a mi asistente
    Oscar, él se encargará de coordinar los detalles. ¿Nos harías favor de compartirnos tu número de
    teléfono con WhatsApp?".
  · Los avisos internos ("respuesta sin acuse") no daban contexto (Jorge). Ahora la base entrega,
    con cada aviso, quién respondió, de qué empresa, qué escribió y qué hizo el sistema; Oscar va
    en copia.
  · Alertas por Telegram (bot @Enncoventasbot) cuando llega una respuesta positiva. La base lleva la
    cola por caso y por chat (TELEGRAM_WORK / TELEGRAM_SETTLE); el token vive en Vercel.
Las listas de CC y los chats viven en app.email_sdr_settings, no en el manifiesto de la campaña.
Este archivo no lleva datos de prospectos: el repositorio es público.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-105"
OUT = ROOT / "supabase/migrations/202610090105_oscar_contexto_y_telegram.sql"
ORG = "e0000000-0000-4000-8000-000000000001"
OSCAR = "oscar.ojeda@ennco.com.mx"

BODY = ("Perfecto {{first_name}},\n\n"
        "Pongo en CC a mi asistente Oscar, él se encargará de coordinar los detalles.\n\n"
        "¿Nos harías favor de compartirnos tu número de teléfono con WhatsApp?\n\n"
        "Saludos,\n"
        "Ing. Francisco Cuellar")


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


def lit(text: str) -> str:
    return "E'" + text.replace("\\", "\\\\").replace("'", "''").replace("\n", "\\n") + "'"


sdr_command = patch("email_sdr_command", [
    ("""  elsif op='ALERT_SETTLE' then""",
     """  elsif op='TELEGRAM_WORK' then
    return app.email_sdr_telegram_work(target_organization_id);
  elsif op='TELEGRAM_SETTLE' then
    return app.email_sdr_telegram_settle(target_organization_id,(p->>'case_id')::uuid,p->>'chat_id',
      (p->>'delivered')::boolean,p->>'error');
  elsif op='ALERT_SETTLE' then"""),
    ("""      case when campaign.manifest_json->>'cc_on_reply_email' is null then '{}'::text[] else array[lower(campaign.manifest_json->>'cc_on_reply_email')] end,e.id)""",
     """      app.email_sdr_reply_cc(campaign.manifest_json->>'cc_on_reply_email',cfg.reply_cc_emails),e.id)"""),
    ("""'Respondida automáticamente con copia a Paco. Paco coordina desde su correo'""",
     """'Respondida automáticamente con copia a Paco y Oscar. Oscar coordina los detalles'"""),
    ("""next_action='Respuesta automática programada con copia a Paco',""",
     """next_action='Respuesta automática programada con copia a Paco y Oscar',"""),
])

alert_work = patch("email_sdr_alert_work", [
    ("""        'owner_email',row_value.owner_email,'backup_email',row_value.backup_email));""",
     """        'owner_email',row_value.owner_email,'backup_email',row_value.backup_email,
        'cc_emails',(select to_jsonb(coalesce(s.alert_cc_emails,'{}'::text[])) from app.email_sdr_settings s where s.organization_id=target_org),
        'context',app.email_sdr_case_context(target_org,row_value.id)));"""),
])

sql = f"""-- 105 · Oscar en copia, avisos con contexto y alertas por Telegram (9-oct-2026).
-- Generado por tools/correos/gen-105.py desde tools/correos/vivas-105/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

alter table app.email_sdr_settings
  add column if not exists reply_cc_emails text[] not null default '{{}}',
  add column if not exists alert_cc_emails text[] not null default '{{}}',
  add column if not exists telegram_chat_ids text[] not null default '{{}}';

update app.email_sdr_settings
set reply_cc_emails = array['{OSCAR}'], alert_cc_emails = array['{OSCAR}'], updated_at = clock_timestamp()
where organization_id = '{ORG}';

-- CC del correo automático: el de la campaña (Paco) y después los de la configuración (Oscar), sin repetir.
create or replace function app.email_sdr_reply_cc(campaign_cc text, extra text[])
returns text[] language sql immutable set search_path to 'pg_catalog' as $$
  select coalesce(array_agg(x order by min_pos), '{{}}'::text[]) from (
    select lower(btrim(v)) x, min(pos) min_pos
    from unnest(array[campaign_cc] || coalesce(extra, '{{}}'::text[])) with ordinality as u(v, pos)
    where nullif(btrim(v), '') is not null
    group by lower(btrim(v))) s;
$$;

update app.email_sdr_templates
set body = {lit(BODY)}, version = 'positivos-v3-2026-10-09', approved_by = 'Grant (9-oct)', approved_at = clock_timestamp();

-- Todo lo que una persona necesita para entender un caso sin abrir el Control Room.
create or replace function app.email_sdr_case_context(target_org uuid, target_case uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'app', 'pg_temp' as $$
  select jsonb_build_object(
    'contact_name', ct.full_name, 'contact_role', ct.role_title, 'contact_email', ct.normalized_email,
    'account_name', a.legal_name, 'account_city', a.city, 'account_state', a.state,
    'mailbox_email', mb.normalized_email, 'received_at', coalesce(e.observed_at, im.created_at),
    'subject', im.subject, 'body', left(im.body_text, 6000),
    'touch_number', (select o.touch_number from public.messages o
      where o.organization_id = e.organization_id and o.id = (e.payload_json->>'related_outbound_message_id')::uuid),
    'event_kind', e.event_kind, 'intent', sc.decision->>'intent', 'subtype', sc.decision->>'subtype',
    'state', sc.state, 'next_action', sc.next_action, 'send_after', sc.send_after,
    'reply_status', r.status, 'reply_sent_at', r.sent_at, 'reply_cc', to_jsonb(r.cc_emails),
    'reply_cc_planned', to_jsonb(app.email_sdr_reply_cc(ca.manifest_json->>'cc_on_reply_email', s.reply_cc_emails)))
  from public.email_sdr_cases sc
  join public.provider_events e on e.organization_id = sc.organization_id and e.id = sc.provider_event_id
  join public.messages im on im.organization_id = e.organization_id and im.id = e.message_id
  join public.contacts ct on ct.organization_id = im.organization_id and ct.id = im.contact_id
  join public.accounts a on a.organization_id = ct.organization_id and a.id = ct.account_id
  left join public.mailboxes mb on mb.organization_id = im.organization_id and mb.id = im.mailbox_id
  left join public.campaign_enrollments ce on ce.organization_id = im.organization_id and ce.id = im.enrollment_id
  left join public.campaigns ca on ca.organization_id = ce.organization_id and ca.id = ce.campaign_id
  left join public.messages r on r.organization_id = sc.organization_id and r.id = sc.message_id
  left join app.email_sdr_settings s on s.organization_id = sc.organization_id
  where sc.organization_id = target_org and sc.id = target_case;
$$;
revoke all on function app.email_sdr_case_context(uuid, uuid) from public, anon, authenticated;

-- Cola de Telegram: un renglón por caso positivo y chat. Solo positivos de las últimas 24 horas.
create table if not exists app.email_sdr_telegram_dispatch (
  organization_id uuid not null,
  case_id uuid not null references public.email_sdr_cases(id),
  chat_id text not null check (chat_id ~ '^-?[0-9]{{1,20}}$'),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  primary key (organization_id, case_id, chat_id)
);
alter table app.email_sdr_telegram_dispatch enable row level security;
revoke all on app.email_sdr_telegram_dispatch from public, anon, authenticated;

create or replace function app.email_sdr_telegram_work(target_org uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
declare row_value record; items jsonb := '[]'::jsonb; claimed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('email-sdr-telegram:' || target_org::text, 0));
  for row_value in
    select sc.id case_id, chat.chat_id
    from public.email_sdr_cases sc
    join public.provider_events e on e.organization_id = sc.organization_id and e.id = sc.provider_event_id
    join app.email_sdr_settings s on s.organization_id = sc.organization_id
    cross join lateral unnest(s.telegram_chat_ids) as chat(chat_id)
    where sc.organization_id = target_org and e.event_kind = 'REPLY'
      and sc.decision->>'subtype' in ('POSITIVE_ACCEPT', 'POSITIVE_VISIT')
      and sc.created_at > clock_timestamp() - interval '24 hours'
      and not exists (select 1 from app.email_sdr_telegram_dispatch d where d.organization_id = sc.organization_id
        and d.case_id = sc.id and d.chat_id = chat.chat_id
        and (d.delivered_at is not null or d.attempts >= 20 or d.last_attempt_at > clock_timestamp() - interval '4 minutes'))
    order by sc.created_at limit 20
  loop
    insert into app.email_sdr_telegram_dispatch (organization_id, case_id, chat_id, attempts, last_attempt_at)
    values (target_org, row_value.case_id, row_value.chat_id, 1, clock_timestamp())
    on conflict (organization_id, case_id, chat_id) do update
      set attempts = app.email_sdr_telegram_dispatch.attempts + 1, last_attempt_at = clock_timestamp()
    returning attempts into claimed;
    items := items || jsonb_build_array(jsonb_build_object('case_id', row_value.case_id, 'chat_id', row_value.chat_id,
      'attempt', claimed, 'context', app.email_sdr_case_context(target_org, row_value.case_id)));
  end loop;
  return jsonb_build_object('status', 'TELEGRAM_WORK', 'items', items);
end $$;
revoke all on function app.email_sdr_telegram_work(uuid) from public, anon, authenticated;

create or replace function app.email_sdr_telegram_settle(target_org uuid, target_case uuid, target_chat text, delivered boolean, error_text text)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
begin
  update app.email_sdr_telegram_dispatch
  set delivered_at = case when delivered then clock_timestamp() else delivered_at end,
      last_error = case when delivered then null else left(error_text, 300) end
  where organization_id = target_org and case_id = target_case and chat_id = target_chat;
  if not found then raise exception 'SDR_TELEGRAM_NOT_CLAIMED'; end if;
  return jsonb_build_object('status', 'SETTLED');
end $$;
revoke all on function app.email_sdr_telegram_settle(uuid, uuid, text, boolean, text) from public, anon, authenticated;

{alert_work}
{sdr_command}
insert into public.audit_log (organization_id, action, record_type, new_data)
values ('{ORG}', 'EMAIL_SDR_OSCAR_CONTEXT_TELEGRAM', 'email_sdr_settings',
  jsonb_build_object('source', 'migración 105', 'reply_cc', 'Paco + Oscar', 'template', 'positivos-v3-2026-10-09',
    'alerts', 'con contexto del caso y Oscar en copia', 'telegram', 'cola por caso y chat',
    'order', 'Grant 9-oct'));

commit;
"""
OUT.write_text(sql)
print(OUT, len(sql))
