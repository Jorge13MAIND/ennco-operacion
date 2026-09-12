"""Compara los casos dorados (pruebas/golden-cases.json) con un libro recalculado.
    python3 golden.py recalc.xlsx golden-cases.json"""
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from xlsx_read import Workbook  # noqa: E402

ALIAS = {"Gen_Energia": "Gen_Energía", "Inf_Modulos": "Inf_Módulos"}
wb = Workbook(sys.argv[1]); g = json.load(open(sys.argv[2], encoding="utf-8"))
ok = bad = 0; fails = []
for sheet, block in g.items():
    if sheet.startswith("_"): continue
    sh = ALIAS.get(sheet, sheet)
    if sh not in wb.sheet_paths: continue
    cells = wb.cells(sh)
    for sub in ("out", "outputs"):
        exp = block.get(sub, {})
        for k, v in exp.items():
            if not re.fullmatch(r"[A-Z]+\d+", k): continue
            c = cells.get(k)
            got = c.value if c else None
            if isinstance(v, (int, float)) and isinstance(got, (int, float)):
                good = math.isclose(v, got, rel_tol=1e-6, abs_tol=1e-6)
            else:
                good = str(v).strip() == str(got).strip()
            if good: ok += 1
            else: bad += 1; fails.append(f"{sh}!{k}: esperado {v!r} obtenido {got!r}")
print(f"casos dorados: {ok} iguales, {bad} distintos")
for f in fails: print("  " + f)
sys.exit(1 if bad else 0)
