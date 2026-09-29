"""Genera supabase/migrations/202609290094_volumen_180.sql (29-sep-2026, Grant).

Grant: "180 por buzón desde hoy" y "autorizar y reanudar" los contactos nuevos. Lo que cambia:
  · Tope de 180 por buzón (la tabla tenía un CHECK de 100 y la configuración uno de 60).
  · Ventana de campaña de 8:00 a 18:00 CDMX (era 9:30 a 13:30) y ritmo de 2 a 3.5 minutos entre
    correos del mismo buzón (era 4 a 7). Con cron cada minuto da unos 180 en diez horas.
  · NO incluye reanudar contactos nuevos: la autorización por contacto de Jorge, su retención por
    rebote de 2 % y la pausa manual de la v4 quedan como están (cambiarlas es decisión de Grant o
    Jorge fuera de esta migración).
  · La rotación ya no puede tumbar el registro de un envío: si la compuerta rechaza la ronda
    siguiente, se salta y queda en bitácora (antes la excepción abortaba el settle del toque 4).
  · Corrige el corte de día de la inscripción automática (daba un timestamp sin zona).
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-094"
OUT = ROOT / "supabase/migrations/202609290094_volumen_180.sql"


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


configure = patch("configure_direct_lane_mailbox", [
    ("coalesce((target_patch->>'cap_max')::integer,mailbox_record.direct_lane_cap_max)>60 then",
     "coalesce((target_patch->>'cap_max')::integer,mailbox_record.direct_lane_cap_max)>200 then"),
])

claim = patch("claim_direct_lane_dispatch", [
    ("reply_only := not app.hybrid_dispatch_window_is_open(clock_timestamp());",
     "reply_only := not app.direct_lane_campaign_window_open(clock_timestamp());"),
    ("pace_seconds := 240+mod(abs(hashtextextended(", "pace_seconds := 120+mod(abs(hashtextextended("),
    ("||sent_count::text,0)),180)::integer;", "||sent_count::text,0)),90)::integer;"),
])

autoenroll = patch("autoenroll_direct_lane", [
    ("< ((clock_timestamp() at time zone 'America/Mexico_City')::date + 1) at time zone 'America/Mexico_City';",
     "< (((clock_timestamp() at time zone 'America/Mexico_City')::date + 1)::timestamp at time zone 'America/Mexico_City');"),
])

rotate = patch("direct_lane_rotate", [
    ("""  insert into public.campaign_enrollments(organization_id, campaign_id, sequence_version_id, account_id, contact_id,
    mailbox_id, status, next_touch_number, next_touch_at, rotation_round, rotation_origin_id)
  values (e.organization_id, rot.id, version_id, e.account_id, e.contact_id,
    chosen, 'PENDING', 1, start_at, next_round, coalesce(e.rotation_origin_id, e.id))
  returning id into new_id;""",
     """  -- Si una compuerta (p. ej. la autorización por contacto) rechaza la ronda, se salta y queda en
  -- bitácora. Esta función corre dentro del settle del toque 4: una excepción aquí tumbaría el
  -- registro de un correo que Gmail ya aceptó.
  begin
    insert into public.campaign_enrollments(organization_id, campaign_id, sequence_version_id, account_id, contact_id,
      mailbox_id, status, next_touch_number, next_touch_at, rotation_round, rotation_origin_id)
    values (e.organization_id, rot.id, version_id, e.account_id, e.contact_id,
      chosen, 'PENDING', 1, start_at, next_round, coalesce(e.rotation_origin_id, e.id))
    returning id into new_id;
  exception when others then
    insert into public.audit_log(organization_id, action, record_type, record_id, new_data)
    values (e.organization_id, 'DIRECT_LANE_ROTATION_SKIPPED', 'campaign_enrollments', e.id,
      jsonb_build_object('round', next_round, 'reason', left(sqlerrm, 200)));
    return null;
  end;"""),
])

head = """-- 094 · 180 correos por buzón, ventana 8:00-18:00 y rotación segura (29-sep-2026).
-- Generado por tools/correos/gen-094.py; ver el docstring del generador para el porqué de cada cambio.

begin;

set local app.operations_rpc_write = 'on';

-- Topes: el CHECK de la tabla permitía hasta 100.
alter table public.mailboxes drop constraint mailboxes_direct_lane_ramp_check;
alter table public.mailboxes add constraint mailboxes_direct_lane_ramp_check check (
  direct_lane_ramp_mode = any (array['AUTO','FIXED','SCHEDULE'])
  and direct_lane_fixed_cap between 0 and 200 and direct_lane_cap_max between 0 and 200
  and (direct_lane_ramp_schedule is null or (array_length(direct_lane_ramp_schedule,1) between 1 and 12
    and 0 <= all (direct_lane_ramp_schedule) and 200 >= all (direct_lane_ramp_schedule)))
  and (direct_lane_ramp_mode <> 'SCHEDULE' or direct_lane_ramp_schedule is not null));

-- Ventana de campaña propia del carril directo (la híbrida sigue igual para su motor).
create or replace function app.direct_lane_campaign_window_open(target_at timestamptz)
returns boolean language sql stable set search_path to 'pg_catalog' as $$
  select extract(isodow from (target_at at time zone 'America/Mexico_City')) between 1 and 5
    and (target_at at time zone 'America/Mexico_City')::time >= time '08:00'
    and (target_at at time zone 'America/Mexico_City')::time < time '18:00'
    and not exists (select 1 from app.dispatch_holidays h
                    where h.holiday_date = (target_at at time zone 'America/Mexico_City')::date)
$$;

"""

tail = """
update public.mailboxes set direct_lane_ramp_mode='FIXED', direct_lane_fixed_cap=180, direct_lane_cap_max=180, updated_at=clock_timestamp()
where organization_id='e0000000-0000-4000-8000-000000000001' and direct_lane_status is not null;

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('e0000000-0000-4000-8000-000000000001', '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', 'DIRECT_LANE_VOLUME_180', 'organizations',
  'e0000000-0000-4000-8000-000000000001',
  jsonb_build_object('cap', 180, 'window', '08:00-18:00', 'pace_seconds', '120-210', 'source', 'migración 094'));

commit;
"""

OUT.write_text(head + configure + "\n" + claim + "\n" + autoenroll + "\n" + rotate + tail)
print(f"escrito {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")
