"""Vuelca celdas de una hoja: python3 dump.py libro.xlsm Hoja [fila_ini fila_fin] [colA colZ]"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from xlsx_read import Workbook, split_ref, col_to_num, num_to_col

wb = Workbook(sys.argv[1]); sh = sys.argv[2]
r0 = int(sys.argv[3]) if len(sys.argv) > 3 else 1
r1 = int(sys.argv[4]) if len(sys.argv) > 4 else 10**6
c0 = col_to_num(sys.argv[5]) if len(sys.argv) > 5 else 1
c1 = col_to_num(sys.argv[6]) if len(sys.argv) > 6 else 10**6
rows = {}
for ref, c in wb.cells(sh).items():
    col, row = split_ref(ref)
    if r0 <= row <= r1 and c0 <= col_to_num(col) <= c1 and c.value is not None:
        rows.setdefault(row, []).append((col_to_num(col), col, c))
for row in sorted(rows):
    parts = []
    for _, col, c in sorted(rows[row]):
        v = c.value
        if isinstance(v, float):
            v = f"{v:.10g}"
        elif isinstance(v, str):
            v = v.replace("\n", "⏎")[:38]
        f = f" ƒ={c.formula}" if c.formula else ""
        parts.append(f"{col}={v}{f}")
    print(f"{row:>4}: " + " | ".join(parts))
