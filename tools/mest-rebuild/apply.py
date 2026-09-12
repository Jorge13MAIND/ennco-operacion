"""Cirugía XML: inserta fórmulas en un .xlsm sin tocar nada más del paquete.

    python3 apply.py --in original.xlsm --catalog formulas-catalogo.json --out build/v1.xlsm [--drop-names password,password_check,_xleta]

Catálogo: lista de {"sheet","cell","formula"} (fórmula sin '=' inicial o con él; sintaxis Excel EN-US).
Opcional "text": true cuando el resultado es texto (se escribe t="str"). Si la celda original era texto compartido (t="s") y no se indica, se asume texto.
El <v> original se conserva como caché; en workbook.xml se fija fullCalcOnLoad="1".
"""
import argparse
import html
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from xlsx_read import col_to_num, split_ref  # noqa: E402


def xml_escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def value_cell(ref, attrs, value):
    if isinstance(value, str):
        return f'<c r="{ref}"{attrs} t="inlineStr"><is><t xml:space="preserve">{xml_escape(value)}</t></is></c>'
    return f'<c r="{ref}"{attrs}><v>{value!r}</v></c>'


def cell_sort_key(ref):
    col, row = split_ref(ref)
    return (row, col_to_num(col))


def patch_sheet(xml, formulas):
    """formulas: {ref: (formula, is_text)}. Devuelve xml nuevo y contadores."""
    done = set()
    stats = {"replaced": 0, "inserted": 0}

    def repl(m):
        col, row, attrs, inner = m.group(1), m.group(2), m.group(3), m.group(4)
        ref = f"{col}{row}"
        if ref not in formulas:
            return m.group(0)
        formula, is_text = formulas[ref]
        done.add(ref)
        stats["replaced"] += 1
        attrs2 = re.sub(r'\s+t="\w+"', "", attrs)
        if formula == "__VALUE__":
            return value_cell(ref, attrs2, is_text)
        t_orig = re.search(r'\bt="(\w+)"', attrs)
        t_orig = t_orig.group(1) if t_orig else "n"
        v = ""
        if inner:
            vm = re.search(r"<v>(.*?)</v>", inner, re.S)
            if vm:
                v = vm.group(1)
        if is_text is None:
            is_text = t_orig in ("s", "str")
        if is_text:
            if t_orig == "s":
                v = ""  # el índice de sharedStrings no sirve como caché de t="str"; Excel recalcula
            return f'<c r="{ref}"{attrs2} t="str"><f>{xml_escape(formula)}</f>' + (f"<v>{v}</v>" if v else "") + "</c>"
        if t_orig in ("s", "b", "e"):
            v = ""
        return f'<c r="{ref}"{attrs2}><f>{xml_escape(formula)}</f>' + (f"<v>{v}</v>" if v else "") + "</c>"

    xml = re.sub(r'<c r="([A-Z]+)(\d+)"([^>]*?)(?:/>|>(.*?)</c>)', repl, xml, flags=re.S)
    # celdas que no existían: insertarlas en su fila (o crear la fila)
    missing = [r for r in formulas if r not in done]
    if missing:
        by_row = defaultdict(list)
        for ref in missing:
            by_row[split_ref(ref)[1]].append(ref)
        for row, refs in by_row.items():
            new_cells = ""
            for ref in sorted(refs, key=cell_sort_key):
                formula, is_text = formulas[ref]
                if formula == "__VALUE__":
                    new_cells += value_cell(ref, "", is_text)
                else:
                    t = ' t="str"' if is_text else ""
                    new_cells += f'<c r="{ref}"{t}><f>{xml_escape(formula)}</f></c>'
                stats["inserted"] += 1
            rm = re.search(rf'<row r="{row}"[^>]*?(/>|>(.*?)</row>)', xml, re.S)
            if rm:
                if rm.group(1) == "/>":
                    new = rm.group(0)[:-2] + ">" + new_cells + "</row>"
                    xml = xml.replace(rm.group(0), new, 1)
                else:
                    # insertar ordenado por columna dentro de la fila
                    cells = re.findall(r'<c r="([A-Z]+)\d+"', rm.group(2))
                    inner = rm.group(2)
                    pos = len(inner)
                    for ref in sorted(refs, key=cell_sort_key):
                        pass
                    # inserción simple: reconstruir la fila ordenando todas las celdas
                    items = re.findall(r'(<c r="([A-Z]+\d+)"[^>]*?(?:/>|>.*?</c>))', inner, re.S)
                    allc = {r: x for x, r in items}
                    for ref in refs:
                        formula, is_text = formulas[ref]
                        if formula == "__VALUE__":
                            allc[ref] = value_cell(ref, "", is_text)
                        else:
                            t = ' t="str"' if is_text else ""
                            allc[ref] = f'<c r="{ref}"{t}><f>{xml_escape(formula)}</f></c>'
                    rebuilt = "".join(allc[r] for r in sorted(allc, key=cell_sort_key))
                    head = rm.group(0)[: rm.group(0).index(">") + 1]
                    xml = xml.replace(rm.group(0), head + rebuilt + "</row>", 1)
            else:
                # crear la fila en orden dentro de <sheetData>
                rows = [(int(x), m.start()) for m in re.finditer(r'<row r="(\d+)"', xml) for x in [m.group(1)]]
                after = [pos for r, pos in rows if r > row]
                new_row = f'<row r="{row}">{new_cells}</row>'
                if after:
                    xml = xml[: min(after)] + new_row + xml[min(after):]
                else:
                    xml = xml.replace("</sheetData>", new_row + "</sheetData>", 1)
    return xml, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--catalog", required=True, nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--drop-names", default="password,password_check,_xleta")
    args = ap.parse_args()
    entries = []
    for c in args.catalog:
        entries += json.load(open(c, encoding="utf-8"))
    zin = zipfile.ZipFile(args.inp)
    wbxml = zin.read("xl/workbook.xml").decode("utf-8")
    rels = dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', zin.read("xl/_rels/workbook.xml.rels").decode("utf-8")))
    paths = {}
    for m in re.finditer(r'<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"', wbxml):
        t = rels[m.group(2)]
        paths[html.unescape(m.group(1))] = t[1:] if t.startswith("/") else "xl/" + t
    by_sheet = defaultdict(dict)
    for e in entries:
        if "value" in e:
            by_sheet[e["sheet"]][e["cell"]] = ("__VALUE__", e["value"])
            continue
        f = e["formula"]
        f = f[1:] if f.startswith("=") else f
        by_sheet[e["sheet"]][e["cell"]] = (f, e.get("text"))
    unknown = [s for s in by_sheet if s not in paths]
    if unknown:
        sys.exit(f"hojas desconocidas en el catálogo: {unknown}")
    # workbook.xml: fullCalcOnLoad y nombres a eliminar
    wb2 = re.sub(r"<calcPr[^>]*/>", '<calcPr calcId="191029" fullCalcOnLoad="1"/>', wbxml)
    drops = [d for d in args.drop_names.split(",") if d]
    for d in drops:
        wb2 = re.sub(rf'<definedName name="{re.escape(d)}[^"]*"[^>]*>.*?</definedName>', "", wb2, flags=re.S)
    patched = {"xl/workbook.xml": wb2.encode("utf-8")}
    total = {"replaced": 0, "inserted": 0}
    for sh, fm in by_sheet.items():
        xml = zin.read(paths[sh]).decode("utf-8")
        xml2, st = patch_sheet(xml, fm)
        total["replaced"] += st["replaced"]
        total["inserted"] += st["inserted"]
        patched[paths[sh]] = xml2.encode("utf-8")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = patched.get(item.filename, zin.read(item.filename))
            zout.writestr(item, data)
    print(f"{args.out}: {len(entries)} fórmulas en {len(by_sheet)} hojas · {total['replaced']} celdas existentes · {total['inserted']} celdas nuevas · nombres eliminados: {drops}")


if __name__ == "__main__":
    main()
