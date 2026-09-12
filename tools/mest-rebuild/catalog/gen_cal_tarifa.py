"""Cal_Tarifa_Residencial, Cal_Tarifa_Comercial, Cal_Tarifa_Industrial."""
import os
from common import Catalog, save, cols, num_to_col, col_to_num
FID = bool(os.environ.get("FIDELITY"))  # modo fidelidad: reproduce las fórmulas del MEST aun donde se corrigieron

L = cols("D", "O")   # historial (izquierda), D = periodo más reciente
R = cols("R", "AC")  # proyección (derecha), R = periodo actual
FC = "VLOOKUP($C$11,$AE$11:$AF$23,2,0)"


def k_of(j):  # índice en el bloque izquierdo del mes homólogo de la columna derecha j (0..11)
    return 1 if j == 0 else 13 - j


def common_headers(c, vac, has_dates, has_days_row, monthly=False):
    for i, col in enumerate(L):
        c.f(f"{col}7", f"{vac}!C{27 + i}", text=True)
    for j, col in enumerate(R):
        c.f(f"{col}5", f"{L[0]}7" if j == 0 else f"{L[12 - j]}7", text=True).f(f"{col}7", f"{col}5", text=True)
    if has_dates:
        c.f("D8", f"{vac}!$D$20").f("D9", f"{vac}!$D$21")
        for i in range(1, 12):
            col, prev = L[i], L[i - 1]
            c.f(f"{col}9", f"{prev}8-1")
            if monthly:  # el original alterna 31/30 días entre inicios de periodo
                c.f(f"{col}8", f"{prev}8-{31 if i % 2 else 30}")
            else:
                c.f(f"{col}8", f"{col}9-($D$9-$D$8)+1")
        c.f("R8", "D8").f("R9", "D9")
        for j in range(1, 12):
            col, prev, lcol = R[j], R[j - 1], L[j]
            c.f(f"{col}8", f"{prev}9+1").f(f"{col}9", f"{col}8+({lcol}$9-{lcol}$8)")
        if has_days_row:
            for col in L:
                c.f(f"{col}5", f"{col}9-{col}8")
            for col in R:
                c.f(f"{col}4", f"{col}9-{col}8")


# ---------------- Residencial ----------------
c = Catalog("Cal_Tarifa_Residencial")
vac = "Inf_Vac_Res"
LATEST = f"MATCH({vac}!$E$22,Inf_Apoyo!$C$6:$C$17,0)"
c.v("B4", "Meses por periodo").f("C4", f'IF({vac}!$D$19="Bimestral",2,1)')
common_headers(c, vac, False, False)
for i, col in enumerate(L):
    c.f(f"{col}8", f"{vac}!F{27 + i}")
c.f("C9", f'"Tarifa: "&{vac}!$G$20', text=True).f("Q9", "C9", text=True).f("C15", f'"Precio Por Tarifa: "&{vac}!$G$20', text=True).f("Q15", "C15", text=True)
ver = f'{vac}!$G$18="Si"'
c.f("C10", f"IF({ver},Tarifas!$L$18,Tarifas!$F$18)").f("C11", f"IF({ver},Tarifas!$M$18,Tarifas!$G$18)").f("C12", f"IF({ver},Tarifas!$N$18,0)")
for r in (10, 11, 12):
    c.f(f"Q{r}", f"C{r}").f(f"C{r + 12}", f"C{r}").f(f"Q{r + 12}", f"C{r}")
c.f("D16", f"IF({ver},Tarifas!$H$18,Tarifas!$C$18)").f("D17", f"IF({ver},Tarifas!$I$18,Tarifas!$D$18)").f("D18", f"IF({ver},Tarifas!$J$18,0)").f("D19", f"IF({ver},Tarifas!$K$18,Tarifas!$E$18)")
c.f("D29", "Tarifas!$R$18").f("D30", "Tarifas!$S$18")
for r in (16, 17, 18, 19, 29, 30):
    c.f(f"R{r}", f"D{r}")
for col in L:
    c.f(f"{col}10", f"MIN({col}8,$C$10*$C$4)").f(f"{col}11", f"MIN(MAX({col}8-{col}10,0),$C$11*$C$4)").f(f"{col}12", f"MIN(MAX({col}8-{col}10-{col}11,0),$C$12*$C$4)").f(f"{col}13", f"MAX({col}8-{col}10-{col}11-{col}12,0)")
    c.f(f"{col}22", f"IF({col}8=0,0,MAX({col}10,Tarifas!$C$92*$C$4)*$D$16)").f(f"{col}23", f"{col}11*$D$17").f(f"{col}24", f"{col}12*$D$18").f(f"{col}25", f"{col}13*$D$19").f(f"{col}26", f"SUM({col}22:{col}25)")
    c.f(f"{col}33", f"IF({col}8=0,0,$D$29*$C$4)").f(f"{col}34", f"MAX({col}8,0)*$D$30").f(f"{col}35", f"{col}33+{col}34")
    c.f(f"{col}37", f'IF({vac}!$G$19="DAC",{col}35,{col}26)').f(f"{col}38", f"{col}37*Tarifas!$C$85").f(f"{col}39", f"({col}37+{col}38)*Tarifas!$C$86").f(f"{col}40", f"{col}37+{col}38+{col}39")
c.f("D45", '"Pago Anual a CFE SIN FV: $"&TEXT(SUM(D40:O40),"#,##0.##")&" (MXN)"', text=True).f("D46", '"Pago Anual a CFE CON FV: $"&TEXT(SUM(R40:AC40),"#,##0.##")&" (MXN)"', text=True)
c.f("E45", "1-E46").f("E46", "R45/R46").f("R45", "SUM(R40:AC40)").f("R46", "SUM(R42:AC42)").f("T48", "E45")
for j, col in enumerate(R):
    k = k_of(j)
    c.f(f"{col}4", f"IF($C$4=2,1-MOD(COLUMN()-COLUMN($R$4),2),1)")
    if j == 0:
        c.f(f"{col}8", f"INDEX($D$8:$O$8,1)-INDEX(Gen_Energía!$P$49:$P$60,{LATEST})")
    else:
        prev = R[j - 1]
        c.f(f"{col}8", f"IF({col}$4=0,{prev}8,INDEX($D$8:$O$8,{k})-INDEX(Gen_Energía!$P$49:$P$60,MOD({LATEST}+{j}-1,12)+1)+{'' if FID else 'MIN('}{prev}8{'' if FID else ',0)'})")
    c.f(f"{col}10", f"MIN({col}8,$Q$10*$C$4)").f(f"{col}11", f"MIN(MAX({col}8-{col}10,0),$Q$11*$C$4)").f(f"{col}12", f"MIN(MAX({col}8-{col}10-{col}11,0),$Q$12*$C$4)").f(f"{col}13", f"MAX({col}8-{col}10-{col}11-{col}12,0)")
    c.f(f"{col}22", f"IF({col}$4=0,0,MAX({col}10,Tarifas!$C$92*$C$4)*$R$16)").f(f"{col}23", f"{col}11*$R$17" if FID else f"IF({col}$4=0,0,{col}11*$R$17)").f(f"{col}24", f"{col}12*$R$18" if FID else f"IF({col}$4=0,0,{col}12*$R$18)").f(f"{col}25", f"{col}13*$R$19" if FID else f"IF({col}$4=0,0,{col}13*$R$19)").f(f"{col}26", f"SUM({col}22:{col}25)")
    c.f(f"{col}33", f"IF({col}$4=0,0,$R$29*$C$4)").f(f"{col}34", f"MAX({col}8,0)*$R$30" if FID else f"IF({col}$4=0,0,MAX({col}8,0)*$R$30)").f(f"{col}35", f"{col}33+{col}34")
    if FID:  # ventana móvil tal como la tenía el MEST (resta meses en orden secuencial y arrastra el neto)
        c.f(f"{col}36", f"{vac}!$G$66-D8+R8" if j == 0 else f"{R[j - 1]}36-{L[j]}8+{col}8")
    else:    # ventana de 12 meses coherente: sale el mes homólogo del historial y entra el neto facturado (nunca negativo)
        c.f(f"{col}36", f"{vac}!$G$66-INDEX($D$8:$O$8,1)+MAX(R8,0)" if j == 0 else f"{R[j - 1]}36-IF({col}$4=0,0,INDEX($D$8:$O$8,{k}))+IF({col}$4=0,0,MAX({col}8,0))")
    c.f(f"{col}37", f'IF({col}41="DAC",{col}35,{col}26)').f(f"{col}38", f"{col}37*Tarifas!$C$85").f(f"{col}39", f"({col}37+{col}38)*Tarifas!$C$94").f(f"{col}40", f"{col}37+{col}38+{col}39")
    c.f(f"{col}41", f'IF({col}36>Tarifas!$O$18,"DAC",{vac}!$G$20)', text=True)
    c.f(f"{col}42", f"IF({col}$4=0,0,INDEX($D$40:$O$40,{k})*(1+{vac}!$K$27/{k}))")
res = c.entries

# ---------------- Comercial (PDBT y afines, bimestral o mensual) ----------------
c = Catalog("Cal_Tarifa_Comercial")
vac = "Inf_Vac_Com"
LATEST = f"MATCH({vac}!$E$22,Inf_Apoyo!$C$6:$C$17,0)"
c.v("B4", "Meses por periodo").f("C4", f'IF({vac}!$D$19="Bimestral",2,1)')
common_headers(c, vac, True, False)
c.f("C11", f"{vac}!$G$19", text=True).f("Q11", "C11", text=True)
MT = 'OR($C$11="GDMTO",$C$11="GDMTH",$C$11="DIST",$C$11="DIT")'
for i, col in enumerate(L):
    c.f(f"{col}10", f"{vac}!F{27 + i}").f(f"{col}12", f"{col}10").f(f"{col}14", f"{vac}!D{27 + i}").f(f"{col}16", f"MAX({col}14,0)")
    c.f(f"{col}17", f'IF($C$11="GDBT",IFERROR({col}10/(({col}9-{col}8)*24*{FC}),0),{col}16)').f(f"{col}20", f"IF({col}18=0,100,ROUND({col}10/SQRT({col}10^2+{col}18^2)*100,2))")
for col, days, kwh, base, flag in [(x, f"({x}9-{x}8)", f"{x}10", f"{x}12", f"{x}10<>0") for x in L] + [(x, f"({x}9-{x}8)", f"MAX({x}10,0)", f"MAX({x}10,0)", f"{x}$4<>0") for x in R]:
    kwfact = f"IFERROR({kwh}/({days}*24*{FC}),0)"
    c.f(f"{col}23", f"IF({flag},Tarifas!$G$48*$C$4,0)").f(f"{col}24", f'IF($C$11="GDBT",{kwfact}*Tarifas!$E$48,{kwh}*Tarifas!$E$48)').f(f"{col}25", f"{kwh}*Tarifas!$D$48").f(f"{col}26", f"{kwh}*Tarifas!$F$48")
    c.f(f"{col}27", f"MAX({base},0)*Tarifas!$I$48").f(f"{col}28", f"{kwfact}*Tarifas!$J$48" if FID else f'IF($C$11="GDBT",{kwfact}*Tarifas!$J$48,{kwh}*Tarifas!$J$48)').f(f"{col}29", f"{kwh}*Tarifas!$H$48").f(f"{col}31", f"SUM({col}23:{col}29)")
    c.f(f"{col}34", f"{col}23").f(f"{col}35", f"{col}31-{col}34").f(f"{col}36", f"IF({MT},{col}31*Tarifas!$C$89,0)")
    c.f(f"{col}37", f'IF(OR({MT},$C$11="GDBT"),IF({col}20<90,Tarifas!$C$91*(90/{col}20-1)*{col}31,-Tarifas!$C$90*{col}31),0)')
    c.f(f"{col}38", f"{col}31+{col}36+{col}37").f(f"{col}39", f"{col}38*Tarifas!$C$85").f(f"{col}40", f"{col}38+{col}39").f(f"{col}41", f"{col}38*Tarifas!$C$87").f(f"{col}43", f"{col}40+{col}41")
for j, col in enumerate(R):
    k = k_of(j)
    c.f(f"{col}4", f"IF(INDEX($D$10:$O$10,{k})<>0,1,0)")
    c.f(f"{col}12", f"IF({col}$4=0,0,INDEX($D$10:$O$10,{k})-INDEX(Gen_Energía!$P$108:$P$119,MOD({LATEST}+{j}-1,12)+1))")
    if j == 0:
        c.f(f"{col}10", f"MAX({col}12,0)")
    else:
        c.f(f"{col}10", f"IF({col}$4=0,{R[j - 1]}10,{col}12+MIN({R[j - 1]}10,0))")
    c.f(f"{col}14", f"INDEX($D$14:$O$14,{k})").f(f"{col}16", f"MAX({col}14,0)")
    c.f(f"{col}17", f"IF({col}$4=0,{R[j - 1] if j else col}17*1,IFERROR({col}10/(({col}9-{col}8)*24*{FC}),0))" if j else f"IFERROR({col}10/(({col}9-{col}8)*24*{FC}),0)")
    c.f(f"{col}18", f"IFERROR(INDEX($D$18:$O$18,{k})/INDEX($D$10:$O$10,{k})*{col}10,0)").f(f"{col}20", f"IF({col}18=0,100,ROUND({col}10/SQRT({col}10^2+{col}18^2)*100,2))")
    c.f(f"{col}44", f"INDEX($D$43:$O$43,{k})")
c.f("D46", '"Pago Anual a CFE SIN FV: $"&TEXT(SUM(D43:O43),"#,##0.##")&" (MXN)"', text=True).f("D47", '"Pago Anual a CFE CON FV: $"&TEXT(SUM(R43:AC43),"#,##0.##")&" (MXN)"', text=True)
c.f("E46", "1-E47").f("E47", "SUM(R43:AC43)/SUM(D43:O43)")
com = c.entries

# ---------------- Industrial (GDMTH y afines, mensual) ----------------
c = Catalog("Cal_Tarifa_Industrial")
vac = "Inf_Vac_Ind"
LATEST = f"MATCH({vac}!$E$22,Inf_Apoyo!$C$6:$C$17,0)"
common_headers(c, vac, True, True, monthly=True)
c.f("C11", f"{vac}!$G$19", text=True).f("Q11", "C11", text=True)
for i, col in enumerate(L):
    c.f(f"{col}10", f"{vac}!F{27 + i}")
    if i == 0:
        c.f("D12", f"{vac}!$K$30").f("D13", f"{vac}!$K$31").f("D14", f"{vac}!$K$32").f("D15", f"{vac}!$K$33").f("D17", f"{vac}!$K$35").f("D18", f"{vac}!$K$36").f("D19", f"{vac}!$K$37").f("D20", f"{vac}!$K$38").f("D24", f"{vac}!$K$40")
    else:
        for r in (12, 13, 14, 15, 17, 18, 19, 20, 24):
            c.f(f"{col}{r}", f"IFERROR({col}$10/$D$10*$D{r},0)")
    c.f(f"{col}22", f"MAX({col}17:{col}19)")
for col, days, kwh in [(x, f"{x}5", f"{x}10") for x in L] + [(x, f"{x}4", f"{x}10") for x in R]:
    c.f(f"{col}23", f"IFERROR({kwh}/({days}*24*{FC}),0)").f(f"{col}26", f"IF({col}24=0,100,ROUND({kwh}/SQRT({kwh}^2+{col}24^2)*100,2))")
    c.f(f"{col}29", "Tarifas!$G$80").f(f"{col}30", f"{col}23*Tarifas!$E$80").f(f"{col}31", f"{kwh}*Tarifas!$D$80").f(f"{col}32", f"{kwh}*Tarifas!$F$80")
    c.f(f"{col}33", f"MAX({col}12,0)*Tarifas!$I$80").f(f"{col}34", f"MAX({col}13,0)*Tarifas!$J$80").f(f"{col}35", f"MAX({col}14,0)*Tarifas!$K$80").f(f"{col}36", f"MAX({col}15,0)*Tarifas!$L$80")
    c.f(f"{col}37", f"{col}23*Tarifas!$M$80").f(f"{col}38", f"{kwh}*Tarifas!$H$80").f(f"{col}40", f"SUM({col}29:{col}38)")
    c.f(f"{col}43", f"{col}29").f(f"{col}44", f"{col}40-{col}43").f(f"{col}45", f"IF({MT},{col}40*Tarifas!$C$89,0)")
    c.f(f"{col}46", f"IF({col}26<90,Tarifas!$C$91*(90/{col}26-1)*{col}40,-Tarifas!$C$90*{col}40)")
    c.f(f"{col}47", f"{col}40+{col}45+{col}46").f(f"{col}48", f"{col}47*Tarifas!$C$85").f(f"{col}49", f"{col}47+{col}48").f(f"{col}50", f"{col}40*Tarifas!$C$88").f(f"{col}52", f"{col}49+{col}50")
for j, col in enumerate(R):
    k = k_of(j)
    c.f(f"{col}13", f"INDEX($D$13:$O$13,{k})-INDEX(Gen_Energía!$P$167:$P$178,MOD({LATEST}+{j}-1,12)+1)")
    c.f(f"{col}14", f"INDEX($D$14:$O$14,{k})+MIN({col}13,0)").f(f"{col}15", f"INDEX($D$15:$O$15,{k})+MIN({col}14,0)").f(f"{col}12", f"INDEX($D$12:$O$12,{k})+MIN({col}15,0)")
    c.f(f"{col}10", f"MAX({col}12,0)+MAX({col}13,0)+MAX({col}14,0)+MAX({col}15,0)")
    for r in (17, 18, 19, 20, 24):
        c.f(f"{col}{r}", f"INDEX($D${r}:$O${r},{k})")
    c.f(f"{col}22", f"MAX({col}17:{col}19)").f(f"{col}53", f"INDEX($D$52:$O$52,{k})")
c.f("D56", '"Pago Anual a CFE SIN FV: $"&TEXT(SUM(D52:O52),"#,##0.##")&" (MXN)"', text=True).f("D57", '"Pago Anual a CFE CON FV: $"&TEXT(SUM(R52:AC52),"#,##0.##")&" (MXN)"', text=True)
c.f("E56", "1-E57").f("E57", "SUM(R52:AC52)/SUM(D52:O52)")
c.f("R56", "AVERAGE(R22:AC22)").f("R57", "AVERAGE(R26:AC26)/100").f("R60", "R56*(TAN(ACOS(R57))-TAN(ACOS(R58)))")
ind = c.entries
save(res + com + ind, __file__.replace("gen_cal_tarifa.py", "../../../build/cat_cal_tarifa.json"))
