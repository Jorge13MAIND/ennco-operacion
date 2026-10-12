"""Genera supabase/migrations/202610120107_sync_resistente_y_primeros_toques.sql (12-oct-2026, Grant).

1. fcuellar@enncoindustrial.com dejó de sincronizar el 7-oct a las 15:22 sin que nadie lo supiera: el
   error por buzón solo vivía en la respuesta del cron. Ahora el sync lo guarda en
   mailbox_sync_cursors.last_error_code (public.record_direct_lane_sync_error) y en la bitácora cuando
   cambia; el siguiente sync exitoso lo limpia (update_dispatch_sync_cursor ya lo hacía).
2. Un correo que la base no acepta (p. ej. una respuesta de otra dirección en el hilo) frenaba el
   cursor para siempre. record_email_recovery acepta kind='FAILED': guarda el correo en la cola de
   recuperación con el error, siempre, y el sync sigue con los demás.
3. Primeros toques: el claim mandaba siempre los seguimientos vencidos antes que cualquier toque 1; con
   cientos atrasados no salía ningún toque 1 (ni gancho). Ahora alterna: si el último toque del día en
   ese buzón fue un seguimiento, prefiere un toque 1, y al revés. El tope de contactos nuevos no cambia.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-107"
OUT = ROOT / "supabase/migrations/202610120107_sync_resistente_y_primeros_toques.sql"


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


claim = patch("claim_direct_lane_dispatch", [
    ("""  thread_json jsonb; rendered_subject text; rendered_body text; unsubscribe_enrollment uuid; hook_text text;""",
     """  thread_json jsonb; rendered_subject text; rendered_body text; unsubscribe_enrollment uuid; hook_text text;
  prefer_new boolean := false;"""),
    ("""  -- Prioridad 2: el siguiente toque vencido de una inscripción de este buzón.""",
     """  -- 12-oct: alterna toques 1 y seguimientos; antes los seguimientos atrasados dejaban sin toque 1 al buzón.
  select m.touch_number>1 into prefer_new from public.messages m
  where m.organization_id=target_organization_id and m.mailbox_id=target_mailbox_id and m.lane='DIRECT'
    and m.direction='OUTBOUND' and m.touch_number is not null and m.status<>'DRY_RUN'
    and m.created_at>=(date_trunc('day',clock_timestamp() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City')
  order by m.created_at desc limit 1;
  prefer_new:=coalesce(prefer_new,false);
  -- Prioridad 2: el siguiente toque vencido de una inscripción de este buzón."""),
    ("""  order by (ce.next_touch_number=1), ce.next_touch_at nulls first, ce.created_at""",
     """  order by case when prefer_new then ce.next_touch_number<>1 else ce.next_touch_number=1 end, ce.next_touch_at nulls first, ce.created_at"""),
])

recovery = patch("record_email_recovery", [
    ("""  elsif p->>'kind'='MESSAGE' then""",
     """  elsif p->>'kind'='FAILED' then
    -- 12-oct: un correo que la base no aceptó se guarda siempre para revisión y el sync sigue.
    insert into public.email_recovery_review(organization_id,mailbox_id,provider_message_id,provider_thread_id,normalized_from,subject,body_text,next_action)
    values(target_organization_id,target_mailbox_id,p->>'provider_message_id',p->>'provider_thread_id',lower(p->>'from_email'),
      left(p->>'subject',1000),left(p->>'body_text',100000),
      left('No se pudo procesar solo ('||coalesce(p->>'error','sin código')||'). Revisar y decidir.',300))
    on conflict(organization_id,mailbox_id,provider_message_id) do nothing;
    insert into public.audit_log(organization_id,action,record_type,record_id,new_data)
      values(target_organization_id,'EMAIL_RECOVERY_FAILED_MESSAGE','mailboxes',target_mailbox_id,
        jsonb_build_object('error',left(p->>'error',200),'service','direct-lane-sync'));
    return jsonb_build_object('status','FAILED_REVIEW_REQUIRED');
  elsif p->>'kind'='MESSAGE' then"""),
])

sql = f"""-- 107 · Sync resistente y primeros toques (12-oct-2026). Generado por tools/correos/gen-107.py desde
-- tools/correos/vivas-107/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

create or replace function public.record_direct_lane_sync_error(target_organization_id uuid, target_mailbox_id uuid,
  target_error_code text, target_detail text, proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'extensions', 'pg_temp' as $$
declare payload_sha text; code text; previous text;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\\n', 'record_direct_lane_sync_error', target_organization_id::text,
    target_mailbox_id::text, coalesce(target_error_code, ''), coalesce(target_detail, '')), 'utf8'), 'sha256'), 'hex');
  perform app.verify_dispatch_proof(target_organization_id, proof_command_id, proof_nonce, proof_expires_at, payload_sha, proof_signature);
  code := left(regexp_replace(upper(coalesce(target_error_code, 'SYNC_FAILED')), '[^A-Z0-9_]', '_', 'g'), 64);
  if length(code) < 3 then code := 'SYNC_FAILED'; end if;
  select last_error_code into previous from public.mailbox_sync_cursors
  where organization_id = target_organization_id and mailbox_id = target_mailbox_id;
  update public.mailbox_sync_cursors set last_error_code = code, updated_at = clock_timestamp()
  where organization_id = target_organization_id and mailbox_id = target_mailbox_id;
  if not found then raise exception 'DIRECT_LANE_SYNC_CURSOR_NOT_FOUND'; end if;
  if previous is distinct from code then
    insert into public.audit_log (organization_id, action, record_type, record_id, new_data)
    values (target_organization_id, 'DIRECT_LANE_SYNC_FAILED', 'mailboxes', target_mailbox_id,
      jsonb_build_object('error_code', code, 'detail', left(target_detail, 300)));
  end if;
  return jsonb_build_object('status', 'RECORDED', 'error_code', code);
end $$;
revoke all on function public.record_direct_lane_sync_error(uuid, uuid, text, text, text, uuid, timestamptz, text) from public;
grant execute on function public.record_direct_lane_sync_error(uuid, uuid, text, text, text, uuid, timestamptz, text) to anon, authenticated;

{recovery}
{claim}
commit;
"""
OUT.write_text(sql)
print(OUT, len(sql))
