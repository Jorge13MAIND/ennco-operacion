"""Compara los valores de dos libros celda por celda (original vs recalculado por LibreOffice).

    python3 verify.py --original mest.xlsm --recalc out/v1.xlsx [--allow notas.json] [--sheet Hoja] [--report diff.md]

Salida: resumen por hoja y lista de diferencias no permitidas. Código de salida 1 si hay diferencias no permitidas.
"""
import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from xlsx_read import Workbook  # noqa: E402

ERR_TEXT = {"#VALUE!", "#DIV/0!", "#N/A", "#REF!", "#NAME?", "#NUM!"}


def same(a, b, rel=1e-9, abs_tol=1e-9):
    if a.kind in ("n",) and b.kind in ("n",) and isinstance(a.value, float) and isinstance(b.value, float):
        return math.isclose(a.value, b.value, rel_tol=rel, abs_tol=abs_tol)
    av = a.value if a.kind != "e" else a.value
    bv = b.value if b.kind != "e" else b.value
    if a.kind == "e" or b.kind == "e":
        return str(av) == str(bv)
    if isinstance(av, float) and isinstance(bv, str) or isinstance(av, str) and isinstance(bv, float):
        try:
            return math.isclose(float(av), float(bv), rel_tol=rel, abs_tol=abs_tol)
        except ValueError:
            return False
    if isinstance(av, str) and isinstance(bv, str):
        return av.replace('\r\n', '\n') == bv.replace('\r\n', '\n')
    return av == bv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--original", required=True)
    ap.add_argument("--recalc", required=True)
    ap.add_argument("--allow", help="JSON {hoja: [celdas o rangos permitidos]}")
    ap.add_argument("--sheet")
    ap.add_argument("--report")
    ap.add_argument("--rel", type=float, default=1e-9)
    ap.add_argument("--show", type=int, default=40)
    args = ap.parse_args()
    allow = json.load(open(args.allow)) if args.allow else {}
    from xlsx_read import col_to_num, num_to_col, split_ref
    expanded = {}
    for sh, items in allow.items():
        cells = set()
        for it in items:
            if ":" in it:
                a, b = it.split(":")
                (c1, r1), (c2, r2) = split_ref(a), split_ref(b)
                for cc in range(col_to_num(c1), col_to_num(c2) + 1):
                    for rr in range(r1, r2 + 1):
                        cells.add(f"{num_to_col(cc)}{rr}")
            else:
                cells.add(it)
        expanded[sh] = cells
    allow = expanded
    o, r = Workbook(args.original), Workbook(args.recalc)
    total = equal = allowed = missing = 0
    bad = []
    lines = []
    for sh in o.sheets:
        if args.sheet and sh != args.sheet:
            continue
        if sh not in r.sheet_paths:
            lines.append(f"| {sh} | FALTA EN RECALC | | |")
            continue
        oc, rc = o.cells(sh), r.cells(sh)
        okd = set(allow.get(sh, []))
        n_eq = n_bad = n_allow = n_miss = 0
        for ref, a in oc.items():
            if a.value is None:
                continue
            total += 1
            b = rc.get(ref)
            if b is None or b.value is None:
                if ref in okd or "*" in okd:
                    n_allow += 1
                else:
                    n_miss += 1
                    bad.append((sh, ref, a.value, None))
                continue
            if same(a, b, args.rel):
                n_eq += 1
            elif ref in okd or "*" in okd:
                n_allow += 1
            else:
                n_bad += 1
                bad.append((sh, ref, a.value, b.value))
        equal += n_eq
        allowed += n_allow
        missing += n_miss
        lines.append(f"| {sh} | {len(oc)} | {n_eq} | {n_allow} | {n_bad + n_miss} |")
    hdr = "| Hoja | Celdas | Iguales | Permitidas | No permitidas |\n|---|---|---|---|---|\n"
    summary = f"\nTotal: {total} comparadas · {equal} iguales · {allowed} permitidas · {len(bad)} NO permitidas (de las cuales {missing} faltan en el recalculado)\n"
    print(hdr + "\n".join(lines) + summary)
    for sh, ref, a, b in bad[: args.show]:
        print(f"  {sh}!{ref}: original={a!r} recalc={b!r}")
    if len(bad) > args.show:
        print(f"  … {len(bad) - args.show} más")
    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            f.write("# Verificación de recálculo\n\n" + hdr + "\n".join(lines) + summary + "\n")
            for sh, ref, a, b in bad:
                f.write(f"- {sh}!{ref}: original={a!r} recalc={b!r}\n")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
