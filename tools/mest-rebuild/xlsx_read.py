"""Lectura de valores y fórmulas de un .xlsx/.xlsm sin dependencias (zipfile + regex).

Uso como librería:
    from xlsx_read import Workbook
    wb = Workbook("libro.xlsm")
    wb.sheets            -> lista de nombres en orden
    wb.cells("Hoja")     -> {"A1": Cell(value, kind, formula)}  kind: n (número), s (texto), b (bool), e (error), str (texto de fórmula)
"""
import html
import re
import zipfile
from dataclasses import dataclass

CELL_RE = re.compile(r'<c r="([A-Z]+)(\d+)"([^>]*?)(?:/>|>(.*?)</c>)', re.S)


@dataclass
class Cell:
    value: object
    kind: str
    formula: str | None = None


class Workbook:
    def __init__(self, path):
        self.path = path
        self.z = zipfile.ZipFile(path)
        wb = self.z.read("xl/workbook.xml").decode("utf-8", "ignore")
        rels = dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', self.z.read("xl/_rels/workbook.xml.rels").decode("utf-8", "ignore")))
        rels.update({k: v for k, v in re.findall(r'Target="([^"]+)"[^>]*Id="([^"]+)"', self.z.read("xl/_rels/workbook.xml.rels").decode("utf-8", "ignore"))[::-1]} if False else {})
        self.sheet_paths = {}
        self.sheets = []
        for m in re.finditer(r'<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"', wb):
            name = html.unescape(m.group(1))
            target = rels[m.group(2)]
            target = target[1:] if target.startswith("/") else "xl/" + target
            self.sheet_paths[name] = target
            self.sheets.append(name)
        self.shared = []
        if "xl/sharedStrings.xml" in self.z.namelist():
            ss = self.z.read("xl/sharedStrings.xml").decode("utf-8", "ignore")
            self.shared = [html.unescape(re.sub(r"<[^>]+>", "", m)) for m in re.findall(r"<si>(.*?)</si>", ss, re.S)]
        self._cache = {}

    def sheet_xml(self, name):
        return self.z.read(self.sheet_paths[name]).decode("utf-8", "ignore")

    def cells(self, name):
        if name in self._cache:
            return self._cache[name]
        out = {}
        for col, row, attrs, inner in CELL_RE.findall(self.sheet_xml(name)):
            if not inner:
                continue
            t = re.search(r'\bt="(\w+)"', attrs)
            t = t.group(1) if t else "n"
            fm = re.search(r"<f[^>]*>(.*?)</f>|<f[^>]*/>", inner, re.S)
            formula = html.unescape(fm.group(1)) if fm and fm.group(1) else ("" if fm else None)
            vm = re.search(r"<v>(.*?)</v>", inner, re.S)
            if vm is None:
                im = re.search(r"<is>(.*?)</is>", inner, re.S)
                if im is None:
                    if formula is not None:
                        out[f"{col}{row}"] = Cell(None, "n", formula)
                    continue
                out[f"{col}{row}"] = Cell(html.unescape(re.sub(r"<[^>]+>", "", im.group(1))), "s", formula)
                continue
            raw = vm.group(1)
            if t == "s":
                out[f"{col}{row}"] = Cell(self.shared[int(raw)], "s", formula)
            elif t == "str":
                out[f"{col}{row}"] = Cell(html.unescape(raw), "str", formula)
            elif t == "b":
                out[f"{col}{row}"] = Cell(raw == "1", "b", formula)
            elif t == "e":
                out[f"{col}{row}"] = Cell(raw, "e", formula)
            else:
                try:
                    out[f"{col}{row}"] = Cell(float(raw), "n", formula)
                except ValueError:
                    out[f"{col}{row}"] = Cell(raw, "n", formula)
        self._cache[name] = out
        return out


def col_to_num(col):
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n


def num_to_col(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def split_ref(ref):
    m = re.match(r"([A-Z]+)(\d+)$", ref)
    return m.group(1), int(m.group(2))


def shift(ref, dcol=0, drow=0):
    col, row = split_ref(ref)
    return f"{num_to_col(col_to_num(col) + dcol)}{row + drow}"
