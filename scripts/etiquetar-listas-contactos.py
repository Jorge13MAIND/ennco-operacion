#!/usr/bin/env python3
"""Genera el SQL que etiqueta a cada contacto con la lista de Apollo de la que salió.

Cruza por correo los archivos del plan comercial (fuera del repo, contienen datos personales)
con public.contacts y escribe un UPDATE con las columnas source_list, source_wave, source_group,
source_origin y source_category. El SQL resultante tampoco debe entrar al repo.

    python3 scripts/etiquetar-listas-contactos.py --dir "<carpeta con 00..05 csv>" --org <uuid> > /tmp/etiquetas.sql

Reglas (7-sep-2026): en 01 → LANZAMIENTO_SEPTIEMBRE; en 05 → NUEVOS_AMPLIACION_1000; en 02 → RESERVA_SEPTIEMBRE.
Ola, grupo A/B, fuente y categoría salen del inventario 00. Listas nuevas: agregar el archivo y su etiqueta en LISTAS.
"""
import argparse
import csv
from pathlib import Path

LISTAS = [  # (archivo, etiqueta) en orden de prioridad
    ("01-lanzamiento-septiembre.csv", "LANZAMIENTO_SEPTIEMBRE"),
    ("05-nuevos-preseleccionados-1000-creditos.csv", "NUEVOS_AMPLIACION_1000"),
    ("02-reserva-septiembre.csv", "RESERVA_SEPTIEMBRE"),
    ("03-retenidos-revision.csv", "RETENIDOS_REVISION"),
]
INVENTARIO = "00-inventario-completo.csv"


def leer(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def q(value: str | None) -> str:
    return "null" if not value else "'" + value.replace("'", "''") + "'"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--org", required=True)
    args = ap.parse_args()
    base = Path(args.dir)
    etiqueta: dict[str, str] = {}
    for archivo, nombre in LISTAS:
        for row in leer(base / archivo):
            email = row["email"].strip().lower()
            if email and email not in etiqueta:
                etiqueta[email] = nombre
    inventario = {r["email"].strip().lower(): r for r in leer(base / INVENTARIO)}
    valores = []
    for email, lista in sorted(etiqueta.items()):
        inv = inventario.get(email, {})
        valores.append("(%s,%s,%s,%s,%s,%s)" % (
            q(email), q(lista), q(inv.get("ola", "").strip() or None), q(inv.get("grupo_ab", "").strip() or None),
            q(inv.get("fuente", "").strip() or None), q(inv.get("categoria", "").strip() or None)))
    print("update public.contacts c set source_list=v.lista, source_wave=v.ola, source_group=v.grupo, source_origin=v.fuente, source_category=v.categoria")
    print("from (values\n" + ",\n".join(valores) + "\n) as v(email, lista, ola, grupo, fuente, categoria)")
    print("where c.organization_id='%s' and lower(c.normalized_email)=v.email;" % args.org)


if __name__ == "__main__":
    main()
