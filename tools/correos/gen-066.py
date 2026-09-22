"""Genera supabase/migrations/202609220066_v4_rotacion.sql (junta #6 con Jorge, 22-sep-2026).

Las funciones que se modifican se toman de la definición viva en producción (volcadas con
pg_get_functiondef a tools/correos/vivas/) y se parchean con reemplazos exactos: cada reemplazo
tiene que encontrar su texto una sola vez o el generador se detiene. Así el cambio es mínimo y
revisable, y no se reescriben a mano funciones de 300 líneas.

Uso: python3 tools/correos/gen-066.py   (desde la raíz del repo)
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas"
OUT = ROOT / "supabase/migrations/202609220066_v4_rotacion.sql"


def patch(sql: str, pairs: list[tuple[str, str]], name: str) -> str:
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


# 1) El envío real (la versión firmada que llama el cron) no pintaba el gancho: la migración 064
#    solo cambió la versión sin firma. Con la v3 en marcha habría salido "{{gancho}}" literal.
claim = patch((LIVE / "claim_proof.sql").read_text(), [
    ("thread_json jsonb; rendered_subject text; rendered_body text; unsubscribe_enrollment uuid;",
     "thread_json jsonb; rendered_subject text; rendered_body text; unsubscribe_enrollment uuid; hook_text text;"),
    ("  rendered_subject := left(app.direct_lane_render(candidate.subject_template,candidate.full_name,candidate.legal_name),180);\n"
     "  rendered_body := app.direct_lane_render(candidate.body_template,candidate.full_name,candidate.legal_name);",
     "  hook_text := app.hook_for_account(target_organization_id, candidate.account_id);\n"
     "  rendered_subject := left(app.direct_lane_render(candidate.subject_template,candidate.full_name,candidate.legal_name,hook_text),180);\n"
     "  rendered_body := app.direct_lane_render(candidate.body_template,candidate.full_name,candidate.legal_name,hook_text);"),
    ("    jsonb_build_object('touch',candidate.touch_value,'attempt',attempt_value));",
     "    jsonb_build_object('touch',candidate.touch_value,'attempt',attempt_value,'hook',coalesce(hook_text,'')<>''));"),
], "claim_direct_lane_dispatch")

# 2) La inscripción automática solo toma contactos que nunca han recibido nada del carril
#    directo. Antes miraba solo inscripciones abiertas: con la rotación, un contacto que agotó sus
#    rondas (o que respondió) habría vuelto a entrar como nuevo.
enroll_core = patch((LIVE / "enroll_core.sql").read_text(), [
    ("      exists (select 1 from public.campaign_enrollments ce where ce.organization_id=target_organization_id and ce.contact_id=c.id\n"
     "        and ce.status in ('PENDING','ACTIVE','PAUSED')) as already_enrolled",
     "      exists (select 1 from public.campaign_enrollments ce join public.campaigns cc on cc.id=ce.campaign_id\n"
     "        where ce.organization_id=target_organization_id and ce.contact_id=c.id and cc.lane='DIRECT') as already_enrolled"),
], "direct_lane_enroll_core")

# 3) El cupo de la inscripción automática cuenta solo los primeros toques que vencen hoy. Las
#    rondas de rotación ya agendadas para la semana próxima no deben frenar a los nuevos de hoy.
autoenroll = patch((LIVE / "autoenroll.sql").read_text(), [
    ("    where e.organization_id=target_organization_id and e.mailbox_id=target_mailbox_id and e.status='PENDING' and e.next_touch_number=1;",
     "    where e.organization_id=target_organization_id and e.mailbox_id=target_mailbox_id and e.status='PENDING' and e.next_touch_number=1\n"
     "      and coalesce(e.next_touch_at,clock_timestamp()) < ((clock_timestamp() at time zone 'America/Mexico_City')::date + 1) at time zone 'America/Mexico_City';"),
], "autoenroll_direct_lane")

# 4) Estadísticas: además de buzón, perfil, estado y semana, por número de toque y por ronda.
stats = patch((LIVE / "stats.sql").read_text(), [
    ("      mb.normalized_email as mailbox, coalesce(nullif(a.state,''),'?') as state,",
     "      mb.normalized_email as mailbox, coalesce(nullif(a.state,''),'?') as state,\n"
     "      coalesce(e.rotation_round,1) as rotation_round,"),
    ("      union all select 'week', week_start::text, * from env",
     "      union all select 'week', week_start::text, * from env\n"
     "      union all select 'touch', 'T'||coalesce(touch_number::text,'?'), * from env\n"
     "      union all select 'round', 'R'||rotation_round::text, * from env"),
], "direct_lane_stats_json")

head = (ROOT / "tools/correos/066-cabecera.sql").read_text()
tail = (ROOT / "tools/correos/066-cierre.sql").read_text()
OUT.write_text(
    head
    + "\n/* ---------- Funciones vivas parchadas (ver tools/correos/gen-066.py) ---------- */\n\n"
    + claim + "\n" + enroll_core + "\n" + autoenroll + "\n" + stats + "\n"
    + tail
)
print(f"escrito {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")
