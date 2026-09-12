"""Pruebas de sensibilidad: cambia entradas en copias del libro, recalcula y comprueba propagación y ausencia de errores."""
import json, subprocess, sys, zipfile, re, html
sys.path.insert(0, "/tmp/claude-1001/-home-atlas/1134cca2-8c95-45d3-9f1b-8781457957b6/scratchpad/wt-mest/tools/mest-rebuild")
from xlsx_read import Workbook
S = "/tmp/claude-1001/-home-atlas/1134cca2-8c95-45d3-9f1b-8781457957b6/scratchpad"
BASE = f"{S}/build/calculadora-produccion.xlsm"
ERR = {"#REF!", "#VALUE!", "#DIV/0!", "#N/A", "#NAME?", "#NUM!"}
WATCH = {"Inf_Vac_Res": ["G65", "G66", "G68", "L44", "F105", "E101"], "Cal_Tarifa_Residencial": ["R45", "R46", "R41", "T41"], "Inf_Apoyo": ["T22", "T25"], "Estudio_Res": ["D45", "D449", "H449", "H553"],
         "Inf_Vac_Ind": ["G65", "F105", "L44"], "Cal_Tarifa_Industrial": ["D23", "D52", "R52", "E57"], "Estudio_Ind": ["D45", "D448", "H448", "H552"], "Inf_Vac_Com": ["G65", "F105"], "Cal_Tarifa_Comercial": ["D43", "R43"], "Estudio_Com": ["D461", "H461", "H567"],
         "Gen_Energía": ["G10", "G11", "V61", "P179"], "Cal_Inv_St": ["D30", "I25", "Z8", "Z9"], "Cal_Cir_Ele_AC": ["J28", "I30", "J33", "G39"], "Cal_Cir_Ele_DC": ["J25", "J34", "J35", "J38"], "Cal_Cir_Ele_Tab": ["J20", "J21", "J22"], "Cal_Sombra": ["G35"], "Precios_SFV": ["AI15", "AI33"], "Textos": ["B21", "B29"]}
CASES = {
    "A_ciudad_leon_res": [("Inf_Vac_Res", "E13", "León")],
    "B_modulo_635_res": [("Inf_Vac_Res", "C44", "Best Solar"), ("Inf_Vac_Res", "F44", "Best Solar - MGL630N-144BM10 (635W)")],
    "C_inversor_5000_res": [("Inf_Vac_Res", "C58", "Growatt (MIN 5000TL-X2)")],
    "D_consumo_x2_res": [("Inf_Vac_Res", f"F{r}", v) for r, v in zip(range(27, 39), [1576, 0, 1780, 0, 2202, 0, 2540, 0, 1604, 0, 1696, 0])],
    "E_tarifa_1C_verano_res": [("Inf_Vac_Res", "G19", "1C"), ("Inf_Vac_Res", "G20", "1C"), ("Inf_Vac_Res", "G18", "Si")],
    "F_mensual_res": [("Inf_Vac_Res", "D19", "Mensual")],
    "G_ingles_res": [("Inf_Vac_Res", "M107", "Inglés")],
    "H_ind_ciudad_monterrey": [("Inf_Vac_Ind", "E13", "Monterrey"), ("Inf_Vac_Ind", "H49", 15)],
    "I_ind_gdmto": [("Inf_Vac_Ind", "G19", "GDMTO")],
    "J_com_gdbt_mensual": [("Inf_Vac_Com", "G19", "GDBT"), ("Inf_Vac_Com", "D19", "Mensual")],
    "K_orientaciones_2": [("Inf_Vac_Res", "H47", 4), ("Inf_Vac_Res", "L47", 3), ("Inf_Vac_Res", "L48", 90), ("Inf_Vac_Res", "L49", 10)],
    "L_dc_aire_3_cadenas": [("Cal_Cir_Ele_DC", "F19", "Aire libre"), ("Cal_Cir_Ele_DC", "F20", 12), ("Cal_Inv_St", "D46", 3), ("Cal_Inv_St", "P36", 12)],
    "M_ac_aluminio_40C_techo": [("Cal_Cir_Ele_AC", "F22", "Aluminio"), ("Cal_Cir_Ele_AC", "F23", 40), ("Cal_Cir_Ele_AC", "J24", "Si"), ("Cal_Cir_Ele_AC", "J21", 6)],
    "N_inv_st_otro_inversor": [("Cal_Inv_St", "D34", "Growatt (MID 11KTL3-XL2)"), ("Cal_Inv_St", "D14", "Longi - LR7-72HTHF-615M (615W)")],
}
def cells_map(path):
    wb = Workbook(path); return {sh: wb.cells(sh) for sh in wb.sheets if sh not in ("Usuarios", "Vigencia")}
base = cells_map(f"{S}/build/recalc/calculadora-produccion.xlsx")
def errors(cm):
    out = {}
    for sh, cells in cm.items():
        n = sum(1 for c in cells.values() if c.kind == "e" or (isinstance(c.value, str) and c.value in ERR))
        if n: out[sh] = n
    return out
orig_err = errors(cells_map(f"{S}/excel/mest.xlsm"))
base_err = errors(base)
report = {"errores_original": orig_err, "errores_reconstruido": base_err, "casos": {}}
for name, changes in CASES.items():
    cat = [{"sheet": sh, "cell": cell, "value": v} for sh, cell, v in changes]
    json.dump(cat, open(f"{S}/audit/{name}.json", "w"))
    out = f"{S}/audit/{name}.xlsm"
    subprocess.run(["python3", "apply.py", "--in", BASE, "--catalog", f"{S}/audit/{name}.json", "--out", out], check=True, capture_output=True)
    subprocess.run(["./recalc.sh", out, f"{S}/audit/recalc"], check=True, capture_output=True)
    cm = cells_map(f"{S}/audit/recalc/{name}.xlsx")
    err = errors(cm)
    new_err = {sh: n - base_err.get(sh, 0) for sh, n in err.items() if n > base_err.get(sh, 0)}
    changed = {}
    for sh, refs in WATCH.items():
        for r in refs:
            a = base[sh].get(r); b = cm[sh].get(r)
            av = a.value if a else None; bv = b.value if b else None
            if av != bv:
                changed[f"{sh}!{r}"] = [av if not isinstance(av, float) else round(av, 4), bv if not isinstance(bv, float) else round(bv, 4)]
    report["casos"][name] = {"cambios": changes[:3], "errores_nuevos": new_err, "celdas_que_cambiaron": changed}
    print(name, "| errores nuevos:", new_err, "| cambiaron:", len(changed))
json.dump(report, open(f"{S}/audit/sensibilidad.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
print("errores original:", orig_err); print("errores reconstruido:", base_err)
