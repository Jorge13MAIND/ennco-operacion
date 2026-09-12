"""Gen_Energía (tres bloques) e Inf_Factor_K (banderas de las tres copias)."""
from common import Catalog, save, cols, num_to_col, col_to_num

g = Catalog("Gen_Energía")
MONTH_COLS = cols("G", "R")  # enero..diciembre
BLOCKS = [  # (fila base de orientación 1, hoja de captura, fila de comparación inicial, columna de banderas K or1, col meses K, bimestral?)
    dict(base=7, vac="Inf_Vac_Res", cmp=49, flag=["G", "I", "K", "M"], kmon="N", bimestral=True, margen="$V$7", res=(44, "R", "S")),
    dict(base=66, vac="Inf_Vac_Com", cmp=108, flag=["AE", "AG", "AI", "AK"], kmon="AL", bimestral=True, margen="$V$66", res=(103, "R", "S")),
    dict(base=125, vac="Inf_Vac_Ind", cmp=167, flag=["BC", "BE", "BG", "BI"], kmon="BJ", bimestral=False, margen="$V$125", res=(184, "O", "P")),
]
g.f("V125", "V66").f("T125", "T66", text=True)
for b in BLOCKS:
    vac = b["vac"]; city = f"{vac}!$E$13"
    for o in range(4):
        r0 = b["base"] + 10 * o  # fila "Orientación #n"
        rP, rInc, rLat, rAz, rPR, rP1, rP2, rN = r0 + 1, r0 + 2, r0 + 3, r0 + 4, r0 + 5, r0 + 6, r0 + 7, r0 + 8
        g.f(f"D{rLat}", f"VLOOKUP({city},Inf_Irrad_Sol!$B$5:$T$63,19,0)")
        vm, va, vi = [("$H$47", "$H$48", "$H$49"), ("$L$47", "$L$48", "$L$49"), ("$E$51", "$E$52", "$E$53"), ("$I$51", "$I$52", "$I$53")][o]
        g.f(f"D{rN}", f"{vac}!{vm}").f(f"D{rAz}", f"{vac}!{va}").f(f"D{rInc}", f"{vac}!{vi}").f(f"D{rP}", f"IF({vac}!{vm}>0,{vac}!$I$44,0)")
        for i, c in enumerate(MONTH_COLS):
            g.f(f"{c}{rLat}", f"INDEX(Inf_Irrad_Sol!$D$5:$O$63,MATCH({city},Inf_Irrad_Sol!$B$5:$B$63,0),{i + 1})")
            kcol = num_to_col(col_to_num(b["kmon"]) + i)
            g.f(f"{c}{rAz}", f"SUMIF(Inf_Factor_K!${b['flag'][o]}$5:${b['flag'][o]}$343,2,Inf_Factor_K!{kcol}$5:{kcol}$343)")
            g.f(f"{c}{rPR}", f"($D${rP}/1000)*{c}{rLat}*{c}{rAz}*{c}{rInc}*$D${rPR}*{b['margen']}*(1-$D${rP1}-$D${rP2})")
    # comparación mensual
    c0 = b["cmp"]; last = c0 + 11
    ocols = ["D", "G", "J", "M"]
    for o, oc in enumerate(ocols):
        r0 = b["base"] + 10 * o
        for i in range(12):
            g.f(f"{oc}{c0 + i}", f"$D${r0 + 8}*{MONTH_COLS[i]}${r0 + 5}")
        g.f(f"{oc}{last + 1}", f"SUM({oc}{c0}:{oc}{last})").f(f"{oc}{last + 2}", f"AVERAGE({MONTH_COLS[0]}{r0 + 5}:{MONTH_COLS[11]}{r0 + 5})")
    nmods = "+".join(f"$D${b['base'] + 10 * o + 8}" for o in range(4))
    latest = f"MATCH({vac}!$E$22,Inf_Apoyo!$C$6:$C$17,0)"
    for i in range(12):
        r = c0 + i
        for lab in ["F", "I", "L", "O", "R"] + (["U", "X"] if b["bimestral"] else []):
            g.f(f"{lab}{r}", f"C{r}", text=True)
        g.f(f"S{r}", f"INDEX({vac}!$F$27:$F$38,MOD({latest}-ROW()+{c0 - 1},12)+1)")
        if b["bimestral"]:
            g.f(f"V{r}", f"D{r}+G{r}+J{r}+M{r}")
            prev = r - 1 if i > 0 else last
            g.f(f"P{r}", f"IF(S{r}=0,0,V{r}+V{prev})")
            if i < 11:
                g.f(f"Y{r}", f"IF(S{r}<>0,S{r}/2,S{r + 1}/2)")
            else:
                g.f(f"Y{r}", f"IF(S{r}<>0,S{r}/2,S{last + 1}/12)")
        else:
            g.f(f"P{r}", f"D{r}+G{r}+J{r}+M{r}")
    g.f(f"P{last + 1}", f"SUM(P{c0}:P{last})").f(f"P{last + 2}", f"P{last + 1}/12/({nmods})")
    g.f(f"S{last + 1}", f"SUM(S{c0}:S{last})").f(f"S{last + 2}", f"S{last + 1}/12")
    if b["bimestral"]:
        g.f(f"V{last + 1}", f"SUM(V{c0}:V{last})").f(f"V{last + 2}", f"V{last + 1}/12/({nmods})")
        g.f(f"Y{last + 1}", f"SUM(Y{c0}:Y{last})").f(f"Y{last + 2}", f"Y{last + 1}/12")
    rr, lc, vc = b["res"]
    gen = f"V{last + 1}" if b["bimestral"] else f"P{last + 1}"
    g.f(f"{lc}{rr}", f'"Consumo de Energía Anual: "&TEXT(S{last + 1},"#,##0.#")&" kWh"', text=True)
    g.f(f"{lc}{rr + 1}", f'"Generación de Energía Anual: "&TEXT({gen},"#,##0.#")&" kWh"', text=True)
    g.f(f"{vc}{rr}", f"1-MIN(1,{gen}/S{last + 1})").f(f"{vc}{rr + 1}", f"MIN(1,{gen}/S{last + 1})")

# Inf_Factor_K: banderas. Bloques de latitud: fila de encabezado (C=latitud, D=0) y 19 inclinaciones. 17 bloques × 20 filas desde la fila 5.
k = Catalog("Inf_Factor_K")
COPIES = [("C", "Gen_Energía", [9, 19, 29, 39], 10), ("AA", "Gen_Energía", [68, 78, 88, 98], 69), ("AY", "Gen_Energía", [127, 137, 147, 157], 128)]
for base_col, sh, incl_rows, lat_row in COPIES:
    b = col_to_num(base_col)
    C, D, E = num_to_col(b), num_to_col(b + 1), num_to_col(b + 2)
    flag_cols = [(num_to_col(b + 3 + 2 * o), num_to_col(b + 4 + 2 * o)) for o in range(4)]  # (F,G),(H,I),(J,K),(L,M)
    for blk in range(17):
        head = 4 + 20 * blk  # fila de encabezado del bloque; la latitud está en la primera fila de datos
        for r in range(head + 1, head + 20):
            k.f(f"{E}{r}", f"IF({sh}!$D${lat_row}=${C}${head + 1},1,0)")
            for o, (fc, gc) in enumerate(flag_cols):
                k.f(f"{fc}{r}", f"IF({sh}!$D${incl_rows[o]}=${D}{r},1,0)").f(f"{gc}{r}", f"${E}{r}+{fc}{r}")
save(g.entries + k.entries, __file__.replace("gen_gen_energia.py", "../../../build/cat_gen_energia.json"))
