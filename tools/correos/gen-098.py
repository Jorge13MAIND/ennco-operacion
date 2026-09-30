"""Genera supabase/migrations/202609300098_positivos_automaticos.sql (30-sep-2026, Grant).

Grant: "Quiero la opción 1: activa el modo automático sin casos de prueba." Los positivos claros
(pide visita / acepta la oferta) se contestan solos desde ya, con copia a Paco, sin esperar a que
alguien apruebe los primeros envíos a mano.
  · QUEUE y set_email_sdr_mode dejan de exigir casos de prueba ya enviados (canarios).
  · Se quedan todos los demás candados: solo subtipos positivos, plantilla fija, hilo verificado,
    sin supresión, sin respuesta más nueva ni intervención humana, espera de 10 a 25 min en horario.
  · El SDR pasa a AUTO. Los dos positivos pendientes (Natural de Alimentos y Dedienne) vuelven a la
    cola de trabajo y salen solos con sus textos con disculpa.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-098"
OUT = ROOT / "supabase/migrations/202609300098_positivos_automaticos.sql"


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


command = patch("email_sdr_command", [
    ("if cfg.mode<>'AUTO' or reviewed_count<2 or not intent=any(cfg.auto_intents)",
     "if cfg.mode<>'AUTO' or not intent=any(cfg.auto_intents)"),
    ("""        or not exists(select 1 from public.email_sdr_cases sc where sc.organization_id=target_organization_id and sc.approved and sc.reviewed_by is not null and sc.reviewed_policy_version=cfg.policy_version and sc.decision->>'intent'=intent)
""", ""),
    ("then return jsonb_build_object('status','HOLD','reason','FIVE_REVIEWED_CANARIES_REQUIRED'); end if;",
     "then return jsonb_build_object('status','HOLD','reason','AUTO_NOT_ENABLED'); end if;"),
])

set_mode = patch("set_email_sdr_mode", [
    ("if reviewed<2 or cfg.acceptance_evidence", "if cfg.acceptance_evidence"),
])

ORG = "e0000000-0000-4000-8000-000000000001"
GRANT = "614db7d9-f70b-4f8b-b0e2-d5c0190a06b3"
CASES = "('06344ccb-daf9-4c02-a2c1-2f2b0e28fc77','651bbc50-dd68-40cb-b777-58806407eef3')"

sql = f"""-- 098 · Positivos automáticos sin casos de prueba (30-sep-2026). Generado por tools/correos/gen-098.py
-- desde tools/correos/vivas-098/. Orden de Grant: "Activa el modo automático sin casos de prueba."
-- Reversa: update app.email_sdr_settings set mode='REVIEW';  (nada sale en automático en REVIEW)

begin;

set local app.operations_rpc_write = 'on';

{command}
{set_mode}
update app.email_sdr_settings set mode='AUTO', auto_intents=array['EXPLICIT_INTEREST'],
  acceptance_evidence=jsonb_build_object(
    'tests_passed', true,
    'tests', 'vitest src/lib/correos: 157/157 (30-sep, commit a595ca8), incluye las 5 respuestas reales',
    'pause_resume_verified', true,
    'pause_resume', 'por código: QUEUE devuelve HOLD si mode<>AUTO y SEND_CONTEXT si mode=PAUSED; sin prueba con envío real',
    'approved_by', 'Grant', 'approved_at', '2026-09-30', 'canaries', 'omitidos por orden de Grant'),
  updated_at=clock_timestamp()
where organization_id='{ORG}';

-- Los dos positivos pendientes vuelven a la cola: salen solos con la espera de 10 a 25 min.
update public.email_sdr_cases set state='READY', send_after=null, lease_until=null, updated_at=clock_timestamp()
where organization_id='{ORG}' and id in {CASES} and state='REVIEW' and message_id is null;

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('{ORG}', '{GRANT}', 'EMAIL_SDR_MODE', 'email_sdr_settings', '{ORG}',
  jsonb_build_object('mode','AUTO','previous_mode','REVIEW','source','migración 098','canaries_required',0,
    'order','Grant: activa el modo automático sin casos de prueba'));

commit;
"""
OUT.write_text(sql)
print(OUT, len(sql))
