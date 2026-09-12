"""Cal_Cir_Ele_DC y Cal_Cir_Ele_Tab (hojas vacías en el original; construidas conforme a NOM-001-SEDE-2012),
tablas NOM nuevas en Tab_Amp_Cir_AC (filas 130+) y hoja de notas (Recuperacion → Notas_Reconstruccion)."""
from common import Catalog, save

TAB = "Tab_Amp_Cir_AC!"
t = Catalog("Tab_Amp_Cir_AC")
t.v("C130", "TABLAS NOM-001-SEDE-2012 PARA CIRCUITO DC (reconstrucción ENNCO 2026; DOF 29/11/2012)")
t.v("C131", "AWG").v("D131", "Ampacidad 90 °C canalización (310-15(b)(16))").v("E131", "Ampacidad 90 °C aire libre (310-15(b)(17))").v("F131", "Resistencia CC a 75 °C Ω/km (Tabla 8)").v("G131", "Diámetro exterior cable PV mm (ficha Viakon; 14, 6 y 4 aproximados)")
for i, (awg, amp_c, amp_a, r, d) in enumerate([(14, 25, 35, 10.1, 6.0), (12, 30, 40, 6.34, 6.5), (10, 40, 55, 3.984, 7.1), (8, 55, 80, 2.506, 8.3), (6, 75, 105, 1.608, 9.7), (4, 95, 140, 1.01, 11.4)]):
    r0 = 132 + i
    t.v(f"C{r0}", awg).v(f"D{r0}", amp_c).v(f"E{r0}", amp_a).v(f"F{r0}", r).v(f"G{r0}", d)
t.v("C139", "Fusibles y protecciones normalizadas 240-6 (A)")
for i, a in enumerate([1, 3, 6, 10, 15, 20, 25, 30, 32, 35, 40]):
    t.v(f"C{140 + i}", a)
t.v("C152", "Tubería PVC cédula 40 (Tabla 4, Cap. 10): designación, pulgadas, área disponible al 40 % (mm²)")
for i, (des, pulg, a40) in enumerate([(16, '1/2"', 74), (21, '3/4"', 131), (27, '1"', 214), (35, '1 1/4"', 374), (41, '1 1/2"', 513), (53, '2"', 849), (63, '2 1/2"', 1212), (78, '3"', 1877), (91, '3 1/2"', 2511), (103, '4"', 3237)]):
    t.v(f"C{153 + i}", des).v(f"D{153 + i}", pulg).v(f"I{153 + i}", a40)
t.v("C165", "Conductor del electrodo de puesta a tierra (Tabla 250-66): sección máxima del conductor de fase (mm²) → calibre Cu")
for i, (mm2, awg) in enumerate([(33.6, "8 AWG"), (53.5, "6 AWG"), (85, "4 AWG"), (177, "2 AWG"), (304, "1/0 AWG"), (557, "2/0 AWG"), (99999, "3/0 AWG")]):
    t.v(f"C{166 + i}", mm2).v(f"D{166 + i}", awg)

d = Catalog("Cal_Cir_Ele_DC")
d.v("B4", "Parámetros de Diseño del Sistema").v("C6", "Información de Proyecto")
d.v("B8", "Nombre del proyecto").f("D8", "Cal_Cir_Ele_AC!D8", text=True).v("B9", "Ciudad").f("D9", "Cal_Cir_Ele_AC!D9", text=True)
d.v("B10", "Modelo de módulo solar").f("D10", "Cal_Inv_St!D14", text=True).v("B11", "Modelo de inversor").f("D11", "Cal_Inv_St!D34", text=True)
d.v("B13", "Datos del arreglo (MPPT 1 de Cal_Inv_St; ajustar si aplica otro MPPT)")
d.v("C14", "Módulos en serie por cadena").f("F14", "IF(Cal_Inv_St!D46>0,Cal_Inv_St!D47/Cal_Inv_St!D46,Cal_Inv_St!Z8)").v("G14", "Cadenas en paralelo").f("J14", "MAX(Cal_Inv_St!D46,1)")
d.v("C15", "Isc del módulo en STC (A)").f("F15", "Cal_Inv_St!D19").v("G15", "Voc a temperatura mínima (V)").f("J15", "Cal_Inv_St!I25")
d.v("C16", "Imp del módulo en STC (A)").f("F16", "Cal_Inv_St!I19").v("G16", "Vmp a temperatura máxima (V)").f("J16", "Cal_Inv_St!D27")
d.v("B18", "Datos de instalación del circuito DC (entradas)")
d.v("C19", "Tipo de canalización (Aire libre / Tubería)").v("F19", "Tubería").v("G19", "Circuitos DC en la misma canalización").v("J19", 1)
d.v("C20", "Calibre del cable PV (AWG: 14, 12, 10, 8, 6, 4)").v("F20", 10).v("G20", "Aislamiento del cable PV (°C)").v("J20", 90)
d.v("C21", "Temperatura ambiente de cálculo (°C)").f("F21", "Cal_Cir_Ele_AC!F23").v("G21", "¿Canalización sobre techumbre? (Si/No)").f("J21", "Cal_Cir_Ele_AC!J24", text=True)
d.v("C22", "Separación al techo (mm)").f("F22", "Cal_Cir_Ele_AC!I25").v("G22", "Longitud de ida del circuito (m)").v("J22", 20)
d.v("B24", "Resultados conforme a NOM-001-SEDE-2012 (690-8, 690-9, 690-31, 310-15, 240-6, Cap. 10)")
d.v("C25", "Corriente máxima del circuito = 1.25 × Isc × cadenas (A) [690-8(a)]").f("J25", "1.25*F15*J14")
d.v("C26", "Corriente para dispositivo de protección = 1.25 × Imax (A) [690-8(b)(1)]").f("J26", "1.25*J25")
d.v("C27", "Temperatura de cálculo con sumador por techumbre (°C) [310-15(b)(3)(c)]").f("J27", f'F21+IF(J21="Si",INDEX({TAB}$N$88:$N$91,COUNTIF({TAB}$L$88:$L$91,"<="&F22)),0)')
d.v("C28", "Factor de corrección por temperatura, columna 90 °C [310-15(b)(2)(a)]").f("J28", f'INDEX({TAB}$G$79:$G$94,COUNTIF({TAB}$C$79:$C$94,"<="&J27))')
d.v("C29", "Factor de ajuste por agrupamiento (2 conductores por circuito) [310-15(b)(3)(a)]").f("J29", f'INDEX({TAB}$N$78:$N$84,COUNTIF({TAB}$L$78:$L$84,"<="&(2*J19)))')
d.v("C30", "Ampacidad base del cable PV a 90 °C (A)").f("J30", f'IF(F19="Aire libre",VLOOKUP(F20,{TAB}$C$132:$E$137,3,0),VLOOKUP(F20,{TAB}$C$132:$D$137,2,0))')
d.v("C31", "Ampacidad corregida = base × Ft × Fa (A)").f("J31", "J30*J28*J29")
d.v("C32", "Cumple 690-8(b)(2): base ≥ 1.25×Imax y corregida ≥ Imax").f("J32", 'IF(AND(J30>=1.25*J25,J31>=J25),"SÍ","NO")', text=True)
d.v("C33", "Ampacidad base requerida = MAX(1.25×Imax, Imax/(Ft×Fa)) (A)").f("J33", "MAX(1.25*J25,J25/(J28*J29))")
d.v("C34", "Calibre mínimo recomendado (AWG)").f("J34", f'IF(F19="Aire libre",INDEX({TAB}$C$132:$C$137,COUNTIF({TAB}$E$132:$E$137,"<"&J33)+1),INDEX({TAB}$C$132:$C$137,COUNTIF({TAB}$D$132:$D$137,"<"&J33)+1))')
d.v("C35", "Fusible de cadena normalizado ≥ 1.25×Imax (A) [240-6]").f("J35", f'INDEX({TAB}$C$140:$C$150,COUNTIF({TAB}$C$140:$C$150,"<"&J26)+1)')
d.v("C36", "¿Se requiere fusible por cadena? [690-9 excepción]").f("J36", 'IF(J14<=2,"No requerido (2 cadenas o menos)","Sí, uno por cadena")', text=True)
d.v("C37", "Fusible máximo de serie permitido por el fabricante del módulo (A) (ficha técnica)").v("J37", 20)
d.v("C38", "Tensión máxima del arreglo = Voc frío × módulos en serie (V) [690-7]").f("J38", "J15*F14")
d.v("C39", "Cumple: ≤ 1000 V y ≤ tensión máxima del inversor").f("J39", 'IF(AND(J38<=1000,J38<=Cal_Inv_St!D38),"SÍ","NO")', text=True)
d.v("C40", "Resistencia del conductor corregida a 90 °C (Ω/km) [Tabla 8, nota 2]").f("J40", f"VLOOKUP(F20,{TAB}$C$132:$F$137,4,0)*(1+0.00323*(90-75))")
d.v("C41", "Corriente de operación = Imp × cadenas (A)").f("J41", "F16*J14")
d.v("C42", "Caída de tensión = 2 × I × L × R / 1000 (V)").f("J42", "2*J41*J22*J40/1000")
d.v("C43", "Caída de tensión (%) sobre Vmp caliente × módulos en serie").f("J43", "IFERROR(J42/(J16*F14),0)")
d.v("C44", "Recomendación ≤ 3 % [210-19 nota 4]").f("J44", 'IF(J43<=0.03,"CUMPLE","REVISAR: aumentar calibre o acortar la trayectoria")', text=True)
d.v("C45", "Área ocupada por los cables PV en la tubería (mm²) [690-31(b), Tabla 1]").f("J45", f'IF(F19="Aire libre",0,2*J19*PI()/4*VLOOKUP(F20,{TAB}$C$132:$G$137,5,0)^2)')
d.v("C46", "Tubería PVC cédula 40 mínima al 40 % de llenado [Tabla 4]").f("J46", f'IF(J45=0,"N/A (aire libre)",INDEX({TAB}$D$153:$D$162,COUNTIF({TAB}$I$153:$I$162,"<"&J45)+1))', text=True)
d.v("B48", "Referencia: NOM-001-SEDE-2012 (DOF 29/11/2012). Hoja construida en la reconstrucción ENNCO 2026: el MEST original la dejó vacía. Validar con ingeniería antes de usar en obra.")

b = Catalog("Cal_Cir_Ele_Tab")
b.v("B4", "Parámetros de Diseño del Sistema").v("C6", "Información de Proyecto")
b.v("B8", "Nombre del proyecto").f("D8", "Cal_Cir_Ele_AC!D8", text=True).v("B9", "Ciudad").f("D9", "Cal_Cir_Ele_AC!D9", text=True)
b.v("B11", "Datos de la interconexión")
b.v("C12", "Configuración eléctrica").f("F12", "Cal_Cir_Ele_AC!F18", text=True).v("G12", "Tensión L-L (V)").f("J12", "Cal_Cir_Ele_AC!F17")
b.v("C13", "Modelo de inversor").f("F13", "Cal_Cir_Ele_AC!D13", text=True).v("G13", "Cantidad de inversores").f("J13", "Cal_Cir_Ele_AC!F19")
b.v("C14", "Corriente de salida por inversor (A)").f("F14", "Cal_Cir_Ele_AC!J18").v("G14", "Corriente total FV (A)").f("J14", "F14*J13")
b.v("C15", "Capacidad de barras del tablero existente (A)").v("F15", 250).v("G15", "Interruptor principal existente (A)").v("J15", 200)
b.v("C16", "Tipo de interconexión (Barras / Lado de línea)").v("F16", "Barras")
b.v("B18", "Resultados (NOM-001-SEDE-2012 Art. 240, 250, 310 y 690; regla del 120 % NEC 705.12(D)(2))")
b.v("C19", "Corriente de diseño = 1.25 × corriente total FV (A) [690-8]").f("J19", "1.25*J14")
b.v("C20", "Interruptor FV en el tablero (A) [240-6]").f("J20", f'INDEX({TAB}$C$99:$C$128,COUNTIF({TAB}$C$99:$C$128,"<"&J19)+1)')
b.v("C21", "Regla de barras: principal + FV ≤ 120 % de la capacidad de barras").f("J21", 'IF(F16="Lado de línea","N/A (interconexión en lado de línea)",IF(J15+J20<=1.2*F15,"CUMPLE","NO CUMPLE: tablero nuevo o interconexión en lado de línea"))', text=True)
b.v("C22", "Alimentador FV: sección (mm²) y calibre con las condiciones de la hoja AC").f("F22", f'INDEX({TAB}$C$13:$C$38,COUNTIF({TAB}$E$13:$E$38,"<"&J19)+1)').f("J22", f'INDEX({TAB}$D$13:$D$38,COUNTIF({TAB}$E$13:$E$38,"<"&J19)+1)', text=True)
b.v("C23", "Ampacidad corregida del alimentador (A)").f("J23", f'INDEX({TAB}$E$13:$E$38,COUNTIF({TAB}$E$13:$E$38,"<"&J19)+1)')
b.v("C24", "Conductor de puesta a tierra de equipos: sección (mm²) y calibre Cu [Tabla 250-122]").f("F24", f'INDEX({TAB}$V$81:$V$99,COUNTIF({TAB}$U$81:$U$99,"<"&J20)+1)').f("J24", f'INDEX({TAB}$W$81:$W$99,COUNTIF({TAB}$U$81:$U$99,"<"&J20)+1)', text=True)
b.v("C25", "Conductor del electrodo de puesta a tierra Cu [Tabla 250-66]").f("J25", f'INDEX({TAB}$D$166:$D$172,COUNTIF({TAB}$C$166:$C$172,"<"&F22)+1)', text=True)
b.v("C26", "Caída de tensión acumulada DC + AC (%)").f("J26", "Cal_Cir_Ele_DC!J43+Cal_Cir_Ele_AC!G39")
b.v("C27", "Recomendación ≤ 5 % total [215-2 nota 2]").f("J27", 'IF(J26<=0.05,"CUMPLE","REVISAR")', text=True)
b.v("B29", "Resumen de circuitos").v("C30", "Circuito").v("E30", "Corriente de diseño (A)").v("G30", "Conductor").v("I30", "Protección (A)").v("J30", "Tierra")
b.v("C31", "DC: cadenas de módulos").f("E31", "Cal_Cir_Ele_DC!J25").f("G31", '"PV "&Cal_Cir_Ele_DC!J34&" AWG"', text=True).f("I31", "Cal_Cir_Ele_DC!J35").v("J31", "-")
b.v("C32", "AC: salida del inversor").f("E32", "Cal_Cir_Ele_AC!F28").f("G32", "Cal_Cir_Ele_AC!G32", text=True).f("I32", "Cal_Cir_Ele_AC!J33").f("J32", "Cal_Cir_Ele_AC!G35", text=True)
b.v("C33", "Alimentador al tablero").f("E33", "J19").f("G33", "J22", text=True).f("I33", "J20").f("J33", "J24", text=True)
b.v("B35", "Hoja construida en la reconstrucción ENNCO 2026 (el MEST original la dejó vacía). No sustituye el cálculo de cortocircuito ni la coordinación de protecciones; validar con ingeniería.")

n = Catalog("Recuperacion")
NOTES = [
    "CALCULADORA SOLAR ENNCO · NOTAS DE LA RECONSTRUCCIÓN (v1.0, septiembre 2026, Teckel AI)",
    "",
    "Origen: MEST PROGRAM 2.0 rescatado el 9 de septiembre de 2026 con 43,927 valores y 0 fórmulas. Todas las fórmulas de este libro se dedujeron de esos valores y se verificaron por recálculo: 42,976 de 43,935 celdas reproducen el original exactamente; las 959 restantes son las diferencias documentadas abajo.",
    "",
    "CORRECCIONES APLICADAS (antes → después)",
    "1. Tarifas!C85:C94: IVA, DAP, 2 % BT, factor de potencia, mínimo residencial y deducción fiscal ahora son celdas editables. El MEST tenía las tasas dentro de las fórmulas (DAP 10 % y 10.34 % residencial, 11 % comercial, 1.367 % industrial).",
    "2. Cal_Tarifa_Residencial: el DAP de la proyección con FV usa Tarifas!C94 (10 %); el MEST usaba 10.34 % en ese bloque y 10 % en el historial. Efecto en el caso de ejemplo: pago anual con FV 698.94 → 696.79 MXN.",
    "3. Precios_SFV: el factor de utilidad de Inf_Vac_*!G99 se aplica a todas las partidas; el MEST lo aplicaba solo al inversor y fijaba 50 % en el resto (caso comercial: 18.48 → 18.58 MXN/W).",
    "4. Estudio_Res: el tiempo de retorno usa la misma serie con deducción fiscal que los estudios comercial e industrial (caso de ejemplo: 2.01 → 1.48 años).",
    "5. Cal_Tarifa_Comercial fila 18, Cal_Inv_St!K48 y Precios_SFV filas 44-47: errores #DIV/0! y #N/A sustituidos por 0 o vacío.",
    "6. Cálculo_Com_String (macro de calibre): leía la corriente sin compensar (F27) y escribía en F29; ahora lee F28 y escribe F30 como las fórmulas nativas. Se eliminó el bloque duplicado.",
    "7. Inf_Sistema_De_Montaje: descripciones por sistema reconstruidas (E17:E24, E41:E48); código 7 duplicado en la tabla en inglés corregido. La lista de componentes por sistema (F17:F24) quedó vacía: no existía en el rescate.",
    "8. Cal_Cir_Ele_AC C26/C31/C34: los avisos solo aparecen cuando aplica la condición (el MEST los mostraba siempre).",
    "",
    "HIPÓTESIS (no deducibles del rescate; revisar con ENNCO)",
    "A. Inf_Apoyo columnas N/H/W (pago a CFE con FV, año 2 en adelante): el MEST tenía un valor de año 2 que no se pudo reproducir (residencial 2,599.76); aquí crece 7 % anual desde el año 1. Afecta ahorro acumulado, TIR y retorno de los tres estudios.",
    "B. Cal_Sombra_Apoyo!D14: declinación −23.429° conservada como dato de entrada (Cooper daría −23.45°).",
    "C. Cal_Inv_St!Q54: referencia de 400 V = 80 % de la tensión máxima del inversor.",
    "D. Cal_Tarifa_Residencial fila 36 (consumo móvil que decide DAC): replica el MEST, que suma dos veces el neto en los meses no facturados de un periodo bimestral. Se conserva porque cambiarlo altera la clasificación DAC del ejemplo; decidir con ENNCO.",
    "E. Inf_Apoyo!T23 y las tablas derivadas de Tab_Amp_Cir_AC (Q10:AP38) no se reconstruyeron: no tenían uso en ningún cálculo.",
    "",
    "HOJAS NUEVAS Y DATOS",
    "· Cal_Cir_Ele_DC y Cal_Cir_Ele_Tab: vacías en el MEST; construidas con NOM-001-SEDE-2012 (Tab_Amp_Cir_AC filas 130-172). Sin caso de referencia del original.",
    "· Tarifas: los valores vivos siguen siendo los del MEST (2024) porque reproducen el caso de ejemplo; el bloque 'REFERENCIA CFE 2026' (fila 96 en adelante) trae las cuotas investigadas para actualizar y confirmar en app.cfe.mx.",
    "· Textos e imágenes: marca ENNCO. Pendientes: teléfono y dirección en la cabecera de los estudios, fotos de proyectos propios (imágenes 55-57) y revisión de los textos de empresa.",
    "· Se eliminaron el login, la caducidad, el borrado por fecha y el envío oculto de propuestas por Outlook. Contraseña de protección de hojas nueva (en resguardo de Teckel).",
    "",
    "Herramientas y evidencia: repositorio ennco-operacion, carpeta tools/mest-rebuild (catálogo de fórmulas, verificación por recálculo con LibreOffice, casos dorados).",
]
for i, line in enumerate(NOTES):
    n.v(f"A{2 + i}", line)
save(t.entries + d.entries + b.entries + n.entries, __file__.replace("gen_dc_tab.py", "../../../build/cat_dc_tab.json"))
