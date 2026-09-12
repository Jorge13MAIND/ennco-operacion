"""Textos (ES/EN, marca ENNCO), Estudio_Res / Estudio_Com / Estudio_Ind e Inf_Sistema_De_Montaje."""
import sys
from pathlib import Path
from common import Catalog, save
sys.path.insert(0, str(Path(__file__).parent.parent))
from xlsx_read import Workbook, split_ref  # noqa: E402

ORIG = "/tmp/claude-1001/-home-atlas/1134cca2-8c95-45d3-9f1b-8781457957b6/scratchpad/excel/mest.xlsm"
wb = Workbook(ORIG)

# ---------------- Textos ----------------
ES = {
    6: "ENNCO es una empresa mexicana de ingeniería eléctrica con sede en el Bajío, dedicada a diseñar, instalar y mantener soluciones energéticas que reducen el costo de la energía de sus clientes.",
    7: "En ENNCO nos distinguimos por la calidad técnica y la confianza en cada proyecto. Ofrecemos ingeniería eléctrica y soluciones fotovoltaicas que cumplen con la normativa vigente y superan las expectativas de nuestros clientes, con un equipo enfocado en la excelencia y el cuidado de cada detalle.",
    8: "Gracias a nuestro compromiso con la calidad en la planeación, el diseño y la ejecución de cada proyecto, en ENNCO nos distinguimos por el profesionalismo y la dedicación hacia nuestros clientes. Buscamos un desarrollo eficaz, confiable y a la vanguardia en cada proyecto que emprendemos juntos.",
    9: "ENNCO ofrece cobertura en todo México, llevando sus servicios de ingeniería y soluciones energéticas a donde el cliente lo necesite.",
    10: "Ser una empresa líder en el sector de la energía eficiente y renovable, con un enfoque primordial en la calidad de nuestros productos, consultoría altamente especializada y un riguroso seguimiento operativo en cada proyecto.",
    15: "Nos esforzamos por ofrecer excelencia en cada uno de nuestros productos y servicios.",
    16: "Estaremos juntos en cada etapa del proceso, asegurando la mejora de la eficiencia energética.",
    17: "Ofrecemos una atención centrada en la amabilidad, agilidad y claridad, para satisfacer sus necesidades de manera eficaz.",
    18: "Ofrecemos productos y servicios que se adaptan y cumplen con sus necesidades.",
    19: "Hemos desarrollado proyectos residenciales, comerciales e industriales en instalaciones eléctricas, tableros, transformadores y sistemas fotovoltaicos, generando alianzas de largo plazo con nuestros clientes para optimizar el uso y la gestión de la energía en sus procesos.",
    20: "En ENNCO estamos comprometidos con la calidad, la confiabilidad y la seguridad en cada uno de nuestros proyectos. Personalizamos cada solución y elegimos equipos certificados a nivel nacional e internacional, adaptados a las condiciones de cada sitio, para garantizar un desempeño óptimo en la operación.",
    24: "A continuación, se presenta un ejemplo preliminar del sistema de montaje propuesto, el cual puede modificarse en cuanto a modelo y características tras la realización del levantamiento técnico en el sitio de instalación.",
    25: "De acuerdo con la Norma Oficial Mexicana NOM-001-SEDE y el National Electrical Code (NEC), en su artículo 690, se especifica el tipo de conductor eléctrico necesario para garantizar un buen desempeño y seguridad en instalaciones fotovoltaicas a nivel residencial, comercial e industrial. Por lo tanto, en este proyecto se utilizará el tipo de cable requerido, que cumple con las siguientes condiciones:",
    27: "Considerando la ubicación de la instalación, la orientación e inclinación, así como la base de datos de radiación solar de la zona, se determina la siguiente estimación de energía generada en comparación con el consumo energético de la propiedad.",
    28: "La siguiente gráfica muestra el comportamiento de la generación de energía del sistema fotovoltaico durante un año. La cantidad de energía generada puede disminuir debido a factores como el clima, la acumulación de suciedad en los módulos y la falta de mantenimiento.",
}
EN = {
    6: "ENNCO is a Mexican electrical engineering company based in the Bajío region, dedicated to designing, installing and maintaining energy solutions that reduce its clients' energy costs.",
    7: "At ENNCO we stand out for technical quality and trust in every project. We provide electrical engineering and photovoltaic solutions that comply with current regulations and exceed our clients' expectations, with a team focused on excellence and attention to every detail.",
    8: "Thanks to our commitment to quality in the planning, design and execution of every project, at ENNCO we stand out for our professionalism and dedication to our clients. We pursue efficient, reliable and cutting-edge development in every project we undertake together.",
    9: "ENNCO offers coverage throughout Mexico, bringing its engineering services and energy solutions wherever the client needs them.",
    10: "To be a leading company in the efficient and renewable energy sector, with a primary focus on the quality of our products, highly specialized consulting and rigorous operational follow-up in every project.",
    15: "We strive to deliver excellence in each of our products and services.",
    16: "We will be with you at every stage of the process, ensuring the improvement of energy efficiency.",
    17: "We offer customer service focused on friendliness, agility and clarity to effectively meet your needs.",
    18: "We offer products and services that adapt to and meet your needs.",
    19: "We have developed residential, commercial and industrial projects in electrical installations, switchboards, transformers and photovoltaic systems, building long-term partnerships with our clients to optimize energy use and management in their processes.",
    20: "At ENNCO we are committed to quality, reliability and safety in each of our projects. We tailor every solution and select nationally and internationally certified equipment, adapted to the conditions of each site, to guarantee optimal performance in operation.",
    24: "Below is a preliminary example of the proposed mounting system, which may be modified in terms of model and features following the completion of the technical survey at the installation site.",
    25: "According to the Mexican Official Standard NOM-001-SEDE and the National Electrical Code (NEC), Article 690 specifies the type of electrical conductor required to ensure optimal performance and safety in residential, commercial and industrial photovoltaic installations. Therefore, in this project the required type of cable will be used, which meets the following conditions:",
    27: "Considering the installation location, orientation and tilt, as well as the solar radiation database for the area, the following estimate of energy generation is determined in comparison with the property's energy consumption.",
    28: "The following graph shows the energy generation performance of the photovoltaic system over the course of a year. The amount of energy generated may decrease due to factors such as weather conditions, dirt accumulation on the modules and lack of maintenance.",
}
BLOCKS = [("Inf_Vac_Res", 6, "Estudio_Res", "Cal_Tarifa_Residencial", "$H$447", None), ("Inf_Vac_Com", 36, "Estudio_Com", "Cal_Tarifa_Comercial", "$H$459", "com"), ("Inf_Vac_Ind", 67, "Estudio_Ind", "Cal_Tarifa_Industrial", "$H$446", "ind")]
tx = Catalog("Textos")
for vac, b, est, cal, precio, kind in BLOCKS:
    off = b - 6
    last = 32 + off + (1 if kind else 0)
    for r in range(b, last + 1):
        tx.f(f"B{r}", f'IF({vac}!$M$107="Español",C{r},D{r})', text=True)
    for k, v in ES.items():
        tx.v(f"C{k + off}", v).v(f"D{k + off}", EN[k])
    MOD = f"VLOOKUP({vac}!$F$44,Inf_Módulos!$D$6:$AI$23,{{}},0)"
    tx.f(f"C{21 + off}", f'"El módulo fotovoltaico propuesto es de la marca "&{vac}!$C$44&", modelo "&{vac}!$F$44&", que se encuentra entre los mejores módulos a nivel mundial en el ranking TIER 1."', text=True)
    tx.f(f"D{21 + off}", f'"The proposed photovoltaic module is from the brand "&{vac}!$C$44&", model "&{vac}!$F$44&", ranked among the best modules worldwide in the TIER 1 ranking."', text=True)
    brand = f"VLOOKUP({vac}!$C$58,Inf_Inversor!$D$6:$BD$45,53,0)"
    tx.f(f"C{22 + off}", f'"El inversor propuesto es de la marca "&{brand}&". Con un adecuado dimensionamiento en cantidad de módulos en serie y cadenas para el inversor, aseguramos un óptimo aprovechamiento de las condiciones del sitio de instalación para lograr con ello una mayor captación de energía solar."', text=True)
    tx.f(f"D{22 + off}", f'"The proposed inverter is from the brand "&{brand}&". With adequate sizing in the number of modules in series and parallel for the inverter, we ensure optimal use of the conditions of the installation site to achieve greater solar energy collection."', text=True)
    tx.f(f"C{23 + off}", f'"De acuerdo a las condiciones actuales de la edificación, se propone 1 sistema de montaje para "&{vac}!$F$55&"."', text=True)
    tx.f(f"D{23 + off}", f'"According to the current conditions of the building, 1 mounting system is proposed for "&IFERROR(VLOOKUP({vac}!$F$55,Inf_Sistema_De_Montaje!$I$17:$J$24,2,0),{vac}!$F$55)&"."', text=True)
    AC = "Cal_Cir_Ele_AC!"
    tx.f(f"C{26 + off}", f'"Para el circuito de corriente alterna se utilizará conductor de cobre calibre "&{AC}$G$32&" con aislamiento "&{AC}$J$22&", protegido con un interruptor termomagnético de "&{AC}$J$33&" A y conductor de puesta a tierra "&{AC}$G$35&". En corriente directa se utilizará cable fotovoltaico tipo PV de 2000 V, 90 °C, resistente a la intemperie."', text=True)
    tx.f(f"D{26 + off}", f'"For the alternating current circuit, copper conductor "&{AC}$G$32&" with "&{AC}$J$22&" insulation will be used, protected by a "&{AC}$J$33&" A circuit breaker with "&{AC}$G$35&" equipment grounding conductor. For direct current, 2000 V, 90 °C, weather-resistant PV wire will be used."', text=True)
    per = f"{vac}!$D$19"
    tx.f(f"C{29 + off}", f'"Actualmente usted tiene una tarifa "&{vac}!$G$19&" con el suministrador de energía eléctrica "&{vac}!$E$11&"; donde tomando en consideración su ubicación de instalación e historial de consumo eléctrico en los 12 meses anteriores a partir del mes de "&{vac}!$E$22&" del año en curso y en donde el promedio de su costo por cada kWh consumido es de $ "&TEXT({est}!{precio},"0.00")&" MXN, con un incremento anual del "&TEXT({vac}!$K$27,"0%")&". Se presenta a continuación una comparativa del futuro pago aproximado de manera "&{per}&" con y sin sistema fotovoltaico."', text=True)
    tx.f(f"D{29 + off}", f'"You currently have a "&{vac}!$G$19&" rate with the electricity supplier "&{vac}!$E$11&"; taking into consideration your installation location and electricity consumption history in the previous 12 months starting from the month of "&{vac}!$E$22&" of the current year, where the average cost of each kWh consumed is $ "&TEXT({est}!{precio},"0.00")&" MXN, with an annual increase of "&TEXT({vac}!$K$27,"0%")&". Below is a comparison of the approximate future "&{per}&" payment with and without a photovoltaic system."', text=True)
    g = 30 + off + (1 if kind else 0)
    tx.f(f"C{g}", f'"Garantía por "&{MOD.format(31)}&" años en defectos de fabricación y "&{MOD.format(32)}&" años por el rendimiento del producto."', text=True)
    tx.f(f"D{g}", f'{MOD.format(31)}&"-year warranty for manufacturing defects and "&{MOD.format(32)}&"-year warranty for product performance."', text=True)
    tx.f(f"C{g + 1}", f'VLOOKUP({vac}!$C$58,Inf_Inversor!$D$6:$BJ$45,59,0)&" años de garantía del producto."', text=True).f(f"D{g + 1}", f'VLOOKUP({vac}!$C$58,Inf_Inversor!$D$6:$BJ$45,59,0)&" years product warranty."', text=True)
    tx.f(f"C{g + 2}", f'{vac}!$M$109&" años de garantía por defectos de fabricación."', text=True).f(f"D{g + 2}", f'{vac}!$M$109&"-year warranty against manufacturing defects."', text=True)
    if kind:
        fp = f"AVERAGE({cal}!$R$26:$AC$26)/100" if kind == "ind" else f"AVERAGE({cal}!$R$20:$AC$20)/100"
        bono = f"AVERAGE({cal}!$R$46:$AC$46)" if kind == "ind" else f"AVERAGE({cal}!$R$37:$AC$37)"
        tx.f(f"C{30 + off}", f'"El nuevo factor de potencia que tendrás en promedio mensual será del "&TEXT({fp},"0.00%")&" con el cual serás acreedor a una bonificación por factor de potencia de $ "&TEXT(-{bono},"#,##0.00")&" promedio mensual (los datos se calculan con base en el comportamiento del consumo actual; si este cambia en el futuro, el factor de potencia también se modificará)."', text=True)
        tx.f(f"D{30 + off}", f'"The new power factor you will have on a monthly average will be "&TEXT({fp},"0.00%")&", which entitles you to a power factor bonus of $ "&TEXT(-{bono},"#,##0.00")&" on a monthly average (the data is calculated based on current consumption behavior; if it changes in the future, the power factor will also change)."', text=True)
    for r in (19, 25, 26):
        for col in "EFGH":
            if wb.cells("Textos").get(f"{col}{r + off}"):
                tx.v(f"{col}{r + off}", "")
    if kind:
        for col in "EFGH":
            if wb.cells("Textos").get(f"{col}{22 + off}"):
                tx.v(f"{col}{22 + off}", "")

# ---------------- Estudio_* ----------------
tvals = {}
for ref, cell in wb.cells("Textos").items():
    if isinstance(cell.value, str) and len(cell.value) > 25:
        tvals.setdefault(cell.value.strip(), ref)


def find(cells, prefix, col=None):
    best = None
    for ref, cell in cells.items():
        if isinstance(cell.value, str) and cell.value.strip().startswith(prefix) and (col is None or ref.startswith(col)):
            r = split_ref(ref)[1]
            if best is None or r < best[1]:
                best = (ref, r)
    return best


out = tx.entries
# (col pago con FV en Inf_Apoyo, fila inicial, deducción, TIR, rango del "precio promedio" (Res: total con IVA y DAP; Com: total antes de IVA; Ind: subtotal antes de IVA), col pago actual en Inf_Apoyo)
APOYO = {"Estudio_Res": ("N", 24, "T21", "T22", "$D$40:$O$40", "K"), "Estudio_Com": ("H", 59, "O57", "O58", "$D$31:$O$31", "E"), "Estudio_Ind": ("W", 59, "AD57", "AD58", "$D$47:$O$47", "T")}
for vac, b, est, cal, precio, kind in BLOCKS:
    e = Catalog(est)
    cells = wb.cells(est)
    apoyo_col, apoyo_r0, ded, tir, fs, pago_col = APOYO[est]
    e.v("A2", "").v("C2", "@ennco").v("A3", "contacto@ennco.com.mx").v("C3", "ENNCO").v("A4", "www.ennco.com.mx").v("C4", "ENNCO")
    e.f("D37", f"{vac}!$E$7", text=True).f("D39", f"{vac}!$E$9", text=True).f("D41", f'{vac}!$J$63&" Módulos Solares "&{vac}!$I$44&" W"', text=True)
    e.f("D43", f'{vac}!$L$63&" kWp De Potencia Instalada"', text=True).f("D45", f"{vac}!$G$65").f("D47", f"MIN(1,{vac}!$G$68)")
    for ref, cell in cells.items():
        if isinstance(cell.value, (int, float)) and cell.value == 45944:
            e.f(ref, "TODAY()")
    for ref, cell in cells.items():
        if isinstance(cell.value, str) and cell.value.strip() in tvals and split_ref(ref)[1] > 100:
            lead = cell.value[: len(cell.value) - len(cell.value.lstrip())]
            e.f(ref, (f'"{lead}"&' if lead else "") + f"Textos!{tvals[cell.value.strip()]}", text=True)
    # criterios
    r = find(cells, "Tipo de Tarifa")[1]
    e.f(f"D{r}", f"{vac}!$G$19", text=True).f(f"H{r}", f"SUM({cal}!{fs})/{vac}!$G$66")
    e.f(f"D{r + 1}", f"{vac}!$K$27").f(f"H{r + 1}", f"Inf_Apoyo!{ded}").f(f"H{r + 2}", f"Inf_Apoyo!{tir}")
    ra = find(cells, "Año", "A")[1]
    d0, d1 = ra + 2, ra + 31
    n = f'COUNTIF($H${d0}:$H${d1},"<0")'
    gt = find(cells, "Gran Total (MXN)")[1]
    e.f(f"D{r + 2}", f'IF({n}=0,TEXT(MAX($H${gt}-$H${r + 1},0)/MAX($G${d0},1),"0.00")&" Años",IF({n}>=30,"No recupera en 30 años",TEXT({n}+ABS(INDEX($H${d0}:$H${d1},{n}))/INDEX($G${d0}:$G${d1},{n}+1),"0.00")&" Años"))', text=True)
    rs = find(cells, "Ahorro Energético:")[1] + 4
    e.f(f"B{rs}", f"MIN(1,D{d0}/B{d0})").f(f"E{rs}", f"G{d0}/C{d0}")
    gt = find(cells, "Gran Total (MXN)")[1]
    for i in range(30):
        rr = d0 + i
        e.f(f"B{rr}", f"{vac}!$G$66").f(f"E{rr}", f"MAX(0,B{rr}-D{rr})").f(f"F{rr}", f"Inf_Apoyo!{apoyo_col}{apoyo_r0 + i}").f(f"G{rr}", f"C{rr}-F{rr}")
        if i == 0:
            e.f(f"C{rr}", f"Inf_Apoyo!{pago_col}{apoyo_r0}").f(f"D{rr}", f"{vac}!$G$65").f(f"H{rr}", f"G{rr}+$H${r + 1}-$H${gt}")
        else:
            e.f(f"C{rr}", f"C{rr - 1}*(1+$D${r + 1})").f(f"D{rr}", f"D{rr - 1}*(1-{vac}!$M$55)").f(f"H{rr}", f"H{rr - 1}+G{rr}")
    # nota del mes
    nm = find(cells, "El cálculo fue realizado")
    if nm:
        e.f(nm[0], f'"El cálculo fue realizado en base al precio de la tarifa del mes de "&{vac}!$E$22&" del año en curso a ésta propuesta."', text=True)
    # propuesta económica
    rc = find(cells, "CONCEPTO", "B")[1]
    e.f(f"B{rc - 3}", f'"SISTEMA FOTOVOLTAICO INTERCONECTADO CON CAPACIDAD DE "&{vac}!$L$63&" kWp."', text=True)
    e.f(f"B{rc + 1}", f'"Módulo Solar "&{vac}!$F$44', text=True).f(f"F{rc + 1}", f"{vac}!$J$63").f(f"H{rc + 1}", f"{vac}!$L$63*1000*{vac}!$G$98")
    e.f(f"B{rc + 2}", f'"Inversor Solar "&{vac}!$C$58', text=True).f(f"F{rc + 2}", f"{vac}!$E$58")
    for i, txt in enumerate(["Sistema de Montaje Para ", "Circuito Eléctrico DC Para ", "Dispositivos de Protección en DC Para ", "Circuito Eléctrico AC Para ", "Dispositivos de Protección en AC Para "]):
        e.f(f"B{rc + 4 + i}", f'"{txt}"&{vac}!$J$63&" Módulos Solares"', text=True)
    e.f(f"H{rc + 10}", f"SUM(H{rc + 1}:H{rc + 9})")
    rsv = find(cells, "SERVICIOS ADICIONALES")[1]
    for i in range(7):
        vr = 83 + 2 * i
        rr = rsv + 2 + i
        e.f(f"B{rr}", f'IF({vac}!$B${vr},{vac}!$C${vr},"")', text=True).f(f"F{rr}", f'IF({vac}!$B${vr},1,"")').f(f"G{rr}", f'IF({vac}!$B${vr},"Lote","")', text=True).f(f"H{rr}", f"IF({vac}!$B${vr},{vac}!$H${vr},0)")
    ad = find(cells, "Subtotal Adicionales (MXN)")[1]
    e.f(f"H{ad - 1}", f"H{rc + 10}").f(f"H{ad}", f"SUM(H{rsv + 2}:H{rsv + 8})").f(f"H{ad + 1}", f"H{ad - 1}+H{ad}")
    e.f(f"H{ad + 2}", f"{vac}!$L$63*1000*{vac}!$G$98*{vac}!$M$98").f(f"H{ad + 3}", f"H{ad + 1}-H{ad + 2}")
    e.f(f"H{ad + 4}", f'H{ad + 3}*IF({vac}!$M$99="Si",Tarifas!$C$85,0)').f(f"H{ad + 5}", f"H{ad + 3}+H{ad + 4}")
    for i in range(4):
        e.f(f"A{ad + 1 + i}", f"{vac}!$D${107 + i}").f(f"D{ad + 1 + i}", f"{vac}!$H${107 + i}")
    e.f(f"A{ad + 5}", f"SUM(A{ad + 1}:A{ad + 4})")
    tot_col = "C" if cells.get(f"C{ad + 5}") else "D"
    e.f(f"{tot_col}{ad + 5}", f"H{ad + 5}")
    rl = find(cells, "Opción Arrendamiento")[1]
    e.f(f"C{rl}", f"{vac}!$G$113")
    for i in range(3):
        vr = 116 + i
        e.f(f"D{rl + 2 + i}", f'TEXT({vac}!$D${vr},"0%")&" Anticipo"', text=True).f(f"F{rl + 2 + i}", f"{vac}!$H${vr}").f(f"G{rl + 2 + i}", f"{vac}!$K${vr}").f(f"H{rl + 2 + i}", f"IFERROR({vac}!$H${vr}/{vac}!$K${vr},0)")
    # garantías y términos
    rg = find(cells, "GARANTÍAS")[1]
    gcol = "D" if cells.get(f"D{rg + 2}") else "C"
    goff = b + 24 + (1 if kind else 0)
    e.f(f"{gcol}{rg + 2}", f"Textos!B{goff}", text=True).f(f"{gcol}{rg + 3}", f"Textos!B{goff + 1}", text=True).f(f"{gcol}{rg + 4}", f"Textos!B{goff + 2}", text=True)
    e.f(f"{gcol}{rg + 5}", f"{vac}!$E$125", text=True).f(f"{gcol}{rg + 6}", f"{vac}!$E$126", text=True)
    rt = find(cells, "TÉRMINOS GENERALES")[1]
    lang = f'IF({vac}!$M$107="Español",1,2)'
    e.f(f"B{rt + 2}", f'"Tiempo de entrega del proyecto de "&INDEX(Inf_Apoyo!$S$10:$T$14,MATCH({vac}!$J$128,Inf_Apoyo!$S$10:$S$14,0),{lang})&"."', text=True)
    e.f(f"B{rt + 3}", f'"El inicio de los trabajos será de "&INDEX(Inf_Apoyo!$S$10:$T$14,MATCH({vac}!$E$128,Inf_Apoyo!$S$10:$S$14,0),{lang})&" posterior a la firma de contrato y pago de anticipo."', text=True)
    e.f(f"B{rt + 4}", f'"Vigencia de cotización de "&{vac}!$N$128&" días."', text=True)
    sig = find(cells, "JESSICA")
    if sig:
        rsg = sig[1]
        e.v(f"B{rsg}", "FRANCISCO CUÉLLAR").v(f"B{rsg + 1}", "ENNCO").f(f"F{rsg}", f"{vac}!$E$7", text=True)
    out += e.entries

m = Catalog("Inf_Sistema_De_Montaje")
for r in range(17, 25):
    m.f(f"E{r}", f"VLOOKUP($C{r},$C$8:$E$15,3,0)", text=True).v(f"F{r}", "")
for r in range(41, 49):
    m.f(f"E{r}", f"VLOOKUP($C{r},$C$31:$E$38,3,0)", text=True).v(f"F{r}", "")
m.f("I26", "Inf_Vac_Res!$F$55", text=True).f("E26", 'IFERROR(VLOOKUP(I26,$C$8:$E$15,3,0),"")', text=True)
m.f("I49", "Inf_Vac_Com!$F$55", text=True).f("L49", "Inf_Vac_Ind!$F$55", text=True).f("E50", 'IFERROR(VLOOKUP(I49,$C$8:$E$15,3,0),"")', text=True)
m.v("C37", "Floating Mounting System").v("D37", 7).v("C38", "Carport").v("D38", 8)
save(out + m.entries, __file__.replace("gen_textos_estudio.py", "../../../build/cat_textos_estudio.json"))
