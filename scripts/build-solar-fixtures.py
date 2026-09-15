#!/usr/bin/env python3
"""Saca los tres proyectos de ejemplo del libro (recalculado) como casos de prueba del motor src/lib/solar.

    python3 scripts/build-solar-fixtures.py --xlsx build/recalc/calculadora.xlsx --out src/lib/solar/__fixtures__/golden-v101.json

Entradas = celdas de captura de Inf_Vac_*; esperados = celdas de resultado de Inf_Vac_*, Gen_Energía, Cal_Tarifa_*,
Inf_Apoyo y Precios_SFV. Los nombres de cliente de los ejemplos se sustituyen por etiquetas neutras.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools" / "mest-rebuild"))
from xlsx_read import Workbook, col_to_num, num_to_col  # noqa: E402

MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]


def rng(c1, c2, r):
    return [f"{num_to_col(c)}{r}" for c in range(col_to_num(c1), col_to_num(c2) + 1)]


def col(c, r1, r2):
    return [f"{c}{r}" for r in range(r1, r2 + 1)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    wb = Workbook(args.xlsx)

    def val(sheet, ref):
        cell = wb.cells(sheet).get(ref)
        v = getattr(cell, "value", None)
        if isinstance(v, str):
            v = v.strip()
        return v

    def month_index(label):
        label = (label or "").strip()
        return MONTHS.index(label) + 1 if label in MONTHS else None

    cases = {}
    for seg, vac, cal, gen_total, gen_monthly, cal_left, cal_right, apoyo, bom in (
        ("RESIDENTIAL", "Inf_Vac_Res", "Cal_Tarifa_Residencial", "V61", col("V", 49, 60), rng("D", "O", 40), rng("R", "AC", 40),
         {"cost": "T20", "deduction": "T21", "irr": "T22", "firstPayment": "K24", "firstPaymentPv": "N24", "paybackYears": "R24", "paybackFraction": "S27", "paybackMonths": "T25"}, ("AH15", "AI15")),
        ("COMMERCIAL", "Inf_Vac_Com", "Cal_Tarifa_Comercial", "V120", col("V", 108, 119), rng("D", "O", 43), rng("R", "AC", 43),
         {"cost": "O56", "deduction": "O57", "irr": "O58", "firstPayment": "E59", "firstPaymentPv": "H59", "paybackYears": "M59", "paybackFraction": "O60", "paybackTotal": "N62"}, ("AH24", "AI24")),
        ("INDUSTRIAL", "Inf_Vac_Ind", "Cal_Tarifa_Industrial", "P179", col("P", 167, 178), rng("D", "O", 52), rng("R", "AC", 52),
         {"cost": "AD56", "deduction": "AD57", "irr": "AD58", "firstPayment": "T59", "firstPaymentPv": "W59", "paybackYears": "AB59", "paybackFraction": "AD60"}, ("AH33", "AI33")),
    ):
        v = lambda ref: val(vac, ref)  # noqa: E731
        orientations = []
        for cells in (("H47", "H48", "H49"), ("L47", "L48", "L49"), ("E51", "E52", "E53"), ("I51", "I52", "I53")):
            n = v(cells[0]) or 0
            orientations.append({"modules": float(n), "azimuth": float(v(cells[1]) or 0), "inclination": float(v(cells[2]) or 0)})
        inverters = [{"model": v(f"C{r}"), "quantity": float(v(f"E{r}") or 0)} for r in range(58, 63) if v(f"C{r}")]
        services = []
        for r in range(83, 96, 2):
            enabled = v(f"B{r}")
            services.append({"enabled": bool(enabled) if not isinstance(enabled, str) else enabled.upper() == "TRUE", "concept": v(f"C{r}") or "", "costMxn": float(v(f"H{r}") or 0)})
        inputs = {
            "segment": seg,
            "customer": {"name": f"Ejemplo {seg.lower()}", "subtitle": "", "supplier": v("E11") or "Comisión Federal de Electricidad"},
            "city": v("E13"),
            "period": v("D19"),
            "summerTariff": (v("G18") or "No") == "Si",
            "currentTariff": str(v("G19")).replace(".0", ""),
            "baseTariff": str(v("G20")).replace(".0", "") if seg == "RESIDENTIAL" else None,
            "contractedDemandKw": float(v("G20") or 0) if seg != "RESIDENTIAL" else None,
            "periodStartSerial": float(v("D20")) if seg != "RESIDENTIAL" and v("D20") is not None else None,
            "periodEndSerial": float(v("D21")) if seg != "RESIDENTIAL" and v("D21") is not None else None,
            "billedMonth": month_index(v("E22")),
            "meterType": v("I22"), "phases": float(v("L22") or 0), "voltage": float(v("E24") or 0), "electricalConfig": v("I24"),
            "annualIncrease": float(v("K27") or 0),
            "consumptionKwh": [float(v(f"F{r}") or 0) for r in range(27, 39)],
            "demandKw": [float(v(f"D{r}") or 0) for r in range(27, 39)] if seg == "INDUSTRIAL" else None,
            "kwhBase": float(v("K30") or 0), "kwhIntermediate": float(v("K31") or 0), "kwhPeak": float(v("K32") or 0), "kwhSemiPeak": float(v("K33") or 0),
            "kwBase": float(v("K35") or 0), "kwIntermediate": float(v("K36") or 0), "kwPeak": float(v("K37") or 0), "kwSemiPeak": float(v("K38") or 0),
            "kvarh": float(v("K40") or 0),
            "moduleModel": v("F44"), "orientationCount": float(v("C48") or 1), "orientations": orientations,
            "mountingSystem": v("F55"), "degradation": float(v("M55") or 0),
            "inverters": inverters, "services": services,
            "currency": v("M84"), "exchangeRate": float(v("M87") or 0), "pricePerWatt": float(v("G98") or 0), "utilityFactor": float(v("G99") or 0),
            "discount": float(v("M98") or 0), "addIva": (v("M99") or "No") == "Si", "taxDeduction": (v("M105") or "No") == "Si",
            "advances": [float(v(f"D{r}") or 0) for r in range(107, 111)], "financingBase": float(v("G113") or 0),
            "financing": [{"share": float(v(f"D{r}") or 0), "months": float(v(f"K{r}") or 0)} for r in range(116, 119)],
            "language": v("M107"), "structureWarrantyYears": float(v("M109") or 0),
            "startTime": v("E128"), "deliveryTime": v("J128"), "validityDays": float(v("N128") or 0),
        }
        expected = {
            "averageConsumption": v("F39"), "annualGeneration": v("G65"), "annualConsumption": v("G66"), "coverage": v("G68"),
            "modulePowerW": v("I44"), "modulesNeeded": v("L44"), "systemNeededKw": v("K52"),
            "minModules": v("F58"), "maxModules": v("H58"), "modulesTotal": v("J63"), "systemKw": v("L63"),
            "cashPrice": v("F105"), "advancesMxn": [v(f"H{r}") for r in range(107, 111)], "financingMxn": [v(f"H{r}") for r in range(116, 119)], "monthlyPayment": v("M116"),
            "generationMonthly": [val("Gen_Energía", c) for c in gen_monthly], "generationAnnual": val("Gen_Energía", gen_total),
            "billWithout": [val(cal, c) for c in cal_left], "billWith": [val(cal, c) for c in cal_right],
            "billWithoutAnnual": sum(float(val(cal, c) or 0) for c in cal_left), "billWithAnnual": sum(float(val(cal, c) or 0) for c in cal_right),
            "projection": {k: val("Inf_Apoyo", ref) for k, ref in apoyo.items()},
            "bomTotalMxn": val("Precios_SFV", bom[0]), "suggestedPricePerWatt": val("Precios_SFV", bom[1]),
        }
        if seg == "RESIDENTIAL":
            expected["dacFlags"] = [val(cal, c) for c in rng("R", "AC", 41)]
            expected["netKwh"] = [val(cal, c) for c in rng("R", "AC", 8)]
        if seg == "COMMERCIAL":
            expected["netKwh"] = [val(cal, c) for c in rng("R", "AC", 10)]
        if seg == "INDUSTRIAL":
            expected["netKwh"] = [val(cal, c) for c in rng("R", "AC", 10)]
            expected["capacitorKvar"] = val(cal, "R60")
        cases[seg] = {"inputs": inputs, "expected": expected}
    Path(args.out).write_text(json.dumps(cases, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8")
    for seg, c in cases.items():
        e = c["expected"]
        print(seg, "| gen anual", e["generationAnnual"], "| sin FV", round(e["billWithoutAnnual"], 2), "| con FV", round(e["billWithAnnual"], 2), "| precio", e["cashPrice"], "| TIR", e["projection"].get("irr"))


if __name__ == "__main__":
    main()
