"""Genera supabase/migrations/202610120108_gancho_en_rondas.sql (12-oct-2026, Grant).

Solo el toque 1 de la ronda 1 (versiones 1 a 4) tiene {{gancho}}; el de las rondas 2 a 5 (versiones 5
a 8) no. Muchos ganchos se investigaron después de que salió la ronda 1, así que nunca llegaban a un
correo (19 de 149 al 12-oct). Grant: "quiero que adaptes las nuevas empresas a los correos que ya
salieron". Ahora, en un toque 1 cuya plantilla no tiene {{gancho}}, se agrega el gancho PROPIO de la
empresa (nunca el de respaldo) después del saludo, solo si esa persona no lo ha recibido antes y solo si
el correo sigue dentro de las 120 palabras y sin enlaces que exige enforce_direct_lane_release. Si no
cabe, sale como antes. No se tocan las plantillas aprobadas.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-108"
OUT = ROOT / "supabase/migrations/202610120108_gancho_en_rondas.sql"


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


claim = patch("claim_direct_lane_dispatch", [
    ("""  prefer_new boolean := false;""",
     """  prefer_new boolean := false; own_hook text; greeting text; hooked_body text;"""),
    ("""  rendered_body := app.direct_lane_render(candidate.body_template,candidate.full_name,candidate.legal_name,hook_text);""",
     """  rendered_body := app.direct_lane_render(candidate.body_template,candidate.full_name,candidate.legal_name,hook_text);
  -- 12-oct (Grant): el toque 1 de las rondas 2 a 5 no tiene {{gancho}}. Si la empresa tiene gancho propio
  -- y esta persona nunca lo recibió, va después del saludo, siempre que quepa en 120 palabras y sin enlaces.
  if candidate.touch_value=1 and position('{{gancho}}' in candidate.body_template)=0 then
    select h.hook_text into own_hook from public.ennco_account_hooks h
    where h.organization_id=target_organization_id and h.account_id=candidate.account_id and h.status='APPROVED'
    order by h.created_at desc limit 1;
    greeting:=substring(rendered_body from '^(Hola[^\\n]*\\n\\n)');
    if nullif(btrim(own_hook),'') is not null and greeting is not null
      and not exists (select 1 from public.messages pm where pm.organization_id=target_organization_id
        and pm.contact_id=candidate.contact_id and pm.direction='OUTBOUND'
        and position(left(btrim(own_hook),40) in coalesce(pm.body_text,''))>0) then
      hooked_body:=greeting||btrim(own_hook)||E'\\n\\n'||substr(rendered_body,length(greeting)+1);
      if cardinality(regexp_split_to_array(btrim(hooked_body),'\\s+'))<=120 and hooked_body!~*'(https?://|www\\.|mailto:)' then
        rendered_body:=hooked_body;
      end if;
    end if;
  end if;"""),
])

sql = f"""-- 108 · Gancho propio en el toque 1 de las rondas 2 a 5 (12-oct-2026). Generado por tools/correos/gen-108.py
-- desde tools/correos/vivas-108/. Ver el docstring del generador.

begin;

{claim}
commit;
"""
OUT.write_text(sql)
print(OUT, len(sql))
