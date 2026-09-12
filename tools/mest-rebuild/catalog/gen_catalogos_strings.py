"""Inf_Irrad_Sol, Inf_Módulos, Inf_Inversor, Cal_Inv_St."""
from common import Catalog, save, num_to_col, col_to_num

ir = Catalog("Inf_Irrad_Sol")
for r in range(5, 64):
    ir.f(f"P{r}", f"AVERAGE(D{r}:O{r})*0.97").f(f"U{r}", f"P{r}/6*1000")

CITY = "Inf_Vac_Res!$E$13"
U = f"VLOOKUP({CITY},Inf_Irrad_Sol!$B$5:$U$63,20,0)"
Q = f"VLOOKUP({CITY},Inf_Irrad_Sol!$B$5:$Q$63,16,0)"
Rmin = f"VLOOKUP({CITY},Inf_Irrad_Sol!$B$5:$R$63,17,0)"
mo = Catalog("Inf_Módulos")
for r in range(6, 24):
    mo.f(f"R{r}", f"{Rmin}-($Q{r}-20)*{U}/1600").f(f"S{r}", f"($Q{r}+20)*({U}+{Q})/800")
    for lo, hi, src, coef in [("T", "U", "H", "N"), ("V", "W", "I", "O"), ("X", "Y", "J", "P"), ("Z", "AA", "K", "O"), ("AB", "AC", "L", "P")]:
        mo.f(f"{lo}{r}", f"${src}{r}*(1+${coef}{r}*($R{r}-25))").f(f"{hi}{r}", f"${src}{r}*(1+${coef}{r}*($S{r}-25))")

iv = Catalog("Inf_Inversor")
for r in range(6, 46):
    iv.f(f"E{r}", f"C{r}*AY{r}").f(f"AX{r}", f"SUM(AN{r}:AW{r})")

st = Catalog("Cal_Inv_St")
MOD = "VLOOKUP($D$14,Inf_Módulos!$D$6:$Q$23,{},0)"
INV = "VLOOKUP($D$34,Inf_Inversor!$D$6:$AZ$45,{},0)"
CU = "VLOOKUP($D$9,Inf_Irrad_Sol!$B$5:$U$63,20,0)"
CQ = "VLOOKUP($D$9,Inf_Irrad_Sol!$B$5:$Q$63,16,0)"
CR = "VLOOKUP($D$9,Inf_Irrad_Sol!$B$5:$R$63,17,0)"
st.f("D18", MOD.format(8)).f("I18", MOD.format(6)).f("D19", MOD.format(9)).f("I19", MOD.format(7)).f("I20", MOD.format(5))
st.f("D20", MOD.format(13)).f("D21", MOD.format(12)).f("I21", MOD.format(11))
st.f("D30", f"({MOD.format(14)}+20)*({CU}+{CQ})/800").f("I30", f"{CR}-({MOD.format(14)}-20)*{CU}/1600")
for tgt, src, coef in [("25", "D18", "D21"), ("26", "D19", "D20"), ("27", "I18", "D21"), ("28", "I19", "D20"), ("29", "I20", "I21")]:
    st.f(f"D{tgt}", f"{src}*(1+{coef}*(D30-25))").f(f"I{tgt}", f"{src}*(1+{coef}*(I30-25))")
st.f("D37", INV.format(15)).f("D38", INV.format(13)).f("I37", INV.format(36)).f("I38", INV.format(47)).f("I39", INV.format(2)).f("D42", "D38")
st.f("T8", "INT(I39/D29)").f("T9", "ROUNDUP(D37/D27,0)").f("Z8", "MIN(T8,INT(D42/I25))").f("Z9", "MAX(T9,ROUNDUP(D37/D27,0))")
st.f("AF8", "I37").f("AK8", "SUM(D47,D50,D53,D56,D59,H47,H50,H53,H56,H59)").f("AK9", "AK8*I20/1000")
st.f("AF9", "IFERROR(AK9*1000/INDEX(Inf_Inversor!$C$6:$C$45,MATCH($D$34,Inf_Inversor!$D$6:$D$45,0)),0)")
st.f("F10", "AK8-D10").f("I10", "AK8-D10").f("D11", '"Falta por acomodar "&ABS(I10)&" módulos "&D14&"."', text=True)
sel_cells = []
for k in range(10):
    start = 14 + 9 * k  # N, W, AF, ...
    sc = num_to_col(start)
    cur = num_to_col(start + 4)     # R, AA, ...
    sel = num_to_col(start + 2)     # P36, Y36, ...
    kw = num_to_col(start + 5)      # S36, AB36
    sel_cells.append(f"{sel}36")
    st.f(f"{cur}11", INV.format(17 + 2 * k))
    st.f(f"{kw}36", f"{sel}36*$I$20/1000")
    for r in range(14, 34):
        st.f(f"{sc}{r}", f"IF({k+1}>$I$37,0,IF(ROW()-13<=$Z$8-$Z$9+1,$Z$9+ROW()-14,0))")
    for j in range(1, 7):
        mc = num_to_col(start + j)
        st.f(f"{mc}13", f"IF(COLUMN()-{start}<=MIN({INV.format(37 + k)},INT({cur}11/$D$26)),COLUMN()-{start},0)")
        for r in range(14, 34):
            st.f(f"{mc}{r}", f"IF({mc}$13=0,0,IF(${sc}{r}=0,0,${sc}{r}*{mc}$13))")
st.f("K47", 'D47&" módulos"', text=True).f("K48", "IFERROR(D47/D46,0)")
st.f("P49", "D46*$D$28").f("P50", "D46*$D$26").f("P51", "P50*1.25").f("P53", "IFERROR((D47/D46)*$I$25,0)").f("P54", "IFERROR((D47/D46)*$I$18,0)").f("P55", "IFERROR((D47/D46)*$D$27,0)")
st.f("Q49", "R11").f("Q50", "R11").f("Q53", "D42").f("Q54", "ROUND(0.8*D38,0)").f("Q55", "D37")
# resultados: módulos por MPPT = celda seleccionada de cada matriz; cadenas (D46…) las escribe la macro
for i, cell in enumerate(sel_cells):
    col = "D" if i < 5 else "H"
    row = 47 + 3 * (i % 5)
    st.f(f"{col}{row}", cell)
save(ir.entries + mo.entries + iv.entries + st.entries, __file__.replace("gen_catalogos_strings.py", "../../../build/cat_catalogos_strings.json"))
