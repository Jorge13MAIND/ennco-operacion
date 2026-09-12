"""Inf_Vac_Res / Inf_Vac_Com / Inf_Vac_Ind (capturas por segmento) y Tarifas (catálogo + tasas)."""
import os
from common import Catalog, save, cols

AVISO = "El sistema fotovoltaico es más grande que la demanda contratada, por lo que será necesario solicitar un aumento de carga por lo menos a la mísma capacidad del sistema fotovoltaico; o reducir la capacidad del sistema a la mísma capacidad de la demanda contrarada."
SEG = [("Inf_Vac_Res", "Gen_Energía!V61", "Precios_SFV!$AI$15", False), ("Inf_Vac_Com", "Gen_Energía!V120", "Precios_SFV!$AI$24", True), ("Inf_Vac_Ind", "Gen_Energía!P179", "Precios_SFV!$AI$33", True)]
out = []
for sh, gen, sug, aviso in SEG:
    c = Catalog(sh)
    c.f("H13", "VLOOKUP($E$13,Inf_Irrad_Sol!$B$5:$S$63,18,0)", text=True).f("K13", "VLOOKUP($E$13,Inf_Irrad_Sol!$B$5:$C$63,2,0)", text=True).f("N13", "VLOOKUP($E$13,Inf_Irrad_Sol!$B$5:$T$63,19,0)")
    c.f("F39", "AVERAGE(F27:F38)")
    c.f("I44", "VLOOKUP(F44,Inf_Módulos!$D$6:$H$23,5,0)").f("L44", "ROUNDUP(G66/(G65/J63),0)").f("K52", "L44*I44/1000")
    c.f("J58", "$H$47+$L$47+$E$51+$I$51")
    c.f("F58", "IFERROR(ROUNDUP(VLOOKUP(C58,Inf_Inversor!$D$6:$Q$45,14,0)/VLOOKUP($F$44,Inf_Módulos!$D$6:$W$23,20,0),0)*E58,0)")
    c.f("H58", "IFERROR(INT(VLOOKUP(C58,Inf_Inversor!$D$6:$E$45,2,0)/$I$44)*E58,0)").f("L58", "J58*$I$44/1000")
    for r in range(59, 63):
        c.f(f"F{r}", f'IF(C{r}="","",IFERROR(ROUNDUP(VLOOKUP(C{r},Inf_Inversor!$D$6:$Q$45,14,0)/VLOOKUP($F$44,Inf_Módulos!$D$6:$W$23,20,0),0)*E{r},0))')
        c.f(f"H{r}", f'IF(C{r}="","",IFERROR(INT(VLOOKUP(C{r},Inf_Inversor!$D$6:$E$45,2,0)/$I$44)*E{r},0))').f(f"L{r}", f'IF(C{r}="","",J{r}*$I$44/1000)')
    c.f("B63", "COUNTA(C58:C62)").f("E63", "SUM(E58:E62)").f("J63", "SUM(J58:J62)").f("L63", "SUM(L58:L62)")
    c.f("G65", gen).f("G66", "SUM(F27:F38)").f("G68", "G65/G66")
    if aviso:
        c.f("J65", f'IF(L63>G20,"{AVISO}","")', text=True)
    for r in range(83, 96, 2):
        c.f(f"K{r}", f"IF(B{r},H{r}/$M$87,0)").f(f"J{r}", f'IF(B{r},"      Si","      No")', text=True)
    c.f("E101", f'"El precio sujerido para éste proyecto es de $"&TEXT(ROUND({sug},2),"0.00")&" (MXN) más IVA."', text=True)
    c.f("E102", f'IF(G98>={sug},"El aumento otorgado es ","El descuento otorgado es ")&TEXT(G98/{sug}-1,"0%")&" del precio sujerido"', text=True)
    c.f("F105", '(L63*1000*G98*(1-M98)+SUM(K83:K95)*M87)*IF(M99="Si",1+Tarifas!$C$85,1)')
    for r in range(107, 111):
        c.f(f"H{r}", f"$F$105*D{r}")
    c.f("D111", "SUM(D107:D110)")
    for r in range(116, 119):
        c.f(f"H{r}", f"IF(K{r}=0,0,IF($G$113=0,$F$105,$G$113)*D{r})")
    c.f("M116", "IFERROR(H116/K116,0)")
    if sh == "Inf_Vac_Ind":
        c.f("M117", "IFERROR(H117/K117,0)").f("M118", "IFERROR(H118/K118,0)").f("K41", "ROUND(F27/SQRT(F27^2+K40^2)*100,2)")
    out += c.entries

t = Catalog("Tarifas")
t.f("B18", "Inf_Vac_Res!$G$20")
for i, col in enumerate(cols("C", "O")):
    t.f(f"{col}18", f'IFERROR(VLOOKUP($B$18,$B$10:$O$16,{i + 2},0),VLOOKUP($B$18&"",$B$10:$O$16,{i + 2},0))')
t.f("Q18", "Inf_Vac_Res!$H$13", text=True).f("R18", "VLOOKUP($Q$18,$Q$9:$S$16,2,0)").f("S18", "VLOOKUP($Q$18,$Q$9:$S$16,3,0)")
t.f("C43", "Inf_Vac_Com!$K$13", text=True)
for r in (44, 45, 46):
    t.f(f"C{r}", "$C$43", text=True)
blocks = {43: "$C$23:$J$39", 44: "$M$23:$T$39", 45: "$W$23:$AD$39", 46: "$AG$23:$AN$39"}
for r, rng in blocks.items():
    for i, col in enumerate(cols("D", "J")):
        t.f(f"{col}{r}", f"VLOOKUP($C{r},{rng},{i + 2},0)")
t.f("B48", "Inf_Vac_Com!$G$19", text=True).f("C48", "$C$43", text=True)
for i, col in enumerate(cols("D", "J")):
    t.f(f"{col}48", f"VLOOKUP($B$48,$B$43:$J$46,{i + 3},0)")
t.f("C71", "Inf_Vac_Ind!$K$13", text=True).f("M71", "$C$71", text=True).f("Y71", "$C$71", text=True)
for i, col in enumerate(cols("D", "J")):
    t.f(f"{col}71", f"VLOOKUP($C$71,$C$53:$J$69,{i + 2},0)")
for i, col in enumerate(cols("N", "V")):
    t.f(f"{col}71", f"VLOOKUP($M$71,$M$53:$V$69,{i + 2},0)")
for i, col in enumerate(cols("Z", "AI")):
    t.f(f"{col}71", f"VLOOKUP($Y$71,$Y$53:$AI$69,{i + 2},0)")
for r in (75, 76, 77):
    t.f(f"C{r}", "$C$71", text=True)
for col, src in zip(cols("D", "M"), ["D71", "E71", "F71", "G71", "H71", "I71", None, None, None, "J71"]):
    if src:
        t.f(f"{col}75", src)
for col, src in zip(cols("D", "M"), ["N71", "O71", "P71", "Q71", "R71", "S71", "T71", "U71", None, "V71"]):
    if src:
        t.f(f"{col}76", src)
for col, src in zip(cols("D", "M"), ["Z71", "AA71", "AB71", "AC71", "AD71", "AE71", "AF71", "AG71", "AH71", "AI71"]):
    t.f(f"{col}77", src)
t.f("B80", "Inf_Vac_Ind!$G$19", text=True).f("C80", "$C$71", text=True)
for i, col in enumerate(cols("D", "M")):
    t.f(f"{col}80", f"VLOOKUP($B$80,$B$75:$M$77,{i + 3},0)")
# Bloque de tasas editables (nuevo): B84:C93
t.v("B84", "TASAS Y CARGOS (editables; reconstrucción ENNCO 2026)").v("D84", "Fuente / nota")
rows = [
    (85, "IVA", 0.16, "Ley del IVA; 8 % en franja fronteriza norte"),
    (86, "DAP residencial (sobre subtotal + IVA)", 0.10, "MEST usaba 10 % (sin FV) y 10.34 % (con FV); unificado. Ley de ingresos municipal"),
    (87, "DAP comercial (sobre subtotal)", 0.11, "MEST: 11 % · León 2026: 12 % con tope $1,073.49/mes"),
    (88, "DAP industrial (sobre total)", 0.01367, "MEST: 1.367 %"),
    (89, "Cargo 2 % por medición en baja tensión (GDMTO/GDMTH)", 0.02, "CFE"),
    (90, "Bonificación por factor de potencia >= 90 %", 0.025, "CFE 5.5: 1/4×(1−90/FP), tope 2.5 %; MEST aplica el tope fijo"),
    (91, "Factor de penalización por FP < 90 %", 0.6, "CFE 5.5: 3/5×(90/FP−1), tope 120 %"),
    (92, "Mínimo facturable residencial (kWh/mes)", 25, "CFE tarifas domésticas"),
    (93, "Deducción fiscal ISR sobre costo sin IVA", 0.30, "LISR art. 34 XIII: depreciación 100 % de equipos renovables; tasa ISR 30 %"),
    (94, "DAP residencial en la proyección con FV", 0.1034 if os.environ.get("FIDELITY") else 0.10, "MEST usaba 10.34 % en el bloque con FV y 10 % sin FV; ENNCO unifica en 10 %"),
]
for r, lab, val, note in rows:
    t.v(f"B{r}", lab).v(f"C{r}", val).v(f"D{r}", note)

# Bloque de referencia CFE 2026 (investigación 2026-09-11; app.cfe.mx no accesible desde el VPS: confirmar antes de pasar a las filas vivas)
t.v("B96", "REFERENCIA CFE 2026 (por confirmar en app.cfe.mx; fuente: investigación Teckel 2026-09-11, agregador airegulasolutions). Las filas vivas (10-16, 23-39, 53-69) conservan los valores del MEST 2024 hasta que ENNCO confirme.")
ref = [
    (97, "Tarifa 1, ago-2026", "básico 1.132 · intermedio 1.377 · excedente 4.028 $/kWh", "https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCRECasa/Tarifas/Tarifa1.aspx"),
    (98, "DAC, ago-2026", "cargo fijo 145.04 $/mes · Central 6.630 · Noroeste 6.211 · Norte y Noreste 6.051 · Sur y Peninsular 6.148 · BC 6.447/5.536 · BCS 7.025/5.536 $/kWh", "https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCRECasa/Tarifas/TarifaDAC.aspx"),
    (99, "Límite DAC (kWh/mes, promedio 12 meses)", "1: 250 · 1A: 300 · 1B: 400 · 1C: 850 · 1D: 1,000 · 1E: 2,000 · 1F: 2,500 (fuentes secundarias)", "https://www.cfe.gob.mx/hogar/tarifas/Pages/Acuerdosdetarifasant.aspx"),
    (100, "PDBT Bajío, ago-2026", "suministro 42.72 $/mes · energía 3.719 $/kWh (tarifa consolidada)", "https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCRENegocio/Tarifas/PequenaDemandaBT.aspx"),
    (101, "GDBT Bajío, sep-2026", "suministro 427.19 · distribución 369.31 $/kW · capacidad 292.37 $/kW · energía 1.787 $/kWh", "https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCRENegocio/Tarifas/GranDemandaBT.aspx"),
    (102, "GDMTO Bajío, ago-2026", "suministro 427.19 · distribución 97.88 $/kW · capacidad 324.69 $/kW · energía 1.487 $/kWh", "https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCRENegocio/Tarifas/GranDemandaMTO.aspx"),
    (103, "GDMTH Bajío, ago-2026", "suministro 427.19 · distribución 97.88 $/kW · capacidad 377.17 $/kW · base 1.0228 · intermedia 1.8107 · punta 2.0620 $/kWh", "https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCRENegocio/Tarifas/GranDemandaMTH.aspx"),
    (104, "Demanda facturable vigente (A/053/2022)", "D_energía = kWh/(FC×24×días); FC PDBT 0.58, GDBT 0.49, GDMTO 0.55, GDMTH 0.57; kW capacidad = MIN(D máx punta, D_energía); kW distribución = MIN(D máx, D_energía). El MEST usa kWh/(FC×24×días) sin el MIN.", "https://dof.gob.mx/nota_detalle.php?codigo=5679231&fecha=10/02/2023"),
    (105, "Factor de potencia (5.5)", "recargo FP<90: 3/5×(90/FP−1)×100 % (tope 120 %); bonificación FP≥90: 1/4×(1−90/FP)×100 % (tope 2.5 %)", "https://www.cfe.gob.mx/industria/tarifas/Pages/disposiciones-complementariasant.aspx"),
    (106, "DAP Guanajuato 2026", "León 12 % del importe de energía, tope 1,073.49 $/mes (2,146.99 bimestral) · Irapuato 12 %, tope 1,933.25 · Guanajuato 12 %, tope 670.25; se cobra después del IVA", "Leyes de ingresos municipales 2026 (normatividadestatalymunicipal.guanajuato.gob.mx)"),
    (107, "Memorias de cálculo CNE (Excel/CSV) y tarifas finales desde 1-mar-2026", "fuente estructurada para actualizar las 17 divisiones", "https://www.gob.mx/cne/articulos/memorias-de-calculo-de-las-tarifas-electricas · https://dof.gob.mx/nota_detalle.php?codigo=5784039&fecha=03/04/2026"),
]
for r, a, b_, c_ in ref:
    t.v(f"B{r}", a).v(f"D{r}", b_).v(f"K{r}", c_)

save(out + t.entries, __file__.replace("gen_inf_vac.py", "../../../build/cat_inf_vac.json"))
