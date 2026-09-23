"""Genera supabase/migrations/202609220067_respuestas_fuera_de_ventana.sql (22-sep-2026).

Una respuesta escrita por el operador a quien ya nos escribió no es correo en frío. Con el tope
de 20 al día y la ventana de 9:30 a 13:30, una respuesta escrita después del mediodía se quedaba
hasta el día siguiente. Caso real: la respuesta a Hershey escrita a las 18:00 del 22-sep.

  · Respuestas del operador: salen de 8:00 a 20:00 CDMX, lunes a viernes, y no cuentan contra
    el tope de la campaña. Los toques siguen solo en su ventana y con su tope.

Mismo método que la 066: se parchan las definiciones vivas con reemplazos exactos.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas"
OUT = ROOT / "supabase/migrations/202609220067_respuestas_fuera_de_ventana.sql"


def patch(sql: str, pairs: list[tuple[str, str]], name: str) -> str:
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


claim = patch((LIVE / "claim_proof_066.sql").read_text(), [
    ("  new_count integer; ceiling integer;",
     "  new_count integer; ceiling integer; reply_only boolean := false; budget_spent boolean := false;"),
    ("    if not app.hybrid_dispatch_window_is_open(clock_timestamp()) then\n"
     "      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'OUTSIDE_SEND_WINDOW',null);\n"
     "    end if;",
     "    -- Fuera de la ventana de campaña solo pueden salir respuestas del operador (8:00 a 20:00).\n"
     "    reply_only := not app.hybrid_dispatch_window_is_open(clock_timestamp());\n"
     "    if reply_only and not app.direct_lane_reply_window_open(clock_timestamp()) then\n"
     "      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'OUTSIDE_SEND_WINDOW',null);\n"
     "    end if;"),
    ("  if sent_count>=ceiling then\n"
     "    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'BUDGET_EXHAUSTED',\n"
     "      jsonb_build_object('sent_today',sent_count,'ceiling',ceiling,'new_today',new_count,'new_cap',cap));\n"
     "  end if;\n",
     "  -- El tope es de la campaña: una respuesta del operador sale aunque el buzón ya lo haya llenado.\n"
     "  budget_spent := sent_count>=ceiling;\n"),
    ("  -- Prioridad 2: el siguiente toque vencido de una inscripción de este buzón.",
     "  if reply_only then\n"
     "    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'OUTSIDE_SEND_WINDOW',jsonb_build_object('replies_only',true));\n"
     "  end if;\n"
     "  if budget_spent then\n"
     "    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'BUDGET_EXHAUSTED',\n"
     "      jsonb_build_object('sent_today',sent_count,'ceiling',ceiling,'new_today',new_count,'new_cap',cap));\n"
     "  end if;\n\n"
     "  -- Prioridad 2: el siguiente toque vencido de una inscripción de este buzón."),
], "claim_direct_lane_dispatch")

release = patch((LIVE / "enforce_release.sql").read_text(), [
    ("  if tg_op='INSERT' then\n"
     "    cap := app.direct_lane_effective_cap(mailbox_record);",
     "  -- El tope diario limita toques de campaña; una respuesta del operador se puede encolar siempre.\n"
     "  if tg_op='INSERT' and new.touch_number is not null then\n"
     "    cap := app.direct_lane_effective_cap(mailbox_record);"),
], "enforce_direct_lane_release")

head = """-- 067 · Respuestas del operador fuera de la ventana de campaña y del tope diario (22-sep-2026).
-- Generado por tools/correos/gen-067.py.

begin;

create or replace function app.direct_lane_reply_window_open(target_at timestamptz)
returns boolean
language sql
stable
set search_path to 'pg_catalog'
as $$
  select extract(isodow from (target_at at time zone 'America/Mexico_City')) between 1 and 5
    and (target_at at time zone 'America/Mexico_City')::time >= time '08:00'
    and (target_at at time zone 'America/Mexico_City')::time < time '20:00'
$$;
comment on function app.direct_lane_reply_window_open(timestamptz) is
  'Horario en que puede salir una respuesta escrita por el operador: 8:00 a 20:00 CDMX, lunes a viernes.';

"""
OUT.write_text(head + claim + "\n" + release + "\ncommit;\n")
print(f"escrito {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")
