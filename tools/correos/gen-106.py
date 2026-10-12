"""Genera supabase/migrations/202610120106_retencion_de_cuarentena.sql (12-oct-2026, Grant).

Un envío incierto (Gmail no confirma, p. ej. GMAIL_API_TIMEOUT) queda QUARANTINED y, mientras exista
uno solo, claim_direct_lane_dispatch pausa el buzón completo. El 8-oct a las 13:00 eso dejó
francisco@enncoindustrial.com parado cuatro días por un solo correo (toque 2 a un contacto), con 239
contactos vencidos. QUARANTINED es terminal a propósito (enforce_direct_lane_release), así que no se
cambia el mensaje: se registra una retención. Con retención, el mensaje sigue en cuarentena (su estado
real es "no se sabe"), su inscripción queda detenida aparte y el buzón vuelve a enviar a los demás.
El toque retenido nunca se reintenta: el claim ya excluye un toque con mensaje que no sea FAILED.
Grant, 12-oct: "reinicia ese correo, si quieres deja el de Felipe ahí".
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-106"
OUT = ROOT / "supabase/migrations/202610120106_retencion_de_cuarentena.sql"


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


claim = patch("claim_direct_lane_dispatch", [
    ("""    and lane='DIRECT' and direction='OUTBOUND' and status='QUARANTINED') then""",
     """    and lane='DIRECT' and direction='OUTBOUND' and status='QUARANTINED'
    -- 12-oct: un envío incierto con retención registrada ya no frena al buzón completo.
    and not exists (select 1 from app.direct_lane_quarantine_holds h
      where h.organization_id=messages.organization_id and h.message_id=messages.id)) then"""),
])

sql = f"""-- 106 · Retención de cuarentena (12-oct-2026). Generado por tools/correos/gen-106.py desde
-- tools/correos/vivas-106/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

create table if not exists app.direct_lane_quarantine_holds (
  organization_id uuid not null,
  message_id uuid not null references public.messages(id),
  enrollment_id uuid not null references public.campaign_enrollments(id),
  decided_by text not null check (length(btrim(decided_by)) between 2 and 120),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, message_id)
);
alter table app.direct_lane_quarantine_holds enable row level security;
revoke all on app.direct_lane_quarantine_holds from public, anon, authenticated;

-- Solo se retiene un mensaje en cuarentena con su inscripción ya detenida.
create or replace function app.direct_lane_hold_quarantine()
returns trigger language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
begin
  if not exists (select 1 from public.messages m join public.campaign_enrollments e
      on e.organization_id = m.organization_id and e.id = m.enrollment_id
    where m.organization_id = new.organization_id and m.id = new.message_id and m.enrollment_id = new.enrollment_id
      and m.status = 'QUARANTINED' and e.status in ('PAUSED', 'COMPLETED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'SUPPRESSED')) then
    raise exception 'QUARANTINE_HOLD_REQUIRES_STOPPED_ENROLLMENT';
  end if;
  return new;
end $$;
drop trigger if exists direct_lane_quarantine_holds_guard on app.direct_lane_quarantine_holds;
create trigger direct_lane_quarantine_holds_guard before insert or update on app.direct_lane_quarantine_holds
  for each row execute function app.direct_lane_hold_quarantine();

{claim}
commit;
"""
OUT.write_text(sql)
print(OUT, len(sql))
