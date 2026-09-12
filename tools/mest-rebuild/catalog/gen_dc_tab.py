"""Cal_Cir_Ele_DC y Cal_Cir_Ele_Tab (hojas vacías en el original; construidas conforme a NOM-001-SEDE-2012),
tablas NOM nuevas en Tab_Amp_Cir_AC (filas 130+) y hoja de notas (Recuperacion → Notas_Reconstruccion)."""
from common import Catalog, save

TAB = "Tab_Amp_Cir_AC!"
t = Catalog("Tab_Amp_Cir_AC")
t.v("C130", "TABLAS NOM-001-SEDE-2012 PARA CIRCUITO DC (reconstrucción ENNCO 2026; DOF 29/11/2012)")
t.v("C131", "AWG").v("D131", "Ampacidad 90 °C canalización (310-15(b)(16))").v("E131", "Ampacidad 90 °C aire libre (310-15(b)(17))").v("F131", "Resistencia CC a 75 °C Ω/km (Tabla 8)").v("G131", "Diámetro exterior cable PV mm (ficha Viakon; 14, 6 y 4 aproximados)").v("H131", "Ampacidad 75 °C para terminales (110-14(c))").v("I131", "Protección máxima 240-4(d) (A)").v("J131", "Cumple para el circuito DC actual (1 = sí)")
for i, (awg, amp_c, amp_a, r, d, a75, lim) in enumerate([(14, 25, 35, 10.1, 6.0, 20, 15), (12, 30, 40, 6.34, 6.5, 25, 20), (10, 40, 55, 3.984, 7.1, 35, 30), (8, 55, 80, 2.506, 8.3, 50, 9999), (6, 75, 105, 1.608, 9.7, 65, 9999), (4, 95, 140, 1.01, 11.4, 85, 9999)]):
    r0 = 132 + i
    t.v(f"C{r0}", awg).v(f"D{r0}", amp_c).v(f"E{r0}", amp_a).v(f"F{r0}", r).v(f"G{r0}", d).v(f"H{r0}", a75).v(f"I{r0}", lim)
    t.f(f"J{r0}", f'IF(AND(H{r0}>=1.25*Cal_Cir_Ele_DC!$J$26,IF(Cal_Cir_Ele_DC!$F$19="Aire libre",E{r0},D{r0})*Cal_Cir_Ele_DC!$J$29*Cal_Cir_Ele_DC!$J$30>=Cal_Cir_Ele_DC!$J$26,I{r0}>=Cal_Cir_Ele_DC!$J$36),1,0)')
# tierra en aluminio para interruptores chicos y dos erratas de la tabla base (verificadas contra NEC 2011)
t.v("X81", 3.31).v("Y81", "12 AWG").v("X82", 5.26).v("Y82", "10 AWG").v("X83", 8.37).v("Y83", "8 AWG").v("E64", 355).v("I67", 395)
t.v("C139", "Fusibles y protecciones normalizadas 240-6 (A), 1 a 100 A")
for i, a in enumerate([1, 3, 6, 10, 15, 16, 20, 25, 30, 32, 35, 40, 45, 50, 60, 63, 70, 80, 90, 100]):
    t.v(f"C{140 + i}", a)
t.v("C164", "Tubería PVC cédula 40 (Tabla 4, Cap. 10): designación, pulgadas, área disponible al 40 % (mm²)")
for i, (des, pulg, a40) in enumerate([(16, '1/2"', 74), (21, '3/4"', 131), (27, '1"', 214), (35, '1 1/4"', 374), (41, '1 1/2"', 513), (53, '2"', 849), (63, '2 1/2"', 1212), (78, '3"', 1877), (91, '3 1/2"', 2511), (103, '4"', 3237)]):
    t.v(f"C{165 + i}", des).v(f"D{165 + i}", pulg).v(f"I{165 + i}", a40)
t.v("C177", "Conductor del electrodo de puesta a tierra (Tabla 250-66): sección máxima del conductor de fase (mm²) → calibre Cu")
for i, (mm2, awg) in enumerate([(33.6, "8 AWG"), (53.5, "6 AWG"), (85, "4 AWG"), (177, "2 AWG"), (304, "1/0 AWG"), (557, "2/0 AWG"), (99999, "3/0 AWG")]):
    t.v(f"C{178 + i}", mm2).v(f"D{178 + i}", awg)

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
d.v("C23", "¿Las cadenas se combinan en un solo conductor antes del inversor? (Si/No)").v("F23", "No").v("G23", "Inversor del arreglo (Cal_Inv_St)").f("J23", "Cal_Inv_St!D34", text=True)
d.v("B24", "Resultados conforme a NOM-001-SEDE-2012 (690-7, 690-8, 690-9, 690-31, 310-15, 240-6, Cap. 10)")
d.v("C25", "Corriente máxima por cadena = 1.25 × Isc (A) [690-8(a)(1)]").f("J25", "1.25*F15")
d.v("C26", "Corriente máxima del circuito calculado (A): por cadena, o combinado = cadena × cadenas si hay combinador [690-8(a)]").f("J26", 'IF(F23="Si",J25*J14,J25)')
d.v("C27", "Corriente para el fusible de cada cadena = 1.25 × corriente de cadena (A) [690-8(b)(1)]").f("J27", "1.25*J25")
d.v("C28", "Temperatura de cálculo con sumador por techumbre (°C) [310-15(b)(3)(c)]").f("J28", f'F21+IF(J21="Si",INDEX({TAB}$N$88:$N$91,COUNTIF({TAB}$L$88:$L$91,"<="&F22)),0)')
d.v("C29", "Factor de corrección por temperatura, columna 90 °C [310-15(b)(2)(a)]").f("J29", f'INDEX({TAB}$G$79:$G$94,COUNTIF({TAB}$C$79:$C$94,"<="&J28))')
d.v("C30", "Factor de ajuste por agrupamiento (2 conductores por circuito) [310-15(b)(3)(a)]").f("J30", f'INDEX({TAB}$N$78:$N$84,COUNTIF({TAB}$L$78:$L$84,"<="&(2*J19)))')
d.v("C31", "Ampacidad base del cable PV a 90 °C (A)").f("J31", f'IF(F19="Aire libre",VLOOKUP(F20,{TAB}$C$132:$E$137,3,0),VLOOKUP(F20,{TAB}$C$132:$D$137,2,0))')
d.v("C32", "Ampacidad corregida = base × Ft × Fa (A)").f("J32", "J31*J29*J30")
d.v("C33", "Cumple 690-8(b)(2) para el circuito combinado: base ≥ 1.25×Imax y corregida ≥ Imax").f("J33", 'IF(AND(J31>=1.25*J26,J32>=J26),"SÍ","NO")', text=True)
d.v("C34", "Ampacidad base requerida = MAX(1.25×Imax, Imax/(Ft×Fa)) (A)").f("J34", "MAX(1.25*J26,J26/(J29*J30))")
d.v("C35", "Calibre mínimo que cumple 690-8(b)(2) con terminales a 75 °C y 240-4(d) (AWG)").f("J35", f'IFERROR(INDEX({TAB}$C$132:$C$137,MATCH(1,{TAB}$J$132:$J$137,0)),"> 4 AWG: usar conductor en canalización (Tab_Amp_Cir_AC)")', text=None)
d.v("C36", "Fusible normalizado por cadena ≥ 1.25 × corriente de cadena (A) [240-6]").f("J36", f'IFERROR(INDEX({TAB}$C$140:$C$159,COUNTIF({TAB}$C$140:$C$159,"<"&J27)+1),"> 100 A: revisar")', text=None)
d.v("C37", "¿Se requiere fusible por cadena? [690-9 excepción]").f("J37", 'IF(J14<=2,"No requerido (2 cadenas o menos)","Sí, uno por cadena")', text=True)
d.v("C38", "Fusible máximo de serie permitido por el fabricante del módulo (A): capturar de la ficha técnica").v("J38", "")
d.v("C39", "Fusible elegido ≤ fusible máximo del módulo").f("J39", 'IF(NOT(ISNUMBER(J36)),"",IF(J38="","Capturar el fusible máximo de la ficha del módulo",IF(J36<=J38,"SÍ","NO: el fusible requerido supera el máximo del módulo")))', text=True)
d.v("C40", "Tensión máxima del arreglo = Voc frío × módulos en serie (V) [690-7]").f("J40", "J15*F14")
d.v("C41", "Cumple: ≤ 1000 V y ≤ tensión máxima del inversor").f("J41", 'IF(AND(J40<=1000,J40<=Cal_Inv_St!D38),"SÍ","NO")', text=True)
d.v("C42", "Resistencia del conductor corregida a 90 °C (Ω/km) [Tabla 8, nota 2]").f("J42", f"VLOOKUP(F20,{TAB}$C$132:$F$137,4,0)*(1+0.00323*(90-75))")
d.v("C43", "Corriente de operación = Imp × cadenas (A)").f("J43", "F16*J14")
d.v("C44", "Caída de tensión = 2 × I × L × R / 1000 (V)").f("J44", "2*J43*J22*J42/1000")
d.v("C45", "Caída de tensión (%) sobre Vmp caliente × módulos en serie").f("J45", "IFERROR(J44/(J16*F14),0)")
d.v("C46", "Recomendación ≤ 3 % [210-19 nota 4]").f("J46", 'IF(J45<=0.03,"CUMPLE","REVISAR: aumentar calibre o acortar la trayectoria")', text=True)
d.v("C47", "Área ocupada por los cables PV en la tubería (mm²) [690-31(b), Tabla 1]").f("J47", f'IF(F19="Aire libre",0,2*J19*PI()/4*VLOOKUP(F20,{TAB}$C$132:$G$137,5,0)^2)')
d.v("C48", "Tubería PVC cédula 40 mínima [Tabla 1: 31 % con dos conductores, 40 % con más; Tabla 4]").f("J48", f'IF(J47=0,"N/A (aire libre)",IFERROR(INDEX({TAB}$D$165:$D$174,COUNTIF({TAB}$I$165:$I$174,"<"&J47*IF(2*J19<=2,0.4/0.31,1))+1),"> 4 pulgadas"))', text=True)
d.v("B50", "Referencia: NOM-001-SEDE-2012 (DOF 29/11/2012). Hoja construida en la reconstrucción ENNCO 2026: el MEST original la dejó vacía. Validar con ingeniería antes de usar en obra.")

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
b.v("C22", "Alimentador FV: sección (mm²) y calibre seleccionados en Cal_Cir_Ele_AC").f("F22", "Cal_Cir_Ele_AC!F32").f("J22", "Cal_Cir_Ele_AC!G32", text=True)
b.v("C23", "Ampacidad corregida del alimentador (A)").f("J23", "Cal_Cir_Ele_AC!J27")
b.v("C24", "Conductor de puesta a tierra de equipos: sección (mm²) y calibre Cu [Tabla 250-122]").f("F24", f'INDEX({TAB}$V$81:$V$99,COUNTIF({TAB}$U$81:$U$99,"<"&J20)+1)').f("J24", f'INDEX({TAB}$W$81:$W$99,COUNTIF({TAB}$U$81:$U$99,"<"&J20)+1)', text=True)
b.v("C25", "Conductor del electrodo de puesta a tierra Cu [Tabla 250-66]").f("J25", f'INDEX({TAB}$D$178:$D$184,COUNTIF({TAB}$C$178:$C$184,"<"&F22)+1)', text=True)
b.v("C26", "Caída de tensión acumulada DC + AC (%)").f("J26", "Cal_Cir_Ele_DC!J45+Cal_Cir_Ele_AC!G39")
b.v("C27", "Recomendación ≤ 5 % total [215-2 nota 2]").f("J27", 'IF(J26<=0.05,"CUMPLE","REVISAR")', text=True)
b.v("B29", "Resumen de circuitos").v("C30", "Circuito").v("E30", "Corriente de diseño (A)").v("G30", "Conductor").v("I30", "Protección (A)").v("J30", "Tierra")
b.v("C31", "DC: cadenas de módulos").f("E31", "Cal_Cir_Ele_DC!J26").f("G31", '"PV "&Cal_Cir_Ele_DC!J35&" AWG"', text=True).f("I31", "Cal_Cir_Ele_DC!J36").v("J31", "-")
b.v("C32", "AC: salida del inversor").f("E32", "Cal_Cir_Ele_AC!F28").f("G32", "Cal_Cir_Ele_AC!G32", text=True).f("I32", "Cal_Cir_Ele_AC!J33").f("J32", "Cal_Cir_Ele_AC!G35", text=True)
b.v("C33", "Alimentador al tablero").f("E33", "J19").f("G33", "J22", text=True).f("I33", "J20").f("J33", "J24", text=True)
b.v("C28", "Coherencia: inversor de Cal_Cir_Ele_AC frente al del arreglo (Cal_Inv_St)").f("J28", 'IF(Cal_Cir_Ele_AC!D13=Cal_Inv_St!D34,"MISMO INVERSOR","AVISO: Cal_Cir_Ele_AC y Cal_Inv_St usan inversores distintos")', text=True)
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
    "9. Cal_Tarifa_Residencial fila 8: el arrastre entre periodos solo acumula crédito (neto negativo); el MEST arrastraba también el consumo positivo y, con consumos altos, multiplicaba el pago con FV. Con el ejemplo de Saltillo el resultado no cambia.",
    "10. Inf_Apoyo y Estudio_*: el tiempo de retorno y la TIR ya no fallan (#REF!, #N/A, #VALUE!) cuando el sistema se paga en el primer año o no se recupera en 30 años.",
    "11. Cal_Tarifa_Comercial fila 28 (PDBT/APBT/RABT): el cargo por capacidad se calcula como kWh × $/kWh; el MEST multiplicaba kW facturable × $/kWh (dimensionalmente incorrecto) y subestimaba el recibo comercial (ejemplo Irapuato noviembre: 7,852 → 10,881 MXN antes de IVA). En GDBT distribución y capacidad usan kW facturable × $/kW. Fila 17 (kW facturable) se calcula para GDBT.",
    "12. Cal_Tarifa_Residencial filas 22-25 y 34: los meses no facturados del periodo bimestral ya no generan cargo (el MEST lo duplicaba cuando el neto era positivo).",
    "13. Cal_Tarifa_Residencial fila 36 (consumo móvil que decide DAC): ahora sale del historial el mes homólogo y entra el neto facturado (nunca negativo). El MEST restaba los meses en orden secuencial y sumaba el arrastre negativo, adelantando la salida de DAC. Ejemplo Saltillo: pago anual con FV 696.79 → 1,276.52 MXN (tres bimestres en DAC en vez de uno). Confirmar con ENNCO.",
    "14. Inf_Apoyo T21/O57/AD57: la deducción fiscal solo se aplica si Inf_Vac_*!M105 = Si (el MEST ignoraba esa pregunta).",
    "15. Cal_Cir_Ele_AC F30/I30/J28: el calibre se busca con la corriente por conductor (F28/F29) para admitir conductores en paralelo; tabla de tierra en aluminio completada para 15-60 A; E64 y I67 corregidas (355 y 395 A).",
    "",
    "HIPÓTESIS (no deducibles del rescate; revisar con ENNCO)",
    "A. Inf_Apoyo columnas N/H/W (pago a CFE con FV, año 2 en adelante): el MEST tenía un valor de año 2 que no se pudo reproducir (residencial 2,599.76); aquí crece 7 % anual desde el año 1. Afecta ahorro acumulado, TIR y retorno de los tres estudios.",
    "B. Cal_Sombra_Apoyo!D14: declinación −23.429° conservada como dato de entrada (Cooper daría −23.45°).",
    "C. Cal_Inv_St!Q54: referencia de 400 V = 80 % de la tensión máxima del inversor.",
    "D. Gen_Energía: el azimut se captura pero ninguna fórmula lo usa (igual que en el MEST); si la inclinación no es múltiplo de 5° o la latitud sale de 16-32°, el Factor K vale 0 y la generación sale en cero sin aviso.",
    "F. Cal_Inv_St e Inf_Módulos: las temperaturas de celda usan las fórmulas del MEST (no son el modelo NOCT estándar) y la ciudad de Inf_Vac_Res para los tres segmentos; Inf_Irrad_Sol!R (temperatura mínima) es 0 °C en todas las ciudades.",
    "G. Cal_Tarifa_Industrial: kW facturable sin el MIN con la demanda medida, bonificación FP fija de 2.5 % y neteo 1:1 entre periodos horarios; son criterios del MEST, no de CFE (A/053/2022). Cambiar solo con aval de ENNCO.",
    "E. Inf_Apoyo!T23 y las tablas derivadas de Tab_Amp_Cir_AC (Q10:AP38) no se reconstruyeron: no tenían uso en ningún cálculo.",
    "",
    "HOJAS NUEVAS Y DATOS",
    "· Cal_Cir_Ele_DC y Cal_Cir_Ele_Tab: vacías en el MEST; construidas con NOM-001-SEDE-2012 (Tab_Amp_Cir_AC filas 130-184). Sin caso de referencia del original.",
    "· Tarifas: los valores vivos siguen siendo los del MEST (2024) porque reproducen el caso de ejemplo; el bloque 'REFERENCIA CFE 2026' (fila 96 en adelante) trae las cuotas investigadas para actualizar y confirmar en app.cfe.mx.",
    "· Textos e imágenes: marca ENNCO. Pendientes: teléfono y dirección en la cabecera de los estudios, fotos de proyectos propios (imágenes 55-57) y revisión de los textos de empresa.",
    "· Se eliminaron el login, la caducidad, el borrado por fecha y el envío oculto de propuestas por Outlook. Contraseña de protección de hojas nueva (en resguardo de Teckel).",
    "",
    "Herramientas y evidencia: repositorio ennco-operacion, carpeta tools/mest-rebuild (catálogo de fórmulas, verificación por recálculo con LibreOffice, casos dorados).",
]
for i, line in enumerate(NOTES):
    n.v(f"A{2 + i}", line)
save(t.entries + d.entries + b.entries + n.entries, __file__.replace("gen_dc_tab.py", "../../../build/cat_dc_tab.json"))
