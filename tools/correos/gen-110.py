"""Genera supabase/migrations/202610140110_bajas_y_una_respuesta.sql (14-oct-2026, Grant).

Byanet (Envases) contestó "baja" tres veces y el SDR la tomó como positiva: recibió dos respuestas
automáticas y quedó como oportunidad en el panel y en el CRM. El detector se arregló en policy.ts
(baja en lo que la persona escribió, en sentido amplio). Decisiones de Grant para la base:
  · Baja o rechazo firme ("no me interesa"): se deja de escribir a esa persona para siempre (solo a
    ella, no a su empresa). El runner aplica UNSUBSCRIBE (supresión y secuencias cerradas).
  · No aparecen en el CRM: crm_records.excluded_at los oculta y no se vuelven a crear.
  · Un contacto suprimido nunca se califica como positivo (lead u oportunidad).
  · Una sola respuesta automática por persona: si ya se le contestó en automático, la siguiente
    respuesta se queda para contestar a mano.
  · No se le manda nada a quien pide baja.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-110"
OUT = ROOT / "supabase/migrations/202610140110_bajas_y_una_respuesta.sql"


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


SUPPRESSED_CHECK = "    if app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2)) then return jsonb_build_object('status','HOLD','reason','SUPPRESSED'); end if;\n"

sdr_command = patch("email_sdr_command", [
    (SUPPRESSED_CHECK,
     SUPPRESSED_CHECK + """    -- 14-oct (Grant): una sola respuesta automática por persona; la siguiente se contesta a mano.
    if not coalesce((p->>'followup')::boolean,false) and exists (select 1 from public.messages om
        where om.organization_id=target_organization_id and om.contact_id=contact.id and om.direction='OUTBOUND'
          and om.idempotency_key like 'email-sdr:%' and om.idempotency_key not like 'email-sdr:'||c.id::text||':%'
          and om.status in ('QUEUED','SENDING','SENT','DELIVERED')) then
      update public.email_sdr_cases set next_action='Ya se le contestó en automático una vez. Si hace falta, contestar a mano',
        updated_at=clock_timestamp() where id=c.id;
      return jsonb_build_object('status','HOLD','reason','AUTO_REPLY_ALREADY_SENT');
    end if;
"""),
])

classify_positive = patch("email_sdr_classify_positive", [
    ("""  if c.id is null or e.event_kind <> 'REPLY' or m.id is null or ce.id is null then return; end if;""",
     """  if c.id is null or e.event_kind <> 'REPLY' or m.id is null or ce.id is null then return; end if;
  -- 14-oct: quien pidió baja o rechazó nunca se vuelve lead positivo.
  if exists (select 1 from public.contacts ct where ct.organization_id = target_org and ct.id = m.contact_id
      and app.is_suppressed(target_org, ct.account_id, ct.normalized_email, split_part(ct.normalized_email, '@', 2))) then return; end if;"""),
])

upsert = patch("crm_upsert_from_reply", [
    ("""  received := coalesce(e.observed_at, m.created_at);
  select * into rec from public.crm_records where organization_id = target_org and contact_id = ct.id for update;""",
     """  received := coalesce(e.observed_at, m.created_at);
  select * into rec from public.crm_records where organization_id = target_org and contact_id = ct.id for update;
  -- 14-oct (Grant): quien pide baja o rechaza en firme no aparece en el CRM.
  if sc.state = 'SUPPRESSED' or intent in ('UNSUBSCRIBE', 'REJECTION', 'COMPLAINT')
    or app.is_suppressed(target_org, ct.account_id, ct.normalized_email, split_part(ct.normalized_email, '@', 2)) then
    if rec.id is not null and rec.excluded_at is null then
      update public.crm_records set excluded_at = clock_timestamp(), excluded_reason = coalesce(reason, 'Pidió baja'),
        updated_at = clock_timestamp() where id = rec.id;
    end if;
    return null;
  end if;
  if rec.excluded_at is not null then return rec.id; end if;"""),
])

read_crm = patch("read_crm", [
    ("""      from public.crm_records r where r.organization_id = target_organization_id), '[]'::jsonb),""",
     """      from public.crm_records r where r.organization_id = target_organization_id and r.excluded_at is null), '[]'::jsonb),"""),
])

reminders = patch("crm_reminders_work", [
    ("""      where r.organization_id = target_org and r.stage not in ('GANADO', 'PERDIDO', 'DESCARTADO')""",
     """      where r.organization_id = target_org and r.excluded_at is null and r.stage not in ('GANADO', 'PERDIDO', 'DESCARTADO')"""),
])

sql = f"""-- 110 · Bajas y rechazos firmes fuera del CRM, una sola respuesta automática por persona (14-oct-2026).
-- Generado por tools/correos/gen-110.py desde tools/correos/vivas-110/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

alter table public.crm_records add column if not exists excluded_at timestamptz;
alter table public.crm_records add column if not exists excluded_reason text check (excluded_reason is null or length(excluded_reason) <= 300);

{upsert}
{read_crm}
{reminders}
{classify_positive}
{sdr_command}
commit;
"""
OUT.write_text(sql)
print(OUT, len(sql))
