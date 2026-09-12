"""Inf_Apoyo: costos, deducción fiscal, proyecciones a 30 años (Res I22:U53, Com C57:P88, Ind R57:AE88) y resumen de inversores."""
import os
from common import Catalog, save

c = Catalog("Inf_Apoyo")
FID = bool(os.environ.get("FIDELITY"))
SEGS = [
    # (vac, cal_tarifa, fila_total_sin, fila_total_con, año0, cols: year,cons,pago,prod,consFV,pagoFV,ahorro,flag,acum, costo, deducc, tir, flujo, n_cell, s_cells)
    dict(vac="Inf_Vac_Res", cal="Cal_Tarifa_Residencial", fs="$D$40:$O$40", fc="$R$40:$AC$40", r0=24, y="I", cons="J", pago="K", prod="L", consfv="M", pagofv="N", ahorro="O", flag="P", acum="Q", costo="T20", ded="T21", tir="T22", flujo="U", n="R24", rem="S25", sav="S26", frac="S27", months="T25", cum="S24"),
    dict(vac="Inf_Vac_Com", cal="Cal_Tarifa_Comercial", fs="$D$43:$O$43", fc="$R$43:$AC$43", r0=59, y="C", cons="D", pago="E", prod="F", consfv="G", pagofv="H", ahorro="I", flag="J", acum="K", costo="O56", ded="O57", tir="O58", flujo="P", n="M59", rem="N60", sav="N61", frac="O60", months=None, cum="N59", total="N62"),
    dict(vac="Inf_Vac_Ind", cal="Cal_Tarifa_Industrial", fs="$D$52:$O$52", fc="$R$52:$AC$52", r0=59, y="R", cons="S", pago="T", prod="U", consfv="V", pagofv="W", ahorro="X", flag="Y", acum="Z", costo="AD56", ded="AD57", tir="AD58", flujo="AE", n="AB59", rem="AC60", sav="AC61", frac="AD60", months=None, cum="AC59", total=None),
]
for g in SEGS:
    vac, cal, r0 = g["vac"], g["cal"], g["r0"]
    r1 = r0 + 29
    c.f(g["costo"], f"{vac}!$F$105").f(g["ded"], f'IF({vac}!$M$105="Si",{g["costo"]}/(1+Tarifas!$C$85)*Tarifas!$C$93,0)')
    for i in range(30):
        r = r0 + i
        c.f(f"{g['cons']}{r}", f"{vac}!$G$66")
        if i == 0:
            c.f(f"{g['pago']}{r}", f"SUM({cal}!{g['fs']})").f(f"{g['prod']}{r}", f"{vac}!$G$65").f(f"{g['pagofv']}{r}", f"SUM({cal}!{g['fc']})")
            c.f(f"{g['acum']}{r}", f"{g['ahorro']}{r}").f(f"{g['flujo']}{r}", f"{g['ahorro']}{r}+{g['ded']}")
        else:
            c.f(f"{g['pago']}{r}", f"{g['pago']}{r - 1}*(1+{vac}!$K$27)").f(f"{g['prod']}{r}", f"{g['prod']}{r - 1}*(1-{vac}!$M$55)")
            c.f(f"{g['pagofv']}{r}", f"{g['pagofv']}{r - 1}*(1+{vac}!$K$27)")
            c.f(f"{g['acum']}{r}", f"{g['acum']}{r - 1}+{g['ahorro']}{r}").f(f"{g['flujo']}{r}", f"{g['ahorro']}{r}")
        c.f(f"{g['consfv']}{r}", f"MAX({g['cons']}{r}-{g['prod']}{r},0)").f(f"{g['ahorro']}{r}", f"{g['pago']}{r}-{g['pagofv']}{r}")
        c.f(f"{g['flag']}{r}", f"IF({g['y']}{r}<=${g['n'][:-2] if g['n'][1].isalpha() else g['n'][0]}${g['n'][len(g['n'][:-2]) if g['n'][1].isalpha() else 1:]},{g['y']}{r},0)")
    c.f(f"{g['flujo']}{r0 - 1}", f"-{g['costo']}").f(g["tir"], f"IFERROR(IRR({g['flujo']}{r0 - 1}:{g['flujo']}{r1}),0)")
    acum = f"{g['acum']}{r0}:{g['acum']}{r1}"
    c.f(g["n"], f'MIN(COUNTIF({acum},"<"&({g["costo"]}-{g["ded"]})),29)')
    c.f(g["cum"], f"IF({g['n']}=0,0,INDEX({acum},{g['n']}))").f(g["rem"], f"{g['costo']}-{g['cum']}").f(g["sav"], f"INDEX({g['ahorro']}{r0}:{g['ahorro']}{r1},{g['n']}+1)").f(g["frac"], f"IFERROR(MAX({g['rem']},0)/{g['sav']},0)")
    if g.get("months"):
        c.f(g["months"], f"{g['frac']}*12")
    if g.get("total"):
        c.f(g["total"], f"{g['n']}+{g['frac']}")
# resumen de inversores por segmento (filas 28-33 Res, 38-43 Com, 48-53 Ind)
for vac, r0 in [("Inf_Vac_Res", 28), ("Inf_Vac_Com", 38), ("Inf_Vac_Ind", 48)]:
    for i in range(5):
        r, vr = r0 + i, 58 + i
        if i == 0:
            c.f(f"C{r}", f'VLOOKUP({vac}!C{vr},Inf_Inversor!$D$6:$E$45,2,0)&"W  ("&{vac}!E{vr}&"Pz)"', text=True)
            c.f(f"D{r}", f'INDEX(Inf_Inversor!$C$6:$C$45,MATCH({vac}!C{vr},Inf_Inversor!$D$6:$D$45,0))&"W  ("&{vac}!E{vr}&"Pz)"', text=True)
            c.f(f"E{r}", f"VLOOKUP({vac}!C{vr},Inf_Inversor!$D$6:$E$45,2,0)*{vac}!E{vr}").f(f"F{r}", f"INDEX(Inf_Inversor!$C$6:$C$45,MATCH({vac}!C{vr},Inf_Inversor!$D$6:$D$45,0))*{vac}!E{vr}")
        else:
            c.f(f"E{r}", f"IFERROR(VLOOKUP({vac}!C{vr},Inf_Inversor!$D$6:$E$45,2,0)*{vac}!E{vr},0)")
            c.f(f"F{r}", f"IFERROR(INDEX(Inf_Inversor!$C$6:$C$45,MATCH({vac}!C{vr},Inf_Inversor!$D$6:$D$45,0))*{vac}!E{vr},FALSE)")
    c.f(f"E{r0 + 5}", f"SUM(E{r0}:E{r0 + 4})").f(f"F{r0 + 5}", f"SUM(F{r0}:F{r0 + 4})")
save(c.entries, __file__.replace("gen_inf_apoyo.py", "../../../build/cat_inf_apoyo.json"))
