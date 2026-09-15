#!/usr/bin/env python3
"""Extrae los catálogos de la Calculadora Solar ENNCO (libro .xlsm o .xlsx recalculado) a data/solar/*.json.

Fuente de verdad: el libro `ENNCO Calculadora Solar v1.0.1.xlsm` (reconstrucción del MEST PROGRAM 2.0).
Los JSON alimentan el motor de src/lib/solar y la carga inicial de catálogos en la base.

    python3 scripts/build-solar-catalogs.py --xlsx "<ruta al libro>" --out data/solar
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools" / "mest-rebuild"))
from xlsx_read import Workbook, col_to_num, num_to_col  # noqa: E402

MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def clean(value):
    if isinstance(value, str):
        value = value.strip()
        if value in ("", "#VALUE!", "#N/A", "#DIV/0!", "#REF!"):
            return None
        return value
    return value


def num(value):
    value = clean(value)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class Sheet:
    def __init__(self, wb, name):
        self.cells = wb.cells(name)

    def v(self, ref):
        cell = self.cells.get(ref)
        return clean(getattr(cell, "value", None))

    def n(self, ref):
        return num(self.v(ref))

    def row(self, r, c1, c2):
        return [self.v(f"{num_to_col(c)}{r}") for c in range(col_to_num(c1), col_to_num(c2) + 1)]


def modules(wb):
    s = Sheet(wb, "Inf_Módulos")
    keys = ["brand", "model", "lengthMm", "widthMm", "thicknessMm", "pmaxW", "vmpV", "impA", "vocV", "iscA", "tempRefC", "coefP", "coefV", "coefI", "toncC"]
    out = []
    for r in range(6, 24):
        vals = s.row(r, "C", "Q")
        if not vals[1]:
            continue
        item = dict(zip(keys, [clean(vals[0]), clean(vals[1])] + [num(v) for v in vals[2:]]))
        item.update(brand2=s.v(f"AD{r}"), weightKg=s.n(f"AE{r}"), efficiency=s.n(f"AF{r}"), cellType=s.v(f"AG{r}"),
                    warrantyProductYears=s.n(f"AH{r}"), warrantyPerformanceYears=s.n(f"AI{r}"), priceUsd=s.n(f"AN{r}"))
        out.append(item)
    return out


def inverters(wb):
    s = Sheet(wb, "Inf_Inversor")
    out = []
    for r in range(6, 46):
        model = s.v(f"D{r}")
        if not model:
            continue
        out.append({
            "model": model,
            "nominalW": s.n(f"C{r}"),
            "pmaxFvW": s.n(f"E{r}"),
            "mpptMaxDcInputW": [s.n(f"{num_to_col(col_to_num('F') + k)}{r}") for k in range(10)],
            "maxDcInputV": s.n(f"P{r}"),
            "startUpV": s.n(f"Q{r}"),
            "mpptMinV": s.n(f"R{r}"),
            "mppt": [{"maxV": s.n(f"{num_to_col(col_to_num('S') + 2 * k)}{r}"), "maxA": s.n(f"{num_to_col(col_to_num('T') + 2 * k)}{r}")} for k in range(10)],
            "mpptCount": s.n(f"AM{r}"),
            "stringsPerMppt": [s.n(f"{num_to_col(col_to_num('AN') + k)}{r}") for k in range(10)],
            "totalStrings": s.n(f"AX{r}"),
            "sizingFactor": s.n(f"AY{r}"),
            "outputW": s.n(f"AZ{r}"),
            "gridV": s.n(f"BA{r}"),
            "phases": s.n(f"BB{r}"),
            "maxOutputA": s.n(f"BC{r}"),
            "brand": s.v(f"BD{r}"),
            "efficiency": s.n(f"BE{r}"),
            "weightKg": s.n(f"BF{r}"),
            "lengthMm": s.n(f"BG{r}"), "widthMm": s.n(f"BH{r}"), "thicknessMm": s.n(f"BI{r}"),
            "warrantyYears": s.n(f"BJ{r}"),
            "priceUsd": s.n(f"BK{r}"),
        })
    return out


def cities(wb):
    s = Sheet(wb, "Inf_Irrad_Sol")
    out = []
    for r in range(5, 64):
        name = s.v(f"B{r}")
        if not name:
            continue
        out.append({
            # El libro trae "Nuevo León" en Guadalupe; la división CFE de Monterrey/Guadalupe es Golfo Norte.
            "city": name, "division": {"Nuevo León": "Golfo Norte"}.get(s.v(f"C{r}") or "", s.v(f"C{r}")),
            "irradiance": [s.n(f"{num_to_col(col_to_num('D') + i)}{r}") for i in range(12)],
            "tMaxC": s.n(f"Q{r}"), "tMinC": s.n(f"R{r}"), "region": s.v(f"S{r}"), "latitude": s.n(f"T{r}"),
            "state": s.v(f"V{r}"), "tMax2C": s.n(f"W{r}"),
        })
    return out


def factor_k(wb):
    s = Sheet(wb, "Inf_Factor_K")
    out = {}
    for blk in range(17):
        head = 4 + 20 * blk
        lat = s.n(f"C{head + 1}")
        if lat is None:
            continue
        table = {}
        for r in range(head + 1, head + 20):
            incl = s.n(f"D{r}")
            if incl is None:
                continue
            table[str(int(incl))] = [s.n(f"{num_to_col(col_to_num('N') + i)}{r}") for i in range(12)]
        out[str(int(lat))] = table
    return out


def tariffs(wb):
    s = Sheet(wb, "Tarifas")
    residential = []
    for r in range(10, 17):
        code = s.v(f"B{r}")
        if code is None:
            continue
        residential.append({
            "tariff": str(code).replace(".0", ""),
            "basicPrice": s.n(f"C{r}"), "intermediatePrice": s.n(f"D{r}"), "excessPrice": s.n(f"E{r}"),
            "basicStep": s.n(f"F{r}"), "intermediateStep": s.n(f"G{r}"),
            "summerBasicPrice": s.n(f"H{r}"), "summerIntermediatePrice": s.n(f"I{r}"), "summerIntermediate2Price": s.n(f"J{r}"), "summerExcessPrice": s.n(f"K{r}"),
            "summerBasicStep": s.n(f"L{r}"), "summerIntermediateStep": s.n(f"M{r}"), "summerIntermediate2Step": s.n(f"N{r}"),
            "dacLimitBimonthlyKwh": s.n(f"O{r}"),
        })
    dac = [{"region": s.v(f"Q{r}"), "fixedMonthly": s.n(f"R{r}"), "pricePerKwh": s.n(f"S{r}")} for r in range(9, 17) if s.v(f"Q{r}")]
    lv_blocks = [("C", "PDBT"), ("M", "GDBT"), ("W", "APBT"), ("AG", "RABT")]
    low_voltage = []
    for start, tariff in lv_blocks:
        c = col_to_num(start)
        for r in range(23, 40):
            zone = s.v(f"{num_to_col(c)}{r}")
            if not zone:
                continue
            low_voltage.append({"tariff": tariff, "zone": zone, "transmission": s.n(f"{num_to_col(c + 1)}{r}"), "distribution": s.n(f"{num_to_col(c + 2)}{r}"),
                                "cenace": s.n(f"{num_to_col(c + 3)}{r}"), "fixed": s.n(f"{num_to_col(c + 4)}{r}"), "mem": s.n(f"{num_to_col(c + 5)}{r}"),
                                "energy": s.n(f"{num_to_col(c + 6)}{r}"), "capacity": s.n(f"{num_to_col(c + 7)}{r}")})
    medium_voltage = []
    for r in range(53, 70):
        zone = s.v(f"C{r}")
        if not zone:
            continue
        medium_voltage.append({"tariff": "GDMTO", "zone": zone, "transmission": s.n(f"D{r}"), "distribution": s.n(f"E{r}"), "cenace": s.n(f"F{r}"), "fixed": s.n(f"G{r}"), "mem": s.n(f"H{r}"),
                               "energyBase": s.n(f"I{r}"), "energyIntermediate": 0, "energyPeak": 0, "energySemiPeak": 0, "capacity": s.n(f"J{r}")})
        medium_voltage.append({"tariff": "GDMTH", "zone": s.v(f"M{r}"), "transmission": s.n(f"N{r}"), "distribution": s.n(f"O{r}"), "cenace": s.n(f"P{r}"), "fixed": s.n(f"Q{r}"), "mem": s.n(f"R{r}"),
                               "energyBase": s.n(f"S{r}"), "energyIntermediate": s.n(f"T{r}"), "energyPeak": s.n(f"U{r}"), "energySemiPeak": 0, "capacity": s.n(f"V{r}")})
        medium_voltage.append({"tariff": "DIST", "zone": s.v(f"Y{r}"), "transmission": s.n(f"Z{r}"), "distribution": s.n(f"AA{r}"), "cenace": s.n(f"AB{r}"), "fixed": s.n(f"AC{r}"), "mem": s.n(f"AD{r}"),
                               "energyBase": s.n(f"AE{r}"), "energyIntermediate": s.n(f"AF{r}"), "energyPeak": s.n(f"AG{r}"), "energySemiPeak": s.n(f"AH{r}"), "capacity": s.n(f"AI{r}")})
    rates = {"iva": s.n("C85"), "dapResidential": s.n("C86"), "dapCommercial": s.n("C87"), "dapIndustrial": s.n("C88"), "lowVoltageMetering": s.n("C89"),
             "powerFactorBonus": s.n("C90"), "powerFactorPenalty": s.n("C91"), "residentialMinimumKwh": s.n("C92"), "incomeTaxDeduction": s.n("C93"), "dapResidentialWithPv": s.n("C94")}
    fc = Sheet(wb, "Cal_Tarifa_Comercial")
    load_factor = {}
    for r in range(11, 24):
        k = fc.v(f"AE{r}")
        if k:
            load_factor[str(k).replace("\xa0", " ").strip()] = fc.n(f"AF{r}")
    return {"residential": residential, "dac": dac, "lowVoltage": low_voltage, "mediumVoltage": medium_voltage, "rates": rates, "loadFactor": load_factor,
            "source": {"note": "Valores del MEST 2024 conservados en el libro v1.0.1; la referencia CFE 2026 está en Tarifas!B96:K107 pendiente de confirmar."}}


def prices(wb):
    s = Sheet(wb, "Precios_SFV")
    segments = {}
    for seg, c0, bom in (("RESIDENTIAL", "D", 11), ("COMMERCIAL", "L", 20), ("INDUSTRIAL", "T", 29)):
        c = col_to_num(c0)
        brands = [s.v(f"{num_to_col(c + 2 + i)}8") for i in range(5)]
        bands = []
        for r in range(9, 32):
            lo = s.n(f"{num_to_col(c)}{r}")
            if lo is None:
                continue
            bands.append({"fromW": lo, "toW": s.n(f"{num_to_col(c + 1)}{r}"), "usdPerW": {b: s.n(f"{num_to_col(c + 2 + i)}{r}") for i, b in enumerate(brands) if b}})
        segments[seg] = {"bands": bands, "structureUsdPerModule": s.n(f"AG{bom + 2}"), "laborUsdPerModule": s.n(f"AG{bom + 3}")}
    return segments


def mounting(wb):
    s = Sheet(wb, "Inf_Sistema_De_Montaje")
    es = [{"code": int(s.n(f"D{r}")), "name": s.v(f"C{r}"), "description": s.v(f"E{r}")} for r in range(8, 16) if s.v(f"C{r}")]
    en = [{"code": int(s.n(f"D{r}")), "name": s.v(f"C{r}"), "description": s.v(f"E{r}")} for r in range(31, 39) if s.v(f"C{r}")]
    return {"es": es, "en": en}


def texts(wb):
    s = Sheet(wb, "Textos")
    out = {}
    for seg, r0, r1 in (("RESIDENTIAL", 6, 32), ("COMMERCIAL", 36, 63), ("INDUSTRIAL", 67, 94)):
        out[seg] = [{"row": r, "es": s.v(f"C{r}"), "en": s.v(f"D{r}")} for r in range(r0, r1 + 1) if s.v(f"C{r}") or s.v(f"D{r}")]
    return out


def generation_defaults(wb):
    s = Sheet(wb, "Gen_Energía")
    out = {}
    for seg, base in (("RESIDENTIAL", 7), ("COMMERCIAL", 66), ("INDUSTRIAL", 125)):
        out[seg] = {"safetyMargin": s.n(f"V{base}") if s.n(f"V{base}") is not None else s.n("V66"), "performanceRatio": s.n(f"D{base + 5}"), "loss1": s.n(f"D{base + 6}"), "loss2": s.n(f"D{base + 7}"),
                    "daysPerMonth": [s.n(f"{num_to_col(col_to_num('G') + i)}{base + 2}") for i in range(12)]}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--out", default="data/solar")
    args = ap.parse_args()
    wb = Workbook(args.xlsx)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    files = {
        "modules.json": modules(wb), "inverters.json": inverters(wb), "cities.json": cities(wb), "factor-k.json": factor_k(wb),
        "tariffs.json": tariffs(wb), "prices.json": prices(wb), "mounting.json": mounting(wb), "texts.json": texts(wb),
        "generation-defaults.json": generation_defaults(wb),
    }
    for name, data in files.items():
        (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        size = len(data) if isinstance(data, (list, dict)) else 0
        print(f"{name}: {size} entradas")


if __name__ == "__main__":
    main()
