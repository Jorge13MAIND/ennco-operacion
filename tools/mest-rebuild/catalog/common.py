"""Ayudas para generar catálogos de fórmulas."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from xlsx_read import col_to_num, num_to_col  # noqa: E402

MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]


class Catalog:
    def __init__(self, sheet):
        self.sheet = sheet
        self.entries = []

    def f(self, cell, formula, text=None):
        e = {"sheet": self.sheet, "cell": cell, "formula": formula if formula.startswith("=") else "=" + formula}
        if text is not None:
            e["text"] = text
        self.entries.append(e)
        return self

    def v(self, cell, value):
        self.entries.append({"sheet": self.sheet, "cell": cell, "value": value})
        return self

    def row(self, row, cols, template, text=None, **kw):
        """template con {c} = columna actual, {r} = fila, {cp} columna anterior, {cn} siguiente."""
        for c in cols:
            n = col_to_num(c)
            self.f(f"{c}{row}", template.format(c=c, r=row, cp=num_to_col(n - 1) if n > 1 else "", cn=num_to_col(n + 1), **kw), text)
        return self

    def col(self, col, rows, template, text=None, **kw):
        for r in rows:
            self.f(f"{col}{r}", template.format(c=col, r=r, rp=r - 1, rn=r + 1, **kw), text)
        return self


def cols(a, b):
    return [num_to_col(i) for i in range(col_to_num(a), col_to_num(b) + 1)]


def save(entries, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    json.dump(entries, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"{path}: {len(entries)} fórmulas")
