"""Cal_Fac_Pot, Cal_Sombra, Cal_Sombra_Apoyo."""
from common import Catalog, save

fp = Catalog("Cal_Fac_Pot")
for r in range(9, 21):
    fp.f(f"O{r}", f"ROUND(I{r}/SQRT(I{r}^2+L{r}^2),4)")
fp.f("W12", "AVERAGE(F9:F20)*(TAN(ACOS(AVERAGE(O9:O20)))-TAN(ACOS(W9)))").f("W15", "MIN(R26:R37)").f("W18", "MAX(R26:R37)")
for r in range(26, 38):
    s = r - 17  # fila de origen 9..20
    fp.f(f"C{r}", f"C{s}", text=True).f(f"F{r}", f"F{s}").f(f"I{r}", f"I{s}")
    fp.f(f"L{r}", f"I{r}*TAN(ACOS($W$9))").f(f"O{r}", "$W$9").f(f"R{r}", f"F{r}*(TAN(ACOS(O{s}))-TAN(ACOS($W$9)))")
    fp.f(f"V{r}", f"C{s}", text=True).f(f"Y{r}", f"F{s}").f(f"AB{r}", f"I{s}")
    fp.f(f"AE{r}", f"I{r}*TAN(ACOS(O{s}))-$AE$12*(I{r}/F{r})").f(f"AH{r}", f"AB{r}/SQRT(AB{r}^2+AE{r}^2)").f(f"AK{r}", "$AE$12")

cs = Catalog("Cal_Sombra")
cs.f("H12", "VLOOKUP(D7,Inf_Irrad_Sol!$B$5:$T$63,19,0)")
cs.f("H18", 'VLOOKUP(D8,Inf_Módulos!$D$6:$F$23,IF(E31="VERTICAL",2,3),0)/1000*L29')
cs.f("C35", 'L29*(VLOOKUP(D8,Inf_Módulos!$D$6:$F$23,IF(E31="VERTICAL",2,3),0)/1000+0.02)')
cs.f("G35", 'IF(I29="SI",Cal_Sombra_Apoyo!D59,Cal_Sombra_Apoyo!D37)')
cs.f("C19", "E12").f("E25", "E12").f("I23", "E29").f("E43", "E29").f("D39", "H18").f("E45", "G35")

sa = Catalog("Cal_Sombra_Apoyo")
sa.f("D6", "Cal_Sombra!E29").f("D7", "Cal_Sombra!H12").f("D8", "Cal_Sombra!C35").f("H7", "D7").f("H8", "Cal_Sombra!E12").f("H10", "D10")
for c in "DH":
    sa.f(f"{c}11", f"{c}10/2").f(f"{c}15", f"15*{c}11")
    sa.f(f"{c}17", f"COS(RADIANS({c}7))").f(f"{c}18", f"COS(RADIANS({c}14))").f(f"{c}19", f"COS(RADIANS({c}15))")
    sa.f(f"{c}20", f"SIN(RADIANS({c}7))").f(f"{c}21", f"SIN(RADIANS({c}14))").f(f"{c}22", f"SIN(RADIANS({c}15))")
    sa.f(f"{c}24", f"{c}20*{c}21+{c}17*{c}18*{c}19").f(f"{c}25", f"DEGREES(ASIN({c}24))").f(f"{c}27", f"COS(RADIANS({c}25))")
    sa.f(f"{c}29", f"{c}18*{c}22/{c}27").f(f"{c}30", f"DEGREES(ASIN({c}29))")
    sa.f(f"{c}32", f"SIN(RADIANS({c}6))").f(f"{c}33", f"COS(RADIANS({c}30))").f(f"{c}34", f"COS(RADIANS({c}6))").f(f"{c}35", f"TAN(RADIANS({c}25))")
    sa.f(f"{c}37", f"{c}8*({c}34+{c}32*{c}33/{c}35)")
    sa.f(f"{c}42", f"{c}32").f(f"{c}43", f"{c}34").f(f"{c}44", f"90-{c}7-23.5").f(f"{c}45", f"TAN(RADIANS({c}44))").f(f"{c}47", f"{c}8*({c}43+{c}42/{c}45)")
    sa.f(f"{c}52", f"{c}6-{c}51").f(f"{c}53", f"{c}25+{c}51").f(f"{c}54", f"{c}33").f(f"{c}55", f"SIN(RADIANS({c}52))").f(f"{c}56", f"COS(RADIANS({c}52))").f(f"{c}57", f"TAN(RADIANS({c}53))")
    sa.f(f"{c}59", f"{c}8*({c}56+{c}55*{c}54/{c}57)")
sa.f("H14", "D14").f("D51", 'IF(Cal_Sombra!I29="SI",Cal_Sombra!I30,0)')
save(fp.entries + cs.entries + sa.entries, __file__.replace("gen_facpot_sombra.py", "../../../build/cat_facpot_sombra.json"))
