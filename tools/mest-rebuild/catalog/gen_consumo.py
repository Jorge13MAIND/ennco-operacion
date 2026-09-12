"""Cal_Consumo: estimador de consumo residencial."""
from common import Catalog, save

c = Catalog("Cal_Consumo")
for r in range(9, 16):
    c.f(f"J{r}", f"H{r}/7").f(f"K{r}", f"E{r}*F{r}/G{r}/1000*J{r}").f(f"L{r}", f"K{r}*30*I{r}/12")
c.f("L16", "SUM(L9:L15)")
for r in range(25, 44):
    c.f(f"H{r}", f"E{r}*G{r}*F{r}/7")
c.f("H44", "SUM(H25:H43)")
for r in range(50, 62):
    c.f(f"H{r}", f"E{r}*F{r}/7*G{r}/1000")
c.f("H62", "SUM(H50:H61)")
c.f("D64", "L16/30+H44+H62").f("D65", "D64*30")
save(c.entries, __file__.replace("gen_consumo.py", "../../../build/cat_consumo.json"))
