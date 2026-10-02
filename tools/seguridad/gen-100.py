"""Genera supabase/migrations/202610020100_auditoria_seguridad.sql (2-oct-2026, Grant).

Auditoría de seguridad del hub de ENNCO: Grant pidió arreglar todo lo que se pueda sin cerrar los
accesos que ya existen. Lo que cambia en la base:
  · Escribir en precios, proyectos solares, cotizaciones, productos y ganchos exige un rol que
    pueda escribir (ya no basta con ser miembro; auditor_readonly solo lee). Igual en las reglas
    del bucket ennco-productos para subir, cambiar o borrar archivos.
  · El rol anónimo pierde todos los privilegios sobre tablas y secuencias de public, y los
    permisos por defecto de objetos nuevos (hoy RLS era la única barrera).
  · 42 funciones que de todos modos exigen un usuario con sesión dejan de ser ejecutables por el
    rol anónimo. Se quedan las firmadas con HMAC que usan los procesos automáticos y los
    formularios públicos.
  · authenticated pierde TRUNCATE, TRIGGER y REFERENCES (TRUNCATE se salta RLS y triggers).
  · Se borra la versión vieja de 3 argumentos de claim_direct_lane_dispatch (no está en el repo).
  · email_sdr_command compara la firma en tiempo constante.
  · RLS encendido en las 11 tablas de app que no lo tenían (el dueño postgres lo omite; las
    funciones siguen igual).
  · Límite de intentos de inicio de sesión y recuperación: tabla auth_attempt_windows y función
    check_auth_attempt (prueba HMAC, ventanas de 15 min por correo y por IP).
  · Limpieza única de nonces vencidos.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/seguridad/vivas-100"
OUT = ROOT / "supabase/migrations/202610020100_auditoria_seguridad.sql"
ORG = "e0000000-0000-4000-8000-000000000001"
WRITERS = "array['ennco_admin','ennco_operator','teckel_admin','teckel_operator']::public.user_role[]"

WRITE_RPCS = [
    "product_save", "product_set_file", "product_set_active", "product_set_favorite", "product_category_save",
    "product_categories_seed_defaults", "price_import", "price_item_save", "price_quote_save", "price_settings_save",
    "price_supplier_save", "solar_project_save", "solar_project_delete", "solar_quote_save", "solar_quote_set_status",
    "account_hook_save", "account_hook_review",
]


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


writes = "\n".join(patch(n, [("app.is_member(target_organization_id)", f"app.has_role(target_organization_id,{WRITERS})")]) for n in WRITE_RPCS)
sdr = patch("email_sdr_command", [
    ("if proof_signature<>signature then raise exception 'SDR_UNAUTHORIZED'; end if;",
     "if digest(proof_signature,'sha256')<>digest(signature,'sha256') then raise exception 'SDR_UNAUTHORIZED'; end if;"),
])

anon_fns = json.loads((ROOT / "tools/seguridad/revocar_anon_100.json").read_text())
revokes = "\n".join(
    f"revoke execute on function public.{sig} from public, anon;\ngrant execute on function public.{sig} to authenticated, service_role;"
    for sig in anon_fns
)

APP_TABLES = ["private_runtime_config", "auth_policy", "dispatch_holidays", "email_sdr_body_overrides",
              "email_unmatched_review_commands", "email_sdr_settings", "email_sdr_nonces", "email_sdr_model_usage",
              "email_contact_clearance_commands", "email_sdr_alert_dispatch", "email_sdr_templates"]
app_rls = "\n".join(f"alter table app.{t} enable row level security;" for t in APP_TABLES)

sql = f"""-- 100 · Auditoría de seguridad del hub (2-oct-2026). Generado por tools/seguridad/gen-100.py desde
-- tools/seguridad/vivas-100/. Ver el docstring del generador. Ninguna cuenta pierde acceso.

begin;

set local app.operations_rpc_write = 'on';

-- 1 · Escribir exige rol con permiso de escritura (no solo membresía).
{writes}
alter policy ennco_productos_insert on storage.objects
  with check (bucket_id = 'ennco-productos' and app.has_role(app.product_object_org_id(name), {WRITERS}));
alter policy ennco_productos_update on storage.objects
  using (bucket_id = 'ennco-productos' and app.has_role(app.product_object_org_id(name), {WRITERS}));
alter policy ennco_productos_delete on storage.objects
  using (bucket_id = 'ennco-productos' and app.has_role(app.product_object_org_id(name), {WRITERS}));

-- 2 · El rol anónimo no tiene nada que hacer con las tablas: todo lo público pasa por funciones firmadas.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, trigger, references on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- 3 · Funciones que exigen usuario con sesión: fuera el rol anónimo (y PUBLIC), se mantiene authenticated.
{revokes}

-- 4 · Versión vieja sin prueba HMAC (fuera del repo; el motor usa la de 7 argumentos).
drop function if exists public.claim_direct_lane_dispatch(uuid, uuid, boolean);

-- 5 · Firma del SDR comparada en tiempo constante.
{sdr}
-- 6 · RLS en las tablas internas de app (postgres es dueño y lo omite; nadie más tiene permisos).
{app_rls}

-- 7 · Límite de intentos de inicio de sesión y recuperación.
create table if not exists public.auth_attempt_windows (
  organization_id uuid not null references public.organizations(id),
  kind text not null check (kind in ('login','recovery')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{{64}}$'),
  window_start timestamptz not null,
  attempts integer not null default 0,
  primary key (organization_id, kind, key_hash, window_start)
);
alter table public.auth_attempt_windows enable row level security;
revoke all on public.auth_attempt_windows from public, anon, authenticated;

create or replace function public.check_auth_attempt(target_organization_id uuid, target_kind text, target_email_hash text,
  target_ip_hash text, proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path = public, app, extensions, pg_temp as $$
declare win timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / 900) * 900);
  email_count integer; ip_count integer; email_limit integer; ip_limit integer;
begin
  if target_kind not in ('login','recovery') or target_email_hash !~ '^[a-f0-9]{{64}}$' or target_ip_hash !~ '^[a-f0-9]{{64}}$' then
    raise exception 'AUTH_ATTEMPT_INVALID';
  end if;
  perform app.verify_dispatch_proof(target_organization_id, proof_command_id, proof_nonce, proof_expires_at,
    encode(digest(convert_to(concat_ws(E'\\n','check_auth_attempt',target_organization_id::text,target_kind,target_email_hash,target_ip_hash),'utf8'),'sha256'),'hex'),
    proof_signature);
  email_limit := case when target_kind = 'login' then 10 else 3 end;
  ip_limit := case when target_kind = 'login' then 30 else 10 end;
  insert into public.auth_attempt_windows values (target_organization_id, target_kind, target_email_hash, win, 1)
    on conflict (organization_id, kind, key_hash, window_start) do update set attempts = auth_attempt_windows.attempts + 1
    returning attempts into email_count;
  insert into public.auth_attempt_windows values (target_organization_id, target_kind, target_ip_hash, win, 1)
    on conflict (organization_id, kind, key_hash, window_start) do update set attempts = auth_attempt_windows.attempts + 1
    returning attempts into ip_count;
  delete from public.auth_attempt_windows where window_start < clock_timestamp() - interval '2 days';
  return jsonb_build_object('allowed', email_count <= email_limit and ip_count <= ip_limit);
end $$;
revoke all on function public.check_auth_attempt(uuid, text, text, text, text, uuid, timestamptz, text) from public;
grant execute on function public.check_auth_attempt(uuid, text, text, text, text, uuid, timestamptz, text) to anon, authenticated, service_role;

-- 8 · Limpieza única de nonces vencidos (no hay pg_cron).
delete from public.public_prequote_nonces where request_expires_at < now() - interval '1 day';

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('{ORG}', '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', 'SECURITY_AUDIT_HARDENING', 'organizations', '{ORG}',
  jsonb_build_object('source','migración 100','write_rpcs',{len(WRITE_RPCS)},'anon_functions_revoked',{len(anon_fns)},'app_tables_rls',{len(APP_TABLES)}));

commit;
"""
OUT.write_text(sql)
print(OUT, len(sql), "funciones anon revocadas:", len(anon_fns))
