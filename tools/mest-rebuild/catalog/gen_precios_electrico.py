"""Precios_SFV, Cal_Cir_Ele_AC, Tab_Amp_Cir_AC."""
from common import Catalog, save

p = Catalog("Precios_SFV")
SEGS = [  # (vac, marca/potencia/precio cols, tabla bandas, cols precios, fila BOM inicial, fila total)
    ("Inf_Vac_Res", "D", "F", "G", "H", "$D$9:$D$31", "$E$9:$E$31", "$F$9:$J$31", "$F$8:$J$8", 11),
    ("Inf_Vac_Com", "L", "N", "O", "P", "$L$9:$L$31", "$M$9:$M$31", "$N$9:$R$31", "$N$8:$R$8", 20),
    ("Inf_Vac_Ind", "T", "V", "W", "X", "$T$9:$T$31", "$U$9:$U$31", "$V$9:$Z$31", "$V$8:$Z$8", 29),
]
for vac, cB, cLo, cHi, cP, lo, hi, prices, brands, b0 in SEGS:
    tot = b0 + 4
    # BOM
    p.f(f"AD{b0}", f"{vac}!$C$44", text=True).f(f"AE{b0}", f"{vac}!$I$44").f(f"AF{b0}", f"{vac}!$J$63").f(f"AG{b0}", f"VLOOKUP({vac}!$F$44,Inf_Módulos!$D$6:$AN$23,37,0)")
    p.f(f"AH{b0}", f"AF{b0}*AG{b0}*(1+$AI${b0})").f(f"AI{b0}", f"{vac}!$G$99")
    p.f(f"AD{b0 + 1}", f"VLOOKUP({vac}!$C$58,Inf_Inversor!$D$6:$BD$45,53,0)", text=True).f(f"AE{b0 + 1}", f"INDEX(Inf_Inversor!$C$6:$C$45,MATCH({vac}!$C$58,Inf_Inversor!$D$6:$D$45,0))")
    p.f(f"AF{b0 + 1}", f"{vac}!$E$58").f(f"AG{b0 + 1}", f"VLOOKUP({vac}!$C$58,Inf_Inversor!$D$6:$BK$45,60,0)*AF{b0 + 1}").f(f"AH{b0 + 1}", f"AG{b0 + 1}*(1+$AI${b0})")
    p.f(f"AF{b0 + 2}", f"AF{b0}").f(f"AH{b0 + 2}", f"AF{b0 + 2}*AG{b0 + 2}*(1+$AI${b0})").f(f"AF{b0 + 3}", f"AF{b0}").f(f"AH{b0 + 3}", f"AF{b0 + 3}*AG{b0 + 3}*(1+$AI${b0})")
    p.f(f"AH{tot}", f"SUM(AH{b0}:AH{b0 + 3})*{vac}!$M$87").f(f"AI{tot}", f"AH{tot}/${cLo}$54")
    # bandas por marca
    p.f(f"{cB}37", f"AD{b0 + 1}", text=True).f(f"{cB}43", f"AD{b0 + 1}", text=True).f(f"{cLo}43", f"{vac}!$L$63*1000")
    for i, r in enumerate(range(37, 42)):
        pr = 43 + i
        p.f(f"{cLo}{r}", f"IF(${cLo}${pr}=0,0,INDEX({lo},MATCH(${cLo}${pr},{lo},1)))").f(f"{cHi}{r}", f"IF(${cLo}${pr}=0,0,INDEX({hi},MATCH(${cLo}${pr},{lo},1)))")
        p.f(f"{cP}{r}", f"IF(${cLo}${pr}=0,0,INDEX({prices},MATCH(${cLo}${pr},{lo},1),MATCH(${cB}{r},{brands},0)))")
        p.f(f"{cB}{49 + i}", f"{cB}{r}", text=True).f(f"{cLo}{49 + i}", f"{cLo}{pr}").f(f"{cP}{49 + i}", f"{cLo}{49 + i}*{cP}{r}")
    for i, r in enumerate(range(44, 48)):
        vr = 59 + i
        p.f(f"{cB}{r}", f'IFERROR(VLOOKUP({vac}!$C${vr},Inf_Inversor!$D$6:$BD$45,53,0),"")', text=True).f(f"{cLo}{r}", f"IFERROR(VLOOKUP({vac}!$C${vr},Inf_Inversor!$D$6:$E$45,2,0)*{vac}!$E${vr}*0+{vac}!$J${vr}*{vac}!$I$44,0)")
    p.f(f"{cLo}54", f"SUM({cLo}49:{cLo}53)").f(f"{cP}54", f"AH{tot}").f(f"{cHi}55", f"AI{tot}")

a = Catalog("Cal_Cir_Ele_AC")
INV = "VLOOKUP($D$13,Inf_Inversor!$D$6:$BK$45,{},0)"
TAB = "Tab_Amp_Cir_AC!"
a.f("J17", "F17/SQRT(3)").f("J18", INV.format(52)).f("J19", f"F19*{INV.format(2)}")
a.f("F18", f"INDEX({TAB}$M$94:$M$96,{INV.format(51)})", text=True)
a.f("F27", "J18*F19").f("F28", "F27*1.25")
first = f"COUNTIF({TAB}$E$13:$E$38,\"<\"&F28)+1"
a.f("J28", f"INDEX({TAB}$E$13:$E$38,{first})").f("F30", f"INDEX({TAB}$C$13:$C$38,{first})").f("I30", f"INDEX({TAB}$D$13:$D$38,{first})", text=True)
a.f("F29", f"ROUNDUP(F28/{TAB}$E$38,0)")
a.f("G32", f"INDEX({TAB}$D$13:$D$38,MATCH(F32,{TAB}$C$13:$C$38,0))", text=True).f("J27", f"INDEX({TAB}$E$13:$E$38,MATCH(F32,{TAB}$C$13:$C$38,0))").f("F33", "J27")
itm = f"COUNTIF({TAB}$C$99:$C$128,\"<\"&F28)+1"
a.f("J33", f"INDEX({TAB}$C$99:$C$128,{itm})")
gnd = f"COUNTIF({TAB}$U$81:$U$99,\"<\"&J33)+1"
a.f("F35", "F22", text=True).f("J35", f"INDEX({TAB}$U$81:$U$99,{gnd})")
a.f("F36", f'IF(F35="Aluminio",INDEX({TAB}$X$81:$X$99,{gnd}),INDEX({TAB}$V$81:$V$99,{gnd}))').f("G35", f'IF(F35="Aluminio",INDEX({TAB}$Y$81:$Y$99,{gnd}),INDEX({TAB}$W$81:$W$99,{gnd}))', text=True)
a.f("F38", "F27").f("J38", f'IF(F22="Aluminio",INDEX({TAB}$N$13:$N$38,MATCH(F32,{TAB}$C$13:$C$38,0)),INDEX({TAB}$M$13:$M$38,MATCH(F32,{TAB}$C$13:$C$38,0)))')
a.f("G39", "F38*F39*J38/1000/J17").f("F40", "F17").f("I40", "F40/(1+G39)")
a.f("C26", f'IF({TAB}$S$85=0,"No es viable esta instalación porque la temperatura a la exposición supera lo permitido por el fabricante. Por favor, proponga un método de cableado alternativo","")', text=True)
a.f("C31", 'IF(J28<F28,"La ampacidad del conductor calculado es ligeramente inferior a la corriente del circuito. Se recomienda incrementar el calibre del cable en 1 grado mayor.","")', text=True)
a.f("C34", 'IF(F33<J33,"La ampacidad del conductor calculado es ligeramente inferior al dispositivo de protección. Se recomienda que el ITM sea ligeramente menor o igual a la ampacidad del cable.","")', text=True)

t = Catalog("Tab_Amp_Cir_AC")
AC = "Cal_Cir_Ele_AC!"
for r in range(13, 39):
    b = r + 35
    t.f(f"E{r}", f'INDEX($E${b}:$P${b},MATCH({AC}$J$23,{{60,75,90}},0)+IF({AC}$F$22="Aluminio",3,0)+IF({AC}$F$24="Aéreo",6,0))*F{r}').f(f"F{r}", "$S$85*$R$90")
t.f("P78", f"{AC}F23").f("Q78", "P78").f("R78", f'IF({AC}$J$24="Si",INDEX($N$88:$N$91,COUNTIF($L$88:$L$91,"<="&{AC}$I$25)),0)').f("S78", "Q78+R78")
t.f("P85", f"{AC}J23").f("Q85", "INDEX($E$79:$G$94,COUNTIF($C$79:$C$94,\"<=\"&$S$78),MATCH($P$85,{60,75,90},0))").f("S85", "Q85")
t.f("P90", f"{AC}J21").f("R90", "INDEX($N$78:$N$84,COUNTIF($L$78:$L$84,\"<=\"&P90))")
save(p.entries + a.entries + t.entries, __file__.replace("gen_precios_electrico.py", "../../../build/cat_precios_electrico.json"))
