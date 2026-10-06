"""Genera supabase/migrations/202610060102_reactivar_v4.sql (6-oct-2026, Grant).

Grant: "Vamos a reactivarlo como estaba antes", con la v4 que ya estaba establecida, los mismos toques,
inscribiendo contactos nuevos, 180 por buzón de dominio y 50 en contacto@. Decisiones:
  · Quitar la pausa automática por avisos sin confirmar: la agregó Codex, no Jorge. Los avisos siguen
    llegando (panel y correo), pero ya no frenan la campaña. Se queda la retención por rebote (>10 %).
  · Corregir las bajas por correo: el SDR registraba la baja con el mismo provider_message_id del
    mensaje que ya se guardó como respuesta y la base lo rechazaba por duplicado. Ninguna baja por
    correo se había registrado. Ahora se reutiliza el mensaje entrante si ya existe.
  · Quitar la pausa manual de contactos nuevos en las dos campañas que siguen corriendo.
Este archivo no lleva datos de contactos ni ganchos: el repositorio es público. La baja pendiente y
los ganchos se aplican aparte, directo en la base.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-102"
OUT = ROOT / "supabase/migrations/202610060102_reactivar_v4.sql"
ORG = "e0000000-0000-4000-8000-000000000001"
GRANT = "614db7d9-f70b-4f8b-b0e2-d5c0190a06b3"


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


apply_event = patch("apply_mailbox_provider_event", [
    ("""    insert into public.messages (
      organization_id, enrollment_id, mailbox_id, contact_id, direction, status,""",
     """    -- Una baja que llega por el SDR trae el mismo mensaje que ya se guardó como respuesta: se reutiliza.
    select id into inbound_message_id from public.messages
      where organization_id = target_organization_id and provider_message_id = target_provider_message_id
        and direction = 'INBOUND' limit 1;
    if inbound_message_id is null then
    insert into public.messages (
      organization_id, enrollment_id, mailbox_id, contact_id, direction, status,"""),
    ("""    ) returning id into inbound_message_id;
  end if;""",
     """    ) returning id into inbound_message_id;
    end if;
  end if;"""),
])

alert_work = patch("email_sdr_alert_work", [
    ("""  if coalesce(oldest_seconds,0)>=7200 then
    update public.campaigns ca set new_contacts_paused=true,updated_at=clock_timestamp()
      where ca.organization_id=target_org and not ca.new_contacts_paused
      and exists(select 1 from app.email_sdr_settings settings where settings.organization_id=target_org and ca.id=any(settings.campaign_ids));
    get diagnostics claimed=row_count;
    if claimed>0 then
      insert into public.audit_log(organization_id,action,record_type,new_data)
        values(target_org,'EMAIL_SDR_UNACKNOWLEDGED_PAUSE','campaigns',
          jsonb_build_object('paused_campaigns',claimed,'oldest_pending_seconds',oldest_seconds));
    end if;
  end if;
""",
     """  -- 6-oct (Grant): un aviso sin confirmar ya no pausa los contactos nuevos; solo se escala.
"""),
])

sql = f"""-- 102 · Reactivar la v4 (6-oct-2026). Generado por tools/correos/gen-102.py desde tools/correos/vivas-102/.
-- Ver el docstring del generador. Reversa de la pausa: update public.campaigns set new_contacts_paused=true
-- where lane='DIRECT' and direct_lane_state='RUNNING';

begin;

set local app.operations_rpc_write = 'on';

{apply_event}
{alert_work}
update public.campaigns set new_contacts_paused = false, updated_at = clock_timestamp()
where organization_id = '{ORG}' and lane = 'DIRECT' and direct_lane_state = 'RUNNING';

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('{ORG}', '{GRANT}', 'DIRECT_LANE_NEW_CONTACTS_RESUMED', 'organizations', '{ORG}',
  jsonb_build_object('source','migración 102','unacknowledged_alert_pause','removed','email_unsubscribe','fixed',
    'order','Grant 6-oct: reactivar como estaba, misma v4, 180 por buzón de dominio y 50 en contacto@'));

commit;
"""
OUT.write_text(sql)
print(OUT, len(sql))
